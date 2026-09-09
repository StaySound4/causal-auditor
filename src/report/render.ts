/**
 * 审计报告渲染。
 *
 * 设计约束（见 docs/adr/0002）：
 * - 不强制三档金字塔，不制造虚假平衡。
 * - 每条外部事实都绑定编号引用，参考文献索引不得为空白占位。
 * - 判定是**基于证据方向的提案**，必须标注待复核。
 * - 显式披露能力缺口、未解决项与被拒绝条目。
 */

import type { BiasFinding } from "../core/bias_catalog.ts";
import type { AdjustmentResult, DAG } from "../core/dag.ts";
import { renderAsciiDag } from "./ascii_dag.ts";
import type { ClaimSpec, Verdict } from "../core/types.ts";
import type { EvidenceResult } from "../evidence/types.ts";
import type { RedTeamPacket } from "../redteam/packet.ts";

export interface VerdictProposal {
  verdict: Verdict;
  basis: string;
  /** 本判定只依据证据方向，未评估研究质量，必须经人工/模型复核。 */
  requiresReview: boolean;
  unresolved: string[];
}

function countDirections(evidence: EvidenceResult): {
  supports: number;
  refutes: number;
  mixed: number;
  other: number;
  retracted: number;
} {
  if (evidence.status !== "OK") {
    return { supports: 0, refutes: 0, mixed: 0, other: 0, retracted: 0 };
  }
  let supports = 0;
  let refutes = 0;
  let mixed = 0;
  let other = 0;
  let retracted = 0;
  for (const item of evidence.items) {
    if (item.retracted === true) {
      retracted += 1;
      continue;
    }
    switch (item.direction) {
      case "SUPPORTS":
        supports += 1;
        break;
      case "REFUTES":
        refutes += 1;
        break;
      case "MIXED":
        mixed += 1;
        break;
      default:
        other += 1;
    }
  }
  return { supports, refutes, mixed, other, retracted };
}

/**
 * 基于证据方向给出**提案性**判定。
 *
 * 明确不做的：不评估研究质量、不做统计合并、不宣布因果已确证。
 */
export function proposeVerdict(
  evidence: EvidenceResult,
  biases: readonly BiasFinding[],
): VerdictProposal {
  const unresolved = biases
    .filter((finding) => finding.status === "PRESENT" || finding.status === "UNKNOWN")
    .map((finding) => `${finding.id} ${finding.name}（${finding.status}）`);

  if (evidence.status === "UNAVAILABLE") {
    return {
      verdict: "INSUFFICIENT_EVIDENCE",
      basis: `检索能力不可用，未获得任何证据：${evidence.reason}`,
      requiresReview: true,
      unresolved,
    };
  }

  const counts = countDirections(evidence);
  const usable = counts.supports + counts.refutes + counts.mixed + counts.other;

  if (usable === 0) {
    return {
      verdict: "INSUFFICIENT_EVIDENCE",
      basis:
        counts.retracted > 0
          ? `检索到的 ${counts.retracted} 条条目均已撤稿或撤回，无可用证据`
          : "检索未返回可用条目",
      requiresReview: true,
      unresolved,
    };
  }

  if (counts.supports > 0 && counts.refutes > 0) {
    return {
      verdict: "CONFLICTING",
      basis: `支持 ${counts.supports} 条、反对 ${counts.refutes} 条，方向冲突，需评估研究质量后再判断`,
      requiresReview: true,
      unresolved,
    };
  }
  if (counts.refutes > 0) {
    return {
      verdict: "REFUTED",
      basis: `检索到的可用条目全部为反对方向（${counts.refutes} 条）`,
      requiresReview: true,
      unresolved,
    };
  }
  if (counts.supports > 0) {
    return {
      verdict: "SUPPORTED",
      basis: `检索到的可用条目全部为支持方向（${counts.supports} 条）；未发现反对方向条目`,
      requiresReview: true,
      unresolved,
    };
  }
  return {
    verdict: "INSUFFICIENT_EVIDENCE",
    basis: "可用条目均未声明相对待审主张的方向，无法据此判断",
    requiresReview: true,
    unresolved,
  };
}

