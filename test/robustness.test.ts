import { test } from "node:test";
import assert from "node:assert/strict";

import { findAdjustmentSets } from "../src/core/dag.ts";
import { runAudit } from "../src/runtime/orchestrator.ts";
import type { AuditRequest } from "../src/runtime/orchestrator.ts";
import type {
  EvidenceSearchProvider,
  EvidenceSearchRequest,
  RawEvidenceItem,
  RetrievalCapability,
} from "../src/evidence/types.ts";

const request: AuditRequest = {
  claim: {
    rawClaim: "某干预改善某结局",
    domain: "CLINICAL",
    exposure: { name: "某干预", route: "ORAL", dose: { amount: 10, unit: "mg" } },
    outcome: { name: "某结局", metricType: "HARD_ENDPOINT" },
    population: { description: "成人患者" },
    comparison: "安慰剂",
  },
};

test("图节点数超上限但候选集很小时，仍报告 SEARCH_LIMIT 而不是抛异常", () => {
  const nodes = ["X", "Y", ...Array.from({ length: 40 }, (_, i) => `D${i}`), "Z"];
  const edges: [string, string][] = [["X", "Y"], ["Z", "X"], ["Z", "Y"]];
  for (let i = 0; i < 40; i += 1) edges.push(["X", `D${i}`]);

  const result = findAdjustmentSets({ nodes, edges }, "X", "Y");
  assert.equal(result.status, "SEARCH_LIMIT");
  if (result.status !== "SEARCH_LIMIT") return;
  assert.match(result.reason, /超过路径枚举上限/);
});

test("检索过程中抛错时审计不崩溃，而是报告能力缺口", async () => {
  const failing: EvidenceSearchProvider = {
    name: "failing-provider",
    capability(): RetrievalCapability {
      return { available: true, provider: "failing-provider" };
    },
    async search(_request: EvidenceSearchRequest): Promise<RawEvidenceItem[]> {
      throw new Error("网络连接被拒绝");
    },
  };

  const outcome = await runAudit(request, { searchProvider: failing });
  assert.equal(outcome.status, "COMPLETE");
  if (outcome.status !== "COMPLETE") return;

  assert.equal(outcome.evidence.status, "UNAVAILABLE");
  assert.equal(outcome.proposal.verdict, "INSUFFICIENT_EVIDENCE");
  assert.ok(outcome.notes.capabilityGaps.some((gap) => /网络连接被拒绝/.test(gap)));
  assert.match(outcome.report, /检索执行失败/);
});
