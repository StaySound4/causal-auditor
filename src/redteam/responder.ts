/**
 * 红队结论契约与应答接缝。
 *
 * 本模块不生成替代解释——那需要模型或人。它负责：
 * - 校验结论是否符合契约（结论取值、依据非空、证据引用不得虚构）；
 * - 提供两种应答适配器：静态（文件/人工填写）与模型（宿主注入生成函数）；
 * - 未绑定生成能力时显式返回不可用，而不是编造结论。
 */

import type {
  AlternativeExplanation,
  AlternativeKind,
  RedTeamFindings,
  RedTeamPacket,
} from "./packet.ts";

const KINDS: readonly AlternativeKind[] = [
  "CONFOUNDING",
  "NATURAL_COURSE",
  "PLACEBO",
  "MEASUREMENT",
  "SELECTION",
  "OTHER",
];

const CONCLUSIONS: readonly RedTeamFindings["conclusion"][] = [
  "ALTERNATIVES_IDENTIFIED",
  "NO_ALTERNATIVE_FOUND",
  "INSUFFICIENT_EVIDENCE",
];

export interface RedTeamValidation {
  valid: boolean;
  errors: string[];
  findings?: RedTeamFindings;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 校验红队结论。
 *
 * `knownEvidenceRefs` 应包含证据条目的 `id` 与原始 `identifier`（如 `PMID:123`），
 * 任何指向未知证据的引用都会导致校验失败——防止模型编造引用。
 */
export function validateRedTeamFindings(
  raw: unknown,
  knownEvidenceRefs: readonly string[],
): RedTeamValidation {
  const errors: string[] = [];
  const known = new Set(knownEvidenceRefs);

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, errors: ["结论必须是一个对象"] };
  }

  const record = raw as Record<string, unknown>;

  const conclusion = record["conclusion"];
  if (typeof conclusion !== "string" || !CONCLUSIONS.includes(conclusion as RedTeamFindings["conclusion"])) {
    errors.push(`conclusion 必须是 ${CONCLUSIONS.join(" / ")} 之一`);
  }

  const rationale = record["rationale"];
  if (!isNonEmptyString(rationale)) {
    errors.push("rationale 不能为空：必须说明得出该结论的依据");
  }

  const rawAlternatives = record["alternatives"];
  const alternatives: AlternativeExplanation[] = [];
  if (!Array.isArray(rawAlternatives)) {
    errors.push("alternatives 必须是数组（允许为空数组）");
  } else {
    rawAlternatives.forEach((entry, index) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        errors.push(`alternatives[${index}] 必须是对象`);
        return;
      }
      const item = entry as Record<string, unknown>;

      const kind = item["kind"];
      if (typeof kind !== "string" || !KINDS.includes(kind as AlternativeKind)) {
        errors.push(`alternatives[${index}].kind 必须是 ${KINDS.join(" / ")} 之一`);
      }

      const description = item["description"];
      if (!isNonEmptyString(description)) {
        errors.push(`alternatives[${index}].description 不能为空`);
      }

      const refs = item["evidenceRefs"];
      const refList: string[] = [];
      let refsValid = false;
      if (!Array.isArray(refs)) {
        errors.push(`alternatives[${index}].evidenceRefs 必须是数组（允许为空）`);
      } else {
        refsValid = true;
        refs.forEach((ref, refIndex) => {
          if (!isNonEmptyString(ref)) {
            errors.push(`alternatives[${index}].evidenceRefs[${refIndex}] 必须是非空字符串`);
            refsValid = false;
            return;
          }
          if (!known.has(ref)) {
            errors.push(
              `alternatives[${index}].evidenceRefs[${refIndex}] 引用了未知证据“${ref}”，禁止虚构引用`
            );
            refsValid = false;
            return;
          }
          refList.push(ref);
        });
      }
      if (
        typeof kind === "string" &&
        KINDS.includes(kind as AlternativeKind) &&
        isNonEmptyString(description) &&
        refsValid
      ) {
        alternatives.push({
          kind: kind as AlternativeKind,
          description,
          evidenceRefs: refList,
        });
      }
    });
  }

  if (conclusion === "ALTERNATIVES_IDENTIFIED" && alternatives.length === 0) {
    errors.push("conclusion 为 ALTERNATIVES_IDENTIFIED 时，alternatives 不能为空");
  }
  if (
    alternatives.length === 0 &&
    conclusion !== undefined &&
    conclusion !== "NO_ALTERNATIVE_FOUND" &&
    conclusion !== "INSUFFICIENT_EVIDENCE"
  ) {
    errors.push("未提出替代解释时，conclusion 必须是 NO_ALTERNATIVE_FOUND 或 INSUFFICIENT_EVIDENCE");
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    errors: [],
    findings: {
      alternatives,
      conclusion: conclusion as RedTeamFindings["conclusion"],
      rationale: rationale as string,
    },
  };
}

