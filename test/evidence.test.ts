import { test } from "node:test";
import assert from "node:assert/strict";

import { EvidenceEngine } from "../src/evidence/engine.ts";
import { createReplayProvider } from "../src/evidence/adapters/replay.ts";
import { createUnavailableProvider } from "../src/evidence/adapters/unavailable.ts";
import type { EvidenceQuery, RawEvidenceItem } from "../src/evidence/types.ts";

const query: EvidenceQuery = {
  claim: "口服胶原蛋白肽改善皮肤弹性",
  confirmatory: "collagen peptide oral supplementation skin elasticity randomized controlled trial",
  falsification: "collagen peptide oral bioavailability hydrolysis intact absorption criticism",
};

function item(overrides: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  return {
    source: "PUBMED",
    identifier: "PMID:12345678",
    title: "示例研究",
    year: 2024,
    studyType: "RCT",
    sampleSize: 120,
    direction: "SUPPORTS",
    keyFindings: "干预组皮肤弹性指标改善",
    ...overrides,
  };
}

test("检索能力不可用时报告 UNAVAILABLE，而不是返回空结论", async () => {
  const engine = new EvidenceEngine(createUnavailableProvider("宿主未提供检索工具"));
  const result = await engine.retrieve(query);
  assert.equal(result.status, "UNAVAILABLE");
  if (result.status !== "UNAVAILABLE") return;
  assert.match(result.reason, /未提供/);
});

test("回放适配器返回双向检索结果并记录检索式", async () => {
  const provider = createReplayProvider({
    confirmatory: [item()],
    falsification: [item({ identifier: "PMID:87654321", direction: "REFUTES", keyFindings: "未检测到完整肽段进入体循环" })],
  });
  const engine = new EvidenceEngine(provider);
  const result = await engine.retrieve(query);

  assert.equal(result.status, "OK");
  if (result.status !== "OK") return;
  assert.equal(result.items.length, 2);
  assert.equal(result.metadata.queries.confirmatory, query.confirmatory);
  assert.equal(result.metadata.queries.falsification, query.falsification);
  assert.equal(result.metadata.byDirection.SUPPORTS, 1);
  assert.equal(result.metadata.byDirection.REFUTES, 1);
});

test("元数据是可核验事实，且明确声明不是证据充分性评分", async () => {
  const provider = createReplayProvider({ confirmatory: [item()], falsification: [] });
  const engine = new EvidenceEngine(provider);
  const result = await engine.retrieve(query);
  assert.equal(result.status, "OK");
  if (result.status !== "OK") return;

  assert.equal(typeof result.metadata.totalUnique, "number");
  assert.ok(result.metadata.disclaimer.length > 0);
  assert.match(result.metadata.disclaimer, /不是证据充分性|非证据充分性/);
  assert.equal(
    Object.keys(result.metadata).some((key) => /saturat|饱和度/i.test(key)),
    false,
    "不得输出饱和度字段",
  );
});

test("缺少标识符的条目被拒绝并记录原因", async () => {
  const provider = createReplayProvider({
    confirmatory: [item(), item({ identifier: "", title: "无标识条目" })],
    falsification: [],
  });
  const engine = new EvidenceEngine(provider);
  const result = await engine.retrieve(query);
  assert.equal(result.status, "OK");
  if (result.status !== "OK") return;

  assert.equal(result.items.length, 1);
  assert.equal(result.metadata.rejected.length, 1);
  assert.match(result.metadata.rejected[0]?.reason ?? "", /标识符/);
});

test("重复标识符去重，保留首次出现的条目", async () => {
  const provider = createReplayProvider({
    confirmatory: [item({ title: "首次" }), item({ identifier: "doi:10.1000/ABC", title: "重复来源" })],
    falsification: [item({ identifier: "DOI:10.1000/abc", title: "大小写不同的同一篇" })],
  });
  const engine = new EvidenceEngine(provider);
  const result = await engine.retrieve(query);
  assert.equal(result.status, "OK");
  if (result.status !== "OK") return;

  assert.equal(result.items.length, 2, "DOI 大小写不同应视为同一篇");
  assert.equal(result.metadata.totalRaw, 3);
  assert.equal(result.metadata.totalUnique, 2);
});

test("撤回与更正标记被保留，供报告披露", async () => {
  const provider = createReplayProvider({
    confirmatory: [item({ retracted: true, correctionNotice: "2025 年撤稿" })],
    falsification: [],
  });
  const engine = new EvidenceEngine(provider);
  const result = await engine.retrieve(query);
  assert.equal(result.status, "OK");
  if (result.status !== "OK") return;

  assert.equal(result.items[0]?.retracted, true);
  assert.match(result.items[0]?.correctionNotice ?? "", /撤稿/);
});

test("未声明方向的条目单独计数，不被自动归入支持或反对", async () => {
  const undeclared: RawEvidenceItem = {
    source: "PUBMED",
    identifier: "PMID:99999999",
    title: "方向未声明的研究",
    keyFindings: "报告了结果但未声明相对待审主张的方向",
  };
  const provider = createReplayProvider({ confirmatory: [undeclared], falsification: [] });
  const engine = new EvidenceEngine(provider);
  const result = await engine.retrieve(query);
  assert.equal(result.status, "OK");
  if (result.status !== "OK") return;

  assert.equal(result.metadata.byDirection.UNDECLARED, 1);
  assert.equal(result.metadata.byDirection.SUPPORTS, undefined);
});

test("监管信号与年份跨度被记录", async () => {
  const provider = createReplayProvider({
    confirmatory: [item({ year: 2019 }), item({ identifier: "FDA-2025-001", source: "REGULATORY", year: 2025 })],
    falsification: [],
  });
  const engine = new EvidenceEngine(provider);
  const result = await engine.retrieve(query);
  assert.equal(result.status, "OK");
  if (result.status !== "OK") return;

  assert.equal(result.metadata.hasRegulatorySignal, true);
  assert.equal(result.metadata.yearRange.earliest, 2019);
  assert.equal(result.metadata.yearRange.latest, 2025);
});

test("每个条目携带检索时间与来源检索式，保证可追溯", async () => {
  const provider = createReplayProvider({ confirmatory: [item()], falsification: [] });
  const engine = new EvidenceEngine(provider);
  const result = await engine.retrieve(query);
  assert.equal(result.status, "OK");
  if (result.status !== "OK") return;

  const first = result.items[0];
  assert.ok(first !== undefined);
  assert.ok(!Number.isNaN(Date.parse(first.retrievedAt)));
  assert.equal(first.retrievalQuery, query.confirmatory);
  assert.equal(first.provider, provider.name);
});
