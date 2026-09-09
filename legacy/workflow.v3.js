/**
 * SCM Causal Auditor - 5 阶段物理隔离因果审计流水线调度脚本 (v3.0-Precision)
 * 适用于 pi-subagents workflowScript / 外部宿主调用
 */

const userQuery = args?.query || args?.task || "待审计断言未指定";

console.log(`[Causal Auditor Workflow] 启动因果形式化审计流水线，目标主题: ${userQuery}`);

// Stage 1: 要素解构与 Step 0 前沿审问
const stage1Prompt = `你现在是因果审计流水线的【Stage 1: 假说与要素解构专家】。
你的任务是客观拆解输入断言，并严格排查概念歧义与环境缺失：

用户待审输入: "${userQuery}"

任务要求:
1. 歧义排查与独立阻断：
   - 检查是否存在严重的样本空间 Omega_V 歧义（如多义词、指代不明）或关键环境 S 缺失（未界定导致因果方向颠倒）；
   - 若存在严重歧义，必须且仅输出以下格式的澄清卡片，并明确标注 [BLOCKED_BY_AMBIGUITY]：
     # 因果建模前沿审问卡片 (Step 0 Frontier Grilling)
     > ⚠️ 检测到输入概念存在重大歧义或关键环境参数缺失，因果结构方程测度无法唯一定义。
     ❓ Q1 - [概念/环境界定题目]: [说明为何缺乏该参数将导致因果模型崩溃，提供 2-4 项明确选项]
     - 选项 A: [具体情境 A]
     - 选项 B: [具体情境 B]
     - 选项 C: [具体情境 C]
     ➡️ 推荐默认设定 (Recommended Standard): [给出最契合大众常识的标准设定]
     *(请确认您的具体意图或直接回复“按推荐设定”以恢复全流程因果审计)*
   - 若上下文清晰或属于标准日常医学/生活语境，直接注明确认的默认设定，继续执行要素提取。
2. 提取内生变量 X (干预动作), Y (结局指标), M (中介路径), S (目标环境)。
3. 制定 3-5 个必须核查的待裁决参数清单 (Theta 清单：真实吸收率、半衰期、有效剂量、毒理阈值)。
4. 构建正向证实与反向质疑双向布尔检索式。

【铁律】: 严禁输出任何主观真假判定！`;

const stage1Result = await runs.run("stage1_deconstructor", {
  agent: "general-purpose",
  task: stage1Prompt
});

const stage1Output = stage1Result.output || stage1Result;

// Step 0 守卫检查：若触发概念严重歧义，立即阻断挂起，直接返回 Q1 澄清卡片
if (typeof stage1Output === "string" && (stage1Output.includes("Q1 -") || stage1Output.includes("[BLOCKED_BY_AMBIGUITY]"))) {
  console.log("[Causal Auditor Workflow] 检测到 Step 0 前沿严重歧义，流水线已安全阻断挂起，等待用户澄清。");
  return stage1Output;
}

console.log("[Causal Auditor Workflow] Stage 1 完成，要素与待查清单已抽取，继续执行事实检索。");

// Stage 2: 假设驱动搜索与去伪 (Searcher & Verifier)
const stage2Prompt = `你现在是因果审计流水线的【Stage 2: 假设驱动双向搜索与去伪核验专家】。
基于 Stage 1 成果开展严格的多源双向搜索与证据核验。

【Stage 1 解构成果】:
${stage1Output}

任务要求:
1. 双向核查：利用正向与反向布尔检索式，针对权威源（WHO, CDC, FDA, Cochrane, Lancet, NEJM, 官方指南）进行交叉验证。
2. 过滤 90% 互联网低质营销号语料。
3. 强制核验时效性：重点核查近 3-5 年（如 2021-2026）最新人体临床实证与权威监管撤回/通告。
4. 给出【搜索饱和度判定证明】；若证据不足，明确列出证据缺口。

输出纯粹的、无偏见的事实与客观证据汇总。`;

const stage2Result = await runs.run("stage2_searcher_verifier", {
  agent: "general-purpose",
  task: stage2Prompt
});

console.log("[Causal Auditor Workflow] Stage 2 完成，权威证据链与搜索饱和度已确立。");

