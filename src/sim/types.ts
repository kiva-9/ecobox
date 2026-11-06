// 核心数据类型：基因、个体、档案、事件、统计。

import { RNG } from './rng';
import { MUTATION, mapGene, speciesParams } from './config';
import { GENE_KEYS } from './config';

/** 六项可遗传基因，取值 0..1。出生时确定，终身不变。 */
export interface Genes {
  speed: number;
  size: number;
  sense: number;
  droughtTol: number;
  reproInvest: number;
  boldness: number;
}

/** 由基因得到的表现型参数（派生值，会随年龄变化的是体型比例，不是基因） */
export interface Phenotype {
  maxSpeed: number; // tile/tick
  adultSize: number; // tile 半径
  senseRadius: number; // tile
  maxEnergy: number;
}

export function computePhenotype(species: number, genes: Genes): Phenotype {
  const p = speciesParams(species);
  return {
    maxSpeed: mapGene('speed', genes.speed),
    adultSize: mapGene('size', genes.size),
    senseRadius: mapGene('sense', genes.sense),
    maxEnergy: p.maxEnergy * (0.7 + 0.6 * genes.size),
  };
}

/** 个体档案记录（死亡后归档，用于谱系追溯） */
export interface CreatureRecord {
  id: number;
  species: number;
  parentId: number; // -1 表示初代
  lineageId: number;
  generation: number;
  birthTick: number;
  deathTick: number;
  cause: number; // DeathCause
  genes: Genes;
  artificial: boolean;
  kids: number;
  x: number;
  y: number;
}

/** 谱系汇总 */
export interface LineageInfo {
  id: number;
  founderId: number;
  species: number;
  startTick: number;
  aliveCount: number;
  totalBirths: number;
  totalDeaths: number;
  maxGeneration: number;
  extinct: boolean;
  extinctTick: number;
  artificial: boolean; // 是否由人工投放建立
}

/** 游戏事件（来自真实模拟事件） */
export interface GameEvent {
  seq: number;
  tick: number;
  type: string;
  text: string;
  x?: number;
  y?: number;
}

/** 统计采样（种群/植物/能量/性状分布） */
export interface StatsSample {
  tick: number;
  counts: number[]; // 4 物种存活数
  plants: number; // 植物总生物量
  carcass: number;
  births: number;
  deaths: number;
  deathByCause: number[]; // 4 类死因计数（自上一采样）
  /** 每项基因的 p10/p50/p90 与均值（只统计存活成年个体） */
  trait: { mean: number; p10: number; p50: number; p90: number }[];
}

/** 繁殖：子代基因 = 亲代基因 + 有限突变 */
export function inheritGenes(parent: Genes, rng: RNG): Genes {
  const child: Genes = { ...parent };
  for (const key of GENE_KEYS) {
    let g = parent[key];
    if (rng.chance(MUTATION.prob)) {
      const sigma = rng.chance(MUTATION.jumpProb) ? MUTATION.jumpSigma : MUTATION.sigma;
      g += rng.gauss(sigma);
    }
    if (g < 0.02) g = 0.02;
    if (g > 0.98) g = 0.98;
    child[key] = g;
  }
  return child;
}

/** 初代随机基因：围绕物种基因中心波动（初始种群需要可存活，演化由后续繁殖接管） */
export function randomGenes(rng: RNG, species: number): Genes {
  const p = speciesParams(species);
  const gc = p.geneCenters;
  const jitter = (center: number, spread = 0.16): number =>
    Math.min(0.95, Math.max(0.05, center + rng.gauss(spread)));
  return {
    speed: jitter(gc[0]),
    size: jitter(gc[1]),
    sense: jitter(gc[2]),
    droughtTol: jitter(gc[3]),
    reproInvest: jitter(gc[4], 0.1),
    boldness: Math.min(0.95, Math.max(0.05, p.boldCenter + rng.gauss(0.18))),
  };
}

/** 蓝色prints：收藏的遗传蓝图 */
export interface Blueprint {
  id: string;
  name: string;
  species: number;
  genes: Genes;
  capturedTick: number;
  sourceWorldSeed: number;
  note: string;
  createdAt: number;
}
