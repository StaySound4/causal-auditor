import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateBoundary } from "../src/core/boundary.ts";
import { buildRedTeamPacket, ContractViolationError } from "../src/redteam/packet.ts";
import { renderReport } from "../src/report/render.ts";
import { scanBiases } from "../src/core/bias_catalog.ts";
import type { EvidenceItem } from "../src/evidence/types.ts";
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

function evidence(id: string, direction: NonNullable<EvidenceItem["direction"]>): EvidenceItem {
  return {
    id,
    source: "PUBMED",
    identifier: id,
    title: `研究 ${id}`,
    year: 2024,
    studyType: "RCT",
    direction,
    keyFindings: "结果摘要",
    provider: "replay-fixture",
    retrievalQuery: "query",
    retrievedAt: new Date().toISOString(),
  };
}

test("红队输入包含双向全部证据，不得只喂负面证据", () => {
  const packet = buildRedTeamPacket({
    spec,
    evidence: [evidence("PMID:1", "SUPPORTS"), evidence("PMID:2", "REFUTES")],
  });
  assert.equal(packet.input.evidence.length, 2);
  assert.ok(packet.input.evidence.some((item) => item.direction === "SUPPORTS"));
  assert.ok(packet.input.evidence.some((item) => item.direction === "REFUTES"));
});

test("信息屏蔽：输入中混入结论字段时抛出契约异常", () => {
  const tainted = {
    spec,
    evidence: [],
    verdict: "SUPPORTED",
  } as unknown as Parameters<typeof buildRedTeamPacket>[0];

  assert.throws(() => buildRedTeamPacket(tainted), ContractViolationError);
});

test("信息屏蔽：深层嵌套的结论字段同样被拦截", () => {
  const tainted = {
    spec: { ...spec, graphDiagnostic: { verdict: "SUPPORTED" } },
    evidence: [],
  } as unknown as Parameters<typeof buildRedTeamPacket>[0];

  assert.throws(() => buildRedTeamPacket(tainted), ContractViolationError);
});

test("证据条目的 direction 字段不视为结论泄漏", () => {
  const packet = buildRedTeamPacket({ spec, evidence: [evidence("PMID:1", "REFUTES")] });
  assert.equal(packet.input.evidence.length, 1);
});

test("问题清单来自偏误目录的命中与未知项", () => {
  const packet = buildRedTeamPacket({
    spec,
    evidence: [],
    design: { studyType: "IN_VITRO" },
  });
  assert.ok(packet.checklist.length > 0);
  assert.ok(
    packet.checklist.some((entry) => /B18|B21|B11/.test(entry.relatedBias ?? "")),
    "清单应关联具体偏误编号",
  );
});

test("未发现替代解释时报告如实呈现，不视为失败", () => {
  const packet = buildRedTeamPacket({ spec, evidence: [] });
  const markdown = renderReport({
    spec,
    biases: scanBiases({ spec }),
    evidence: { status: "UNAVAILABLE", provider: "test", reason: "未执行检索" },
    proposal: { verdict: "INSUFFICIENT_EVIDENCE", basis: "未执行检索", requiresReview: true, unresolved: [] },
    redTeam: {
      ...packet,
      findings: {
        alternatives: [],
        conclusion: "NO_ALTERNATIVE_FOUND",
        rationale: "现有信息不足以提出可检验的替代解释",
      },
    },
  });
  assert.match(markdown, /NO_ALTERNATIVE_FOUND/);
  assert.match(markdown, /未提出（允许，不得为凑数编造）/);
});

test("红队可给出证据不足结论，报告不强迫其下判断", () => {
  const packet = buildRedTeamPacket({ spec, evidence: [] });
  const markdown = renderReport({
    spec,
    biases: scanBiases({ spec }),
    evidence: { status: "UNAVAILABLE", provider: "test", reason: "未执行检索" },
    proposal: { verdict: "INSUFFICIENT_EVIDENCE", basis: "未执行检索", requiresReview: true, unresolved: [] },
    redTeam: {
      ...packet,
      findings: {
        alternatives: [],
        conclusion: "INSUFFICIENT_EVIDENCE",
        rationale: "缺乏研究设计信息",
      },
    },
  });
  assert.match(markdown, /INSUFFICIENT_EVIDENCE/);
  assert.match(markdown, /缺乏研究设计信息/);
});

test("问题清单覆盖零效应、混杂、次生代价三类，但不预设结论", () => {
  const packet = buildRedTeamPacket({ spec, evidence: [] });
  const joined = packet.checklist.map((entry) => entry.question).join("\n");
  assert.match(joined, /自然病程|自限|安慰剂/);
  assert.match(joined, /混杂|替代/);
  assert.match(joined, /长期|次生|代价|风险/);
});
