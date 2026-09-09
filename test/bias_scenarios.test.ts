import { test } from "node:test";
import assert from "node:assert/strict";

import { scanBiases } from "../src/core/bias_catalog.ts";
import type { BiasContext, BiasFinding } from "../src/core/bias_catalog.ts";
import { evaluateBoundary } from "../src/core/boundary.ts";
import type { ClaimInput } from "../src/core/types.ts";

function specOf(input: ClaimInput) {
  const result = evaluateBoundary(input);
  assert.equal(result.status, "READY", `场景前置失败：${input.rawClaim}`);
  if (result.status !== "READY") throw new Error("unreachable");
  return result.spec;
}

interface Scenario {
  name: string;
  context: BiasContext;
  /** 该场景下应当被判为 PRESENT 的偏误编号全集（穷举，用于统计误报/漏报）。 */
  expectedPresent: string[];
}

function buildScenarios(): Scenario[] {
  // 场景 1：口服大分子 + 分叉混杂。重点：B18 必须是 UNKNOWN 而非 PRESENT。
  const s1Spec = specOf({
    rawClaim: "口服胶原蛋白肽改善皮肤弹性",
    domain: "NUTRITIONAL",
    exposure: { name: "胶原蛋白肽", route: "ORAL", dose: { amount: 5000, unit: "mg", frequency: "每日一次" } },
    outcome: { name: "皮肤弹性测量值", metricType: "VALIDATED_INSTRUMENT" },
    population: { description: "健康成年女性" },
    comparison: "安慰剂",
    timeframe: "12 周",
  });

  // 场景 2：草药治愈自限性疾病。重点：无对照 → B17 PRESENT；自报结局但未声明盲法 → B11 UNKNOWN。
  const s2Spec = specOf({
    rawClaim: "某草药治愈风湿关节疼痛",
    domain: "CLINICAL",
    exposure: { name: "某草药煎剂", route: "ORAL", dose: { amount: 200, unit: "mL", frequency: "每日两次" } },
    outcome: { name: "关节疼痛主观评分", metricType: "SELF_REPORTED" },
    population: { description: "风湿性关节炎患者" },
    timeframe: "4 周",
  });

  // 场景 3：等待期分配的抗癌药生存分析。重点：B10 PRESENT。
  const s3Spec = specOf({
    rawClaim: "接受某靶向药的患者总生存期显著延长",
    domain: "CLINICAL",
    exposure: { name: "某靶向药", route: "ORAL", dose: { amount: 100, unit: "mg", frequency: "每日一次" } },
    outcome: { name: "总生存期", metricType: "HARD_ENDPOINT" },
    population: { description: "晚期非小细胞肺癌患者" },
    comparison: "标准化疗",
    timeframe: "24 个月",
  });

  // 场景 4：医院样本抽样。重点：B05 PRESENT（对撞抽样）。
  const s4Spec = specOf({
    rawClaim: "住院患者中两种疾病呈负相关",
    domain: "CLINICAL",
    exposure: { name: "某住院诊断", route: "OTHER", dose: { amount: 1, unit: "次" } },
    outcome: { name: "另一疾病确诊", metricType: "HARD_ENDPOINT" },
    population: { description: "三级医院住院患者" },
    comparison: "社区人群",
    timeframe: "1 年",
  });

  // 场景 5：M-型对撞网络 + 误控 M。重点：B03 PRESENT 且 B04 PRESENT。
  const s5Spec = specOf({
    rawClaim: "某暴露与某结局相关",
    domain: "CLINICAL",
    exposure: { name: "某暴露", route: "ORAL", dose: { amount: 10, unit: "mg" } },
    outcome: { name: "某硬结局", metricType: "HARD_ENDPOINT" },
    population: { description: "成人患者" },
    comparison: "安慰剂",
    timeframe: "12 个月",
  });

  // 场景 6：动物模型外推。重点：B21 与 B22 PRESENT。
  const s6Spec = specOf({
    rawClaim: "某植物提取物杀死癌细胞",
    domain: "NUTRITIONAL",
    exposure: { name: "某植物提取物", route: "ORAL", dose: { amount: 500, unit: "mg" } },
    outcome: { name: "肿瘤体积", metricType: "HARD_ENDPOINT" },
    population: { description: "荷瘤小鼠" },
    comparison: "溶剂对照",
    timeframe: "8 周",
  });

  return [
    {
      name: "口服大分子 + 分叉混杂",
      context: {
        spec: s1Spec,
        dag: { nodes: ["X", "Z", "Y"], edges: [["Z", "X"], ["Z", "Y"], ["X", "Y"]] },
        adjustmentSet: ["Z"],
        design: { studyType: "RCT", randomized: true, blinded: true },
      },
      expectedPresent: ["B01"],
    },
    {
      name: "草药治愈自限性疾病（无对照）",
      context: { spec: s2Spec },
      expectedPresent: ["B17"],
    },
    {
      name: "等待期分配的抗癌药生存",
      context: { spec: s3Spec, design: { immortalTimeRisk: true } },
      expectedPresent: ["B10"],
    },
    {
      name: "医院样本对撞抽样",
      context: { spec: s4Spec, design: { selectionOnCollider: true } },
      expectedPresent: ["B05"],
    },
    {
      name: "M-型对撞网络且误控 M",
      context: {
        spec: s5Spec,
        dag: {
          nodes: ["X", "U1", "M", "U2", "Y"],
          edges: [["U1", "X"], ["U1", "M"], ["U2", "M"], ["U2", "Y"], ["X", "Y"]],
        },
        adjustmentSet: ["M"],
        latent: ["U1", "U2"],
        design: { studyType: "COHORT" },
      },
      expectedPresent: ["B03", "B04"],
    },
    {
      name: "动物模型外推人体",
      context: { spec: s6Spec, design: { studyType: "ANIMAL" } },
      expectedPresent: ["B21", "B22"],
    },
  ];
}

