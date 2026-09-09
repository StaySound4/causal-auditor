import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildAuditPlan,
  buildStageTask,
  proveIsolation,
  runPlan,
} from "../src/runtime/scheduler.ts";
import type { AuditStage, StageResult, SubagentHost } from "../src/runtime/scheduler.ts";

test("计划包含六个阶段，且红队标记为必须隔离", () => {
  const plan = buildAuditPlan();
  assert.equal(plan.length, 6);
  const redTeam = plan.find((stage) => stage.key === "red_team");
  assert.equal(redTeam?.requiresIsolation, true);
  assert.match(redTeam?.inputContract ?? "", /严禁.*结论/);
  assert.equal(plan.filter((stage) => stage.requiresIsolation).length, 1);
});

test("宿主能力不可用时报告 UNAVAILABLE 且隔离为假", async () => {
  const host: SubagentHost = {
    name: "no-host",
    capability: () => ({ available: false, reason: "环境不支持子代理" }),
    spawn: async () => {
      throw new Error("不应被调用");
    },
  };
  const outcome = await runPlan(host);
  assert.equal(outcome.status, "UNAVAILABLE");
  assert.equal(outcome.isolation.isolated, false);
  if (outcome.status !== "UNAVAILABLE") return;
  assert.match(outcome.reason, /不支持子代理/);
});

test("宿主为隔离阶段提供不同进程标识时，隔离得到证明", async () => {
  let counter = 0;
  const host: SubagentHost = {
    name: "real-host",
    capability: () => ({ available: true }),
    async spawn(stage: AuditStage, task: string): Promise<StageResult> {
      counter += 1;
      return { key: stage.key, output: task, processId: `pid-${counter}` };
    },
  };
  const outcome = await runPlan(host);
  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.results.length, 6);
  assert.equal(outcome.isolation.isolated, true);
  if (outcome.isolation.isolated) {
    assert.equal(outcome.isolation.distinctProcesses, 6);
    assert.equal(outcome.isolation.requiredStages, 1);
  }
});

test("关键防伪：隔离阶段共享同一进程标识时，隔离判定为假并说明原因", async () => {
  const plan = buildAuditPlan();
  const results: StageResult[] = plan.map((stage) => ({
    key: stage.key,
    output: "x",
    processId: "same-pid",
  }));
  const proof = proveIsolation(plan, results);
  assert.equal(proof.isolated, false);
  if (proof.isolated) return;
  assert.match(proof.reason, /共享进程标识/);
});

test("隔离阶段缺少进程标识时，隔离判定为假", () => {
  const plan = buildAuditPlan();
  const results: StageResult[] = plan.map((stage) => ({
    key: stage.key,
    output: "x",
    processId: stage.requiresIsolation ? "" : "pid-1",
  }));
  const proof = proveIsolation(plan, results);
  assert.equal(proof.isolated, false);
  if (proof.isolated) return;
  assert.match(proof.reason, /未报告进程标识/);
});

test("隔离阶段未执行时，隔离判定为假", () => {
  const plan = buildAuditPlan();
  const results: StageResult[] = plan
    .filter((stage) => stage.key !== "red_team")
    .map((stage) => ({ key: stage.key, output: "x", processId: "pid-1" }));
  const proof = proveIsolation(plan, results);
  assert.equal(proof.isolated, false);
  if (proof.isolated) return;
  assert.match(proof.reason, /未执行/);
});

test("阶段任务文本携带输入契约，红队任务不得包含结论字段", () => {
  const redTeam = buildAuditPlan().find((stage) => stage.key === "red_team");
  assert.ok(redTeam !== undefined);
  const task = buildStageTask(redTeam, "主张：X 影响 Y");
  assert.match(task, /严禁.*结论/);
  assert.doesNotMatch(task, /verdict|conclusion/);
});

test("阶段执行抛错时调度不崩溃，返回 UNAVAILABLE 并说明失败阶段", async () => {
  const host: SubagentHost = {
    name: "flaky-host",
    capability: () => ({ available: true }),
    async spawn(stage: AuditStage, task: string): Promise<StageResult> {
      if (stage.key === "red_team") throw new Error("子进程启动失败");
      return { key: stage.key, output: task, processId: `pid-${stage.key}` };
    },
  };
  const outcome = await runPlan(host);
  assert.equal(outcome.status, "UNAVAILABLE");
  assert.equal(outcome.isolation.isolated, false);
  if (outcome.status !== "UNAVAILABLE") return;
  assert.match(outcome.reason, /red_team 执行失败.*子进程启动失败/);
  assert.ok(outcome.results.length > 0, "失败前已完成的结果应保留");
});
