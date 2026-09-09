import { test } from "node:test";
import assert from "node:assert/strict";

import {
  descendantsOf,
  findAdjustmentSets,
  findOpenPaths,
  isDSeparated,
  validateDAG,
  type DAG,
} from "../src/core/dag.ts";

function dag(nodes: string[], edges: [string, string][]): DAG {
  return { nodes, edges };
}

test("图校验：拒绝未知节点引用、自环与环", () => {
  assert.equal(validateDAG(dag(["X", "Y"], [["X", "Y"]])).valid, true);

  const unknownRef = validateDAG(dag(["X"], [["X", "Y"]]));
  assert.equal(unknownRef.valid, false);
  if (!unknownRef.valid) assert.ok(unknownRef.errors.some((e) => e.includes("未知节点")));

  const selfLoop = validateDAG(dag(["X"], [["X", "X"]]));
  assert.equal(selfLoop.valid, false);

  const cycle = validateDAG(dag(["A", "B"], [["A", "B"], ["B", "A"]]));
  assert.equal(cycle.valid, false);
  if (!cycle.valid) assert.ok(cycle.errors.some((e) => e.includes("环")));
});

test("链结构 X → M → Y：控制 M 才阻断", () => {
  const g = dag(["X", "M", "Y"], [["X", "M"], ["M", "Y"]]);
  assert.equal(isDSeparated(g, "X", "Y", []), false);
  assert.equal(isDSeparated(g, "X", "Y", ["M"]), true);
  assert.equal(isDSeparated(g, "X", "Y", ["X"]), false, "控制端点不阻断路径");
});

test("分叉结构 X ← Z → Y：控制 Z 阻断", () => {
  const g = dag(["X", "Z", "Y"], [["Z", "X"], ["Z", "Y"]]);
  assert.equal(isDSeparated(g, "X", "Y", []), false);
  assert.equal(isDSeparated(g, "X", "Y", ["Z"]), true);
});

test("对撞结构 X → C ← Y：默认阻断，控制 C 或其后代反而打开", () => {
  const g = dag(["X", "C", "Y"], [["X", "C"], ["Y", "C"]]);
  assert.equal(isDSeparated(g, "X", "Y", []), true, "对撞节点未控制时阻断");
  assert.equal(isDSeparated(g, "X", "Y", ["C"]), false, "控制对撞节点会打开路径");

  const withDescendant = dag(
    ["X", "C", "Y", "D"],
    [["X", "C"], ["Y", "C"], ["C", "D"]],
  );
  assert.equal(isDSeparated(withDescendant, "X", "Y", ["D"]), false, "控制对撞节点后代同样打开路径");
  assert.equal(descendantsOf(withDescendant, "C").has("D"), true);
});

test("M-偏误结构：默认已阻断，误控制 M 反而制造伪路径", () => {
  const g = dag(
    ["X", "U1", "M", "U2", "Y"],
    [["U1", "X"], ["U1", "M"], ["U2", "M"], ["U2", "Y"]],
  );
  assert.equal(isDSeparated(g, "X", "Y", []), true, "M 是对撞节点，路径本已阻断");
  assert.equal(isDSeparated(g, "X", "Y", ["M"]), false, "控制 M 打开伪路径");
});

test("无路径时任何条件集都 d-分离", () => {
  const g = dag(["X", "Y", "Z"], [["Z", "Z"]]);
  const clean = dag(["X", "Y", "Z"], []);
  assert.equal(isDSeparated(clean, "X", "Y", []), true);
  assert.equal(isDSeparated(clean, "X", "Y", ["Z"]), true);
  assert.equal(validateDAG(g).valid, false, "自环图应被拒绝");
});

test("多路径：一条被阻断不等于全部被阻断", () => {
  const g = dag(["X", "Z", "Y"], [["Z", "X"], ["Z", "Y"], ["X", "Y"]]);
  assert.equal(isDSeparated(g, "X", "Y", ["Z"]), false, "直接路径仍打开");
  assert.equal(findOpenPaths(g, "X", "Y", ["Z"]).length, 1);
});

test("后门调整集：分叉混杂需要控制 Z", () => {
  const g = dag(["X", "Z", "Y"], [["Z", "X"], ["Z", "Y"], ["X", "Y"]]);
  const result = findAdjustmentSets(g, "X", "Y");
  assert.equal(result.status, "IDENTIFIABLE");
  if (result.status !== "IDENTIFIABLE") return;
  assert.deepEqual(result.minimalSets, [["Z"]]);
});

