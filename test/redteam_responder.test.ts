import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateBoundary } from "../src/core/boundary.ts";
import { buildRedTeamPacket } from "../src/redteam/packet.ts";
import {
  buildResponderPrompt,
  collectEvidenceRefs,
  createModelResponder,
  createStaticResponder,
  validateRedTeamFindings,
} from "../src/redteam/responder.ts";
import { runAudit } from "../src/runtime/orchestrator.ts";
import { createReplayProvider } from "../src/evidence/adapters/replay.ts";
import type { EvidenceItem, RawEvidenceItem } from "../src/evidence/types.ts";
import type { ClaimInput } from "../src/core/types.ts";

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

function evidenceItem(identifier: string): EvidenceItem {
  return {
    id: identifier.toLowerCase(),
    source: "PUBMED",
    identifier,
    title: "示例研究",
    keyFindings: "要点",
    provider: "replay-fixture",
    retrievalQuery: "query",
    retrievedAt: new Date().toISOString(),
  };
}

const refs = ["pmid:111", "PMID:111"];

test("合法结论通过校验", () => {
  const result = validateRedTeamFindings(
    {
      alternatives: [{ kind: "PLACEBO", description: "期望效应", evidenceRefs: ["PMID:111"] }],
      conclusion: "ALTERNATIVES_IDENTIFIED",
      rationale: "存在未设盲的可能",
    },
    refs,
  );
  assert.equal(result.valid, true);
  assert.equal(result.findings?.alternatives.length, 1);
});

test("虚构证据引用被拒绝", () => {
  const result = validateRedTeamFindings(
    {
      alternatives: [{ kind: "PLACEBO", description: "期望效应", evidenceRefs: ["PMID:999"] }],
      conclusion: "ALTERNATIVES_IDENTIFIED",
      rationale: "理由",
    },
    refs,
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /禁止虚构引用/.test(error)));
});

test("声称发现替代解释却给出空列表被拒绝", () => {
  const result = validateRedTeamFindings(
    { alternatives: [], conclusion: "ALTERNATIVES_IDENTIFIED", rationale: "理由" },
    refs,
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /不能为空/.test(error)));
});

test("空依据被拒绝", () => {
  const result = validateRedTeamFindings(
    { alternatives: [], conclusion: "NO_ALTERNATIVE_FOUND", rationale: "  " },
    refs,
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /rationale/.test(error)));
});

test("非法结论取值被拒绝", () => {
  const result = validateRedTeamFindings(
    { alternatives: [], conclusion: "DEFINITELY_TRUE", rationale: "理由" },
    refs,
  );
  assert.equal(result.valid, false);
});

test("允许未发现替代解释与证据不足两种诚实结论", () => {
  for (const conclusion of ["NO_ALTERNATIVE_FOUND", "INSUFFICIENT_EVIDENCE"] as const) {
    const result = validateRedTeamFindings({ alternatives: [], conclusion, rationale: "理由" }, refs);
    assert.equal(result.valid, true, `${conclusion} 应被接受`);
  }
});

test("模型应答器未注入生成函数时声明不可用", async () => {
  const responder = createModelResponder();
  assert.equal(responder.capability().available, false);
  const packet = buildRedTeamPacket({ spec, evidence: [] });
  await assert.rejects(() => responder.respond(packet, []), /不可用/);
});

test("模型应答器解析代码块包裹的 JSON 并通过校验", async () => {
  const responder = createModelResponder({
    generate: async () =>
      '```json\n{"alternatives":[{"kind":"CONFOUNDING","description":"健康生活方式混杂","evidenceRefs":["PMID:111"]}],"conclusion":"ALTERNATIVES_IDENTIFIED","rationale":"缺乏随机化信息"}\n```',
  });
  const packet = buildRedTeamPacket({ spec, evidence: [evidenceItem("PMID:111")] });
  const findings = await responder.respond(packet, collectEvidenceRefs(packet));
  assert.equal(findings.conclusion, "ALTERNATIVES_IDENTIFIED");
  assert.equal(findings.alternatives[0]?.evidenceRefs[0], "PMID:111");
});

test("模型应答器输出虚构引用时抛错，而不是静默接受", async () => {
  const responder = createModelResponder({
    generate: async () =>
      '{"alternatives":[{"kind":"CONFOUNDING","description":"混杂","evidenceRefs":["PMID:000"]}],"conclusion":"ALTERNATIVES_IDENTIFIED","rationale":"理由"}',
  });
  const packet = buildRedTeamPacket({ spec, evidence: [evidenceItem("PMID:111")] });
  await assert.rejects(() => responder.respond(packet, collectEvidenceRefs(packet)), /虚构引用/);
});

test("应答提示词包含证据 id 与全部待答问题", () => {
  const packet = buildRedTeamPacket({ spec, evidence: [evidenceItem("PMID:111")] });
  const prompt = buildResponderPrompt(packet);
  assert.match(prompt, /PMID:111/);
  assert.match(prompt, /禁止为凑数编造/);
  assert.match(prompt, /未发现有力替代解释/);
  assert.equal(prompt.includes(packet.checklist[0]?.question ?? "___"), true);
});

test("编排器：结论引用虚构证据时拒绝并入并如实记录", async () => {
  const fixture: RawEvidenceItem = {
    source: "PUBMED",
    identifier: "PMID:111",
    title: "示例",
    keyFindings: "要点",
  };
  const outcome = await runAudit(
    {
      claim: {
        rawClaim: spec.rawClaim,
        domain: "NUTRITIONAL",
        exposure: { name: "胶原蛋白肽", route: "ORAL", dose: { amount: 5000, unit: "mg" } },
        outcome: { name: "皮肤弹性", metricType: "VALIDATED_INSTRUMENT" },
        population: { description: "健康成年女性" },
        comparison: "安慰剂",
      },
    },
    {
      searchProvider: createReplayProvider({ confirmatory: [fixture], falsification: [] }),
      redTeamResponder: createStaticResponder({
        alternatives: [{ kind: "OTHER", description: "引用不存在的证据", evidenceRefs: ["PMID:000"] }],
        conclusion: "ALTERNATIVES_IDENTIFIED",
        rationale: "理由",
      }),
    },
  );
  assert.equal(outcome.status, "COMPLETE");
  if (outcome.status !== "COMPLETE") return;
  assert.ok(outcome.notes.notExecuted.some((note) => /红队结论未并入/.test(note)));
  assert.match(outcome.report, /红队结论尚未填写/);
});
