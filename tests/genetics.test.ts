// 遗传测试：继承与突变、基因稳定性、性状影响行为与成本。
import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { Creature } from '../src/sim/creature';
import { Species } from '../src/sim/constants';
import { inheritGenes, randomGenes } from '../src/sim/types';
import { RNG } from '../src/sim/rng';
import { MUTATION, speciesParams } from '../src/sim/config';
import type { Genes } from '../src/sim/types';

function genes(speed = 0.5, size = 0.5, sense = 0.5, droughtTol = 0.5, reproInvest = 0.3, boldness = 0.5): Genes {
  return { speed, size, sense, droughtTol, reproInvest, boldness };
}

function controlledSim(): Simulation {
  const sim = new Simulation(4242, 'temperate');
  sim.creatures.length = 0;
  sim.lineages.clear();
  return sim;
}

describe('遗传系统', () => {
  it('inheritGenes：子代基因来自亲代并可能有限突变', () => {
    const rng = new RNG(99);
    const parent = genes(0.6, 0.4, 0.7, 0.3, 0.35, 0.55);
    let mutatedCount = 0;
    const N = 500;
    for (let k = 0; k < N; k++) {
      const child = inheritGenes(parent, rng);
      // 所有基因在合法范围
      for (const key of Object.keys(child) as (keyof Genes)[]) {
        expect(child[key]).toBeGreaterThanOrEqual(0.02);
        expect(child[key]).toBeLessThanOrEqual(0.98);
      }
      if (child.speed !== parent.speed) mutatedCount++;
      // 单次突变幅度有限（≤ 3×jumpSigma）
      expect(Math.abs(child.speed - parent.speed)).toBeLessThanOrEqual(MUTATION.jumpSigma * 3 + 1e-9);
    }
    // 突变概率符合参数（0.35 ± 统计容差）
    const rate = mutatedCount / N;
    expect(rate).toBeGreaterThan(MUTATION.prob - 0.12);
    expect(rate).toBeLessThan(MUTATION.prob + 0.12);
  });

  it('繁殖产生的子代基因确实来自亲代谱系', () => {
    const sim = controlledSim();
    sim.world.grass.fill(0);
    sim.world.shrub.fill(0);
    const parent = new Creature(Species.SmallHerb, genes(0.7, 0.6, 0.5, 0.4, 0.3, 0.5), 40.5, 40.5, 100, 11, 0);
    parent.age = 5000;
    parent.mature = true;
    parent.reproCooldown = 0;
    sim.creatures.push(parent);
    let child: Creature | null = null;
    for (let k = 0; k < 40 && !child; k++) {
      sim.step();
      child = sim.creatures.find((c) => c.parentId === parent.id) ?? null;
    }
    expect(child).not.toBeNull();
    for (const key of Object.keys(child!.genes) as (keyof Genes)[]) {
      const diff = Math.abs(child!.genes[key] - parent.genes[key]);
      expect(diff).toBeLessThanOrEqual(MUTATION.jumpSigma * 3 + 1e-9);
    }
  });

  it('成年个体的基因不随时间改变', () => {
    const sim = controlledSim();
    sim.world.grass.fill(25);
    const c = new Creature(Species.SmallHerb, genes(0.55, 0.45, 0.6, 0.5, 0.3, 0.5), 40.5, 40.5, 80, 12, 0);
    c.age = 3000;
    c.mature = true;
    sim.creatures.push(c);
    const snapshot = () => JSON.stringify(c.genes);
    const g0 = snapshot();
    for (let k = 0; k < 4000; k++) sim.step();
    expect(c.alive).toBe(true);
    expect(snapshot()).toBe(g0);
  });

  it('体型基因增加基础代谢成本', () => {
    const small = new Creature(Species.SmallHerb, genes(0.5, 0.1), 0, 0, 50, 1, 0);
    const large = new Creature(Species.SmallHerb, genes(0.5, 0.9), 0, 0, 50, 1, 0);
    small.age = 5000;
    large.age = 5000;
    expect(large.upkeepCost(0)).toBeGreaterThan(small.upkeepCost(0));
    // 体型也提高能量上限
    expect(large.maxEnergy).toBeGreaterThan(small.maxEnergy);
  });

  it('感知基因增加感知维持成本', () => {
    const narrow = new Creature(Species.SmallHerb, genes(0.5, 0.5, 0.05), 0, 0, 50, 1, 0);
    const wide = new Creature(Species.SmallHerb, genes(0.5, 0.5, 0.95), 0, 0, 50, 1, 0);
    expect(wide.upkeepCost(0)).toBeGreaterThan(narrow.upkeepCost(0));
    expect(wide.pheno.senseRadius).toBeGreaterThan(narrow.pheno.senseRadius);
  });

  it('速度基因提高移动能耗', () => {
    const slow = new Creature(Species.SmallHerb, genes(0.1, 0.5), 0, 0, 50, 1, 0);
    const fast = new Creature(Species.SmallHerb, genes(0.9, 0.5), 0, 0, 50, 1, 0);
    // 各自以自身最高速移动时的能耗（速度比 = 最高速 / 参考速）
    const slowCost = slow.moveCost(slow.pheno.maxSpeed / 0.08, false);
    const fastCost = fast.moveCost(fast.pheno.maxSpeed / 0.08, false);
    expect(fastCost).toBeGreaterThan(slowCost);
    expect(fast.pheno.maxSpeed).toBeGreaterThan(slow.pheno.maxSpeed);
  });

  it('耐旱基因降低干旱脱水消耗但有基础代谢代价', () => {
    const tender = new Creature(Species.SmallHerb, genes(0.5, 0.5, 0.5, 0.0), 0, 0, 50, 1, 0);
    const hardy = new Creature(Species.SmallHerb, genes(0.5, 0.5, 0.5, 1.0), 0, 0, 50, 1, 0);
    // 干旱时（drought=1）耐旱者总开销更低
    expect(hardy.upkeepCost(1)).toBeLessThan(tender.upkeepCost(1));
    // 无干旱时耐旱者开销更高（生理投入的代价）
    expect(hardy.upkeepCost(0)).toBeGreaterThan(tender.upkeepCost(0));
  });

  it('速度基因改变实际行为：快速捕食者捕获速度远快于慢速捕食者', () => {
    const run = (predSpeedGene: number, preySpeedGene: number): number => {
      const sim = controlledSim();
      sim.world.grass.fill(0);
      sim.world.shrub.fill(0);
      sim.world.carcass.fill(0);
      const pred = new Creature(Species.Predator, genes(predSpeedGene, 0.5, 0.6), 40.5, 40.5, 150, 3, 900001);
      pred.age = 5000;
      pred.mature = true;
      const prey = new Creature(Species.SmallHerb, genes(preySpeedGene, 0.3, 0.3), 43.0, 40.5, 70, 4, 900002);
      prey.age = 5000;
      prey.mature = true;
      sim.creatures.push(pred, prey);
      for (let k = 0; k < 1500; k++) {
        sim.step();
        if (!prey.alive) return sim.tick;
        if (!pred.alive) return -1;
      }
      return -1;
    };
    const fastVsSlow = run(0.95, 0.05);
    expect(fastVsSlow).toBeGreaterThan(0); // 快捕食者 vs 慢猎物 → 捕获
    const slowVsFast = run(0.05, 0.95);
    // 慢捕食者 vs 快猎物：要么抓不到，要么耗时远长（允许被逼入角落的偶然情况）
    if (slowVsFast > 0) expect(slowVsFast).toBeGreaterThan(fastVsSlow * 2);
  });

  it('初代基因围绕物种中心分布', () => {
    const rng = new RNG(7);
    const preds = Array.from({ length: 200 }, () => randomGenes(rng, Species.Predator));
    const meanSpeed = preds.reduce((s, g) => s + g.speed, 0) / preds.length;
    // 捕食者速度基因中心 0.68
    expect(meanSpeed).toBeGreaterThan(0.55);
    expect(meanSpeed).toBeLessThan(0.8);
    const herbs = Array.from({ length: 200 }, () => randomGenes(rng, Species.SmallHerb));
    const meanHerbSpeed = herbs.reduce((s, g) => s + g.speed, 0) / herbs.length;
    expect(meanHerbSpeed).toBeLessThan(meanSpeed); // 猎物平均更慢
  });

  it('繁殖投入基因影响子代获得能量与亲代成本', () => {
    const run = (invest: number): { childEnergy: number; parentLeft: number } => {
      const sim = controlledSim();
      sim.world.grass.fill(0);
      sim.world.shrub.fill(0);
      const parent = new Creature(Species.SmallHerb, genes(0.5, 0.5, 0.5, 0.5, invest), 40.5, 40.5, 100, 13, 0);
      parent.age = 5000;
      parent.mature = true;
      parent.reproCooldown = 0;
      sim.creatures.push(parent);
      let child: Creature | null = null;
      for (let k = 0; k < 40 && !child; k++) {
        sim.step();
        child = sim.creatures.find((c) => c.parentId === parent.id) ?? null;
      }
      return { childEnergy: child!.energy, parentLeft: parent.energy };
    };
    const low = run(0.1);
    const high = run(0.45);
    expect(high.childEnergy).toBeGreaterThan(low.childEnergy);
    expect(high.parentLeft).toBeLessThan(low.parentLeft);
  });

  it('物种参数完整性：四个物种都有食谱与基因中心', () => {
    for (let s = 0; s < 4; s++) {
      const p = speciesParams(s);
      expect(p.diet).toBeGreaterThanOrEqual(0);
      expect(p.geneCenters.length).toBe(5);
      expect(p.maxAge).toBeGreaterThan(p.maturity);
    }
  });
});
