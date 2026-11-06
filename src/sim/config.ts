// 模拟核心配置：所有可调参数集中于此，单位与含义逐项注明。
// 时间单位：1 tick = 1 个固定模拟步；1× 速度目标 60 tick/秒（≈1 tick = 0.1 秒模拟时间感）。
// 空间单位：1 tile = 1.0；世界坐标使用 tile 为单位的浮点数。
// 能量单位：EU（energy unit）。

import { Species } from './constants';

// ---------------------------------------------------------------- 世界与时间

export const WORLD = {
  width: 128,
  height: 80,
  /** 每个 tile 每 SOIL_STRIDE tick 更新一次（错峰更新，速率按 stride 补偿） */
  soilStride: 8,
  /** 固定模拟步目标频率（tick/秒） */
  ticksPerSecond: 60,
  /** 一天的长度（tick）。60 tps 下 2400 tick = 40 秒 */
  dayLength: 2400,
  /** 夜间最低光照 */
  nightMinLight: 0.1,
} as const;

// ---------------------------------------------------------------- 随机变异

export const MUTATION = {
  /** 每个基因发生突变的概率 */
  prob: 0.35,
  /** 常规突变标准差（基因空间 0..1） */
  sigma: 0.06,
  /** 大幅跳变概率与标准差 */
  jumpProb: 0.04,
  jumpSigma: 0.16,
} as const;

// ---------------------------------------------------------------- 基因定义
// 每项基因取值 0..1，经 mapGene 映射到具名行为参数。
// gain/cost 字段仅用于面板说明，真实计算在 creatures.ts / ai.ts。

export type GeneKey = 'speed' | 'size' | 'sense' | 'droughtTol' | 'reproInvest' | 'boldness';

export const GENE_KEYS: readonly GeneKey[] = ['speed', 'size', 'sense', 'droughtTol', 'reproInvest', 'boldness'];

export interface GeneDef {
  key: GeneKey;
  name: string;
  /** 映射到的最小值 */
  min: number;
  /** 映射到的最大值 */
  max: number;
  gain: string;
  cost: string;
}

export const GENE_DEFS: readonly GeneDef[] = [
  {
    key: 'speed', name: '运动速度', min: 0.028, max: 0.115,
    gain: '移动更快：追击猎物、逃离天敌、更早到达食物',
    cost: '移动能耗按速度平方增长，追逐失败代价更高',
  },
  {
    key: 'size', name: '成年体型', min: 0.2, max: 0.62,
    gain: '能量储备上限更高；体型大可捕食更大的猎物；受惊时更难被锁定',
    cost: '基础代谢随体型上升；目标更大更容易被玩家与捕食者注意',
  },
  {
    key: 'sense', name: '感知范围', min: 1.6, max: 6.4,
    gain: '更早发现食物、残骸与天敌，决策质量更高',
    cost: '每 tick 消耗感知维持能，范围越大持续开销越高',
  },
  {
    key: 'droughtTol', name: '耐旱性', min: 0, max: 1,
    gain: '干旱时脱水消耗更慢，从干枯植物中榨取能量效率更高',
    cost: '耐旱生理需要额外基础代谢投入（任何时期都付出）',
  },
  {
    key: 'reproInvest', name: '繁殖投入', min: 0.1, max: 0.45,
    gain: '后代获得更多起步能量，幼体存活率更高',
    cost: '亲代能量损失按 1.5 倍结算，繁殖后虚弱期更长',
  },
  {
    key: 'boldness', name: '胆量', min: 0, max: 1,
    gain: '更偏向觅食与追猎，进食时间更长',
    cost: '对天敌反应更慢，被捕食概率上升',
  },
] as const;

