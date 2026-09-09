# SCM Causal Auditor 5 阶段子代理架构深度解析 (v3.0-Precision)

## 一、 为什么单模型单上下文必然陷入“先射箭再画靶”？

大语言模型基于自回归解码机制：一旦在输出首句锁定了直觉立场，后续所有注意力分配便沦为该立场的后验辩护，无法完成反向假设审问。

## 二、 物理级上下文隔离设计原理

`causal-auditor` 将任务完全解耦在 5 个独立的子代理中运行：

1. **Stage 1 (Deconstructor & Frontier Grilling)**：
   - 目标：概念歧义检测与要素抽取。
   - 铁律：排查变量样本空间 $\Omega_V$ 歧义与环境 $S$ 漂移；若歧义严重，暂停审计并输出 Step 0 澄清提问 Q1。严禁下任何结论。
2. **Stage 2 (Searcher & Verifier)**：
   - 目标：假设驱动双向布尔检索与事实核验。
   - 手段：正向验证式 + 反向质疑式，锁定权威期刊与官方指南，排查 90% 劣质语料，出具饱和度证明。
3. **Stage 3 (Causal Modeler)**：
   - 目标：8 步因果判定与 SCM 拓扑推演。
   - 手段：内部进行后门不等式推导、中介截断、跨域选择图检验、反事实三步法与归因责任计算；划定真假边界；遵守证据不足元认知谦逊。
4. **Stage 4 (Red Team Adversary)**：
   - 目标：最苛刻的反方对抗攻击。
   - 手段：平行世界自限性自愈质疑、幸存者偏差审查、依从性损耗与长期隐性代价。
5. **Stage 5 (Pyramid Synthesizer)**：
   - 目标：高维金字塔报告合成。
   - 手段：正文零公式，大幅精炼推断；首屏直达 ASCII 因果图与三档金字塔决策；后置收敛审计与参考文献。

---

## 三、 多平台自动同步

本单一 Skill 自动适配全局与各平台工具链：
- `~/.agents/skills/causal-auditor` (全局 agents)
- `~/.pi/skills/causal-auditor` (全局 pi)
- `~/.claude/skills/causal-auditor` (Claude Code)
- `~/.codex/skills/causal-auditor` (Codex)
- `~/.omp/skills/causal-auditor` (omp)
- `~/omp-skills-pack/skills/causal-auditor` (omp pack)
