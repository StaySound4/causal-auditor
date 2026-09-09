/**
 * 双向对冲证据检索引擎。
 *
 * 职责：执行证实式与证伪式检索，去重、拒绝无标识条目、汇总可核验的检索元数据。
 * 不做的事：不评价“证据是否充分”，不输出饱和度百分比，不替模型编造文献。
 */

import type {
  EvidenceItem,
  EvidenceQuery,
  EvidenceResult,
  EvidenceSearchProvider,
  RawEvidenceItem,
  RetrievalMetadata,
} from "./types.ts";

const DISCLAIMER =
  "以下为可核验的检索事实（来源、年份、去重条目数等），不是证据充分性评分；" +
  "条目数量不能替代研究质量与设计评估。";

function normalizeIdentifier(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/, "")
    .replace(/\s+/g, "");
}

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

export class EvidenceEngine {
  private readonly provider: EvidenceSearchProvider;

  constructor(provider: EvidenceSearchProvider) {
    this.provider = provider;
  }

  async retrieve(query: EvidenceQuery): Promise<EvidenceResult> {
    const capability = this.provider.capability();
    if (!capability.available) {
      return {
        status: "UNAVAILABLE",
        provider: capability.provider,
        reason: capability.reason ?? "检索能力不可用，未执行任何检索",
      };
    }

    const retrievedAt = new Date().toISOString();
    const rejected: RetrievalMetadata["rejected"] = [];
    const seen = new Map<string, EvidenceItem>();
    let totalRaw = 0;

    const runs: { query: string; items: RawEvidenceItem[] }[] = [
      {
        query: query.confirmatory,
        items: await this.provider.search({
          claim: query.claim,
          query: query.confirmatory,
          track: "CONFIRMATORY",
        }),
      },
      {
        query: query.falsification,
        items: await this.provider.search({
          claim: query.claim,
          query: query.falsification,
          track: "FALSIFICATION",
        }),
      },
    ];

    // 证伪式检索单独执行，避免引擎把两个检索式混为一谈。
    for (const run of runs) {
      for (const raw of run.items) {
        totalRaw += 1;
        if (!isNonEmpty(raw.identifier)) {
          rejected.push({
            identifier: "",
            title: raw.title,
            reason: "缺少可核验标识符（PMID/DOI/公文号/URL）",
          });
          continue;
        }
        const key = normalizeIdentifier(raw.identifier);
        if (seen.has(key)) continue;

        const entry: EvidenceItem = {
          ...raw,
          id: key,
          provider: this.provider.name,
          retrievalQuery: run.query,
          retrievedAt,
        };
        seen.set(key, entry);
      }
    }

    const items = [...seen.values()];
    return { status: "OK", items, metadata: buildMetadata(items, query, rejected, totalRaw, capability.provider, retrievedAt) };
  }
}

function buildMetadata(
  items: readonly EvidenceItem[],
  query: EvidenceQuery,
  rejected: RetrievalMetadata["rejected"],
  totalRaw: number,
  provider: string,
  retrievedAt: string,
): RetrievalMetadata {
  const bySource: Record<string, number> = {};
  const byDirection: Record<string, number> = {};
  const years: number[] = [];
  let hasRegulatorySignal = false;
  let retractedCount = 0;

  for (const item of items) {
    bySource[item.source] = (bySource[item.source] ?? 0) + 1;
    const direction = item.direction ?? "UNDECLARED";
    byDirection[direction] = (byDirection[direction] ?? 0) + 1;
    if (item.year !== undefined) years.push(item.year);
    if (item.source === "REGULATORY") hasRegulatorySignal = true;
    if (item.retracted === true) retractedCount += 1;
  }

  const yearRange: RetrievalMetadata["yearRange"] = {};
  if (years.length > 0) {
    yearRange.earliest = Math.min(...years);
    yearRange.latest = Math.max(...years);
  }

  return {
    provider,
    retrievedAt,
    queries: { confirmatory: query.confirmatory, falsification: query.falsification },
    totalRaw,
    totalUnique: items.length,
    rejected,
    bySource,
    byDirection,
    yearRange,
    hasRegulatorySignal,
    retractedCount,
    disclaimer: DISCLAIMER,
  };
}
