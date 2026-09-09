/**
 * 因果图（DAG）拓扑算法。
 *
 * 契约（见 docs/adr/0002）：所有结论都**以传入的图与假设为条件**。
 * 本模块只做图论判定，不推断真实世界因果结构，也不从自然语言生成图。
 *
 * ponytail: 路径枚举为指数复杂度；审计场景下图规模小（默认上限见 PATH_NODE_LIMIT），
 * 换取的是实现可直接对照教科书定义验证。若出现大规模图，改为 Bayes-Ball 多项式算法。
 */

export interface DAG {
  nodes: readonly string[];
  /** 有向边 [父, 子]。 */
  edges: readonly (readonly [string, string])[];
}

export type DAGValidation = { valid: true } | { valid: false; errors: string[] };

const PATH_NODE_LIMIT = 32;
const MAX_CANDIDATES = 12;

export function validateDAG(dag: DAG): DAGValidation {
  const errors: string[] = [];
  const nodeSet = new Set(dag.nodes);

  if (nodeSet.size !== dag.nodes.length) {
    errors.push("节点列表存在重复项");
  }

  for (const [from, to] of dag.edges) {
    if (!nodeSet.has(from) || !nodeSet.has(to)) {
      errors.push(`边 ${from} → ${to} 引用了未知节点`);
    }
    if (from === to) {
      errors.push(`存在自环：${from} → ${to}`);
    }
  }

  if (errors.length === 0 && hasCycle(dag, nodeSet)) {
    errors.push("图中存在环，不是有向无环图");
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

function hasCycle(dag: DAG, nodeSet: ReadonlySet<string>): boolean {
  const children = new Map<string, string[]>();
  for (const node of nodeSet) children.set(node, []);
  for (const [from, to] of dag.edges) {
    children.get(from)?.push(to);
  }

  const state = new Map<string, 0 | 1 | 2>();
  for (const node of nodeSet) state.set(node, 0);

  // 迭代式 DFS，避免深图递归栈溢出。
  for (const start of nodeSet) {
    if (state.get(start) !== 0) continue;
    const stack: Array<{ node: string; childIndex: number }> = [{ node: start, childIndex: 0 }];
    state.set(start, 1);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      const list = children.get(frame.node) ?? [];
      if (frame.childIndex >= list.length) {
        state.set(frame.node, 2);
        stack.pop();
        continue;
      }
      const next = list[frame.childIndex];
      frame.childIndex += 1;
      if (next === undefined) continue;
      const nextState = state.get(next) ?? 0;
      if (nextState === 1) return true;
      if (nextState === 0) {
        state.set(next, 1);
        stack.push({ node: next, childIndex: 0 });
      }
    }
  }

  return false;
}

function buildIndex(dag: DAG): {
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
  neighbors: Map<string, string[]>;
} {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const neighbors = new Map<string, string[]>();
  for (const node of dag.nodes) {
    parents.set(node, []);
    children.set(node, []);
    neighbors.set(node, []);
  }
  for (const [from, to] of dag.edges) {
    children.get(from)?.push(to);
    parents.get(to)?.push(from);
    neighbors.get(from)?.push(to);
    neighbors.get(to)?.push(from);
  }
  return { parents, children, neighbors };
}

export function parentsOf(dag: DAG, node: string): string[] {
  return buildIndex(dag).parents.get(node) ?? [];
}

export function childrenOf(dag: DAG, node: string): string[] {
  return buildIndex(dag).children.get(node) ?? [];
}

function reachable(
  start: string,
  adjacency: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const seen = new Set<string>();
  const stack = [...(adjacency.get(start) ?? [])];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined || seen.has(node)) continue;
    seen.add(node);
    stack.push(...(adjacency.get(node) ?? []));
  }
  return seen;
}

export function descendantsOf(dag: DAG, node: string): Set<string> {
  return reachable(node, buildIndex(dag).children);
}

export function ancestorsOf(dag: DAG, node: string): Set<string> {
  return reachable(node, buildIndex(dag).parents);
}