test("后门调整集：无混杂时空集即为有效调整集", () => {
  const g = dag(["X", "Y"], [["X", "Y"]]);
  const result = findAdjustmentSets(g, "X", "Y");
  assert.equal(result.status, "IDENTIFIABLE");
  if (result.status !== "IDENTIFIABLE") return;
  assert.deepEqual(result.minimalSets, [[]]);
});

test("后门调整集：对撞节点不得被控制", () => {
  const g = dag(["X", "C", "Y"], [["X", "C"], ["Y", "C"]]);
  const result = findAdjustmentSets(g, "X", "Y");
  assert.equal(result.status, "IDENTIFIABLE");
  if (result.status !== "IDENTIFIABLE") return;
  assert.deepEqual(result.minimalSets, [[]], "控制对撞节点会制造偏误");
});

test("后门调整集：M-偏误场景下空集已足够，不得建议控制 M", () => {
  const g = dag(
    ["X", "U1", "M", "U2", "Y"],
    [["U1", "X"], ["U1", "M"], ["U2", "M"], ["U2", "Y"], ["X", "Y"]],
  );
  const result = findAdjustmentSets(g, "X", "Y");
  assert.equal(result.status, "IDENTIFIABLE");
  if (result.status !== "IDENTIFIABLE") return;
  assert.deepEqual(result.minimalSets, [[]]);
});

test("后门调整集：暴露的后代不得进入调整集", () => {
  const g = dag(
    ["X", "M", "Y", "Z"],
    [["Z", "X"], ["Z", "Y"], ["X", "M"], ["M", "Y"]],
  );
  const result = findAdjustmentSets(g, "X", "Y");
  assert.equal(result.status, "IDENTIFIABLE");
  if (result.status !== "IDENTIFIABLE") return;
  for (const set of result.minimalSets) {
    assert.ok(!set.includes("M"), "中介是暴露的后代，不得作为调整变量");
  }
  assert.deepEqual(result.minimalSets, [["Z"]]);
});

test("后门调整集：潜变量不可被选入调整集", () => {
  const g = dag(
    ["X", "U", "Y"],
    [["U", "X"], ["U", "Y"], ["X", "Y"]],
  );
  const result = findAdjustmentSets(g, "X", "Y", { latent: ["U"] });
  assert.equal(result.status, "NO_ADJUSTMENT_SET");
  if (result.status !== "NO_ADJUSTMENT_SET") return;
  assert.match(result.reason, /后门/);
});

test("后门调整集：前门结构下后门不可识别，但需提示前门可能存在", () => {
  const g = dag(
    ["X", "M", "Y", "U"],
    [["X", "M"], ["M", "Y"], ["U", "X"], ["U", "Y"]],
  );
  const result = findAdjustmentSets(g, "X", "Y", { latent: ["U"] });
  assert.equal(result.status, "NO_ADJUSTMENT_SET");
  if (result.status !== "NO_ADJUSTMENT_SET") return;
  assert.match(result.note, /前门|工具变量/);
});

test("后门调整集：候选集过大时明确报告搜索受限，而不是假装无解", () => {
  const nodes = ["X", "Y", ...Array.from({ length: 14 }, (_, i) => `Z${i}`)];
  const edges: [string, string][] = [["X", "Y"]];
  for (let i = 0; i < 14; i += 1) {
    edges.push([`Z${i}`, "X"], [`Z${i}`, "Y"]);
  }
  const result = findAdjustmentSets(dag(nodes, edges), "X", "Y");
  assert.equal(result.status, "SEARCH_LIMIT");
  if (result.status !== "SEARCH_LIMIT") return;
  assert.match(result.reason, /候选/);
});

test("图校验失败时调整集分析拒绝给出结论", () => {
  const g = dag(["X", "Y"], [["X", "Y"], ["Y", "X"]]);
  const result = findAdjustmentSets(g, "X", "Y");
  assert.equal(result.status, "INVALID_GRAPH");
});

test("未知节点参与分析时拒绝给出结论", () => {
  const g = dag(["X", "Y"], [["X", "Y"]]);
  const result = findAdjustmentSets(g, "X", "Q");
  assert.equal(result.status, "INVALID_GRAPH");
  if (result.status !== "INVALID_GRAPH") return;
  assert.ok(result.errors.some((e) => e.includes("Q")));
});
