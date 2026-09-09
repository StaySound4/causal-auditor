/**
 * 审计编排器。
 *
 * 契约（见 docs/adr/0002）：
 * - 缺要素 → 返回澄清请求，不进入后续阶段。
 * - 检索能力缺失 → 报告显式标注 `UNAVAILABLE`，不静默降级、不编造证据。
 * - 红队结论由宿主提供；未提供时报告标注“尚未填写”，而不是替模型编造。
 */

import { scanBiases } from "../core/bias_catalog.ts";
import type { BiasContext, BiasFinding, DesignInfo } from "../core/bias_catalog.ts";
import { findAdjustmentSets } from "../core/dag.ts";
import type { AdjustmentResult, DAG } from "../core/dag.ts";
import { evaluateBoundary } from "../core/boundary.ts";
import type { ClaimInput, ClaimSpec, MissingRequirement } from "../core/types.ts";
import { EvidenceEngine } from "../evidence/engine.ts";
import type { EvidenceQuery, EvidenceResult, EvidenceSearchProvider } from "../evidence/types.ts";
import { buildRedTeamPacket } from "../redteam/packet.ts";
import type { RedTeamPacket } from "../redteam/packet.ts";
import { collectEvidenceRefs } from "../redteam/responder.ts";
import type { RedTeamResponder } from "../redteam/responder.ts";
import { proposeVerdict, renderReport } from "../report/render.ts";
import type { VerdictProposal } from "../report/render.ts";

export interface AuditRequest {
  claim: ClaimInput;
  dag?: DAG;
  latent?: readonly string[];
  adjustmentSet?: readonly string[];
  design?: DesignInfo;
}

export interface AuditDependencies {
  searchProvider: EvidenceSearchProvider;
  /** 可选：红队应答适配器（静态或模型）。未提供时报告标注“尚未填写”。 */
  redTeamResponder?: RedTeamResponder;
}

export interface AuditNotes {
  capabilityGaps: string[];
  /** 检索式质量提示（例如非 ASCII 术语导致召回率低）。 */
  queryWarnings: string[];
  /** 明确记录哪些阶段未执行。 */
  notExecuted: string[];
}

export type AuditOutcome =
  | {
      status: "BLOCKED_NEEDS_CLARIFICATION";
      rawClaim: string;
      missing: MissingRequirement[];
    }
  | {
      status: "COMPLETE";
      spec: ClaimSpec;
      biases: BiasFinding[];
      evidence: EvidenceResult;
      adjustment?: AdjustmentResult;
      proposal: VerdictProposal;
      report: string;
      notes: AuditNotes;
    };

/** 由结构化主张生成双向检索式。这是模板拼接，不是语言理解。 */
export function buildEvidenceQueries(spec: ClaimSpec): EvidenceQuery {
  const wrap = (text: string) => `(${text})`;
  const exposure = wrap(spec.exposure.name);
  const outcome = wrap(spec.outcome.name);
  const population = wrap(spec.population.description);

  // 用括号显式限定布尔结构，并加出版物类型过滤，避免退化为宽泛关键词堆叠。
  const confirmatory = [
    exposure,
    outcome,
    population,
    '("randomized controlled trial"[pt] OR "systematic review"[pt] OR "meta-analysis"[pt])',
  ].join(" AND ");

  const falsification = [
    exposure,
    outcome,
    '(bioavailability OR absorption OR hydrolysis OR "null result" OR "negative trial" OR retraction OR "adverse effect" OR "conflicting evidence")',
  ].join(" AND ");

  return { claim: spec.rawClaim, confirmatory, falsification };
}

/** 检出检索词中的非 ASCII 字符，提示 PubMed 可能无法匹配。 */
export function detectQueryWarnings(spec: ClaimSpec): string[] {
  const warnings: string[] = [
    "证伪式检索依赖关键词，阴性结果常未被索引或未发表；检索结果不能证明“不存在反对证据”。",
  ];
  const terms = [spec.exposure.name, spec.outcome.name, spec.population.description];
  if (terms.some((term) => /[^\x00-\x7F]/.test(term))) {
    warnings.push(
      "检索词包含非 ASCII 字符，PubMed 全文索引可能无法匹配；建议补充英文或 MeSH 术语以提高召回率。",
    );
  }
  return warnings;
}