export interface ReportInput {
  spec: ClaimSpec;
  graph?: { dag: DAG; adjustment: AdjustmentResult };
  biases: readonly BiasFinding[];
  evidence: EvidenceResult;
  redTeam?: RedTeamPacket;
  proposal: VerdictProposal;
  /** 编排器记录的能力缺口与未执行项，必须原样披露。 */
  notes?: { capabilityGaps: string[]; queryWarnings: string[]; notExecuted: string[] };
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

const VERDICT_LABEL: Record<Verdict, string> = {
  SUPPORTED: "支持（现有条目方向一致，未评估质量）",
  REFUTED: "反对（现有条目方向一致，未评估质量）",
  CONFLICTING: "证据冲突",
  INSUFFICIENT_EVIDENCE: "证据不足",
  NOT_APPLICABLE: "不适用",
};

function renderGraphSection(graph: ReportInput["graph"]): string[] {
  if (graph === undefined) {
    return ["## 一、因果结构", "", "未声明因果图；本节未做任何图论判定。", ""];
  }
  const lines = ["## 一、因果结构（基于已声明图与假设）", ""];
  const { adjustment, dag } = graph;
  const adjustmentSet = adjustment.status === "IDENTIFIABLE" ? (adjustment.minimalSets[0] ?? []) : [];
  lines.push("```text");
  lines.push(renderAsciiDag(dag, { adjustmentSet }));
  lines.push("```", "");
  switch (adjustment.status) {
    case "IDENTIFIABLE":
      lines.push(
        `- 后门调整集（最小集合）：${
          adjustment.minimalSets.map((set) => (set.length === 0 ? "∅（无需调整）" : `{${set.join(", ")}}`)).join("；")
        }`
      );
      lines.push(`- 说明：${adjustment.note}`);
      break;
    case "NO_ADJUSTMENT_SET":
      lines.push(`- 后门判据失败：${adjustment.reason}`);
      lines.push(`- 说明：${adjustment.note}`);
      break;
    case "SEARCH_LIMIT":
      lines.push(`- 未完成穷举：${adjustment.reason}`);
      lines.push(`- 说明：${adjustment.note}`);
      break;
    case "INVALID_GRAPH":
      lines.push(`- 图校验失败：${adjustment.errors.join("；")}`);
      break;
  }
  lines.push("");
  return lines;
}

function renderBiasSection(biases: readonly BiasFinding[]): string[] {
  const lines = [
    "## 二、22 项偏误排查",
    "",
    "> `未知` 表示依据不足，是正常结果；它既不代表存在该偏误，也不代表不存在。",
    "",
    "| 编号 | 偏误 | 维度 | 状态 | 判定依据 |",
    "| :--- | :--- | :--- | :--- | :--- |",
  ];
  for (const finding of biases) {
    lines.push(
      `| ${finding.id} | ${cell(finding.name)} | ${cell(finding.dimension)} | ${finding.status} | ${cell(finding.basis)} |`,
    );
  }
  lines.push("");
  return lines;
}

function renderEvidenceSection(evidence: EvidenceResult): {
  lines: string[];
  references: string[];
} {
  const lines = ["## 三、证据清单", ""];
  const references: string[] = [];

  if (evidence.status === "UNAVAILABLE") {
    lines.push(`检索未执行：${evidence.reason}`, "");
    lines.push("未获得任何证据条目，因此本次审计不引用任何文献。", "");
    return { lines, references };
  }

  if (evidence.items.length === 0) {
    lines.push("检索已执行，但未返回可用条目。", "");
  } else {
    lines.push("| 引用 | 标识符 | 年份 | 研究类型 | 方向 | 要点 |", "| :--- | :--- | :--- | :--- | :--- | :--- |");
    evidence.items.forEach((item, index) => {
      const number = index + 1;
      const flags: string[] = [];
      if (item.retracted === true) flags.push("已撤稿");
      if (item.peerReviewed === false) flags.push("未经同行评议");
      const suffix = flags.length > 0 ? `（${flags.join("；")}）` : "";
      lines.push(
        `| [${number}] | ${cell(item.identifier)}${suffix} | ${item.year ?? "未知"} | ${item.studyType ?? "未知"} | ${
          item.direction ?? "未声明"
        } | ${cell(item.keyFindings)} |`,
      );
      references.push(
        `[${number}] ${cell(item.identifier)} —— ${cell(item.title)}${item.year !== undefined ? `（${item.year}）` : ""}${
          item.retracted === true ? " **已撤稿**" : ""
        }${item.correctionNotice !== undefined ? ` 更正说明：${cell(item.correctionNotice)}` : ""}`,
      );
    });
    lines.push("");
  }

  const metadata = evidence.metadata;
  lines.push("### 检索元数据（可核验事实）", "");
  lines.push(`- 检索提供方：${metadata.provider}`);
  lines.push(`- 检索时间：${metadata.retrievedAt}`);
  lines.push(`- 证实式检索式：\`${metadata.queries.confirmatory}\``);
  lines.push(`- 证伪式检索式：\`${metadata.queries.falsification}\``);
  lines.push(`- 原始条目 ${metadata.totalRaw} 条，去重后 ${metadata.totalUnique} 条`);
  lines.push(
    `- 年份跨度：${
      metadata.yearRange.earliest !== undefined
        ? `${metadata.yearRange.earliest}–${metadata.yearRange.latest}`
        : "未提供"
    }`,
  );
  lines.push(`- 命中监管来源：${metadata.hasRegulatorySignal ? "是" : "否"}`);
  lines.push(`- 撤回条目：${metadata.retractedCount} 条`);
  lines.push(`- 被拒绝条目：${metadata.rejected.length} 条`);
  for (const rejected of metadata.rejected) {
    lines.push(`  - ${cell(rejected.title || "（无标题）")}：${cell(rejected.reason)}`);
  }
  lines.push("", `> ${metadata.disclaimer}`, "");
  return { lines, references };
}

function renderRedTeamSection(redTeam: ReportInput["redTeam"]): string[] {
  if (redTeam === undefined) {
    return ["## 四、红队反事实审查", "", "未执行红队审查。", ""];
  }
  const lines = [
    "## 四、红队反事实审查",
    "",
    `- 信息屏蔽：${redTeam.integrity.informationShielded ? "已启用（未向红队传入任何模型结论）" : "未启用"}`,
    `- 证据是否被筛选：${redTeam.integrity.evidenceFiltered ? "是（违反契约）" : "否（双向全部提供）"}`,
    "",
    "### 待核查问题",
    "",
  ];
  for (const entry of redTeam.checklist) {
    const tag = entry.relatedBias !== undefined ? `（${entry.relatedBias}）` : "";
    lines.push(`- ${cell(entry.question)}${tag}`);
  }
  lines.push("");
  if (redTeam.findings !== undefined) {
    lines.push("### 红队结论", "");
    lines.push(`- 结论：${redTeam.findings.conclusion}`);
    lines.push(`- 依据：${cell(redTeam.findings.rationale)}`);
    if (redTeam.findings.alternatives.length === 0) {
      lines.push("- 替代解释：未提出（允许，不得为凑数编造）");
    } else {
      for (const alternative of redTeam.findings.alternatives) {
        lines.push(
          `- [${alternative.kind}] ${cell(alternative.description)}${
            alternative.evidenceRefs.length > 0 ? `（证据：${alternative.evidenceRefs.join("、")}）` : ""
          }`,
        );
      }
    }
    lines.push("");
  } else {
    lines.push("> 红队结论尚未填写；上方清单由宿主模型或人工逐项回答。", "");
  }
  return lines;
}

export function renderReport(input: ReportInput): string {
  const { spec, proposal, evidence, biases, redTeam, graph } = input;
  const lines: string[] = [];

  lines.push(`# 因果审计报告：${spec.rawClaim}`, "");
  lines.push(`- 判定：**${VERDICT_LABEL[proposal.verdict]}**`);
  lines.push(`- 判定依据：${cell(proposal.basis)}`);
  lines.push(
    `- 复核状态：${
      proposal.requiresReview
        ? "**待复核**——本判定仅基于证据方向，未评估研究质量与偏误严重程度"
        : "无需复核"
    }`,
  );
  lines.push("");

  lines.push("## 审计边界与假设", "");
  lines.push(`- 领域：${spec.domain}`);
  lines.push(`- 暴露：${cell(spec.exposure.name)}${spec.exposure.route !== undefined ? `，途径 ${spec.exposure.route}` : ""}`);
  if (spec.exposure.dose !== undefined) {
    lines.push(
      `- 剂量：${spec.exposure.dose.amount} ${cell(spec.exposure.dose.unit)}${
        spec.exposure.dose.frequency !== undefined ? `，${cell(spec.exposure.dose.frequency)}` : ""
      }`,
    );
  }
  lines.push(`- 结局：${cell(spec.outcome.name)}（${spec.outcome.metricType}）`);
  lines.push(`- 人群：${cell(spec.population.description)}`);
  lines.push(`- 对照：${spec.comparison !== undefined ? cell(spec.comparison) : "未声明"}`);
  lines.push(`- 时间窗：${spec.timeframe !== undefined ? cell(spec.timeframe) : "未声明"}`);
  if (spec.assumptions.length > 0) {
    lines.push(`- 记录在案的假设：${spec.assumptions.map(cell).join("；")}`);
  }
  lines.push("");
  if (spec.flags.length > 0) {
    lines.push("### 风险标记", "");
    for (const flag of spec.flags) {
      lines.push(`- **${flag.code}**：${cell(flag.message)}`);
    }
    lines.push("");
  }

  lines.push(...renderGraphSection(graph));
  lines.push(...renderBiasSection(biases));

  const evidenceSection = renderEvidenceSection(evidence);
  lines.push(...evidenceSection.lines);
  lines.push(...renderRedTeamSection(redTeam));

  lines.push("## 五、未解决项与能力缺口", "");
  if (proposal.unresolved.length === 0) {
    lines.push("- 无已命中的偏误项（不代表不存在，仅表示在已声明信息下未判定为存在）");
  } else {
    lines.push("- 下列偏误项处于 `PRESENT` 或 `UNKNOWN`，结论前需逐项核查：");
    for (const item of proposal.unresolved) {
      lines.push(`  - ${cell(item)}`);
    }
  }
  if (evidence.status === "UNAVAILABLE") {
    lines.push(`- 检索能力缺口：${cell(evidence.reason)}`);
  }
  if (evidence.status === "OK" && evidence.metadata.rejected.length > 0) {
    lines.push(`- 有 ${evidence.metadata.rejected.length} 条检索结果因缺少标识符被拒绝，未纳入分析`);
  }
  if (input.notes !== undefined) {
    for (const warning of input.notes.queryWarnings) {
      lines.push(`- 检索式提示：${cell(warning)}`);
    }
    for (const gap of input.notes.capabilityGaps) {
      lines.push(`- 能力缺口：${cell(gap)}`);
    }
    for (const item of input.notes.notExecuted) {
      lines.push(`- 未执行：${cell(item)}`);
    }
  }
  lines.push("");

  lines.push("## 参考文献与证据索引", "");
  if (evidenceSection.references.length === 0) {
    lines.push(
      evidence.status === "UNAVAILABLE"
        ? "无——本次未执行检索，未获得任何可引用条目。"
        : "无——本次检索未返回可用条目。",
    );
  } else {
    for (const reference of evidenceSection.references) {
      lines.push(reference);
    }
  }
  lines.push("");
  lines.push(
    "> 本报告由确定性引擎生成。涉及外部事实的结论以所列条目为限；" +
      "涉及结构的结论以已声明的图与假设为条件。两者均不构成对真实世界因果关系的证明。",
  );

  return lines.join("\n");
}
