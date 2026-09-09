import { test } from "node:test";
import assert from "node:assert/strict";

import { renderAsciiDag } from "../src/report/ascii_dag.ts";

test("ASCII 图列出全部边并标注角色", () => {
  const text = renderAsciiDag(
    { nodes: ["X", "Z", "Y"], edges: [["Z", "X"], ["Z", "Y"], ["X", "Y"]] },
    { adjustmentSet: ["Z"] },
  );
  assert.match(text, /Z\s+──▶ X/);
  assert.match(text, /Z\s+──▶ Y/);
  assert.match(text, /X\s+──▶ Y/);
  assert.match(text, /X=暴露/);
  assert.match(text, /Y=结局/);
  assert.match(text, /Z=调整变量/);
  assert.match(text, /对撞节点：无/);
});

test("ASCII 图标注对撞节点并警告控制后果", () => {
  const text = renderAsciiDag({ nodes: ["X", "C", "Y"], edges: [["X", "C"], ["Y", "C"]] });
  assert.match(text, /对撞节点：C/);
  assert.match(text, /打开伪路径/);
});

test("无边的图明确说明没有有向边", () => {
  const text = renderAsciiDag({ nodes: ["X", "Y"], edges: [] });
  assert.match(text, /无有向边/);
});
