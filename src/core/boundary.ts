/**
 * Step 0 边界门禁。
 *
 * 职责：判断一条主张的**结构化输入**是否足以定义可审计的因果问题。
 *
 * 明确不做的事（见 docs/adr/0002）：
 * - 不解析自然语言。自然语言到结构体的抽取由宿主模型完成；未提供的字段保持缺失。
 * - 不填充任何“默认值”。缺什么就要求澄清什么。
 * - 不因结局是主观量表而阻断；改为记录风险标记。
 */

import type {
  BoundaryResult,
  ClaimInput,
  ClaimSpec,
  DomainKind,
  MissingRequirement,
  SpecFlag,
} from "./types.ts";

type RequirementField =
  | "domain"
  | "exposure.name"
  | "exposure.route"
  | "exposure.dose"
  | "exposure.definition"
  | "outcome.name"
  | "outcome.metricType"
  | "population.description";

/**
 * 各领域的必填要素。
 * 物质类暴露要求途径与剂量；行为/商业/社会类要求暴露定义。
 */
const REQUIREMENTS: Record<DomainKind, readonly RequirementField[]> = {
  CLINICAL: [
    "exposure.name",
    "exposure.route",
    "exposure.dose",
    "outcome.name",
    "outcome.metricType",
    "population.description",
  ],
  NUTRITIONAL: [
    "exposure.name",
    "exposure.route",
    "exposure.dose",
    "outcome.name",
    "outcome.metricType",
    "population.description",
  ],
  BEHAVIORAL: [
    "exposure.name",
    "exposure.definition",
    "outcome.name",
    "outcome.metricType",
    "population.description",
  ],
  COMMERCIAL: [
    "exposure.name",
    "exposure.definition",
    "outcome.name",
    "outcome.metricType",
    "population.description",
  ],
  SOCIAL: [
    "exposure.name",
    "exposure.definition",
    "outcome.name",
    "outcome.metricType",
    "population.description",
  ],
  OTHER: [
    "exposure.name",
    "exposure.definition",
    "outcome.name",
    "outcome.metricType",
    "population.description",
  ],
};

