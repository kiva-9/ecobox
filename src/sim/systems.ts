// 生态子系统：土壤水分/养分、植物生长、残骸分解（错峰更新），以及统计采样。
// 因果链：光照 × 水分 × 养分 → 植物生长；残骸分解 → 养分；蒸发/降雨 → 水分。

import { World } from './world';
import { CLIMATE, GENE_KEYS, LIGHT, LIMITS, PLANTS, WORLD } from './config';
import { Terrain } from './constants';
import type { Genes, StatsSample } from './types';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export interface ClimateView {
  /** 当前全局光照 0..1 */
  light: number;
  /** 当前降雨强度 */
  rainfall: number;
  /** 干旱强度 0..1 */
  drought: number;
}

/** 错峰更新土壤与植物：每 tile 每 WORLD.soilStride tick 更新一次（速率为"每土壤更新"）。 */
export function updateSoil(world: World, tick: number, climate: ClimateView): void {
  const stride = WORLD.soilStride;
  const n = world.width * world.height;
  for (let i = tick % stride; i < n; i += stride) {
    const t = world.terrain[i];
    if (t === Terrain.Water || t === Terrain.Rock) continue;

    const light = climate.light * LIGHT.byTerrain[t];

    // ---- 水分：降雨补充 - 蒸发（蒸发受光照与干旱影响） ----
    const evap =
      CLIMATE.evaporationBase *
      CLIMATE.evaporationByTerrain[t] *
      (0.7 + light * 0.6) *
      (climate.drought > 0 ? CLIMATE.droughtEvapBoost : 1);
    let m = world.moisture[i] + climate.rainfall * CLIMATE.rainToMoisture - evap * world.moisture[i];
    world.moisture[i] = clamp(m, 0, 1);

    // ---- 养分：基础再生（土壤风化，外部输入，极小） ----
    let nut = world.nutrients[i] + PLANTS.nutrientRegen * stride;

    // ---- 青草生长 ----
    const gl = clamp((light - PLANTS.grass.lightMin) / (PLANTS.grass.lightOpt - PLANTS.grass.lightMin), 0, 1);
    const gm = clamp(m / PLANTS.grass.moistureOpt, 0, 1);
    const gn = clamp(nut / 0.35, 0, 1);
    let g = world.grass[i];
    if (g < PLANTS.grass.max && gl > 0 && gm > 0 && gn > 0) {
      const growth = PLANTS.grass.growth * gl * gm * gn * (1 - g / PLANTS.grass.max);
      g = Math.min(PLANTS.grass.max, g + growth);
      nut -= growth * PLANTS.grass.nutrientUse;
      m = Math.max(0, m - growth * PLANTS.grass.waterUse);
    }
    // 干旱枯死：部分养分返还土壤
    if (m < PLANTS.grass.dryDie && g > 0) {
      const loss = Math.min(g, PLANTS.grass.dryDieRate);
      g -= loss;
      nut += loss * PLANTS.deadPlantNutrientReturn;
    }
    world.grass[i] = g;

    // ---- 浆果灌丛生长（喜遮阴，耐旱性低于青草） ----
    const sl = clamp(1.15 - Math.abs(light - PLANTS.shrub.lightCenter) / PLANTS.shrub.lightTol, 0, 1);
    const sm = clamp(m / PLANTS.shrub.moistureOpt, 0, 1);
    const sn = clamp(nut / 0.35, 0, 1);
    let s = world.shrub[i];
    if (s < PLANTS.shrub.max && sl > 0 && sm > 0 && sn > 0) {
      const growth = PLANTS.shrub.growth * sl * sm * sn * (1 - s / PLANTS.shrub.max);
      s = Math.min(PLANTS.shrub.max, s + growth);
      nut -= growth * PLANTS.shrub.nutrientUse;
      m = Math.max(0, m - growth * PLANTS.shrub.waterUse);
    }
    if (m < PLANTS.shrub.dryDie && s > 0) {
      const loss = Math.min(s, PLANTS.shrub.dryDieRate);
      s -= loss;
      nut += loss * PLANTS.deadPlantNutrientReturn;
    }
    world.shrub[i] = s;

    // ---- 残骸分解：转化为养分（另有少量干燥损失，一半返还养分） ----
    let car = world.carcass[i];
    if (car > 0) {
      const dec = Math.min(car, PLANTS.carcass.decompRate);
      const dry = Math.min(car - dec, PLANTS.carcass.dryRate);
      car -= dec + dry;
      nut += (dec + dry * 0.5) * PLANTS.carcass.decompToNutrient;
      world.carcass[i] = Math.max(0, car);
    }

    world.moisture[i] = clamp(m, 0, 1);
    world.nutrients[i] = clamp(nut, 0, 1);
  }
}

/** 分位数（原地排序副本） */
function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const traitBuffer: number[] = [];

/** 统计采样：种群、植物、出生死亡、性状分布（p10/p50/p90） */
export function sampleStats(
  world: World,
  creatures: readonly { species: number; alive: boolean; genes: Genes }[],
  tick: number,
  births: number,
  deaths: number,
  deathByCause: number[],
): StatsSample {
  const counts = [0, 0, 0, 0];
  const totals = world.totals();
  const geneSums = [0, 0, 0, 0, 0, 0];
  const geneCounts = [0, 0, 0, 0, 0, 0];
  const geneValues: number[][] = [[], [], [], [], [], []];
  for (const c of creatures) {
    if (!c.alive) continue;
    counts[c.species]++;
    for (let k = 0; k < 6; k++) {
      const v = c.genes[GENE_KEYS[k]];
      geneSums[k] += v;
      geneCounts[k]++;
      geneValues[k].push(v);
    }
  }
  const trait = geneValues.map((vals, k) => {
    vals.sort((a, b) => a - b);
    return {
      mean: geneCounts[k] > 0 ? geneSums[k] / geneCounts[k] : 0,
      p10: percentile(vals, 0.1),
      p50: percentile(vals, 0.5),
      p90: percentile(vals, 0.9),
    };
  });
  traitBuffer.length = 0;
  return {
    tick,
    counts,
    plants: totals.grass + totals.shrub,
    carcass: totals.carcass,
    births,
    deaths,
    deathByCause,
    trait,
  };
}

export function statsInterval(): number {
  return LIMITS.statsInterval;
}