// Stage 3: SCM 8 步拓扑推导与真假边界建模 (Causal Modeler)
const stage3Prompt = `你现在是因果审计流水线的【Stage 3: 结构因果拓扑与边界建模专家】。
精通 Judea Pearl SCM、d-分离、后门准则、对撞偏倚/辛普森悖论、反事实双生网络与环境传输理论。

【输入事实与证据】:
- 要素清单: ${stage1Output}
- 纯净证据: ${stage2Result.output || stage2Result}

任务要求:
在内部进行严谨的 SCM 数学推演：
1. 构建 DAG 因果图，写出后门不等式 P(Y|X, S) != P(Y|do(X), S)；
2. 严密排查混杂变量 Z、对撞偏倚（M-偏误、伯克森偏倚）与辛普森悖论；
3. 检验生理中介通路：严格解耦 Pearl 前门准则与物理中介吸收阻断（验证自然间接效应 NIE 是否归零）；
4. 评估选择图 G_S 跨域机制不变性（试管/动物极端剂量向人类生活外推）；
5. 反事实双生网络推演（溯因-动作-预测三步法），计算必要性概率 PN 与充分性概率 PS；
6. 严格划定【成立边界】（在何种微观/特定条件下为真）与【失效边界】（在何种常规生活环境下为假）。
注意：若核心前提不可核实且无决定性证伪反证，必须使用【无法判定（证据不足）】。`;

const stage3Result = await runs.run("stage3_causal_modeler", {
  agent: "general-purpose",
  task: stage3Prompt
});

console.log("[Causal Auditor Workflow] Stage 3 完成，因果机制与真假边界已建模。");

// Stage 4: 红队反事实对抗压力测试 (Red Team Adversary)
const stage4Prompt = `你现在是因果审计流水线的【Stage 4: 红队反事实对抗攻击专家】。
扮演最苛刻的反方辩手，专门挑刺并攻击 Stage 3 的模型与结论！

【待攻击结论与模型】:
${stage3Result.output || stage3Result}

压力测试要点:
1. 反事实检验：若不采取该干预，自然病程自限性自愈或安慰剂效应能否解释结局？
2. 幸存者偏差与依从性损耗：是否只统计了见效者而忽略受害者？实际效应极限界是否跨越零点？
3. 二阶毒性与长期隐性代价。
输出【脆弱点与反驳加固清单】。`;

const stage4Result = await runs.run("stage4_red_team", {
  agent: "general-purpose",
  task: stage4Prompt
});

console.log("[Causal Auditor Workflow] Stage 4 完成，红队反事实压力测试已收敛。");

// Stage 5: 高维金字塔报告合成 (Pyramid Synthesizer)
const stage5Prompt = `你现在是因果审计流水线的【Stage 5: 高维金字塔报告终极合成大师】。
将前序沉淀转化为一份正文零公式、直击要害、高度对称、人类友好型报告！

【前序审计沉淀】:
- Stage 1: ${stage1Output}
- Stage 2: ${stage2Result.output || stage2Result}
- Stage 3: ${stage3Result.output || stage3Result}
- Stage 4: ${stage4Result.output || stage4Result}

【排版铁律】:
1. 正文绝不堆砌生硬数学公式，大幅精炼推断过程！
2. 严格按最新规范顺序呈现 (STD-21)：
   - 标题与审计速览（一句话真实度界限 + 默认设定注明）
   - 一、 核心要素与因果机制拓扑图（ASCII 纯文本流程图 + 极简机制解构）
   - 二、 三档金字塔综合决策指南（结论先行 · 正反严格对称 STD-22）：
     * 第一档：高因果强度·确凿事实（正面做什么/怎么做/为什么 + 反面别做什么/禁忌后果）
     * 第二档：中因果强度·实用科学（正面做什么/怎么做/为什么 + 反面别做什么/禁忌后果）
     * 第三档：低因果强度·营销陷阱/伪科学（正面替代方案做什么/怎么做/为什么 + 反面坚决抵制别做什么/禁忌后果）
   - 三、 真假边界与适用条件剖析（简要点明成立边界 vs 失效边界）
   - 四、 因果逻辑漏洞与潜在次生风险诊断（简短点名）
   - 五、 执行的八步因果排查与证据缺口公示（极简清单）
   - 六、 参考文献与检索轨迹（统一后置收敛：权威信源、近3-5年时效核验、去伪说明与饱和度证明）

请立即渲染完整报告！`;

const finalReport = await runs.run("stage5_pyramid_synthesizer", {
  agent: "general-purpose",
  task: stage5Prompt
});

console.log("[Causal Auditor Workflow] 流水线全部圆满完成，终极报告已生成。");
return finalReport.output || finalReport;