const CLARIFICATION: Record<RequirementField, Omit<MissingRequirement, "field">> = {
  domain: {
    reason: "领域决定必填要素（是否需要给药剂量），无法由系统代猜。",
    question: "这条主张属于哪类问题？",
    options: ["临床/医疗", "营养/膳食补充", "行为/生活方式", "商业/运营", "社会/公共议题", "其他"],
  },
  "exposure.name": {
    reason: "未说明被检验的干预或暴露是什么，因果效应无从定义。",
    question: "被检验的干预或暴露具体是什么？",
  },
  "exposure.route": {
    reason: "途径决定吸收与首过代谢，缺失会使效应方向无法定义。",
    question: "暴露通过什么途径发生？",
    options: ["口服", "外用/涂抹", "吸入", "注射", "环境暴露", "其他"],
  },
  "exposure.dose": {
    reason: "剂量与频次缺失时剂量-反应关系不可定义。",
    question: "暴露的剂量与频次是多少？",
  },
  "exposure.definition": {
    reason: "未界定“什么算作暴露”，干预组无法与对照组区分。",
    question: "满足什么条件算作发生了该暴露？",
  },
  "outcome.name": {
    reason: "未说明观察的结局，无法建立暴露到结局的映射。",
    question: "要观察的结局是什么？",
  },
  "outcome.metricType": {
    reason: "结局类型决定偏误风险与所需设计（盲法、客观检测或验证量表）。",
    question: "该结局用什么类型的指标衡量？",
    options: ["客观硬终点（如事件发生、死亡）", "经过验证的量表", "替代生物标志物", "患者自报症状", "尚不确定"],
  },
  "population.description": {
    reason: "同一暴露在不同人群中的效应方向可能相反，人群缺失则效应不可定义。",
    question: "目标人群是谁？",
  },
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasValidDose(input: ClaimInput): boolean {
  const dose = input.exposure?.dose;
  if (dose === undefined) return false;
  if (!Number.isFinite(dose.amount) || dose.amount <= 0) return false;
  return isNonEmptyString(dose.unit);
}

function isSatisfied(field: RequirementField, input: ClaimInput): boolean {
  switch (field) {
    case "domain":
      return input.domain !== undefined;
    case "exposure.name":
      return isNonEmptyString(input.exposure?.name);
    case "exposure.route":
      return input.exposure?.route !== undefined;
    case "exposure.dose":
      return hasValidDose(input);
    case "exposure.definition":
      return isNonEmptyString(input.exposure?.definition);
    case "outcome.name":
      return isNonEmptyString(input.outcome?.name);
    case "outcome.metricType":
      return input.outcome?.metricType !== undefined && input.outcome.metricType !== "UNSPECIFIED";
    case "population.description":
      return isNonEmptyString(input.population?.description);
  }
}

function buildFlags(input: ClaimInput): SpecFlag[] {
  const flags: SpecFlag[] = [];

  if (input.outcome?.metricType === "SELF_REPORTED") {
    flags.push({
      code: "SELF_REPORTED_OUTCOME",
      message: "自报结局受安慰剂、期望与霍桑效应影响，必须核对盲法设计与客观辅助指标。",
    });
  }
  if (input.outcome?.metricType === "SURROGATE_BIOMARKER") {
    flags.push({
      code: "SURROGATE_ENDPOINT",
      message: "替代标志物改善不必然转化为临床获益，需核验该标志物与硬终点的关联强度。",
    });
  }
  if (!isNonEmptyString(input.comparison)) {
    flags.push({
      code: "NO_COMPARATOR_DECLARED",
      message: "未声明对照条件，无法区分干预效应与自然病程、均值回归或安慰剂效应。",
    });
  }
  if (!isNonEmptyString(input.timeframe)) {
    flags.push({
      code: "UNSPECIFIED_TIME_HORIZON",
      message: "未声明观察时间窗，短期与长期效应可能方向不同。",
    });
  }

  return flags;
}

/**
 * 评估边界完整性。
 *
 * 输入是**已结构化**的主张。若调用方只提供 `rawClaim`，结果必然是要求澄清——
 * 这是正确行为，而不是缺陷：系统不得替用户编造剂量与人群。
 */
export function evaluateBoundary(input: ClaimInput): BoundaryResult {
  if (input.domain === undefined) {
    return {
      status: "NEEDS_CLARIFICATION",
      rawClaim: input.rawClaim,
      missing: [{ field: "domain", ...CLARIFICATION.domain }],
    };
  }

  const missing: MissingRequirement[] = REQUIREMENTS[input.domain]
    .filter((field) => !isSatisfied(field, input))
    .map((field) => ({ field, ...CLARIFICATION[field] }));

  if (missing.length > 0) {
    return { status: "NEEDS_CLARIFICATION", rawClaim: input.rawClaim, missing };
  }

  // 要素齐全。此处仅搬运用户提供的值，不做任何补全。
  const exposure: ClaimSpec["exposure"] = { name: input.exposure?.name ?? "" };
  if (input.exposure?.route !== undefined) exposure.route = input.exposure.route;
  if (input.exposure?.dose !== undefined) exposure.dose = input.exposure.dose;
  if (input.exposure?.definition !== undefined) exposure.definition = input.exposure.definition;

  const outcome: ClaimSpec["outcome"] = {
    name: input.outcome?.name ?? "",
    metricType: input.outcome?.metricType ?? "UNSPECIFIED",
  };

  const population: ClaimSpec["population"] = {
    description: input.population?.description ?? "",
  };
  if (input.population?.baseline !== undefined) population.baseline = input.population.baseline;

  const spec: ClaimSpec = {
    rawClaim: input.rawClaim,
    domain: input.domain,
    exposure,
    outcome,
    population,
    assumptions: [],
    flags: buildFlags(input),
  };
  if (input.comparison !== undefined) spec.comparison = input.comparison;
  if (input.timeframe !== undefined) spec.timeframe = input.timeframe;

  return { status: "READY", spec };
}
