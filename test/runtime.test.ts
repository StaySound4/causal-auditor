import { test } from "node:test";
import assert from "node:assert/strict";

import { createReplayProvider } from "../src/evidence/adapters/replay.ts";
import { createUnavailableProvider } from "../src/evidence/adapters/unavailable.ts";
import { extractAbstracts } from "../src/evidence/adapters/pubmed.ts";
import { buildEvidenceQueries, runAudit } from "../src/runtime/orchestrator.ts";
import { createStaticResponder } from "../src/redteam/responder.ts";
import { buildSingleTurnPrompt, singleTurnCapability } from "../src/runtime/single_turn_prompt.ts";
import type { AuditRequest } from "../src/runtime/orchestrator.ts";
import type { RawEvidenceItem } from "../src/evidence/types.ts";

const completeRequest: AuditRequest = {
  claim: {
    rawClaim: "口服胶原蛋白肽改善皮肤弹性",
    domain: "NUTRITIONAL",
    exposure: { name: "胶原蛋白肽", route: "ORAL", dose: { amount: 5000, unit: "mg" } },
    outcome: { name: "皮肤弹性", metricType: "VALIDATED_INSTRUMENT" },
    population: { description: "健康成年女性" },
    comparison: "安慰剂",
    timeframe: "12 周",
  },
};

const fixtureItem: RawEvidenceItem = {
  source: "PUBMED",
  identifier: "PMID:11111111",
  title: "示例随机对照试验",
  year: 2024,
  studyType: "RCT",
  direction: "SUPPORTS",
  keyFindings: "干预组皮肤弹性改善",
};

test("要素缺失时阻断并给出澄清项，不进入审计", async () => {
  const outcome = await runAudit(
    { claim: { rawClaim: "喝茶能防癌" } },
    { searchProvider: createUnavailableProvider("测试用") },
  );
  assert.equal(outcome.status, "BLOCKED_NEEDS_CLARIFICATION");
  if (outcome.status !== "BLOCKED_NEEDS_CLARIFICATION") return;
  assert.ok(outcome.missing.some((item) => item.field === "domain"));
});

test("检索能力缺失时仍完成审计，但判定为证据不足并披露缺口", async () => {
  const outcome = await runAudit(completeRequest, {
    searchProvider: createUnavailableProvider("宿主未提供检索工具"),
  });
  assert.equal(outcome.status, "COMPLETE");
  if (outcome.status !== "COMPLETE") return;

  assert.equal(outcome.proposal.verdict, "INSUFFICIENT_EVIDENCE");
  assert.equal(outcome.notes.capabilityGaps.length, 1);
  assert.match(outcome.report, /证据不足/);
  assert.match(outcome.report, /未执行检索|检索未执行/);
});

test("红队结论未提供时明确记录为未执行，而不是替模型编造", async () => {
  const outcome = await runAudit(completeRequest, {
    searchProvider: createReplayProvider({ confirmatory: [fixtureItem], falsification: [] }),
  });
  assert.equal(outcome.status, "COMPLETE");
  if (outcome.status !== "COMPLETE") return;

  assert.ok(outcome.notes.notExecuted.some((item) => /红队/.test(item)));
  assert.match(outcome.report, /红队结论尚未填写/);
});

test("提供红队结论时并入报告", async () => {
  const outcome = await runAudit(completeRequest, {
    searchProvider: createReplayProvider({ confirmatory: [fixtureItem], falsification: [] }),
    redTeamResponder: createStaticResponder({
      alternatives: [
        { kind: "NATURAL_COURSE", description: "季节性皮肤状态波动", evidenceRefs: [] },
      ],
      conclusion: "ALTERNATIVES_IDENTIFIED",
      rationale: "存在未控制的季节因素",
    }),
  });
  assert.equal(outcome.status, "COMPLETE");
  if (outcome.status !== "COMPLETE") return;

  assert.match(outcome.report, /季节性皮肤状态波动/);
  assert.doesNotMatch(outcome.report, /红队结论尚未填写/);
});

test("提供因果图时报告给出后门调整集结论", async () => {
  const outcome = await runAudit(
    {
      ...completeRequest,
      dag: { nodes: ["X", "Z", "Y"], edges: [["Z", "X"], ["Z", "Y"], ["X", "Y"]] },
    },
    { searchProvider: createReplayProvider({ confirmatory: [fixtureItem], falsification: [] }) },
  );
  assert.equal(outcome.status, "COMPLETE");
  if (outcome.status !== "COMPLETE") return;

  assert.equal(outcome.adjustment?.status, "IDENTIFIABLE");
  assert.match(outcome.report, /后门调整集/);
  assert.match(outcome.report, /基于已声明图与假设/);
});

test("检索式生成器给出互不相同的证实式与证伪式", () => {
  const outcome = completeRequest.claim;
  const spec = {
    rawClaim: outcome.rawClaim,
    domain: "NUTRITIONAL" as const,
    exposure: { name: "胶原蛋白肽", route: "ORAL" as const },
    outcome: { name: "皮肤弹性", metricType: "VALIDATED_INSTRUMENT" as const },
    population: { description: "健康成年女性" },
    assumptions: [],
    flags: [],
  };
  const queries = buildEvidenceQueries(spec);
  assert.notEqual(queries.confirmatory, queries.falsification);
  assert.match(queries.falsification, /bioavailability|negative|retraction/);
});

test("单轮模式明确标注为非隔离，并禁止编造检索结果", () => {
  const capability = singleTurnCapability();
  assert.equal(capability.isolated, false);

  const prompt = buildSingleTurnPrompt("口服胶原蛋白肽改善皮肤弹性");
  assert.match(prompt, /非隔离/);
  assert.match(prompt, /禁止编造/);
  assert.match(prompt, /未实际调用工具/);
  assert.match(prompt, /不得强行凑/);
});

test("PubMed 摘要解析器可在离线夹具上工作", () => {
  const xml = `<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID Version="1">12345678</PMID><Article><Abstract><AbstractText Label="BACKGROUND">背景文本。</AbstractText><AbstractText Label="RESULTS">结果文本。</AbstractText></Abstract></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>`;
  const abstracts = extractAbstracts(xml);
  assert.equal(abstracts.get("12345678"), "背景文本。 结果文本。");
});
