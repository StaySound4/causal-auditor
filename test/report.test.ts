import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateBoundary } from "../src/core/boundary.ts";
import { scanBiases } from "../src/core/bias_catalog.ts";
import { EvidenceEngine } from "../src/evidence/engine.ts";
import { createReplayProvider } from "../src/evidence/adapters/replay.ts";
import { createUnavailableProvider } from "../src/evidence/adapters/unavailable.ts";
import { proposeVerdict, renderReport } from "../src/report/render.ts";
import { buildRedTeamPacket } from "../src/redteam/packet.ts";
import type { ClaimInput } from "../src/core/types.ts";
import type { RawEvidenceItem } from "../src/evidence/types.ts";

function specOf(input: ClaimInput) {
  const result = evaluateBoundary(input);
  assert.equal(result.status, "READY");
  if (result.status !== "READY") throw new Error("unreachable");
  return result.spec;
}

const spec = specOf({
  rawClaim: "口服胶原蛋白肽改善皮肤弹性",
  domain: "NUTRITIONAL",
  exposure: { name: "胶原蛋白肽", route: "ORAL", dose: { amount: 5000, unit: "mg" } },
  outcome: { name: "皮肤弹性", metricType: "VALIDATED_INSTRUMENT" },
  population: { description: "健康成年女性" },
  comparison: "安慰剂",
});

function raw(overrides: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  return {
    source: "PUBMED",
    identifier: "PMID:11111111",
    title: "示例随机对照试验",
    year: 2024,
    studyType: "RCT",
    direction: "SUPPORTS",
    keyFindings: "干预组皮肤弹性指标改善",
    ...overrides,
  };
}

async function reportWith(items: RawEvidenceItem[], unavailable = false) {
  const provider = unavailable
    ? createUnavailableProvider("宿主未提供检索工具")
    : createReplayProvider({ confirmatory: items, falsification: [] });
  const engine = new EvidenceEngine(provider);
  const evidence = await engine.retrieve({
    claim: spec.rawClaim,
    confirmatory: "collagen skin elasticity rct",
    falsification: "collagen oral bioavailability criticism",
  });
  const biases = scanBiases({ spec });
  const proposal = proposeVerdict(evidence, biases);
  const markdown = renderReport({
    spec,
    biases,
    evidence,
    redTeam: buildRedTeamPacket({ spec, evidence: evidence.status === "OK" ? evidence.items : [] }),
    proposal,
  });
  return { evidence, proposal, markdown };
}

test("检索不可用时判定为证据不足，并披露能力缺口", async () => {
  const { proposal, markdown } = await reportWith([], true);
  assert.equal(proposal.verdict, "INSUFFICIENT_EVIDENCE");
  assert.match(markdown, /证据不足/);
  assert.match(markdown, /能力|未执行|不可用/);
});

test("每条证据的标识符都出现在参考文献索引中", async () => {
  const { markdown } = await reportWith([
    raw({ identifier: "PMID:11111111" }),
    raw({ identifier: "10.1000/xyz", source: "JOURNAL", direction: "REFUTES" }),
  ]);
  assert.match(markdown, /PMID:11111111/);
  assert.match(markdown, /10\.1000\/xyz/);
  assert.match(markdown, /## 参考文献与证据索引/);
});

test("报告不包含强制三档金字塔或虚假平衡结构", async () => {
  const { markdown } = await reportWith([raw()]);
  assert.doesNotMatch(markdown, /三档|金字塔|第一档|第二档|第三档/);
});

test("报告不出现饱和度百分比等伪指标", async () => {
  const { markdown } = await reportWith([raw()]);
  assert.doesNotMatch(markdown, /饱和度|saturation/i);
});

test("检索元数据声明其不是证据充分性评分", async () => {
  const { markdown } = await reportWith([raw()]);
  assert.match(markdown, /不是证据充分性/);
});

test("撤回条目被显式披露", async () => {
  const { markdown } = await reportWith([
    raw({ retracted: true, correctionNotice: "2025 年因数据问题撤稿" }),
  ]);
  assert.match(markdown, /撤稿/);
});

test("报告包含全部 22 项偏误的排查结果", async () => {
  const { markdown } = await reportWith([raw()]);
  for (let i = 1; i <= 22; i += 1) {
    assert.match(markdown, new RegExp(`B${String(i).padStart(2, "0")}`), `缺少 B${i}`);
  }
});

test("证据不足时参考文献索引不为空白占位", async () => {
  const { markdown } = await reportWith([], true);
  const section = markdown.split("## 参考文献与证据索引")[1] ?? "";
  assert.ok(section.trim().length > 0, "参考文献章节必须有实质内容");
  assert.match(section, /无|未获得/);
});

test("判定标注为需要复核，不得声称已确证", async () => {
  const { proposal, markdown } = await reportWith([raw()]);
  assert.equal(proposal.requiresReview, true);
  assert.match(markdown, /复核|待复核|提案/);
});

test("支持与反对并存时判定为证据冲突", async () => {
  const { proposal } = await reportWith([
    raw({ identifier: "PMID:1", direction: "SUPPORTS" }),
    raw({ identifier: "PMID:2", direction: "REFUTES" }),
  ]);
  assert.equal(proposal.verdict, "CONFLICTING");
});

test("撤回条目不计入方向统计", async () => {
  const { proposal } = await reportWith([
    raw({ identifier: "PMID:1", direction: "SUPPORTS", retracted: true }),
  ]);
  assert.equal(proposal.verdict, "INSUFFICIENT_EVIDENCE");
  assert.match(proposal.basis, /撤稿|撤回/);
});

test("未解决项被列出", async () => {
  const { markdown } = await reportWith([raw()]);
  assert.match(markdown, /未解决|待核查/);
});