function presentIds(findings: readonly BiasFinding[]): string[] {
  return findings
    .filter((finding) => finding.status === "PRESENT")
    .map((finding) => finding.id)
    .sort();
}

test("6 组基准场景：误报 0、漏报 0", () => {
  const scenarios = buildScenarios();
  assert.equal(scenarios.length, 6);

  let falsePositives = 0;
  let falseNegatives = 0;
  const detail: string[] = [];

  for (const scenario of scenarios) {
    const actual = presentIds(scanBiases(scenario.context));
    const expected = [...scenario.expectedPresent].sort();

    const fp = actual.filter((id) => !expected.includes(id));
    const fn = expected.filter((id) => !actual.includes(id));
    falsePositives += fp.length;
    falseNegatives += fn.length;

    if (fp.length > 0 || fn.length > 0) {
      detail.push(
        `[${scenario.name}] 期望 PRESENT=${expected.join(",")}；实际=${actual.join(",")}；` +
          `误报=${fp.join(",") || "无"}；漏报=${fn.join(",") || "无"}`,
      );
    }
  }

  assert.equal(falsePositives, 0, `误报 ${falsePositives} 项：\n${detail.join("\n")}`);
  assert.equal(falseNegatives, 0, `漏报 ${falseNegatives} 项：\n${detail.join("\n")}`);
});

test("场景 1 关键回归：口服大分子不得被判为中介阻断", () => {
  const scenario = buildScenarios()[0];
  assert.ok(scenario !== undefined);
  const b18 = scanBiases(scenario.context).find((finding) => finding.id === "B18");
  assert.equal(b18?.status, "UNKNOWN");
  assert.match(b18?.basis ?? "", /药代动力学/);
});

test("场景 2 关键回归：自报结局未声明盲法时为未知，不直接判存在安慰剂效应", () => {
  const scenario = buildScenarios()[1];
  assert.ok(scenario !== undefined);
  const b11 = scanBiases(scenario.context).find((finding) => finding.id === "B11");
  assert.equal(b11?.status, "UNKNOWN");
});

test("每个场景的 PRESENT 项都给出可追溯依据", () => {
  for (const scenario of buildScenarios()) {
    for (const finding of scanBiases(scenario.context)) {
      if (finding.status === "PRESENT") {
        assert.ok(finding.basis.length > 0, `${scenario.name} / ${finding.id} 缺少依据`);
      }
    }
  }
});
