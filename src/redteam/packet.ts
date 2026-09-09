/**
 * 红队反事实审查输入包。
 *
 * 设计要点（见 docs/adr/0002）：
 * - **信息屏蔽**：只提供原始主张与双向证据，禁止输入任何模型结论；
 *   违反契约时抛出异常，而不是“尽力而为”。
 * - **不强迫生成**：允许结论为“未发现有力替代解释”或“证据不足”。
 * - 本模块只构造输入包与问题清单；替代解释的判断由宿主模型或人工完成。
 */

import { scanBiases } from "../core/bias_catalog.ts";
import type { BiasContext, BiasFinding } from "../core/bias_catalog.ts";
import type { ClaimSpec } from "../core/types.ts";
import type { EvidenceItem } from "../evidence/types.ts";

/** 被视为“结论泄漏”的字段名（归一化后比较）。 */
const FORBIDDEN_KEYS = new Set([
  "verdict",
  "conclusion",
  "diagnosis",
  "modelconclusion",
  "graphdiagnostic",
  "biasfindings",
  "recommendation",
  "assessment",
  "judgement",
  "judgment",
  "confidence",
  "confidencescore",
]);

export class ContractViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractViolationError";
  }
}

export interface RedTeamInput {
  spec: ClaimSpec;
  /** 双向全部证据，不得筛选。 */
  evidence: readonly EvidenceItem[];
  dag?: BiasContext["dag"];
  design?: BiasContext["design"];
}

export type AlternativeKind =
  | "CONFOUNDING"
  | "NATURAL_COURSE"
  | "PLACEBO"
  | "MEASUREMENT"
  | "SELECTION"
  | "OTHER";

export interface AlternativeExplanation {
  kind: AlternativeKind;
  description: string;
  /** 支撑该替代解释的证据条目 id；可为空。 */
  evidenceRefs: string[];
}

export interface RedTeamFindings {
  alternatives: AlternativeExplanation[];
  /** 允许“未发现有力替代解释”与“证据不足”。 */
  conclusion: "ALTERNATIVES_IDENTIFIED" | "NO_ALTERNATIVE_FOUND" | "INSUFFICIENT_EVIDENCE";
  rationale: string;
}

export interface ChecklistEntry {
  question: string;
  rationale: string;
  relatedBias?: string;
}

export interface RedTeamPacket {
  input: RedTeamInput;
  checklist: ChecklistEntry[];
  /** 供报告披露的契约说明。 */
  integrity: { informationShielded: true; evidenceFiltered: false };
  findings?: RedTeamFindings;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findForbiddenPaths(value: unknown, path: string, found: string[]): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findForbiddenPaths(entry, `${path}[${index}]`, found));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizeKey(key);
    if (FORBIDDEN_KEYS.has(normalized)) {
      found.push(`${path}${path === "" ? "" : "."}${key}`);
    }
    findForbiddenPaths(child, `${path}${path === "" ? "" : "."}${key}`, found);
  }
}

/** 校验输入不含任何结论字段。发现即抛异常。 */
export function assertInformationShielded(input: unknown): void {
  const found: string[] = [];
  findForbiddenPaths(input, "", found);
  if (found.length > 0) {
    throw new ContractViolationError(
      `红队输入包含结论字段，违反信息屏蔽契约：${found.join("、")}。` +
        "请只传入主张规格与双向证据。",
    );
  }
}

function buildChecklist(findings: readonly BiasFinding[]): ChecklistEntry[] {
  const checklist: ChecklistEntry[] = [
    {
      question: "若真实效应为零，仅凭自然病程、自限性缓解与安慰剂效应能否完整解释观察到的改善？",
      rationale: "零效应是竞争性解释，必须被主动检验而不是默认排除。",
    },
    {
      question: "是否存在至少一条能同时解释暴露与结局的非因果路径（如健康生活方式、社会经济地位、就医行为）？",
      rationale: "混杂是观测关联最常见的替代来源。",
    },
    {
      question: "长期暴露是否存在次生代价（器官负荷、微生态、机会成本或延误规范治疗）？",
      rationale: "净获益需要同时评估收益与代价。",
    },
    {
      question: "证据方向是否被发表偏倚与商业资助系统性扭曲？",
      rationale: "资助来源与发表倾向会改变可检索到的证据分布。",
    },
  ];

  for (const finding of findings) {
    if (finding.status === "PRESENT" || finding.status === "UNKNOWN") {
      checklist.push({
        question: `${finding.name}：${finding.whatToCheck.join("；")}？`,
        rationale: `该偏误当前状态为 ${finding.status}（依据：${finding.basis}）`,
        relatedBias: finding.id,
      });
    }
  }

  return checklist;
}

export function buildRedTeamPacket(input: RedTeamInput): RedTeamPacket {
  assertInformationShielded(input);

  const biasContext: BiasContext = { spec: input.spec };
  if (input.dag !== undefined) biasContext.dag = input.dag;
  if (input.design !== undefined) biasContext.design = input.design;
  const biasFindings = scanBiases(biasContext);

  return {
    input,
    checklist: buildChecklist(biasFindings),
    integrity: { informationShielded: true, evidenceFiltered: false },
  };
}
