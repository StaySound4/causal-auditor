/**
 * PubMed 真实检索适配器（NCBI E-utilities，无需 API Key）。
 *
 * 说明：
 * - 使用全局 `fetch`，无第三方依赖。
 * - 只做**检索与元数据抓取**，不判定方向、不做摘要，方向由人工或宿主模型依据摘要判断。
 * - 网络不可用时抛出异常，由上层决定如何披露，不返回空结果冒充“检索完成”。
 */

import type {
  EvidenceSearchProvider,
  EvidenceSearchRequest,
  RawEvidenceItem,
  RetrievalCapability,
  StudyType,
} from "../types.ts";

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const DEFAULT_RETMAX = 10;

interface ESearchResponse {
  esearchresult?: { idlist?: string[] };
}

interface ESummaryDocSum {
  uid?: string;
  title?: string;
  pubdate?: string;
  source?: string;
  pubtype?: string[];
}

interface ESummaryResponse {
  result?: Record<string, ESummaryDocSum | string[]>;
}

function pickStudyType(pubtypes: readonly string[] | undefined): StudyType {
  const joined = (pubtypes ?? []).join(" ").toLowerCase();
  if (joined.includes("systematic review") || joined.includes("meta-analysis")) return "SYSTEMATIC_REVIEW";
  if (joined.includes("randomized controlled trial")) return "RCT";
  if (joined.includes("clinical trial")) return "RCT";
  if (joined.includes("cohort")) return "COHORT";
  if (joined.includes("case-control")) return "CASE_CONTROL";
  if (joined.includes("cross-sectional")) return "CROSS_SECTIONAL";
  if (joined.includes("case reports")) return "CASE_REPORT";
  return "UNKNOWN";
}

function pickYear(pubdate: string | undefined): number | undefined {
  if (pubdate === undefined) return undefined;
  const match = /(\d{4})/.exec(pubdate);
  return match?.[1] !== undefined ? Number(match[1]) : undefined;
}

/** 从 PubMed XML 中抽取摘要文本。只做最小解析，避免引入 XML 依赖。 */
export function extractAbstracts(xml: string): Map<string, string> {
  const result = new Map<string, string>();
  const articleBlocks = xml.split("<PubmedArticle>").slice(1);
  for (const block of articleBlocks) {
    const pmid = /<PMID[^>]*>(\d+)<\/PMID>/.exec(block)?.[1];
    if (pmid === undefined) continue;
    const abstractParts = [...block.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)].map(
      (match) => (match[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    );
    if (abstractParts.length > 0) result.set(pmid, abstractParts.join(" "));
  }
  return result;
}

export interface PubMedOptions {
  retmax?: number;
  /** 注入 fetch 便于离线测试；默认使用全局 fetch。 */
  fetchImpl?: typeof fetch;
  /** NCBI 建议的 tool/email 参数，用于礼貌性标识。 */
  tool?: string;
  email?: string;
}

export function createPubMedProvider(options: PubMedOptions = {}): EvidenceSearchProvider {
  const retmax = options.retmax ?? DEFAULT_RETMAX;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const name = "pubmed-eutils";

  async function esearch(term: string): Promise<string[]> {
    const url = new URL(`${EUTILS}/esearch.fcgi`);
    url.searchParams.set("db", "pubmed");
    url.searchParams.set("term", term);
    url.searchParams.set("retmode", "json");
    url.searchParams.set("retmax", String(retmax));
    url.searchParams.set("sort", "date");
    if (options.tool !== undefined) url.searchParams.set("tool", options.tool);
    if (options.email !== undefined) url.searchParams.set("email", options.email);

    const response = await fetchImpl(url.toString(), {
      headers: { "user-agent": "causal-auditor/0.9.0 (+https://pubmed.ncbi.nlm.nih.gov/)" },
    });
    if (!response.ok) {
      throw new Error(`PubMed esearch 失败：HTTP ${response.status}`);
    }
    const body = (await response.json()) as ESearchResponse;
    return body.esearchresult?.idlist ?? [];
  }

  async function esummary(ids: readonly string[]): Promise<ESummaryDocSum[]> {
    if (ids.length === 0) return [];
    const url = new URL(`${EUTILS}/esummary.fcgi`);
    url.searchParams.set("db", "pubmed");
    url.searchParams.set("id", ids.join(","));
    url.searchParams.set("retmode", "json");
    if (options.tool !== undefined) url.searchParams.set("tool", options.tool);
    if (options.email !== undefined) url.searchParams.set("email", options.email);

    const response = await fetchImpl(url.toString());
    if (!response.ok) {
      throw new Error(`PubMed esummary 失败：HTTP ${response.status}`);
    }
    const body = (await response.json()) as ESummaryResponse;
    const record = body.result ?? {};
    return ids
      .map((id) => record[id])
      .filter((entry): entry is ESummaryDocSum => entry !== undefined && !Array.isArray(entry));
  }

  async function efetchAbstracts(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const url = new URL(`${EUTILS}/efetch.fcgi`);
    url.searchParams.set("db", "pubmed");
    url.searchParams.set("id", ids.join(","));
    url.searchParams.set("retmode", "xml");
    if (options.tool !== undefined) url.searchParams.set("tool", options.tool);
    if (options.email !== undefined) url.searchParams.set("email", options.email);

    const response = await fetchImpl(url.toString());
    if (!response.ok) {
      throw new Error(`PubMed efetch 失败：HTTP ${response.status}`);
    }
    return extractAbstracts(await response.text());
  }

  return {
    name,
    capability(): RetrievalCapability {
      return {
        available: typeof fetchImpl === "function",
        provider: name,
        reason:
          typeof fetchImpl === "function"
            ? "PubMed E-utilities 实时检索；需要网络连接"
            : "当前运行环境没有可用的 fetch 实现",
      };
    },
    async search(request: EvidenceSearchRequest): Promise<RawEvidenceItem[]> {
      const ids = await esearch(request.query);
      if (ids.length === 0) return [];
      const [summaries, abstracts] = await Promise.all([esummary(ids), efetchAbstracts(ids)]);

      return summaries.map((summary) => {
        const pmid = summary.uid ?? "";
        const abstract = abstracts.get(pmid);
        return {
          source: "PUBMED" as const,
          identifier: `PMID:${pmid}`,
          title: (summary.title ?? "（无标题）").replace(/\.$/, ""),
          ...(pickYear(summary.pubdate) !== undefined ? { year: pickYear(summary.pubdate) as number } : {}),
          studyType: pickStudyType(summary.pubtype),
          keyFindings:
            abstract !== undefined && abstract.length > 0
              ? abstract.slice(0, 400)
              : `（未获取到摘要；期刊：${summary.source ?? "未知"}）`,
          peerReviewed: true,
          // direction 刻意留空：检索结果本身不构成“支持/反对”判断。
        };
      });
    },
  };
}
