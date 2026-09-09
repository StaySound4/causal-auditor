/**
 * 多子代理编排契约与隔离证明。
 *
 * 关键诚实约束（见 docs/adr/0002）：
 * 本模块**不能创造隔离**，只能**验证**宿主是否真的把需要独立的阶段放进了不同进程。
 * 若宿主未提供可验证的进程标识，则隔离状态一律为 `false`，报告不得声称已隔离。
 */

export interface AuditStage {
  key: string;
  purpose: string;
  /** 是否必须与其他阶段物理隔离，才能避免前文立场锚定。 */
  requiresIsolation: boolean;
  /** 该阶段允许接收的输入（信息屏蔽契约）。 */
  inputContract: string;
}

export function buildAuditPlan(): AuditStage[] {
  return [
    {
      key: "boundary_gating",
      purpose: "结构化抽取主张要素；缺要素则阻断并要求澄清",
      requiresIsolation: false,
      inputContract: "仅原始主张文本",
    },
    {
      key: "evidence_retrieval",
      purpose: "执行证实式与证伪式双向检索，提取带标识符的证据",
      requiresIsolation: false,
      inputContract: "结构化主张（不含任何结论）",
    },
    {
      key: "graph_analysis",
      purpose: "在已声明图上计算 d-分离与后门调整集",
      requiresIsolation: false,
      inputContract: "已声明图与潜变量假设",
    },
    {
      key: "bias_scan",
      purpose: "逐项扫描 22 项偏误并给出依据",
      requiresIsolation: false,
      inputContract: "结构化主张 + 图 + 研究设计",
    },
    {
      key: "red_team",
      purpose: "检验零效应竞争解释、混杂替代路径与长期次生代价",
      requiresIsolation: true,
      inputContract: "仅原始主张与双向证据；**严禁**输入任何模型结论",
    },
    {
      key: "report_synthesis",
      purpose: "合成报告：判定、依据、证据索引、未解决项与能力缺口",
      requiresIsolation: false,
      inputContract: "各阶段产物 + 红队结论",
    },
  ];
}

export interface StageResult {
  key: string;
  output: string;
  /** 宿主报告的进程标识；缺失即无法证明隔离。 */
  processId: string;
}

export interface HostCapability {
  available: boolean;
  reason?: string;
}

export interface SubagentHost {
  readonly name: string;
  capability(): HostCapability;
  spawn(stage: AuditStage, task: string): Promise<StageResult>;
}

export type IsolationProof =
  | { isolated: true; distinctProcesses: number; requiredStages: number }
  | { isolated: false; reason: string; distinctProcesses: number; requiredStages: number };

export type SchedulerOutcome =
  | {
      status: "COMPLETED";
      host: string;
      plan: AuditStage[];
      results: StageResult[];
      isolation: IsolationProof;
    }
  | {
      status: "UNAVAILABLE";
      host: string;
      plan: AuditStage[];
      results: StageResult[];
      isolation: IsolationProof;
      reason: string;
    };

/**
 * 依据宿主报告的进程标识验证隔离。
 *
 * 判定标准：需要隔离的阶段必须 (1) 已执行、(2) 报告了进程标识、
 * (3) 其进程标识不与任何其它阶段（尤其是它之前提供上下文的阶段）相同。
 * 任一条件不满足即判定为未隔离——这是防止“假装隔离”的唯一手段。
 */
export function proveIsolation(
  plan: readonly AuditStage[],
  results: readonly StageResult[],
): IsolationProof {
  const required = plan.filter((stage) => stage.requiresIsolation);
  const byKey = new Map(results.map((result) => [result.key, result]));
  const distinct = new Set(results.map((result) => result.processId.trim()).filter((id) => id.length > 0));

  for (const stage of required) {
    const result = byKey.get(stage.key);
    if (result === undefined) {
      return {
        isolated: false,
        reason: `阶段 ${stage.key} 未执行，无法证明隔离`,
        distinctProcesses: distinct.size,
        requiredStages: required.length,
      };
    }
    const processId = result.processId.trim();
    if (processId.length === 0) {
      return {
        isolated: false,
        reason: `阶段 ${stage.key} 未报告进程标识，无法证明隔离`,
        distinctProcesses: distinct.size,
        requiredStages: required.length,
      };
    }
    const sharedWith = results.filter(
      (other) => other.key !== stage.key && other.processId.trim() === processId,
    );
    if (sharedWith.length > 0) {
      return {
        isolated: false,
        reason:
          `阶段 ${stage.key} 与 ${sharedWith.map((other) => other.key).join("、")} 共享进程标识 ${processId}，` +
          "说明它们并未真正隔离（可能在同一上下文中运行）",
        distinctProcesses: distinct.size,
        requiredStages: required.length,
      };
    }
  }

  return { isolated: true, distinctProcesses: distinct.size, requiredStages: required.length };
}

export function buildStageTask(stage: AuditStage, context: string): string {
  return [
    `阶段：${stage.key}`,
    `目标：${stage.purpose}`,
    `输入契约：${stage.inputContract}`,
    "",
    "上下文：",
    context,
  ].join("\n");
}

export async function runPlan(
  host: SubagentHost,
  plan: readonly AuditStage[] = buildAuditPlan(),
  context = "",
): Promise<SchedulerOutcome> {
  const capability = host.capability();
  if (!capability.available) {
    return {
      status: "UNAVAILABLE",
      host: host.name,
      plan: [...plan],
      results: [],
      isolation: {
        isolated: false,
        reason: "宿主未提供子代理能力，未执行任何阶段",
        distinctProcesses: 0,
        requiredStages: plan.filter((stage) => stage.requiresIsolation).length,
      },
      reason: capability.reason ?? "宿主未说明原因",
    };
  }

  const results: StageResult[] = [];
  for (const stage of plan) {
    try {
      results.push(await host.spawn(stage, buildStageTask(stage, context)));
    } catch (error) {
      // 阶段失败必须可披露；隔离判定基于已收集的结果，必然是未隔离。
      return {
        status: "UNAVAILABLE",
        host: host.name,
        plan: [...plan],
        results,
        isolation: proveIsolation(plan, results),
        reason: `阶段 ${stage.key} 执行失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return {
    status: "COMPLETED",
    host: host.name,
    plan: [...plan],
    results,
    isolation: proveIsolation(plan, results),
  };
}