export async function runAudit(
  request: AuditRequest,
  deps: AuditDependencies,
): Promise<AuditOutcome> {
  const boundary = evaluateBoundary(request.claim);
  if (boundary.status === "NEEDS_CLARIFICATION") {
    return {
      status: "BLOCKED_NEEDS_CLARIFICATION",
      rawClaim: boundary.rawClaim,
      missing: boundary.missing,
    };
  }

  const spec = boundary.spec;
  const notes: AuditNotes = { capabilityGaps: [], queryWarnings: [], notExecuted: [] };
  notes.queryWarnings.push(...detectQueryWarnings(spec));

  const biasContext: BiasContext = { spec };
  if (request.dag !== undefined) biasContext.dag = request.dag;
  if (request.latent !== undefined) biasContext.latent = request.latent;
  if (request.adjustmentSet !== undefined) biasContext.adjustmentSet = request.adjustmentSet;
  if (request.design !== undefined) biasContext.design = request.design;
  const biases = scanBiases(biasContext);

  const adjustment =
    request.dag !== undefined
      ? findAdjustmentSets(request.dag, "X", "Y", request.latent !== undefined ? { latent: request.latent } : {})
      : undefined;

  const capability = deps.searchProvider.capability();
  if (!capability.available) {
    notes.capabilityGaps.push(`检索能力不可用：${capability.reason ?? "未说明原因"}`);
  }

  const engine = new EvidenceEngine(deps.searchProvider);
  let evidence: EvidenceResult;
  try {
    evidence = await engine.retrieve(buildEvidenceQueries(spec));
  } catch (error) {
    // 检索执行失败必须可披露，而不是让整个审计崩溃或静默返回空结果。
    evidence = {
      status: "UNAVAILABLE",
      provider: deps.searchProvider.name,
      reason: `检索执行失败：${error instanceof Error ? error.message : String(error)}`,
    };
    notes.capabilityGaps.push(evidence.reason);
  }

  const redTeamInput: Parameters<typeof buildRedTeamPacket>[0] = {
    spec,
    evidence: evidence.status === "OK" ? evidence.items : [],
  };
  if (request.dag !== undefined) redTeamInput.dag = request.dag;
  if (request.design !== undefined) redTeamInput.design = request.design;

  let redTeam = buildRedTeamPacket(redTeamInput);
  if (deps.redTeamResponder === undefined) {
    notes.notExecuted.push("红队结论未填写（未提供 redTeamResponder）");
  } else {
    const redTeamCapability = deps.redTeamResponder.capability();
    if (!redTeamCapability.available) {
      notes.capabilityGaps.push(
        `红队能力不可用：${redTeamCapability.reason ?? "未说明原因"}`
      );
    } else {
      try {
        const findings = await deps.redTeamResponder.respond(
          redTeam,
          collectEvidenceRefs(redTeam)
        );
        redTeam = { ...redTeam, findings };
      } catch (error) {
        // 结论不合约时拒绝并入，并如实记录，而不是降级接受。
        notes.notExecuted.push(
          `红队结论未并入：${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  const proposal = proposeVerdict(evidence, biases);

  const reportInput: Parameters<typeof renderReport>[0] = {
    spec,
    biases,
    evidence,
    redTeam,
    proposal,
    notes,
  };
  if (adjustment !== undefined && request.dag !== undefined) {
    reportInput.graph = { dag: request.dag, adjustment };
  }

  const report = renderReport(reportInput);

  const outcome: AuditOutcome = {
    status: "COMPLETE",
    spec,
    biases,
    evidence,
    proposal,
    report,
    notes,
  };
  if (adjustment !== undefined) outcome.adjustment = adjustment;
  return outcome;
}
