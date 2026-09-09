[English](README.md) | **简体中文**

# causal-auditor

**开源因果审计引擎，用于主张核验。`causal-auditor` 宁可返回「证据不足」，也不瞎猜，更绝不编造引用。**

[![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-109-brightgreen)](test)
[![Runtime dependencies](https://img.shields.io/badge/runtime%20deps-0-blue)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/StaySound4/causal-auditor/pulls)

`causal-auditor` 用一条确定性的六阶段流水线审计因果、健康、消费与商业主张：**边界门禁 → 因果图识别 → 22 项偏误排查 → 双向证据检索 → 信息屏蔽红队 → 带缺口披露的报告**。

`causal-auditor` 报告中的每条结论都绑定到具体证据条目（外部事实，附真实 PMID/DOI）或具体因果图及其假设（结构推论）。信息不足时，`causal-auditor` 报告 `INSUFFICIENT_EVIDENCE` 并停止。

| 快速事实 | |
| :--- | :--- |
| **定位** | 确定性因果推断审计引擎 + CLI + TypeScript 库 |
| **语言 / 运行时** | TypeScript on Node.js ≥ 22（已在 Node 24 验证） |
| **运行时依赖** | 0（使用内置 `fetch` 与 `node:test`） |
| **测试** | 109 项（108 项离线确定性 + 1 项可选真实网络门禁） |
| **判定模型** | 五值枚举（不是真/假） |
| **偏误目录** | 22 项流行病学/计量经济学模式，每项均给出判定依据 |
| **证据来源** | NCBI E-utilities（PubMed），无需 API Key |
| **许可证** | MIT |

---

## 目录

- [causal-auditor 解决什么问题？](#causal-auditor-解决什么问题)
- [causal-auditor 适合谁用？](#causal-auditor-适合谁用)
- [causal-auditor 与其它方案有何不同？](#causal-auditor-与其它方案有何不同)
- [快速开始](#快速开始)
- [causal-auditor 如何工作？](#causal-auditor-如何工作)
- [判定语义](#判定语义)
- [验证：三类独立证据](#验证三类独立证据)
- [常见问题](#常见问题)
- [已知限制](#已知限制)
- [设计原则](#设计原则)
- [项目结构](#项目结构)
- [许可证](#许可证)

---

## causal-auditor 解决什么问题？

`causal-auditor` 只解决一个问题：**让看起来科学的主张接受机制层面的审计，而不是感觉层面的判断**——并且审计过程可复现。

多数 AI 事实核查会以同样的三种方式失败。`causal-auditor` 用硬机制而非提示词请求来阻断每一种失败。

| AI 事实核查中的失败模式 | causal-auditor 的机制 |
| :--- | :--- |
| **编造证据 / 幻觉引用。** 提示词要求综述文献，却没有绑定检索工具，模型于是捏造 DOI、期刊名和「搜索饱和度 95%」。 | 检索是硬接缝。没有绑定提供方 ⇒ 显式 `UNAVAILABLE`。任何缺少真实标识符（PMID / DOI / 公文号 / URL）的检索条目都会被**拒绝并记录**。 |
| **把不确定性压成二值。** 「没检索到」被悄悄写成「假的」——这是统计错误，不是结论。 | `causal-auditor` 输出**五值判定**，含 `INSUFFICIENT_EVIDENCE` 与 `CONFLICTING`。 |
| **替主张辩护。** 自回归模型会被自己写下的第一句话锚定，跑在同一上下文里的「红队」只会变成啦啦队。 | 红队输入经过**信息屏蔽**：任何含 verdict/conclusion 字段的对象都会以契约违规被拒绝。 |
| **伪精确。** 一个看起来量化、其实什么都没测的「饱和度评分」。 | `causal-auditor` 只报告可核验的检索元数据，并明确声明该元数据**不是**证据充分性评分。 |
| **虚假平衡。** 辟谣内容被掺入无关的「平衡」建议。 | 不强制三档金字塔。报告自适应，绝不为对称给辟谣掺水。 |
| **过度声称。** 判定读起来像质量评估。 | 每个 `causal-auditor` 判定都标记 `requires review`：引擎只统计证据方向，不评估研究质量。 |

完整的认识论依据——包括本项目**明确否决**的那些断言——记录在 [`docs/adr/0002-causal-audit-epistemic-corrections.md`](docs/adr/0002-causal-audit-epistemic-corrections.md)。

## causal-auditor 适合谁用？

- **正在构建 AI 事实核查或主张核验产品的开发者**，需要一层不会凭空造出信源的引用校验。
- **RAG 与 LLM 管线工程师**，需要在「模型生成了健康主张」与「产品把它发出去」之间放一道确定性护栏。
- **健康、营养与消费者保护研究者**，需要一套覆盖 22 类已知因果偏误的可复现初筛。
- **审计营销或商业主张的分析师**（留存提升、会员 ROI），需要把混杂与效应分开。
- **任何被「研究表明」说服过的人**，想把主张还原为可声明的图、偏误清单和编号证据索引。

## causal-auditor 与其它方案有何不同？

| 能力 | 通用 LLM 事实核查 | 仅 RAG 管线 | causal-auditor |
| :--- | :--- | :--- | :--- |
| 检索绑定真实工具 | 通常没有 | 有 | **有——硬接缝；无提供方 ⇒ `UNAVAILABLE`** |
| 拒绝无真实标识符的条目 | 无 | 少见 | **有，并记录拒绝原因** |
| 判定词表 | 真 / 假 / 也许 | 回答文本 | **五值枚举，含 `INSUFFICIENT_EVIDENCE`** |
| 因果图数学 | 无 | 无 | **d-分离、对撞节点识别、最小后门调整集** |
| 偏误清单 | 临时 | 临时 | **22 项目录化模式，每项给出依据** |
| 红队独立性 | 同一上下文 | 同一上下文 | **信息屏蔽输入契约；隔离是被*验证*的，而非声称的** |
| 识别编造引用 | 无 | 部分 | **有——引用未知证据会被拒绝** |
| 确定性离线测试 | 少见 | 少见 | **108 项离线测试，零 API 成本** |

## 快速开始

```bash
npm install

# 1) 不检索：报告会明确写「未执行检索」
node src/cli.ts examples/request.json

# 2) 真实 PubMed 检索（NCBI E-utilities）
node src/cli.ts examples/request.json --live

# 3) 用固定脚本离线回放
node src/cli.ts examples/request.json --replay examples/fixture.json

# 4) 并入经契约校验的红队结论（虚构引用会被拒绝）
node src/cli.ts examples/request.json --replay examples/fixture.json --redteam examples/redteam.json

# 5) 生成单轮宿主提示词（自声明「非隔离」）
node src/cli.ts examples/request.json --prompt
```

把 `causal-auditor` 当库用：

```ts
import { runAudit } from "./src/runtime/orchestrator.ts";
import { createPubMedProvider } from "./src/evidence/adapters/pubmed.ts";

const outcome = await runAudit(request, { searchProvider: createPubMedProvider() });

if (outcome.status === "BLOCKED_NEEDS_CLARIFICATION") {
  // 向用户提问。不要自行编造剂量、人群或终点。
} else {
  console.log(outcome.report);
}
```

第 4 步生成的样例报告存档于 [`examples/sample-report.md`](examples/sample-report.md)。

## causal-auditor 如何工作？

```text
主张
 │
 ├─[1] 边界门禁 ── evaluateBoundary
 │       缺要素 → 输出澄清卡片并停止（不填默认值）
 │       必填项按领域确定：临床/营养需要途径+剂量；
 │       行为/商业/社会需要暴露定义
 │
 ├─[2] 结构识别 ──（仅在提供图时）
 │       d-分离 / 最小后门调整集 / 对撞节点识别
 │       每条结论都带前缀「在已声明图与假设下」
 │
 ├─[3] 偏误排查 ── scanBiases
 │       22 项 → PRESENT / ABSENT / UNKNOWN / NOT_APPLICABLE + 依据
 │       UNKNOWN 是正常且预期的结果
 │
 ├─[4] 双向检索 ── EvidenceEngine
 │       证实式与证伪式检索分别执行
 │       标识符强制；提供方缺失 → UNAVAILABLE（绝不静默）
 │
 ├─[5] 红队输入包 ── buildRedTeamPacket + responder 契约
 │       信息屏蔽 + 问题清单
 │       结论经校验：引用未知证据会被拒绝
 │       「未发现替代解释」与「证据不足」都是合法结论
 │
 └─[6] 报告 ── renderReport
         判定 + 依据 + 待复核标记 + 22 项表 + ASCII 因果图
         + 编号证据索引 + 未解决项 + 能力缺口
         不强制三档金字塔
```

### 两个真实接缝

| 接缝 | 实现 | 证明了什么 |
| :--- | :--- | :--- |
| `EvidenceSearchProvider` | `pubmed`（实时）、`replay`（离线）、`unavailable`（显式阻断） | 检索可替换，且永不造假 |
| `RedTeamResponder` | `static`（文件/人工）、`model`（宿主注入生成函数） | 结论被校验，而不是在本仓库被编造 |

### 隔离是被验证的，不是被声称的

`src/runtime/scheduler.ts` **不能创造隔离**——它只能**验证**。需要隔离的阶段，只有在「已执行 + 报告了进程标识 + 该标识不与任何其它阶段相同」时才算隔离。共享标识、缺标识、跳过阶段、阶段失败，四种情况一律判 `isolated: false` 并给出原因。

## 判定语义

`causal-auditor` 输出五值判定，不存在布尔真伪输出。

| 取值 | 含义 |
| :--- | :--- |
| `SUPPORTED` | 可用条目方向一致为支持。**不评估研究质量。** |
| `REFUTED` | 可用条目方向一致为反对。**不评估研究质量。** |
| `CONFLICTING` | 支持与反对并存。 |
| `INSUFFICIENT_EVIDENCE` | 证据不足。**这不等于效应为零。** |
| `NOT_APPLICABLE` | 该偏误或该结论不适用于此类主张。 |

偏误结论使用另一套四值状态：`PRESENT` / `ABSENT` / `UNKNOWN` / `NOT_APPLICABLE`。

## 验证：三类独立证据

```bash
npm test                                                        # 109 项测试（108 离线 + 1 可选真实门禁）
npm run typecheck                                               # TypeScript 严格模式
CAUSAL_AUDITOR_LIVE=1 node --test "test/live_pubmed.test.ts"    # 真实网络门禁
node scripts/live_probe.ts                                      # 打印真实检索式与命中条目
```

| 类别 | 证明了什么 | **不能**证明什么 |
| :--- | :--- | :--- |
| 离线测试 | 确定性代码遵守其声明的契约 | 任何外部事实为真 |
| 真实运行记录 | 检索确实发生过，并返回了真实标识符 | 检索到的研究质量好 |
| 人工复核 | 研究质量、适用性、混杂评估 | — |

**三者缺一不可。测试全绿不代表审计结论正确。**

测试重点：

- `test/bias_scenarios.test.ts` —— 6 组端到端基准场景，与**穷举**的期望 `PRESENT` 集合比对：**误报 0、漏报 0**。
- `test/dag.test.ts` —— 教科书级 d-分离用例：链、分叉、对撞、对撞后代、M-结构、潜变量排除、`SEARCH_LIMIT` 与 `NO_ADJUSTMENT_SET` 的区分。
- `test/scheduler.test.ts` —— 防伪隔离套件：共享进程标识 ⇒ 隔离判定为假。

## 常见问题

### causal-auditor 能证明一个主张是真是假吗？

不能。`causal-auditor` 产出的是*可追溯的审计*，不是真值证书。`causal-auditor` 报告检索证据的方向、适用的因果偏误，以及任何图结论背后的结构假设。每个 `causal-auditor` 判定都带 `requires review` 标记，因为引擎不评估研究质量。

### causal-auditor 能防止大模型幻觉吗？

`causal-auditor` 只防一类特定幻觉：**编造引用**。任何缺少可核验标识符（PMID / DOI / 公文号 / URL）的证据条目都会被拒绝并记录，指向未知证据的引用会在红队契约处被拒绝。`causal-auditor` 不能阻止语言模型对检索到的文本做出错误推理。

### causal-auditor 可以离线运行吗？

可以。`causal-auditor` 有 108 项确定性离线测试，零网络访问、零 API 成本。第 109 项测试是由 `CAUSAL_AUDITOR_LIVE=1` 启用的可选真实网络门禁。未绑定检索提供方时，CLI 报告「未执行检索」，而不是静默降级。

### 为什么 causal-auditor 经常返回「证据不足」？

因为 `UNKNOWN` 与 `INSUFFICIENT_EVIDENCE` 才是诚实的结果。22 项偏误中多数无法仅凭一句主张判定——它们需要随机化、盲法、脱落率或随访时长等研究设计信息。`causal-auditor` 报告 `UNKNOWN`，而不是猜成 `ABSENT`。

### causal-auditor 能替代系统综述吗？

不能。`causal-auditor` 是初筛与可复现性工具。系统综述需要方案注册、穷尽数据库检索、双人独立筛选、偏倚风险评估与 Meta 分析。`causal-auditor` 自动化的是其中确定性部分——图运算、偏误枚举、标识符校验、引用绑定——并把剩余部分明确交给人工复核。

### d-分离与相关性有什么区别？

d-分离是图的性质：一条路径被阻断，当且仅当路径上存在一个在条件集中间节点（链或分叉），或存在一个不在条件集中且其后代也不在条件集中的对撞节点。相关性是观测数据的统计性质。`causal-auditor` 在**已声明的因果图**上计算 d-分离；相关性永远不会作为因果证据出现在 `causal-auditor` 报告中。

### causal-auditor 能从数据中发现因果结构吗？

不能。`causal-auditor` 只分析你声明的图。从观测数据做因果发现（PC 算法、GES、LiNGAM）不在范围内。`causal-auditor` 也无法证明声明的图正确——图错了，调整集就是错的。

### causal-auditor 里的「后门调整集」是什么意思？

后门调整集是能阻断暴露到结局全部非因果路径的最小可观测变量集合。`causal-auditor` 通过「删除所有自暴露节点出发的边 + 检验 d-分离」来计算最小调整集。`causal-auditor` 会把暴露的后代与潜变量排除在候选集之外，并在候选变量超过 12 个时返回 `SEARCH_LIMIT`，而不是给一个错误答案。

## 已知限制

- **检索式基于关键词。** `causal-auditor` 由结构化字段拼接检索式；非英文术语在 PubMed 召回率低，引擎会就此给出提示。
- **证伪检索天然不完备。** 阴性结果常未被索引或未发表。`causal-auditor` 的检索**无法**证明「不存在反对证据」。
- **缺少研究设计信息时，22 项偏误多数返回 `UNKNOWN`。** 这是诚实结果，不是 bug。
- **后门调整集搜索为穷举。** 候选变量超过 12 个时返回 `SEARCH_LIMIT`（明确报告，绝不当作「不可识别」）。
- **隔离是被验证的，不是被创造的。** 真实多进程编排需要宿主实现 `SubagentHost` 适配器。
- **红队结论的生成仍需模型或人。** 本仓库提供契约、校验与提示词构造。

## 设计原则

1. **证据不足 ≠ 效应为零。** `INSUFFICIENT_EVIDENCE` 是一等公民。
2. **无标识符不入库。** 缺少可核验标识符的检索结果被拒绝并记录。
3. **能力缺失即阻断，不降级。** 没有检索工具就写「未执行检索」，绝不编造引用。
4. **结构结论有条件。** 图结论永远注明「在已声明图与假设下」。
5. **不强迫生成。** 红队可以得出「未发现替代解释」。
6. **不制造虚假平衡。** 报告绝不为对称给辟谣掺水。
7. **验证优于声称。** 隔离由宿主报告的进程标识证明；`UNKNOWN` 就报 `UNKNOWN`。

## 项目结构

```text
src/
├── core/
│   ├── types.ts          领域类型：五值判定、主张规格、风险标记
│   ├── boundary.ts       Step 0 门禁（按领域定必填项，不填默认值）
│   ├── dag.ts            d-分离 / 后门调整集 / 对撞节点（纯函数）
│   └── bias_catalog.ts   22 项目录（每项都给出状态与依据）
├── evidence/
│   ├── types.ts          检索契约（标识符强制，无伪指标）
│   ├── engine.ts         双向检索、去重、拒绝无标识条目
│   └── adapters/
│       ├── pubmed.ts     NCBI E-utilities 实时检索（无第三方依赖）
│       ├── replay.ts     离线回放
│       └── unavailable.ts 显式不可用
├── redteam/
│   ├── packet.ts         信息屏蔽 + 问题清单
│   └── responder.ts      结论契约 + 静态/模型应答适配器
├── report/
│   ├── render.ts         报告渲染（编号引用，无虚假平衡）
│   └── ascii_dag.ts      ASCII 因果图
├── runtime/
│   ├── orchestrator.ts   编排 + 检索式生成 + 能力缺口记录
│   ├── scheduler.ts      子代理编排计划 + 隔离证明（只验证）
│   └── single_turn_prompt.ts  单轮宿主提示词（自声明非隔离）
└── cli.ts                命令行入口
```

## 许可证

[MIT](LICENSE)

---

**关键词：** 因果推断 · 主张核验 · AI 事实核查 · 大模型幻觉防治 · 引用校验 · d-分离 · 后门判据 · 结构因果模型 · 流行病学 · 证据综合 · PubMed · RAG 护栏 · TypeScript

[English](README.md) | **简体中文**
