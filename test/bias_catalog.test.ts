import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateBoundary } from "../src/core/boundary.ts";
import { BIAS_CATALOG, scanBiases } from "../src/core/bias_catalog.ts";
import type { ClaimInput } from "../src/core/types.ts";

function specOf(input: ClaimInput) {
  const result = evaluateBoundary(input);
  assert.equal(result.status, "READY", "测试前置：主张必须要素完整");
  if (result.status !== "READY") throw new Error("unreachable");
  return result.spec;
}

const oralMacromolecule = specOf({
  rawClaim: "口服胶原蛋白肽改善皮肤弹性",
  domain: "NUTRITIONAL",
  exposure: { name: "胶原蛋白肽", route: "ORAL", dose: { amount: 5000, unit: "mg", frequency: "每日一次" } },
  outcome: { name: "皮肤弹性测量值", metricType: "VALIDATED_INSTRUMENT" },
  population: { description: "健康成年女性" },
  comparison: "安慰剂",
  timeframe: "12 周",
});

test("目录包含 22 项且编号唯一", () => {
  assert.equal(BIAS_CATALOG.length, 22);
  const ids = BIAS_CATALOG.map((entry) => entry.id);
  assert.equal(new Set(ids).size, 22);
  for (let i = 1; i <= 22; i += 1) {
    assert.ok(ids.includes(`B${String(i).padStart(2, "0")}`), `缺少 B${i}`);
  }
});

test("每项都给出机制说明与待核查问题，不得只给结论", () => {
  for (const entry of BIAS_CATALOG) {
    assert.ok(entry.mechanism.length > 0, `${entry.id} 缺少机制说明`);
    assert.ok(entry.whatToCheck.length > 0, `${entry.id} 缺少待核查问题`);
  }
});

test("扫描结果必须附带依据；未知是正常结果", () => {
  const findings = scanBiases({ spec: oralMacromolecule });
  assert.equal(findings.length, 22);
  for (const finding of findings) {
    assert.ok(finding.basis.length > 0, `${finding.id} 缺少判定依据`);
  }
});

test("缺少图时不得凭空给出图论结论", () => {
  const findings = scanBiases({ spec: oralMacromolecule });
  const b01 = findings.find((f) => f.id === "B01");
  const b03 = findings.find((f) => f.id === "B03");
  assert.equal(b01?.status, "UNKNOWN");
  assert.equal(b03?.status, "UNKNOWN");
});

test("分叉混杂图：B01 命中；纯对撞图：B01 可排除", () => {
  const fork = scanBiases({
    spec: oralMacromolecule,
    dag: { nodes: ["X", "Z", "Y"], edges: [["Z", "X"], ["Z", "Y"], ["X", "Y"]] },
  });
  assert.equal(fork.find((f) => f.id === "B01")?.status, "PRESENT");

  const colliderOnly = scanBiases({
    spec: oralMacromolecule,
    dag: { nodes: ["X", "C", "Y"], edges: [["X", "C"], ["Y", "C"]] },
  });
  assert.equal(colliderOnly.find((f) => f.id === "B01")?.status, "ABSENT");
});

test("调整集含对撞节点时 B03 命中；M-偏误场景空集时 B03 可排除", () => {
  const colliderAdjusted = scanBiases({
    spec: oralMacromolecule,
    dag: { nodes: ["X", "C", "Y"], edges: [["X", "C"], ["Y", "C"]] },
    adjustmentSet: ["C"],
  });
  assert.equal(colliderAdjusted.find((f) => f.id === "B03")?.status, "PRESENT");

  const mBias = scanBiases({
    spec: oralMacromolecule,
    dag: {
      nodes: ["X", "U1", "M", "U2", "Y"],
      edges: [["U1", "X"], ["U1", "M"], ["U2", "M"], ["U2", "Y"], ["X", "Y"]],
    },
    adjustmentSet: [],
  });
  assert.equal(mBias.find((f) => f.id === "B03")?.status, "ABSENT");
});

test("自报结局且无盲法时 B11 命中；客观硬终点时 B11 不适用", () => {
  const selfReported = specOf({
    rawClaim: "某膏药缓解疼痛",
    domain: "CLINICAL",
    exposure: { name: "某膏药", route: "TOPICAL", dose: { amount: 1, unit: "g" } },
    outcome: { name: "疼痛评分", metricType: "SELF_REPORTED" },
    population: { description: "慢性腰痛患者" },
  });
  const b11 = scanBiases({ spec: selfReported, design: { blinded: false } }).find((f) => f.id === "B11");
  assert.equal(b11?.status, "PRESENT");

  const hard = specOf({
    rawClaim: "某药降低死亡率",
    domain: "CLINICAL",
    exposure: { name: "某药", route: "ORAL", dose: { amount: 10, unit: "mg" } },
    outcome: { name: "全因死亡", metricType: "HARD_ENDPOINT" },
    population: { description: "心衰患者" },
  });
  assert.equal(scanBiases({ spec: hard }).find((f) => f.id === "B11")?.status, "NOT_APPLICABLE");
});

test("关键回归：口服大分子不得被自动判为中介阻断（B18 必须为未知）", () => {
  const findings = scanBiases({ spec: oralMacromolecule });
  const b18 = findings.find((f) => f.id === "B18");
  assert.equal(b18?.status, "UNKNOWN", "水解只是待核查假设，不能自动判为效应为零");
  assert.ok(
    b18?.whatToCheck.some((item) => /药代|生物利用度|吸收/.test(item)),
    "B18 必须要求药代动力学证据",
  );
});

test("体外研究证据等级触发 B21 外推风险", () => {
  const findings = scanBiases({
    spec: oralMacromolecule,
    design: { studyType: "IN_VITRO" },
  });
  assert.equal(findings.find((f) => f.id === "B21")?.status, "PRESENT");
});

test("横断面设计下反向因果为未知，而不是断言存在", () => {
  const findings = scanBiases({
    spec: oralMacromolecule,
    design: { studyType: "CROSS_SECTIONAL" },
  });
  const b09 = findings.find((f) => f.id === "B09");
  assert.equal(b09?.status, "UNKNOWN");
  assert.match(b09?.basis ?? "", /横断面|时序/);
});

test("均值回归在缺乏重复测量信息时为未知", () => {
  const findings = scanBiases({ spec: oralMacromolecule });
  const b16 = findings.find((f) => f.id === "B16");
  assert.equal(b16?.status, "UNKNOWN");
  assert.ok(b16?.whatToCheck.some((item) => /重复测量|基线|对照/.test(item)));
});

test("未声明调整集时 B03 为未知，而不是断言无偏误", () => {
  const findings = scanBiases({
    spec: oralMacromolecule,
    dag: { nodes: ["X", "C", "Y"], edges: [["X", "C"], ["Y", "C"]] },
  });
  assert.equal(findings.find((f) => f.id === "B03")?.status, "UNKNOWN");
});

test("图超出分析上限时不抛异常，报告未知", () => {
  const nodes = ["X", "Y", ...Array.from({ length: 40 }, (_, i) => `Z${i}`)];
  const edges: [string, string][] = [["X", "Y"]];
  for (let i = 0; i < 40; i += 1) edges.push([`Z${i}`, "X"], [`Z${i}`, "Y"]);
  const findings = scanBiases({
    spec: oralMacromolecule,
    dag: { nodes, edges },
    adjustmentSet: [],
  });
  assert.equal(findings.find((f) => f.id === "B01")?.status, "UNKNOWN");
  assert.equal(findings.find((f) => f.id === "B03")?.status, "UNKNOWN");
});
