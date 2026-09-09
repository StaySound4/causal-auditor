/**
 * 22 项因果偏误排查目录。
 *
 * 定位（见 docs/adr/0002）：这是**可扩展的排查目录**，不是可自动判定的公理体系。
 * 每项返回 `PRESENT` / `ABSENT` / `UNKNOWN` / `NOT_APPLICABLE` 并附判定依据。
 * `UNKNOWN` 是正常且高频的结果：绝大多数偏误只能靠真实数据与研究设计判定，
 * 图结构与结构化字段只能排除其中一部分。
 */

import {
  collidersBetween,
  findOpenPaths,
  isAnalyzable,
  withoutOutgoingEdges,
} from "./dag.ts";
import type { DAG } from "./dag.ts";
import type { ClaimSpec } from "./types.ts";

export interface DesignInfo {
  studyType?:
    | "RCT"
    | "COHORT"
    | "CASE_CONTROL"
    | "CROSS_SECTIONAL"
    | "CASE_REPORT"
    | "IN_VITRO"
    | "ANIMAL"
    | "UNKNOWN";
  randomized?: boolean;
  blinded?: boolean;
  intentionToTreat?: boolean;
  followUpMonths?: number;
  attritionRate?: number;
  temporalOrderEstablished?: boolean;
  timeVaryingTreatment?: boolean;
  immortalTimeRisk?: boolean;
  exposureRequiresFutureEvent?: boolean;
  hiddenObservation?: boolean;
  prospectiveRecords?: boolean;
  selectionOnCollider?: boolean;
  survivorsOnly?: boolean;
  samplingFrame?: string;
  effectModifiers?: readonly string[];
  subgroupDataAvailable?: boolean;
  analysisLevel?: "INDIVIDUAL" | "GROUP";
  repeatedMeasures?: boolean;
  selectionOnExtremeBaseline?: boolean;
  naturalHistoryKnown?: boolean;
  competingRisksAssessed?: boolean;
  doseExceedsPhysiological?: boolean;
}

export interface BiasContext {
  spec: ClaimSpec;
  /** 已声明的图。节点约定：`X` 为暴露，`Y` 为结局。 */
  dag?: DAG;
  latent?: readonly string[];
  /** 分析中实际控制的变量集。缺失时无法判断 M-偏误等条目。 */
  adjustmentSet?: readonly string[];
  design?: DesignInfo;
}

export type BiasStatus = "PRESENT" | "ABSENT" | "UNKNOWN" | "NOT_APPLICABLE";

export interface BiasAssessment {
  status: BiasStatus;
  basis: string;
}

export interface BiasEntry {
  id: string;
  dimension: string;
  name: string;
  mechanism: string;
  whatToCheck: string[];
  assess: (ctx: BiasContext) => BiasAssessment;
}

export interface BiasFinding {
  id: string;
  dimension: string;
  name: string;
  status: BiasStatus;
  basis: string;
  whatToCheck: string[];
}

const X = "X";
const Y = "Y";

function unknown(basis: string): BiasAssessment {
  return { status: "UNKNOWN", basis };
}

function graphReady(ctx: BiasContext): BiasAssessment | null {
  if (ctx.dag === undefined) return unknown("未声明因果图，无法进行图论判定");
  if (!ctx.dag.nodes.includes(X) || !ctx.dag.nodes.includes(Y)) {
    return unknown("图缺少约定的 X（暴露）或 Y（结局）节点");
  }
  if (!isAnalyzable(ctx.dag)) {
    return unknown("图规模超出当前路径枚举能力，未做判定");
  }
  return null;
}