export function mapGene(key: string, g: number): number {
  const def = GENE_DEFS.find((d) => d.key === key);
  if (!def) return g;
  return def.min + (def.max - def.min) * clamp01(g);
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------- 物种参数

export interface SpeciesParams {
  name: string;
  /** 基础代谢系数（每 tick） */
  basal: number;
  /** 移动能耗系数（× (v/0.08)^2 × 体型因子） */
  moveK: number;
  /** 感知能耗系数（× 感知半径 tile） */
  senseK: number;
  /** 能量上限基数（再乘体型系数） */
  maxEnergy: number;
  /** 初始能量比例 */
  startEnergy: number;
  /** 成熟年龄（tick） */
  maturity: number;
  /** 最大年龄（tick） */
  maxAge: number;
  /** 速度基因区间（tile/tick） */
  speedRange: [number, number];
  /** 体型基因区间（tile 半径） */
  sizeRange: [number, number];
  /** 感知基因区间（tile） */
  senseRange: [number, number];
  /** 繁殖能量门槛（占上限比例） */
  reproThreshold: number;
  /** 繁殖冷却基数（tick） */
  reproCooldown: number;
  /** 咬合/捕食攻击冷却 */
  attackCooldown: number;
  /** 进食半径（tile，在体型之外） */
  eatRadius: number;
  /** 捕食攻击距离（tile） */
  catchRadius: number;
  /** 捕食成功率基准与斜率 */
  catchBase: number;
  catchSlope: number;
  /** 胆量基因默认区间中心 */
  boldCenter: number;
  /** 食谱：0 只吃青草，1 青草+浆果，2 只吃肉，3 只吃残骸 */
  diet: number;
  /** 是否会被捕食者当作猎物 */
  preyable: boolean;
  /** 夜间活跃度加成（>1 表示夜行） */
  nocturnal: number;
  /** 初代基因中心（仅初始种群使用）：[speed, size, sense, droughtTol, reproInvest] */
  geneCenters: [number, number, number, number, number];
}

export const SPECIES: readonly SpeciesParams[] = [
  {
    name: '小型食草者',
    basal: 0.05, moveK: 0.052, senseK: 0.0055, maxEnergy: 105, startEnergy: 0.72,
    maturity: 1100, maxAge: 14000, speedRange: [0.055, 0.105], sizeRange: [0.2, 0.32],
    senseRange: [1.7, 3.8], reproThreshold: 0.78, reproCooldown: 2000, attackCooldown: 0,
    eatRadius: 0.32, catchRadius: 0, catchBase: 0, catchSlope: 0, boldCenter: 0.45,
    diet: 0, preyable: true, nocturnal: 0.85, geneCenters: [0.5, 0.45, 0.55, 0.5, 0.4],
  },
  {
    name: '大型食草者',
    basal: 0.1, moveK: 0.1, senseK: 0.0045, maxEnergy: 230, startEnergy: 0.72,
    maturity: 2000, maxAge: 22000, speedRange: [0.032, 0.062], sizeRange: [0.42, 0.62],
    senseRange: [1.6, 3.4], reproThreshold: 0.74, reproCooldown: 3200, attackCooldown: 0,
    eatRadius: 0.42, catchRadius: 0, catchBase: 0, catchSlope: 0, boldCenter: 0.4,
    diet: 1, preyable: true, nocturnal: 0.8, geneCenters: [0.35, 0.6, 0.45, 0.55, 0.4],
  },
  {
    name: '捕食者',
    basal: 0.028, moveK: 0.055, senseK: 0.0055, maxEnergy: 200, startEnergy: 0.85,
    maturity: 1200, maxAge: 18000, speedRange: [0.062, 0.118], sizeRange: [0.3, 0.5],
    senseRange: [4.2, 8.0], reproThreshold: 0.58, reproCooldown: 900, attackCooldown: 12,
    eatRadius: 0.3, catchRadius: 0.5, catchBase: 0.55, catchSlope: 2.0, boldCenter: 0.7,
    diet: 2, preyable: false, nocturnal: 1.35, geneCenters: [0.68, 0.5, 0.6, 0.5, 0.45],
  },
  {
    name: '食腐者',
    basal: 0.03, moveK: 0.05, senseK: 0.0025, maxEnergy: 120, startEnergy: 0.95,
    maturity: 900, maxAge: 16000, speedRange: [0.035, 0.07], sizeRange: [0.26, 0.42],
    senseRange: [6.0, 12.0], reproThreshold: 0.58, reproCooldown: 900, attackCooldown: 0,
    eatRadius: 0.36, catchRadius: 0, catchBase: 0, catchSlope: 0, boldCenter: 0.35,
    diet: 3, preyable: true, nocturnal: 1.1, geneCenters: [0.4, 0.45, 0.65, 0.5, 0.4],
  },
] as const;

export function speciesParams(s: number): SpeciesParams {
  return SPECIES[s] ?? SPECIES[0];
}

// ---------------------------------------------------------------- 植物与土壤

export const PLANTS = {
  /** 青草：快生、低能、喜湿润草地 */
  grass: {
    max: 60,
    /** 每土壤更新的生长量（满条件） */
    growth: 0.15,
    /** 能量密度（每单位生物量） */
    energy: 0.42,
    /** 光照需求：[最低, 最适] */
    lightMin: 0.12,
    lightOpt: 0.55,
    /** 水分最适 */
    moistureOpt: 0.5,
    /** 每生长 1 生物量消耗的养分 */
    nutrientUse: 0.0016,
    /** 每生长 1 生物量消耗的水分 */
    waterUse: 0.0011,
    /** 干旱枯死速率（水分 < dryDie 时每土壤更新损失） */
    dryDie: 0.07,
    dryDieRate: 0.35,
    /** 咬合量上限（每 eatCooldown） */
    bite: 2.4,
  },
  /** 浆果灌丛：慢生、高能、喜林地遮阴 */
  shrub: {
    max: 40,
    growth: 0.1,
    energy: 0.85,
    /** 最适光照中心与容忍 */
    lightCenter: 0.4,
    lightTol: 0.42,
    moistureOpt: 0.45,
    nutrientUse: 0.003,
    waterUse: 0.0016,
    dryDie: 0.06,
    dryDieRate: 0.12,
    bite: 1.6,
  },
  /** 残骸（尸体/掉落） */
  carcass: {
    max: 90,
    /** 食腐者咬合量 */
    bite: 2.0,
    /** 残骸能量密度（肉类能量密度高） */
    energy: 2.2,
    /** 每土壤更新分解量 */
    decompRate: 0.035,
    /** 每分解 1 单位转化为养分的比例 */
    decompToNutrient: 0.02,
    /** 干燥损失（每土壤更新） */
    dryRate: 0.01,
  },
  /** 养分基础再生（外部输入：土壤风化，很小） */
  nutrientRegen: 0.00008,
  /** 枯死植物返还养分比例 */
  deadPlantNutrientReturn: 0.12,
} as const;

// ---------------------------------------------------------------- 气候

export const CLIMATE = {
  /** 降雨强度 → 水分增量（每土壤更新） */
  rainToMoisture: 0.02,
  /** 基础蒸发（每土壤更新），按地形系数 */
  evaporationBase: 0.012,
  evaporationByTerrain: [0.0, 0.0, 0.011, 0.008, 0.021] as const,
  /** 干旱参数 */
  droughtRainfall: 0.012,
  droughtEvapBoost: 1.6,
  /** 玩家降雨干预：强度与持续 tick */
  rainBoost: 0.3,
  rainBoostTicks: 900,
  /** 玩家干旱干预持续 tick */
  droughtTicks: 2400,
  /** 脱水附加消耗 = DROUGHT_DRAIN × (1-耐旱) × 干旱强度 */
  droughtDrain: 0.05,
} as const;

// ---------------------------------------------------------------- 光照

export const LIGHT = {
  /** 白天的峰值光照 */
  dayPeak: 1.0,
  /** 各地形光照系数（林地遮阴） */
  byTerrain: [0.0, 0.0, 1.0, 0.72, 1.18] as const,
} as const;

// ---------------------------------------------------------------- 决策与移动

export const AI = {
  /** 决策间隔（tick） */
  decisionInterval: 5,
  /** 转向平滑系数 */
  turnSmooth: 0.3,
  /** 转向速度上限系数（相对最大速度） */
  maxTurnFactor: 0.55,
  /** 分离力强度 */
  separation: 0.018,
  /** 逃跑肾上腺素：速度倍率与能耗倍率 */
  fleeSpeedBoost: 1.05,
  fleeCostBoost: 1.35,
  /** 饥饿追猎加成 */
  huntHungerBoost: 1.1,
  /** 觅食速度（相对最大速度） */
  forageSpeedFactor: 0.72,
  /** 闲逛速度 */
  wanderSpeedFactor: 0.42,
  /** 捕食者/食腐者的巡逻搜索速度（直线长距离搜索更有效率） */
  patrolSpeedFactor: 0.58,
  /** 巡逻时角度抖动（小 = 长直线） */
  patrolTurn: 0.05,
  /** 闲逛角度随机游走强度 */
  wanderTurn: 0.5,
  /** 卡住判定：进度阈值与计时 */
  stuckProgress: 0.02,
  stuckTicks: 40,
  /** 目标黑名单时长 */
  blacklistTicks: 240,
  /** 夜间休息倾向加成 */
  nightRestBoost: 1.6,
  /** 夜间捕猎倾向加成 */
  nightHuntBoost: 1.35,
  /** 进食冷却（tick） */
  eatCooldown: 8,
  /** 低能量减速系数 */
  tiredFactor: 0.65,
  tiredBelow: 0.22,
} as const;

// ---------------------------------------------------------------- 性能与容量

export const LIMITS = {
  /** 空间哈希格子大小（tile），≥ 最大感知半径 */
  spatialCell: 8,
  /** 生物硬上限（超出后停止自然繁殖，界面提示） */
  maxCreatures: 1600,
  /** 个体档案记录上限 */
  maxRecords: 24000,
  /** 事件日志上限 */
  maxEvents: 800,
  /** 统计采样间隔（tick） */
  statsInterval: 30,
  /** 统计环形缓冲长度 */
  statsBuffer: 3000,
  /** 谱系树上限 */
  maxLineages: 4000,
} as const;

// ---------------------------------------------------------------- 能量核算常量

export const ENERGY = {
  /** 移动能耗参考速度 */
  refSpeed: 0.08,
  /** 体型代谢指数 */
  sizeMetabExp: 1.35,
  /** 参考体型 */
  refSize: 0.4,
  /** 耐旱的基础代谢附加（任何时期） */
  droughtTolCost: 0.12,
  /** 捕食能量转移效率 */
  predationTransfer: 0.72,
  /** 尸骸中来自剩余能量的比例 */
  carcassFromEnergy: 0.4,
  /** 尸骸中来自生物量的比例 */
  carcassFromBiomass: 0.4,
  /** 尸骸生物量 = base + size × factor */
  carcassBase: 3,
  carcassSizeFactor: 26,
  /** 植物消化效率 = base + droughtTol × gain */
  digestBase: 0.82,
  digestDroughtGain: 0.22,
  /** 残骸消化效率 */
  carrionEfficiency: 0.65,
} as const;

// ---------------------------------------------------------------- 挑战配置
// 阈值在试玩后冻结；此处为初版数值，将通过 scripts/batch-sim.ts 实测定标。

export interface ChallengeConfig {
  id: string;
  name: string;
  brief: string;
  /** 起始预设 */
  preset: string;
  seed: number;
  /** 干预配额 */
  interventions: number;
  /** 时限（tick） */
  timeLimit: number;
  /** 目标定义（按物种的最低存活数） */
  goals: { species: number; min: number }[];
  /** 植物生物量目标 */
  plantGoal: number;
  /** A: 共存需持续 tick；B/C 不用 */
  coexistTicks?: number;
  /** B: 干旱开始 tick 与持续 tick */
  droughtStart?: number;
  droughtLength?: number;
  /** C: 谱系目标 */
  lineageGenerations?: number;
  lineageAlive?: number;
  /** 起始数量覆盖（物种 → 数量），缺省用预设 */
  initialCounts?: { species: number; count: number }[];
}

export const CHALLENGES: readonly ChallengeConfig[] = [
  {
    id: 'guardian',
    name: 'A · 生态守护',
    brief:
      '在一片资源有限的世界中，让植物、食草动物与捕食者同时维持在目标数量之上，并持续一段时间。' +
      '干预配额有限，请把每次干预用在关键时刻。',
    preset: 'temperate',
    seed: 20260101,
    interventions: 8,
    timeLimit: 27000,
    goals: [
      { species: Species.SmallHerb, min: 150 },
      { species: Species.LargeHerb, min: 100 },
      { species: Species.Predator, min: 8 },
    ],
    plantGoal: 180000,
    coexistTicks: 3600,
    initialCounts: [
      { species: Species.SmallHerb, count: 60 },
      { species: Species.LargeHerb, count: 12 },
      { species: Species.Predator, count: 10 },
      { species: Species.Scavenger, count: 8 },
    ],
  },
  {
    id: 'drought',
    name: 'B · 旱季之后',
    brief:
      '一场提前预告的干旱将在开局后不久到来，持续约一分钟。利用有限的干预帮助生态度过干旱，' +
      '并在截止时间前让关键种群恢复到目标范围。',
    preset: 'arid',
    seed: 20260404,
    interventions: 10,
    timeLimit: 27000,
    droughtStart: 900,
    droughtLength: 4200,
    coexistTicks: 1800,
    goals: [
      { species: Species.SmallHerb, min: 110 },
      { species: Species.LargeHerb, min: 25 },
      { species: Species.Predator, min: 7 },
    ],
    plantGoal: 70000,
    initialCounts: [
      { species: Species.SmallHerb, count: 80 },
      { species: Species.LargeHerb, count: 18 },
      { species: Species.Predator, count: 8 },
      { species: Species.Scavenger, count: 8 },
    ],
  },
  {
    id: 'lineage',
    name: 'C · 谱系延续',
    brief:
      '选择一条起始谱系，让它在变化的环境中自然繁衍到指定代数与数量。' +
      '人工投放不计入繁殖目标，保护它但不要替它生育。',
    preset: 'temperate',
    seed: 20260303,
    interventions: 5,
    timeLimit: 30000,
    droughtStart: 12000,
    droughtLength: 3600,
    lineageGenerations: 7,
    lineageAlive: 100,
    goals: [],
    plantGoal: 0,
    initialCounts: [
      { species: Species.SmallHerb, count: 30 },
      { species: Species.LargeHerb, count: 10 },
      { species: Species.Predator, count: 3 },
      { species: Species.Scavenger, count: 6 },
    ],
  },
] as const;

export function challengeById(id: string): ChallengeConfig | undefined {
  return CHALLENGES.find((c) => c.id === id);
}

// ---------------------------------------------------------------- 预设

export interface PresetDef {
  id: string;
  name: string;
  desc: string;
  /** 降雨基准 */
  rainfall: number;
  /** 地形生成参数 */
  gen: {
    waterLevel: number;
    rockLevel: number;
    meadowMoisture: number;
    woodlandMoisture: number;
    scale: number;
    treeDensity: number;
  };
  /** 初始数量（物种 → 数量） */
  initialCounts: { species: number; count: number }[];
  /** 是否可能随机干旱 */
  randomDrought: boolean;
}

export const PRESETS: readonly PresetDef[] = [
  {
    id: 'temperate',
    name: '温带河谷',
    desc: '草地与林地交错，一条小河穿过谷地。资源适中，种群波动温和。',
    rainfall: 0.1,
    gen: { waterLevel: 0.3, rockLevel: 0.87, meadowMoisture: 0.46, woodlandMoisture: 0.68, scale: 7, treeDensity: 0.5 },
    initialCounts: [
      { species: Species.SmallHerb, count: 170 },
      { species: Species.LargeHerb, count: 30 },
      { species: Species.Predator, count: 14 },
      { species: Species.Scavenger, count: 12 },
    ],
    randomDrought: false,
  },
  {
    id: 'meadow',
    name: '湿润草甸',
    desc: '水分充足的开阔草甸，植物生长快，适合食草者快速扩张。',
    rainfall: 0.15,
    gen: { waterLevel: 0.24, rockLevel: 0.9, meadowMoisture: 0.52, woodlandMoisture: 0.72, scale: 6, treeDensity: 0.32 },
    initialCounts: [
      { species: Species.SmallHerb, count: 150 },
      { species: Species.LargeHerb, count: 26 },
      { species: Species.Predator, count: 12 },
      { species: Species.Scavenger, count: 12 },
    ],
    randomDrought: false,
  },
  {
    id: 'arid',
    name: '干旱谷地',
    desc: '缺水少土的世界，植物稀疏，生物必须有足够耐旱性才能延续。',
    rainfall: 0.045,
    gen: { waterLevel: 0.36, rockLevel: 0.8, meadowMoisture: 0.4, woodlandMoisture: 0.62, scale: 8, treeDensity: 0.22 },
    initialCounts: [
      { species: Species.SmallHerb, count: 100 },
      { species: Species.LargeHerb, count: 20 },
      { species: Species.Predator, count: 10 },
      { species: Species.Scavenger, count: 12 },
    ],
    randomDrought: true,
  },
] as const;

export function presetById(id: string): PresetDef | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** 地形基础光照系数（供世界生成与界面显示） */
export function terrainLightMul(t: number): number {
  return LIGHT.byTerrain[t] ?? 0;
}
