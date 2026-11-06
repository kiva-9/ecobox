// 生物个体：状态、表现型与能量核算。
// 基因出生后不变；体型随年龄变化属于表现型，不修改基因。

import type { Genes, Phenotype } from './types';
import { computePhenotype } from './types';
import { BehaviorState, Species } from './constants';
import { ENERGY, mapGene, speciesParams, WORLD } from './config';

/** ID 分配器：每个 Simulation 拥有独立序列，互不干扰 */
export type IdAllocator = () => number;

export class Creature {
  id: number;
  species: number;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  heading = 0;
  energy: number;
  age = 0;
  alive = true;
  genes: Genes;
  pheno: Phenotype;
  adultSize: number;
  maxEnergy: number;
  state: number = BehaviorState.Wander;
  reason = '刚刚出生，正在观察环境';
  // 目标
  targetX = 0;
  targetY = 0;
  targetKind: number = 0; // 0 无 / 1 植物格 / 2 猎物 / 3 残骸格 / 4 逃逸点
  targetId = -1;
  threatX = -1;
  threatY = -1;
  hasThreat = false;
  // 计时器
  reproCooldown = 0;
  eatCooldown = 0;
  attackCooldown = 0;
  decisionTimer = 0;
  blockedTimer = 0;
  lastX = 0;
  lastY = 0;
  blacklistX = -1;
  blacklistY = -1;
  blacklistTimer = 0;
  wanderAngle = 0;
  // 谱系
  parentId = -1;
  lineageId = 0;
  generation = 0;
  birthTick = 0;
  artificial = false;
  kids = 0;
  lastMealTick = -1;
  mature = false;
  /** 距上次进食的 tick 数（用于休眠判定） */
  starveTicks = 0;
  /** 休眠中（代谢大幅降低的节能状态） */
  torpor = false;
  /** 视觉表现缓存：颜色色相偏移（由速度基因决定，渲染用） */
  hueShift = 0;
  /** 死因（DeathCause），存活时为 -1 */
  deathCause = -1;
  /** 猎物引用（运行时用，不序列化） */
  targetRef: Creature | null = null;

  constructor(species: number, genes: Genes, x: number, y: number, energy: number, lineageId: number, id: number) {
    this.id = id;
    this.species = species;
    this.genes = genes;
    this.x = x;
    this.y = y;
    this.lastX = x;
    this.lastY = y;
    this.energy = energy;
    this.lineageId = lineageId;
    this.pheno = computePhenotype(species, genes);
    this.adultSize = this.pheno.adultSize;
    this.maxEnergy = this.pheno.maxEnergy;
    this.hueShift = genes.speed;
  }

  /** 当前体型（幼体较小）——表现型，不改变基因 */
  get currentSize(): number {
    const p = speciesParams(this.species);
    const t = Math.min(1, this.age / p.maturity);
    return this.adultSize * (0.38 + 0.62 * t);
  }

  /** 体型代谢因子 */
  sizeFactor(): number {
    const s = this.currentSize;
    return Math.pow(s / ENERGY.refSize, ENERGY.sizeMetabExp);
  }

  /** 每 tick 固定开销：基础代谢 + 感知 + 耐旱投入 + 干旱脱水（休眠时大幅降低） */
  upkeepCost(drought: number): number {
    const p = speciesParams(this.species);
    const torporK = this.torpor ? 0.1 : 1;
    const basal = p.basal * this.sizeFactor() * (1 + ENERGY.droughtTolCost * this.genes.droughtTol) * torporK;
    const sense = p.senseK * this.pheno.senseRadius * (this.torpor ? 0.25 : 1);
    const dry = CLIMATE_DRAIN * (1 - this.genes.droughtTol) * drought * torporK;
    return basal + sense + dry;
  }

  /** 移动能耗（按实际速度） */
  moveCost(speedRatio: number, fleeing: boolean): number {
    const p = speciesParams(this.species);
    const cost = p.moveK * speedRatio * speedRatio * this.sizeFactor();
    return fleeing ? cost * 1.35 : cost;
  }

  /** 植物消化效率（耐旱提升干草榨取） */
  digestEfficiency(): number {
    return ENERGY.digestBase + ENERGY.digestDroughtGain * this.genes.droughtTol;
  }

  canReproduce(): boolean {
    const p = speciesParams(this.species);
    return (
      this.mature &&
      this.reproCooldown <= 0 &&
      this.energy >= p.reproThreshold * this.maxEnergy
    );
  }

  /** 繁殖投入比例（基因映射） */
  investRatio(): number {
    return mapGene('reproInvest', this.genes.reproInvest);
  }
}

// 与 CLIMATE.droughtDrain 保持一致（单独引用避免循环）
const CLIMATE_DRAIN = 0.05;

/** 尸骸生物量（死亡时生成） */
export function carcassBiomass(c: Creature): number {
  return ENERGY.carcassBase + ENERGY.carcassSizeFactor * c.currentSize + c.energy * 0.12;
}

/** 世界坐标 → 格子坐标 */
export function tileOf(v: number): number {
  return Math.floor(v);
}

export function inWorld(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < WORLD.width && y < WORLD.height;
}

export const PREY_SPECIES: number[] = [Species.SmallHerb, Species.LargeHerb];