function buildCatalog(): BiasEntry[] {
  const entries: BiasEntry[] = [
    // ---------- 维度一：混杂 ----------
    {
      id: "B01",
      dimension: "混杂",
      name: "经典共同原因混杂（Fork）",
      mechanism: "存在同时影响暴露与结局的共同原因 Z，使观测关联偏离干预效应。",
      whatToCheck: ["识别暴露与结局的共同原因", "确认调整集是否闭合全部后门路径"],
      assess: (ctx) => {
        const blocked = graphReady(ctx);
        if (blocked !== null) return blocked;
        const dag = ctx.dag;
        if (dag === undefined) return unknown("未声明因果图");
        const open = findOpenPaths(withoutOutgoingEdges(dag, X), X, Y, []);
        if (open.length > 0) {
          return {
            status: "PRESENT",
            basis: `在已声明图中存在 ${open.length} 条未阻断的后门路径：${open
              .map((p) => p.join("→"))
              .join("；")}`,
          };
        }
        return { status: "ABSENT", basis: "在已声明图中不存在未阻断的后门路径" };
      },
    },
    {
      id: "B02",
      dimension: "混杂",
      name: "时变混杂",
      mechanism: "治疗与病情随时间相互影响，后续治疗的分配依赖既往结局，普通回归无法校正。",
      whatToCheck: ["是否存在随时间的治疗切换", "是否使用边际结构模型或 G 估计"],
      assess: (ctx) => {
        if (ctx.design?.timeVaryingTreatment === true) {
          return {
            status: "PRESENT",
            basis: "研究设计声明存在时变治疗，需要 G 方法而非普通回归",
          };
        }
        if (ctx.design?.studyType === "RCT") {
          return { status: "ABSENT", basis: "随机化试验中治疗分配由方案决定，不随结局演变" };
        }
        return unknown("缺乏治疗随时间变化的信息");
      },
    },
    {
      id: "B03",
      dimension: "混杂",
      name: "M-偏误",
      mechanism: "误将两个未观测混杂之间的对撞节点纳入调整集，人为打开一条伪路径。",
      whatToCheck: ["调整集中是否包含对撞节点", "该节点是否同时是两个外生原因的共同后果"],
      assess: (ctx) => {
        const blocked = graphReady(ctx);
        if (blocked !== null) return blocked;
        if (ctx.adjustmentSet === undefined) {
          return unknown("未声明实际控制的变量集，无法判断是否误控对撞节点");
        }
        const dag = ctx.dag;
        if (dag === undefined) return unknown("未声明因果图");
        const colliders = collidersBetween(dag, X, Y);
        const overlap = ctx.adjustmentSet.filter((node) => colliders.has(node));
        if (overlap.length > 0) {
          return {
            status: "PRESENT",
            basis: `调整集包含 X 与 Y 之间的对撞节点：${overlap.join("、")}`,
          };
        }
        return {
          status: "ABSENT",
          basis: "调整集未包含 X 与 Y 之间路径上的对撞节点",
        };
      },
    },
    {
      id: "B04",
      dimension: "混杂",
      name: "未观测混杂",
      mechanism: "存在无法测量的共同原因，使后门路径无法闭合。",
      whatToCheck: ["是否存在未测量的共同原因", "敏感性分析（E 值等）能容忍多强的混杂"],
      assess: (ctx) => {
        if (ctx.latent !== undefined && ctx.latent.length > 0) {
          return {
            status: "PRESENT",
            basis: `分析已声明潜变量：${ctx.latent.join("、")}`,
          };
        }
        return unknown("未声明潜变量；但缺少声明不等于不存在未观测混杂");
      },
    },

    // ---------- 维度二：选择与对撞 ----------
    {
      id: "B05",
      dimension: "选择与对撞",
      name: "伯克森悖论 / 对撞抽样",
      mechanism: "抽样或入组条件本身是对撞节点的后果，导致样本内出现伪关联。",
      whatToCheck: ["入组标准是否依赖于暴露与结局的共同后果", "是否存在以对撞节点为条件的筛选"],
      assess: (ctx) => {
        if (ctx.design?.selectionOnCollider === true) {
          return { status: "PRESENT", basis: "设计声明抽样基于对撞节点或其后果" };
        }
        if (ctx.design?.selectionOnCollider === false) {
          return { status: "ABSENT", basis: "设计声明抽样不以对撞节点为条件" };
        }
        return unknown("缺乏抽样机制信息");
      },
    },
    {
      id: "B06",
      dimension: "选择与对撞",
      name: "幸存者偏差",
      mechanism: "只有存活或留存到观察点的个体进入分析，差结局个体被系统性排除。",
      whatToCheck: ["被淘汰人群的结局分布", "是否存在只统计成功者的样本构造"],
      assess: (ctx) => {
        if (ctx.design?.survivorsOnly === true) {
          return { status: "PRESENT", basis: "设计声明样本仅包含幸存/留存个体" };
        }
        if (ctx.design?.survivorsOnly === false) {
          return { status: "ABSENT", basis: "设计声明样本未按存活状态截断" };
        }
        return unknown("缺乏样本流失与截断信息");
      },
    },
    {
      id: "B07",
      dimension: "选择与对撞",
      name: "损耗偏倚",
      mechanism: "不耐受或无效者中途退出，仅分析完成者会高估效应。",
      whatToCheck: ["各臂脱落率", "是否采用意向性治疗分析"],
      assess: (ctx) => {
        const attrition = ctx.design?.attritionRate;
        const itt = ctx.design?.intentionToTreat;
        if (attrition !== undefined && attrition > 0.2) {
          return {
            status: "PRESENT",
            basis: `脱落率 ${(attrition * 100).toFixed(0)}%，且${itt === true ? "采用" : "未采用"}意向性治疗分析`,
          };
        }
        if (attrition !== undefined && itt === true) {
          return {
            status: "ABSENT",
            basis: `脱落率 ${(attrition * 100).toFixed(0)}% 且采用意向性治疗分析`,
          };
        }
        if (itt === false) {
          return { status: "PRESENT", basis: "未采用意向性治疗分析，完成者分析可能高估效应" };
        }
        return unknown("缺乏脱落率与分析集信息");
      },
    },
    {
      id: "B08",
      dimension: "选择与对撞",
      name: "自选择偏倚",
      mechanism: "自愿接受干预者本身具有更好的基线特征，与干预效应混淆。",
      whatToCheck: ["干预分配是否随机", "自愿参与者的基线特征差异"],
      assess: (ctx) => {
        if (ctx.design?.randomized === true) {
          return { status: "ABSENT", basis: "随机分配消除了自愿选择带来的基线差异" };
        }
        if (ctx.design?.randomized === false) {
          return { status: "PRESENT", basis: "非随机分配，暴露组由个体或医生选择决定" };
        }
        return unknown("缺乏分配机制信息");
      },
    },

    // ---------- 维度三：时间与过程 ----------
    {
      id: "B09",
      dimension: "时间与过程",
      name: "反向因果",
      mechanism: "真实因果方向为结局的前驱状态影响暴露，被误读为暴露导致结局。",
      whatToCheck: ["暴露是否明确早于结局前驱期", "是否具备前瞻性时序记录"],
      assess: (ctx) => {
        if (ctx.design?.temporalOrderEstablished === true) {
          return { status: "ABSENT", basis: "已建立暴露早于结局的时序" };
        }
        if (ctx.design?.studyType === "CROSS_SECTIONAL") {
          return unknown("横断面设计无法确定时序，反向因果无法排除");
        }
        return unknown("缺乏时序信息");
      },
    },
    {
      id: "B10",
      dimension: "时间与过程",
      name: "不朽时间偏倚",
      mechanism: "暴露定义要求个体存活到某个未来时点，等待期被错误计入暴露组的无事件生存时间。",
      whatToCheck: ["暴露组的起始时间定义", "是否使用时变暴露 Cox 模型"],
      assess: (ctx) => {
        if (ctx.design?.immortalTimeRisk === true || ctx.design?.exposureRequiresFutureEvent === true) {
          return {
            status: "PRESENT",
            basis: "暴露定义依赖未来事件，存在等待期存活红利",
          };
        }
        if (ctx.design?.studyType === "RCT") {
          return { status: "ABSENT", basis: "随机化在基线完成，不存在等待期分配" };
        }
        return unknown("缺乏暴露起始时间定义");
      },
    },

    // ---------- 维度四：测量与心理 ----------
    {
      id: "B11",
      dimension: "测量与心理",
      name: "安慰剂 / 反安慰剂效应",
      mechanism: "期望与情境通过非特异性通路改变主观症状，被误当作干预效应。",
      whatToCheck: ["是否采用盲法与安慰剂对照", "是否有客观辅助终点"],
      assess: (ctx) => {
        if (ctx.spec.outcome.metricType === "HARD_ENDPOINT") {
          return { status: "NOT_APPLICABLE", basis: "客观硬终点不依赖主观期望" };
        }
        if (ctx.design?.blinded === false) {
          return { status: "PRESENT", basis: "结局非客观硬终点且未设盲，期望效应无法排除" };
        }
        if (ctx.design?.blinded === true) {
          return unknown("已设盲可降低但不能消除期望效应，且缺乏客观辅助终点信息");
        }
        return unknown("缺乏盲法设计信息");
      },
    },
    {
      id: "B12",
      dimension: "测量与心理",
      name: "霍桑效应",
      mechanism: "受试者意识到被观察而改变行为，产生非特异性的行为干预。",
      whatToCheck: ["是否存在隐蔽观察或客观记录", "行为改变是否与暴露无关"],
      assess: (ctx) => {
        if (ctx.design?.hiddenObservation === true) {
          return { status: "ABSENT", basis: "采用隐蔽观察或客观被动记录" };
        }
        return unknown("缺乏观察方式信息");
      },
    },
    {
      id: "B13",
      dimension: "测量与心理",
      name: "回忆偏倚",
      mechanism: "病例比对照更努力追溯既往暴露，造成非对称的信息误差。",
      whatToCheck: ["暴露信息是否来自前瞻性客观档案", "回忆是否与病例状态相关"],
      assess: (ctx) => {
        if (ctx.design?.prospectiveRecords === true) {
          return { status: "ABSENT", basis: "暴露信息来自前瞻性客观记录" };
        }
        if (ctx.design?.studyType === "CASE_CONTROL") {
          return { status: "PRESENT", basis: "病例对照设计依赖回顾性回忆，病例与对照回忆强度不对称" };
        }
        return unknown("缺乏暴露信息来源信息");
      },
    },

    // ---------- 维度五：聚合与分布 ----------
    {
      id: "B14",
      dimension: "聚合与分布",
      name: "辛普森悖论",
      mechanism: "亚组权重不均导致合并后的效应方向与各亚组内部方向相反。",
      whatToCheck: ["是否存在同时影响效应的分层变量", "分层与合并结论是否一致"],
      assess: (ctx) => {
        const modifiers = ctx.design?.effectModifiers;
        if (modifiers !== undefined && modifiers.length > 0) {
          return {
            status: "PRESENT",
            basis: `已声明效应修饰变量：${modifiers.join("、")}，合并分析可能与分层方向相反`,
          };
        }
        if (ctx.design?.subgroupDataAvailable === true) {
          return unknown("存在亚组数据，但未声明效应修饰变量，需核对分层与合并结论");
        }
        return unknown("缺乏分层数据，无法排除聚合方向反转");
      },
    },
    {
      id: "B15",
      dimension: "聚合与分布",
      name: "生态学谬误",
      mechanism: "用群体层面的关联推断个体层面的因果，跨层级外推无效。",
      whatToCheck: ["分析单位是个体还是群体", "群体级协方差能否支持个体结论"],
      assess: (ctx) => {
        if (ctx.design?.analysisLevel === "GROUP") {
          return { status: "PRESENT", basis: "分析单位是群体，结论不可直接外推到个体" };
        }
        if (ctx.design?.analysisLevel === "INDIVIDUAL") {
          return { status: "ABSENT", basis: "分析单位是个体" };
        }
        return unknown("缺乏分析单位信息");
      },
    },
    {
      id: "B16",
      dimension: "聚合与分布",
      name: "均值回归",
      mechanism: "极端测量值因随机误差回落至均值，被误认为干预起效。",
      whatToCheck: ["是否有重复测量与基线波动数据", "是否设立同期对照组"],
      assess: (ctx) => {
        if (ctx.design?.selectionOnExtremeBaseline === true) {
          return {
            status: "PRESENT",
            basis: "按极端基线值入组，均值回归必然发生",
          };
        }
        if (ctx.design?.repeatedMeasures === true) {
          return unknown("有重复测量，但仍需对照基线波动才能区分回归与效应");
        }
        return unknown("缺乏重复测量与基线波动信息");
      },
    },
    {
      id: "B17",
      dimension: "聚合与分布",
      name: "自然病程自限性",
      mechanism: "疾病本身随时间缓解，无对照时会被归因于干预。",
      whatToCheck: ["是否设立同期对照组", "该疾病的自然缓解率"],
      assess: (ctx) => {
        if (ctx.spec.comparison === undefined) {
          return {
            status: "PRESENT",
            basis: "未声明对照条件，自然病程与干预效应无法分离",
          };
        }
        if (ctx.design?.randomized === true) {
          return { status: "ABSENT", basis: "随机同期对照可吸收自然病程与安慰剂效应" };
        }
        return unknown("已声明对照，但缺乏随机化与自然病程信息");
      },
    },

    // ---------- 维度六：生理机制与中介 ----------
    {
      id: "B18",
      dimension: "生理机制与中介",
      name: "自然间接效应阻断（吸收/首过代谢）",
      mechanism:
        "若活性成分在吸收或首过代谢环节被水解或转化，其中介通路可能被截断；" +
        "但截断程度取决于实测药代数据，不能由化学常识直接推出效应为零。",
      whatToCheck: [
        "原型化合物的人体吸收率与生物利用度",
        "是否存在可测的药代动力学数据",
        "代谢产物是否具有独立活性",
      ],
      assess: (ctx) => {
        if (ctx.spec.exposure.route !== "ORAL") {
          return {
            status: "NOT_APPLICABLE",
            basis: `暴露途径为 ${ctx.spec.exposure.route}，不涉及消化道吸收截断`,
          };
        }
        return unknown("口服暴露是否发生中介阻断需要药代动力学证据，当前未获取");
      },
    },
    {
      id: "B19",
      dimension: "生理机制与中介",
      name: "受体饱和与代谢速率限制",
      mechanism: "剂量超过代谢或转运能力后，效应不再随剂量增加，甚至转为负荷。",
      whatToCheck: ["剂量-反应曲线形状", "人体生理耐受与清除阈值"],
      assess: (ctx) => {
        if (ctx.spec.exposure.route === undefined) {
          return unknown("缺乏暴露途径信息，无法判断代谢饱和相关性");
        }
        if (ctx.spec.exposure.dose === undefined) {
          return unknown("缺乏剂量信息，无法评估剂量-反应关系");
        }
        return unknown("需要剂量-反应与代谢动力学数据才能判断是否饱和");
      },
    },
    {
      id: "B20",
      dimension: "生理机制与中介",
      name: "竞争风险",
      mechanism: "其它终点事件提前发生，截断了目标结局的发生机会，使累积发生率被高估或低估。",
      whatToCheck: ["是否评估竞争事件的累积发生率", "是否使用 Fine-Gray 等竞争风险模型"],
      assess: (ctx) => {
        if (ctx.design?.competingRisksAssessed === true) {
          return { status: "ABSENT", basis: "分析已评估竞争风险" };
        }
        return unknown("缺乏竞争风险评估信息");
      },
    },

    // ---------- 维度七：环境传输与外推 ----------
    {
      id: "B21",
      dimension: "环境传输与外推",
      name: "体外 / 体内鸿沟",
      mechanism: "培养皿或动物模型中的机制无法在人体暴露水平与生理环境中复现。",
      whatToCheck: ["证据来自人体还是细胞/动物", "跨域外推需要哪些额外假设"],
      assess: (ctx) => {
        const studyType = ctx.design?.studyType;
        if (studyType === "IN_VITRO" || studyType === "ANIMAL") {
          return {
            status: "PRESENT",
            basis: `现有证据来自 ${studyType === "IN_VITRO" ? "体外细胞实验" : "动物实验"}，外推到人体需要额外假设`,
          };
        }
        if (studyType === "RCT" || studyType === "COHORT") {
          return unknown("已有人体证据，但仍需检查人群与场景外推");
        }
        return unknown("缺乏研究类型信息");
      },
    },
    {
      id: "B22",
      dimension: "环境传输与外推",
      name: "超生理剂量谬误",
      mechanism: "动物灌喂或体外浸泡使用的剂量远高于人类真实暴露水平，结论不可外推。",
      whatToCheck: ["实验剂量与人体等效剂量的折算", "真实生活暴露水平"],
      assess: (ctx) => {
        if (ctx.design?.doseExceedsPhysiological === true || ctx.design?.studyType === "ANIMAL") {
          return {
            status: "PRESENT",
            basis: "剂量或实验模型与人类真实暴露水平不匹配",
          };
        }
        return unknown("缺乏剂量折算与暴露水平信息");
      },
    },
  ];

  return entries;
}

export const BIAS_CATALOG: readonly BiasEntry[] = buildCatalog();

export function scanBiases(ctx: BiasContext): BiasFinding[] {
  return BIAS_CATALOG.map((entry) => {
    const assessment = entry.assess(ctx);
    return {
      id: entry.id,
      dimension: entry.dimension,
      name: entry.name,
      status: assessment.status,
      basis: assessment.basis,
      whatToCheck: entry.whatToCheck,
    };
  });
}