function enumerateSimplePaths(
  dag: DAG,
  from: string,
  to: string,
): string[][] {
  const { neighbors } = buildIndex(dag);
  const paths: string[][] = [];
  const path: string[] = [from];
  const visited = new Set<string>([from]);

  function walk(current: string): void {
    if (current === to) {
      paths.push([...path]);
      return;
    }
    for (const next of neighbors.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      path.push(next);
      walk(next);
      path.pop();
      visited.delete(next);
    }
  }

  walk(from);
  return paths;
}

function isCollider(parents: ReadonlyMap<string, readonly string[]>, prev: string, node: string, next: string): boolean {
  const parentsOfNode = parents.get(node) ?? [];
  return parentsOfNode.includes(prev) && parentsOfNode.includes(next);
}

/** 判断给定路径在条件集下是否被阻断（教科书定义：存在一个阻断节点即阻断）。 */
function isPathBlocked(
  parents: ReadonlyMap<string, readonly string[]>,
  children: ReadonlyMap<string, readonly string[]>,
  path: readonly string[],
  conditioned: ReadonlySet<string>,
  descendantCache: Map<string, Set<string>>,
): boolean {
  for (let i = 1; i < path.length - 1; i += 1) {
    const prev = path[i - 1];
    const node = path[i];
    const next = path[i + 1];
    if (prev === undefined || node === undefined || next === undefined) continue;

    if (isCollider(parents, prev, node, next)) {
      if (conditioned.has(node)) continue;
      let desc = descendantCache.get(node);
      if (desc === undefined) {
        desc = reachable(node, children);
        descendantCache.set(node, desc);
      }
      const hasConditionedDescendant = [...desc].some((d) => conditioned.has(d));
      if (!hasConditionedDescendant) return true;
    } else if (conditioned.has(node)) {
      return true;
    }
  }
  return false;
}

/** 返回在条件集下仍然打开的路径，用于诊断“为什么没有分离”。 */
export function findOpenPaths(
  dag: DAG,
  x: string,
  y: string,
  conditioned: readonly string[],
): string[][] {
  const { parents, children } = buildIndex(dag);
  const conditionedSet = new Set(conditioned);
  const descendantCache = new Map<string, Set<string>>();
  return enumerateSimplePaths(dag, x, y).filter(
    (path) => !isPathBlocked(parents, children, path, conditionedSet, descendantCache),
  );
}

export function isDSeparated(
  dag: DAG,
  x: string,
  y: string,
  conditioned: readonly string[],
): boolean {
  if (dag.nodes.length > PATH_NODE_LIMIT) {
    throw new Error(
      `图节点数 ${dag.nodes.length} 超过路径枚举上限 ${PATH_NODE_LIMIT}；请改用多项式算法或拆分子图。`,
    );
  }
  return findOpenPaths(dag, x, y, conditioned).length === 0;
}

export type AdjustmentResult =
  | { status: "IDENTIFIABLE"; minimalSets: string[][]; note: string }
  | { status: "NO_ADJUSTMENT_SET"; reason: string; note: string }
  | { status: "SEARCH_LIMIT"; reason: string; note: string }
  | { status: "INVALID_GRAPH"; errors: string[] };

/**
 * 寻找满足后门判据的最小调整集。
 *
 * 判据实现：在“删除所有自 X 出发的边”的图中，X 与 Y 被 Z d-分离。
 * 候选集排除 X、Y、X 的后代与潜变量；结果以“最小集合”形式返回。
 */
