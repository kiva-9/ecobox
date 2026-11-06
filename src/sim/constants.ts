// 全局常量：地形、物种、行为状态、死因等枚举式定义。
// 使用 const 对象而非 enum，以兼容 isolatedModules / verbatimModuleSyntax。

export const Terrain = {
  Water: 0,
  Rock: 1,
  Meadow: 2, // 湿润草地
  Woodland: 3, // 林地
  Arid: 4, // 干旱地
} as const;
export type TerrainId = (typeof Terrain)[keyof typeof Terrain];

export const TERRAIN_COUNT = 5;

export function terrainName(t: number): string {
  switch (t) {
    case Terrain.Water: return '水域';
    case Terrain.Rock: return '岩石';
    case Terrain.Meadow: return '湿润草地';
    case Terrain.Woodland: return '林地';
    case Terrain.Arid: return '干旱地';
    default: return '未知';
  }
}

export function isPassableTerrain(t: number): boolean {
  return t === Terrain.Meadow || t === Terrain.Woodland || t === Terrain.Arid;
}

export const Species = {
  SmallHerb: 0, // 小型食草者
  LargeHerb: 1, // 大型食草者
  Predator: 2, // 捕食者
  Scavenger: 3, // 食腐者
} as const;
export type SpeciesId = (typeof Species)[keyof typeof Species];

export const SPECIES_COUNT = 4;

export function speciesName(s: number): string {
  switch (s) {
    case Species.SmallHerb: return '小型食草者';
    case Species.LargeHerb: return '大型食草者';
    case Species.Predator: return '捕食者';
    case Species.Scavenger: return '食腐者';
    default: return '未知';
  }
}

export function speciesShort(s: number): string {
  switch (s) {
    case Species.SmallHerb: return '小食草';
    case Species.LargeHerb: return '大食草';
    case Species.Predator: return '捕食者';
    case Species.Scavenger: return '食腐者';
    default: return '?';
  }
}

export const BehaviorState = {
  Wander: 0,
  Forage: 1, // 前往植物食物
  Flee: 2, // 逃离威胁
  Hunt: 3, // 追猎
  Scavenge: 4, // 前往残骸
  Rest: 5, // 休息
  Reproduce: 6, // 繁殖
  Eat: 7, // 进食中（短状态）
} as const;
export type BehaviorStateId = (typeof BehaviorState)[keyof typeof BehaviorState];

export function behaviorName(b: number): string {
  switch (b) {
    case BehaviorState.Wander: return '闲逛';
    case BehaviorState.Forage: return '觅食';
    case BehaviorState.Flee: return '逃逸';
    case BehaviorState.Hunt: return '追猎';
    case BehaviorState.Scavenge: return '寻骸';
    case BehaviorState.Rest: return '休息';
    case BehaviorState.Reproduce: return '繁殖';
    case BehaviorState.Eat: return '进食';
    default: return '未知';
  }
}

export const DeathCause = {
  Starve: 0, // 饿死
  Age: 1, // 衰老
  Predated: 2, // 被捕食
  Dehydrate: 3, // 脱水
} as const;
export type DeathCauseId = (typeof DeathCause)[keyof typeof DeathCause];

export function deathCauseName(c: number): string {
  switch (c) {
    case DeathCause.Starve: return '饿死';
    case DeathCause.Age: return '衰老';
    case DeathCause.Predated: return '被捕食';
    case DeathCause.Dehydrate: return '脱水';
    default: return '未知';
  }
}

/** 干预工具（画笔/投放/气候）。沙盒无限次；挑战中每次动作消耗 1 点干预配额。 */
export const Tool = {
  None: 0, // 选择/观察
  PaintMeadow: 1,
  PaintWoodland: 2,
  PaintArid: 3,
  PaintWater: 4,
  PaintRock: 5,
  PlantGrass: 6,
  PlantShrub: 7,
  Rain: 8,
  Drought: 9,
  SpawnSmallHerb: 10,
  SpawnLargeHerb: 11,
  SpawnPredator: 12,
  SpawnScavenger: 13,
} as const;
export type ToolId = (typeof Tool)[keyof typeof Tool];

export function toolName(t: number): string {
  switch (t) {
    case Tool.None: return '选择';
    case Tool.PaintMeadow: return '改为湿润草地';
    case Tool.PaintWoodland: return '改为林地';
    case Tool.PaintArid: return '改为干旱地';
    case Tool.PaintWater: return '改为水域';
    case Tool.PaintRock: return '改为岩石';
    case Tool.PlantGrass: return '播种青草';
    case Tool.PlantShrub: return '种植浆果灌丛';
    case Tool.Rain: return '降雨';
    case Tool.Drought: return '触发干旱';
    case Tool.SpawnSmallHerb: return '投放小型食草者';
    case Tool.SpawnLargeHerb: return '投放大型食草者';
    case Tool.SpawnPredator: return '投放捕食者';
    case Tool.SpawnScavenger: return '投放食腐者';
    default: return '未知';
  }
}

/** 该工具是否属于"干预"（挑战中消耗配额）。 */
export function toolIsIntervention(t: number): boolean {
  return t !== Tool.None;
}
