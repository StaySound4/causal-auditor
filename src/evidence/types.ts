/**
 * 证据检索契约。
 *
 * 契约要点（见 docs/adr/0002）：
 * - 未调用检索工具时**不得**声称已检索；能力不可用必须显式返回 `UNAVAILABLE`。
 * - 每条证据必须携带可核验标识符（PMID / DOI / 公文号 / URL）与检索时间。
 * - 不输出“饱和度百分比”之类伪指标。
 */

export type EvidenceSource =
  | "PUBMED"
  | "COCHRANE"
  | "REGULATORY"
  | "JOURNAL"
  | "PREPRINT"
  | "WEB"
  | "OTHER";

export type StudyType =
  | "SYSTEMATIC_REVIEW"
  | "RCT"
  | "COHORT"
  | "CASE_CONTROL"
  | "CROSS_SECTIONAL"
  | "CASE_REPORT"
  | "IN_VITRO"
  | "ANIMAL"
  | "UNKNOWN";

/** 条目相对待审主张的方向。未声明时保持未声明，不自动归类。 */
export type EvidenceDirection = "SUPPORTS" | "REFUTES" | "MIXED" | "NEUTRAL";

export interface RawEvidenceItem {
  source: EvidenceSource;
  /** PMID / DOI / 监管公文号 / URL。为空则该条目会被拒绝。 */
  identifier: string;
  title: string;
  year?: number;
  studyType?: StudyType;
  sampleSize?: number;
  direction?: EvidenceDirection;
  keyFindings: string;
  excerpt?: string;
  peerReviewed?: boolean;
  retracted?: boolean;
  correctionNotice?: string;
}

/** 已入库、可追溯的证据条目。 */
export interface EvidenceItem extends RawEvidenceItem {
  id: string;
  provider: string;
  retrievalQuery: string;
  retrievedAt: string;
}

export interface EvidenceQuery {
  claim: string;
  /** 证实式检索式：寻找支持该主张的高质量研究。 */
  confirmatory: string;
  /** 证伪式检索式：寻找阴性结果、方法学质疑、监管警示。 */
  falsification: string;
}

export interface RetrievalCapability {
  available: boolean;
  provider: string;
  reason?: string;
}

/** 单次检索请求。`track` 区分证实式与证伪式，二者必须分别执行。 */
export interface EvidenceSearchRequest {
  claim: string;
  query: string;
  track: "CONFIRMATORY" | "FALSIFICATION";
}

export interface EvidenceSearchProvider {
  readonly name: string;
  capability(): RetrievalCapability;
  search(request: EvidenceSearchRequest): Promise<RawEvidenceItem[]>;
}

export interface RetrievalMetadata {
  provider: string;
  retrievedAt: string;
  queries: { confirmatory: string; falsification: string };
  totalRaw: number;
  totalUnique: number;
  rejected: { identifier: string; title: string; reason: string }[];
  bySource: Record<string, number>;
  byDirection: Record<string, number>;
  yearRange: { earliest?: number; latest?: number };
  hasRegulatorySignal: boolean;
  retractedCount: number;
  /** 明确声明：以下数字是可核验的检索事实，不是证据充分性评分。 */
  disclaimer: string;
}

export type EvidenceResult =
  | { status: "OK"; items: EvidenceItem[]; metadata: RetrievalMetadata }
  | { status: "UNAVAILABLE"; provider: string; reason: string };
