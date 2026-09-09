import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateBoundary } from "../src/core/boundary.ts";

test("缺少领域时要求澄清，且不猜测领域", () => {
  const result = evaluateBoundary({ rawClaim: "喝茶能防癌" });
  assert.equal(result.status, "NEEDS_CLARIFICATION");
  if (result.status !== "NEEDS_CLARIFICATION") return;
  const fields = result.missing.map((m) => m.field);
  assert.ok(fields.includes("domain"), "必须要求澄清领域");
  assert.ok(!("spec" in result), "不得在澄清状态返回已定稿规格");
});

test("临床域缺少剂量与途径时要求澄清", () => {
  const result = evaluateBoundary({
    rawClaim: "口服胶原蛋白软糖能补充面部胶原蛋白",
    domain: "CLINICAL",
    exposure: { name: "胶原蛋白软糖" },
    outcome: { name: "面部胶原蛋白含量", metricType: "SURROGATE_BIOMARKER" },
    population: { description: "健康成年人" },
  });
  assert.equal(result.status, "NEEDS_CLARIFICATION");
  if (result.status !== "NEEDS_CLARIFICATION") return;
  const fields = result.missing.map((m) => m.field);
  assert.ok(fields.includes("exposure.route"), "缺途径必须澄清");
  assert.ok(fields.includes("exposure.dose"), "缺剂量必须澄清");
});

test("临床域要素完整时判定 READY 且不擅自填充", () => {
  const result = evaluateBoundary({
    rawClaim: "某降压药降低收缩压",
    domain: "CLINICAL",
    exposure: { name: "某降压药", route: "ORAL", dose: { amount: 10, unit: "mg", frequency: "每日一次" } },
    outcome: { name: "诊室收缩压", metricType: "HARD_ENDPOINT" },
    population: { description: "成人原发性高血压患者", baseline: "未接受其他降压治疗" },
    comparison: "安慰剂",
  });
  assert.equal(result.status, "READY");
  if (result.status !== "READY") return;
  assert.deepEqual(result.spec.exposure.dose, { amount: 10, unit: "mg", frequency: "每日一次" });
  assert.equal(result.spec.assumptions.length, 0, "要素齐全时不得写入假设");
});

test("商业域不需要给药剂量，但需要暴露定义", () => {
  const base = {
    rawClaim: "购买会员提高了次月留存",
    domain: "COMMERCIAL" as const,
    exposure: { name: "购买高端会员" },
    outcome: { name: "次月留存率", metricType: "HARD_ENDPOINT" as const },
    population: { description: "电商平台注册用户" },
  };

  const missingDefinition = evaluateBoundary(base);
  assert.equal(missingDefinition.status, "NEEDS_CLARIFICATION");
  if (missingDefinition.status === "NEEDS_CLARIFICATION") {
    const fields = missingDefinition.missing.map((m) => m.field);
    assert.ok(fields.includes("exposure.definition"), "商业域必须澄清暴露定义");
    assert.ok(!fields.includes("exposure.dose"), "商业域不得要求给药剂量");
  }

  const withDefinition = evaluateBoundary({
    ...base,
    exposure: { name: "购买高端会员", definition: "开通年度会员且完成支付" },
  });
  assert.equal(withDefinition.status, "READY");
});

test("自报结局不阻断，但触发盲法风险标记", () => {
  const result = evaluateBoundary({
    rawClaim: "某药膏缓解疼痛",
    domain: "CLINICAL",
    exposure: { name: "某药膏", route: "TOPICAL", dose: { amount: 1, unit: "g", frequency: "每日两次" } },
    outcome: { name: "疼痛主观评分", metricType: "SELF_REPORTED" },
    population: { description: "膝关节骨关节炎患者" },
  });
  assert.equal(result.status, "READY");
  if (result.status !== "READY") return;
  const flags = result.spec.flags.map((f) => f.code);
  assert.ok(flags.includes("SELF_REPORTED_OUTCOME"), "自报结局必须标记");
  assert.ok(flags.includes("NO_COMPARATOR_DECLARED"), "未声明对照必须标记");
});

test("替代标志物触发外推风险标记，但不等同于无效", () => {
  const result = evaluateBoundary({
    rawClaim: "某补剂提高血清某指标",
    domain: "NUTRITIONAL",
    exposure: { name: "某补剂", route: "ORAL", dose: { amount: 500, unit: "mg" } },
    outcome: { name: "血清某生物标志物", metricType: "SURROGATE_BIOMARKER" },
    population: { description: "健康成年人" },
    comparison: "安慰剂",
  });
  assert.equal(result.status, "READY");
  if (result.status !== "READY") return;
  const flags = result.spec.flags.map((f) => f.code);
  assert.ok(flags.includes("SURROGATE_ENDPOINT"), "替代终点必须标记外推风险");
});

test("剂量数值非法时视为缺失，而不是静默修正", () => {
  const result = evaluateBoundary({
    rawClaim: "某药降低某指标",
    domain: "CLINICAL",
    exposure: {
      name: "某药",
      route: "ORAL",
      dose: { amount: Number.NaN, unit: "mg" },
    },
    outcome: { name: "某指标", metricType: "HARD_ENDPOINT" },
    population: { description: "成人患者" },
  });
  assert.equal(result.status, "NEEDS_CLARIFICATION");
  if (result.status !== "NEEDS_CLARIFICATION") return;
  assert.ok(result.missing.some((m) => m.field === "exposure.dose"));
});

test("行为域需要暴露定义与强度，不需要给药剂量", () => {
  const result = evaluateBoundary({
    rawClaim: "每天步行一万步降低心血管事件",
    domain: "BEHAVIORAL",
    exposure: { name: "每日步行", definition: "每日累计步数", dose: { amount: 10000, unit: "步/日" } },
    outcome: { name: "主要心血管不良事件", metricType: "HARD_ENDPOINT" },
    population: { description: "中老年社区居民" },
    comparison: "低步数组",
  });
  assert.equal(result.status, "READY");
  if (result.status !== "READY") return;
  assert.equal(result.spec.domain, "BEHAVIORAL");
});