export interface RedTeamCapability {
  available: boolean;
  provider: string;
  reason?: string;
}

/** 红队应答接缝。真实接缝由静态与模型两个适配器共同证明。 */
export interface RedTeamResponder {
  readonly name: string;
  capability(): RedTeamCapability;
  respond(packet: RedTeamPacket, knownEvidenceRefs: readonly string[]): Promise<RedTeamFindings>;
}

/** 静态应答：结论来自文件或人工填写。 */
export function createStaticResponder(raw: unknown, name = "static-findings"): RedTeamResponder {
  return {
    name,
    capability(): RedTeamCapability {
      return {
        available: true,
        provider: name,
        reason: "结论来自外部提供的静态数据（人工或宿主模型填写）",
      };
    },
    async respond(_packet, knownEvidenceRefs): Promise<RedTeamFindings> {
      const validation = validateRedTeamFindings(raw, knownEvidenceRefs);
      if (!validation.valid || validation.findings === undefined) {
        throw new Error(`红队结论未通过契约校验：${validation.errors.join("；")}`);
      }
      return validation.findings;
    },
  };
}

export interface ModelResponderOptions {
  /** 宿主注入的生成函数；未提供时适配器声明不可用。 */
  generate?: (prompt: string) => Promise<string>;
  name?: string;
}

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("模型输出中未找到 JSON 对象");
  }
  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}

export function buildResponderPrompt(packet: RedTeamPacket): string {
  const questions = packet.checklist
    .map((entry, index) => `${index + 1}. ${entry.question}${entry.relatedBias !== undefined ? `（${entry.relatedBias}）` : ""}`)
    .join("\n");
  const evidence = packet.input.evidence
    .map(
      (item) =>
        `- id=${item.id} identifier=${item.identifier} 方向=${item.direction ?? "未声明"} 类型=${
          item.studyType ?? "未知"
        } 要点=${item.keyFindings}`,
    )
    .join("\n");

  return [
    "你是反事实红队审查员。你没有看到任何因果结论，只看到原始主张与双向证据。",
    "任务：检验零效应竞争解释（自然病程/安慰剂/均值回归）、混杂替代路径与长期次生代价。",
    "允许得出“未发现有力替代解释”或“证据不足”；禁止为凑数编造。",
    "引用证据时必须使用下面列出的 id；不得虚构引用。",
    "",
    "待审主张：" + packet.input.spec.rawClaim,
    "",
    "可用证据：",
    evidence.length > 0 ? evidence : "（无）",
    "",
    "待回答的问题：",
    questions,
    "",
    "只输出 JSON：",
    '{"alternatives":[{"kind":"CONFOUNDING|NATURAL_COURSE|PLACEBO|MEASUREMENT|SELECTION|OTHER","description":"...","evidenceRefs":["id"]}],',
    '"conclusion":"ALTERNATIVES_IDENTIFIED|NO_ALTERNATIVE_FOUND|INSUFFICIENT_EVIDENCE","rationale":"..."}',
  ].join("\n");
}

/** 模型应答：由宿主注入生成函数；未注入即不可用。 */
export function createModelResponder(options: ModelResponderOptions = {}): RedTeamResponder {
  const name = options.name ?? "model-responder";
  const generate = options.generate;
  return {
    name,
    capability(): RedTeamCapability {
      if (generate === undefined) {
        return {
          available: false,
          provider: name,
          reason: "宿主未注入生成函数，无法产出红队结论",
        };
      }
      return { available: true, provider: name, reason: "由宿主模型生成，结论需人工复核" };
    },
    async respond(packet, knownEvidenceRefs): Promise<RedTeamFindings> {
      if (generate === undefined) {
        throw new Error("红队生成能力不可用");
      }
      const text = await generate(buildResponderPrompt(packet));
      const validation = validateRedTeamFindings(extractJson(text), knownEvidenceRefs);
      if (!validation.valid || validation.findings === undefined) {
        throw new Error(`模型输出未通过契约校验：${validation.errors.join("；")}`);
      }
      return validation.findings;
    },
  };
}

/** 已知证据引用集合：同时接受内部 id 与原始标识符。 */
export function collectEvidenceRefs(packet: RedTeamPacket): string[] {
  const refs = new Set<string>();
  for (const item of packet.input.evidence) {
    refs.add(item.id);
    refs.add(item.identifier);
  }
  return [...refs];
}
