/**
 * ASCII 因果图渲染。
 *
 * 只呈现**已声明的节点与边**，并标注角色与对撞节点。
 * 不推断真实因果结构；图本身错误时结论随之失效。
 */

import { collidersBetween } from "../core/dag.ts";
import type { DAG } from "../core/dag.ts";

export interface AsciiDagOptions {
  exposure?: string;
  outcome?: string;
  adjustmentSet?: readonly string[];
}

export function renderAsciiDag(dag: DAG, options: AsciiDagOptions = {}): string {
  const exposure = options.exposure ?? "X";
  const outcome = options.outcome ?? "Y";
  const lines: string[] = [];

  lines.push("因果图（依据已声明节点与边；结论以此图为条件）");
  lines.push("");

  if (dag.edges.length === 0) {
    lines.push("  （无有向边）");
  } else {
    const width = Math.max(...dag.nodes.map((node) => node.length), 1);
    for (const [from, to] of dag.edges) {
      lines.push(`  ${from.padEnd(width)} ──▶ ${to}`);
    }
  }

  lines.push("");
  const roles: string[] = [`${exposure}=暴露`, `${outcome}=结局`];
  if (options.adjustmentSet !== undefined && options.adjustmentSet.length > 0) {
    roles.push(`${options.adjustmentSet.join("、")}=调整变量`);
  }
  lines.push(`节点角色：${roles.join("；")}`);

  const colliders = collidersBetween(dag, exposure, outcome);
  lines.push(
    colliders.size === 0
      ? "对撞节点：无"
      : `对撞节点：${[...colliders].join("、")}（控制它会人为打开伪路径）`,
  );

  return lines.join("\n");
}