export function findAdjustmentSets(
  dag: DAG,
  x: string,
  y: string,
  options: { latent?: readonly string[] } = {},
): AdjustmentResult {
  const validation = validateDAG(dag);
  const errors = validation.valid ? [] : [...validation.errors];
  if (!dag.nodes.includes(x)) errors.push(`未知节点：${x}`);
  if (!dag.nodes.includes(y)) errors.push(`未知节点：${y}`);
  if (errors.length > 0) return { status: "INVALID_GRAPH", errors };

  const latent = new Set(options.latent ?? []);
  const banned = new Set<string>([x, y, ...descendantsOf(dag, x)]);

  const candidates = dag.nodes.filter(
    (node) => !banned.has(node) && !latent.has(node),
  );
  if (candidates.length > MAX_CANDIDATES || !isAnalyzable(dag)) {
    return {
      status: "SEARCH_LIMIT",
      reason: !isAnalyzable(dag)
        ? `图节点数 ${dag.nodes.length} 超过路径枚举上限 ${PATH_NODE_LIMIT} 个`
        : `候选调整变量 ${candidates.length} 个，超过穷举上限 ${MAX_CANDIDATES} 个`,
      note: "未能穷举全部子集；请人工指定候选变量或改用其他识别策略，不要据此认为不可识别。",
    };
  }

  // 后门判据：删除所有自 X 出发的边，再检验 d-分离。
  const outEdges = new Set(dag.edges.filter(([from]) => from === x).map(edgeKey));
  const backdoorGraph: DAG = {
    nodes: dag.nodes,
    edges: dag.edges.filter((edge) => !outEdges.has(edgeKey(edge))),
  };

  const minimalSets: string[][] = [];
  const subsets = enumerateSubsets(candidates);
  for (const subset of subsets) {
    if (minimalSets.some((found) => isSubset(found, subset))) continue;
    if (isDSeparated(backdoorGraph, x, y, subset)) minimalSets.push(subset);
  }

  if (minimalSets.length === 0) {
    return {
      status: "NO_ADJUSTMENT_SET",
      reason: "在已声明的图中，不存在可观测的后门调整集（可能存在未观测混杂）",
      note: "后门判据失败不等于效应为零：可考虑前门判据、工具变量或敏感性分析等其它识别策略。",
    };
  }

  return {
    status: "IDENTIFIABLE",
    minimalSets,
    note: "结论以传入的图与潜变量假设为条件；图本身错误时结论随之失效。",
  };
}

function edgeKey(edge: readonly [string, string]): string {
  return `${edge[0]}\u0000${edge[1]}`;
}

function isSubset(small: readonly string[], large: readonly string[]): boolean {
  const largeSet = new Set(large);
  return small.every((item) => largeSet.has(item));
}

function enumerateSubsets(items: readonly string[]): string[][] {
  const result: string[][] = [];
  const total = 1 << items.length;
  for (let mask = 0; mask < total; mask += 1) {
    const subset: string[] = [];
    for (let i = 0; i < items.length; i += 1) {
      if ((mask & (1 << i)) !== 0) {
        const item = items[i];
        if (item !== undefined) subset.push(item);
      }
    }
    result.push(subset);
  }
  // 先小后大，便于“最小集合”判定。
  result.sort((a, b) => a.length - b.length || a.join().localeCompare(b.join()));
  return result;
}

/** 图规模是否在路径枚举能力之内。超出时应报告未知，而不是抛异常或给结论。 */
export function isAnalyzable(dag: DAG): boolean {
  return dag.nodes.length <= PATH_NODE_LIMIT;
}

/** 返回删除了自 `node` 出发所有边之后的图。 */
export function withoutOutgoingEdges(dag: DAG, node: string): DAG {
  return {
    nodes: dag.nodes,
    edges: dag.edges.filter(([from]) => from !== node),
  };
}

/** 返回在 X 与 Y 之间的某条简单路径上充当对撞节点的全部节点。 */
export function collidersBetween(dag: DAG, x: string, y: string): Set<string> {
  const colliders = new Set<string>();
  const { parents } = buildIndex(dag);
  for (const path of enumerateSimplePaths(dag, x, y)) {
    for (let i = 1; i < path.length - 1; i += 1) {
      const prev = path[i - 1];
      const node = path[i];
      const next = path[i + 1];
      if (prev === undefined || node === undefined || next === undefined) continue;
      if (isCollider(parents, prev, node, next)) colliders.add(node);
    }
  }
  return colliders;
}
