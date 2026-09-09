---
name: causal-auditor
description: 结构因果审计引擎（v0.9.0）。对健康、消费、商业与社会类因果主张做边界门禁、图论识别判定、22 项偏误排查、双向证据溯源与红队审查，并输出带能力缺口披露的报告。适用于"某说法是否可信""这个关联是不是因果"等审计请求。
---

# SCM Causal Auditor v0.9.0

## 它是什么

一个**确定性因果审计引擎**，不是会聊天的权威。它把审计拆成可核验的步骤，把每个结论绑定到具体证据或具体图与假设，并在信息不足时明确说"不足"。

## 它明确不是什么

- **不是因果发现器**：不能从一句话主张自动推断真实因果结构。图算法只对**你声明的图**有效。
- **不是证据裁判**：检索命中数量不等于证据充分性，引擎不输出"饱和度百分比"。
- **不是物理隔离的红队**：单上下文模式（同一对话窗口）存在自回归锚定，红队会退化为附和。真隔离需要宿主提供独立子进程。
- **不替你补全事实**：未调用的检索不会写成"经检索显示"；缺要素的主张会被阻断并要求澄清。

完整认识论依据见 `docs/adr/0002-causal-audit-epistemic-corrections.md`。

## 判定语义

判定是**五值**，不是真/假：

| 取值 | 含义 |
| :--- | :--- |
| `SUPPORTED` | 检索到的可用条目方向一致为支持；**未评估研究质量** |
| `REFUTED` | 可用条目方向一致为反对；**未评估研究质量** |
| `CONFLICTING` | 支持与反对并存 |
| `INSUFFICIENT_EVIDENCE` | 证据不足（**不等于效应为零**） |
| `NOT_APPLICABLE` | 该偏误或该结论不适用于此类主张 |

任何判定都带 `待复核` 标记：引擎只做方向统计，不做质量评估。

## 执行流程

```text
主张
 │
 ├─[1] 边界门禁 evaluateBoundary
 │     缺要素 → 输出澄清卡片并停止（不填默认值）
 │
 ├─[2] 结构判定（仅在用户提供图时）
 │     d-分离 / 后门调整集 / 对撞节点识别
 │     结论前缀："在已声明图与假设下"
 │
 ├─[3] 22 项偏误排查 scanBiases
 │     每项 → 命中 / 不适用 / 未知 + 依据
 │     "未知"是正常结果
 │
 ├─[4] 双向证据检索 EvidenceEngine
 │     证实式 + 证伪式分别执行
 │     无标识符条目被拒绝；能力不可用 → UNAVAILABLE
 │
 ├─[5] 红队输入包 buildRedTeamPacket
 │     信息屏蔽（拒绝结论字段）+ 问题清单
 │     结论经 responder 契约校验：虚构引用会被拒绝并入
 │     允许"未发现替代解释"或"证据不足"
 │
 └─[6] 报告 renderReport
       判定 + 依据 + 22 项表 + 证据索引 + 未解决项 + 能力缺口
       不强制三档金字塔
```

## 如何使用

### 方式一：CLI（推荐，可复现）

```bash
# 不检索：显式报告"未执行检索"
node src/cli.ts examples/request.json

# 真实 PubMed 检索
node src/cli.ts examples/request.json --live

# 离线回放固定脚本
node src/cli.ts examples/request.json --replay examples/fixture.json

# 并入经契约校验的红队结论（引用虚构证据会被拒绝）
node src/cli.ts examples/request.json --replay examples/fixture.json --redteam examples/redteam.json

# 只生成单轮宿主提示词
node src/cli.ts examples/request.json --prompt
```

### 方式二：单轮宿主提示词

在没有独立子进程的宿主（普通 Claude Code / Codex 对话）中，用 `--prompt` 生成的提示词作为系统指令。该提示词会**自行声明"非隔离"**并禁止编造检索结果。

### 方式三：作为库

```ts
import { runAudit } from "./src/runtime/orchestrator.ts";
import { createPubMedProvider } from "./src/evidence/adapters/pubmed.ts";

const outcome = await runAudit(request, { searchProvider: createPubMedProvider() });
if (outcome.status === "BLOCKED_NEEDS_CLARIFICATION") {
  // 向用户提问，不要自行假设
} else {
  console.log(outcome.report);
}
```

## 验证

```bash
npm test          # 109 项离线确定性测试（含 1 项真实网络门禁，默认跳过）
npm run typecheck # TypeScript 严格模式
CAUSAL_AUDITOR_LIVE=1 node --test "test/live_pubmed.test.ts"  # 真实网络门禁
```

三类证据相互独立，缺一不可：

1. **离线测试**：断言确定性代码在其声明契约下的行为。
2. **真实运行记录**：检索、模型推理、宿主隔离必须留下真实调用记录；未执行则报告 `UNAVAILABLE`。
3. **人工复核**：判定必须经人评估研究质量后才可作为决策依据。

## 已知限制

- 检索式由结构化字段拼接而成，非英文术语召回率低（引擎会提示）。
- 证伪式检索依赖关键词，阴性结果常未被索引；**不能证明"不存在反对证据"**。
- 22 项偏误目录中，多数条目在缺少研究设计信息时只能返回"未知"。
- 后门调整集搜索为穷举，候选变量超过 12 个时返回 `SEARCH_LIMIT`（明确报告，不假装无解）。
- **隔离只能被验证，不能被创造**：`src/runtime/scheduler.ts` 通过宿主报告的进程标识证明隔离；需要隔离的阶段若与其它阶段共享进程标识、未报告标识或未执行，隔离一律判定为假。真实多进程调度需要宿主实现 `SubagentHost` 适配器。
- 红队结论的**生成**仍需模型或人；本仓库只提供契约、校验与提示词构造。
