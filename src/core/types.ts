/**
 * 领域类型定义。
 *
 * 设计约束（见 docs/adr/0002）：
 * - 判定必须能表达“未知/证据不足”，禁止二值真伪。
 * - 任何结论都要能追溯到证据条目（外部事实）或图与假设（结构推论）。
 */

/** 主张所属领域。领域决定必填要素，而非一刀切要求给药剂量。 */
export type DomainKind =
  | "CLINICAL"
  | "NUTRITIONAL"
  | "BEHAVIORAL"
  | "COMMERCIAL"
  | "SOCIAL"
  | "OTHER";

/** 暴露途径。仅对物质类暴露有意义。 */
export type ExposureRoute =
  | "ORAL"
  | "TOPICAL"
  | "INHALED"
  | "INJECTION"
  | "BEHAVIORAL"
  | "ENVIRONMENTAL"
  | "OTHER";

/** 结局类型。自报结局不阻断审计，但触发盲法风险标记。 */
export type OutcomeMetricType =
  | "HARD_ENDPOINT"
  | "VALIDATED_INSTRUMENT"
  | "SURROGATE_BIOMARKER"
  | "SELF_REPORTED"
  | "UNSPECIFIED";

/** 判定取值。`INSUFFICIENT_EVIDENCE` 与 `CONFLICTING` 是一等公民。 */
export type Verdict =
  | "SUPPORTED"
  | "REFUTED"
  | "CONFLICTING"
  | "INSUFFICIENT_EVIDENCE"
  | "NOT_APPLICABLE";

export interface DoseSpec {
  amount: number;
  unit: string;
  frequency?: string;
}

export interface ExposureSpec {
  name: string;
  /** 物质类暴露需要；行为/商业类可省略。 */
  route?: ExposureRoute;
  /** 物质类暴露需要；行为/商业类可省略。 */
  dose?: DoseSpec;
  /** 行为/商业/社会类暴露的界定（“什么算作暴露”）。 */
  definition?: string;
}

export interface OutcomeSpec {
  name: string;
  metricType: OutcomeMetricType;
}

export interface PopulationSpec {
  description: string;
  baseline?: string;
}

/** 风险标记：提示需要注意的问题，本身不构成结论。 */
export interface SpecFlag {
  code: SpecFlagCode;
  message: string;
}

export type SpecFlagCode =
  | "SELF_REPORTED_OUTCOME"
  | "SURROGATE_ENDPOINT"
  | "NO_COMPARATOR_DECLARED"
  | "UNSPECIFIED_TIME_HORIZON";

/** 已定稿的因果主张规格。 */
export interface ClaimSpec {
  rawClaim: string;
  domain: DomainKind;
  exposure: ExposureSpec;
  outcome: OutcomeSpec;
  population: PopulationSpec;
  comparison?: string;
  timeframe?: string;
  /** 记录在案的非实质假设（例如“按用户措辞理解”）。不得用于填充关键变量。 */
  assumptions: string[];
  flags: SpecFlag[];
}

/** 待定稿输入：未提供或无法确定的字段保持缺失，绝不由系统猜测。 */
export interface ClaimInput {
  rawClaim: string;
  domain?: DomainKind;
  exposure?: Partial<ExposureSpec>;
  outcome?: Partial<OutcomeSpec>;
  population?: Partial<PopulationSpec>;
  comparison?: string;
  timeframe?: string;
}

/** 需澄清项。`options` 仅用于帮助用户表达，不会被自动应用。 */
export interface MissingRequirement {
  field: string;
  reason: string;
  question: string;
  options?: string[];
}

export type BoundaryResult =
  | { status: "READY"; spec: ClaimSpec }
  | { status: "NEEDS_CLARIFICATION"; rawClaim: string; missing: MissingRequirement[] };
