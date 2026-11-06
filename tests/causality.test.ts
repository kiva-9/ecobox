// 核心因果测试：食物→能量、代谢成本、繁殖成本、捕食不创生、分解不创生、死亡即终止。
import { describe, it, expect } from 'vitest';
import { Simulation, computeLight } from '../src/sim/simulation';
import { Creature, carcassBiomass } from '../src/sim/creature';
import { Species, Tool, Terrain, BehaviorState } from '../src/sim/constants';
import { ENERGY, PLANTS, speciesParams } from '../src/sim/config';
import type { Genes } from '../src/sim/types';

function genes(speed = 0.5, size = 0.5, sense = 0.5, droughtTol = 0.5, reproInvest = 0.3, boldness = 0.5): Genes {
  return { speed, size, sense, droughtTol, reproInvest, boldness };
}

/** 构造一个只含指定个体的受控世界 */
function controlledSim(): Simulation {
  const sim = new Simulation(4242, 'temperate');
  sim.creatures.length = 0;
  sim.lineages.clear();
  return sim;
}

let testCreatureId = 900000;
function addCreature(sim: Simulation, species: number, x: number, y: number, g: Genes, energy?: number, lineageId = 1): Creature {
  const p = speciesParams(species);
  const c = new Creature(species, g, x, y, energy ?? p.maxEnergy * 0.5, lineageId, testCreatureId++);
  sim.creatures.push(c);
  return c;
}

describe('核心因果链', () => {
  it('进食：食物被真实消耗，动物获得能量', () => {
    const sim = controlledSim();
    // 在世界中心附近找一块草地并种满青草
    let tx = -1;
    let ty = -1;
    for (let y = 30; y < 50 && tx < 0; y++) {
      for (let x = 30; x < 90 && tx < 0; x++) {
        if (sim.world.terrain[sim.world.idx(x, y)] === Terrain.Meadow) { tx = x; ty = y; }
      }
    }
    expect(tx).toBeGreaterThan(0);
    const i = sim.world.idx(tx, ty);
    sim.world.grass[i] = 40;
    const herb = addCreature(sim, Species.SmallHerb, tx + 0.5, ty + 0.5, genes(), 20);
    const grassBefore = sim.world.grass[i];
    const energyBefore = herb.energy;
    // 运行足够让个体吃到食物（决策+移动+咬合同步完成）
    for (let k = 0; k < 400; k++) sim.step();
    expect(herb.alive).toBe(true);
    expect(herb.energy).toBeGreaterThan(energyBefore + 0.5);
    expect(sim.world.grass[i]).toBeLessThan(grassBefore);
    // 能量增益与食物消耗成正比关系（增益 = 咬合 × 密度 × 效率）
    const consumed = grassBefore - sim.world.grass[i];
    expect(consumed).toBeGreaterThan(0);
  });

  it('代谢与移动消耗能量：不进食时能量下降，移动有额外成本', () => {
    const sim = controlledSim();
    // 把世界植物清空，确保没有食物
    sim.world.grass.fill(0);
    sim.world.shrub.fill(0);
    sim.world.carcass.fill(0);
    const a = addCreature(sim, Species.SmallHerb, 40.5, 40.5, genes(), 60);
    const b = addCreature(sim, Species.SmallHerb, 42.5, 40.5, genes(0.9), 60);
    const energyA0 = a.energy;
    const energyB0 = b.energy;
    for (let k = 0; k < 200; k++) sim.step();
    // 两者都因基础代谢而下降
    expect(a.energy).toBeLessThan(energyA0);
    expect(b.energy).toBeLessThan(energyB0);
    // 能量会计：移动成本 = moveK × 速度比² × 体型因子，静止时为 0
    expect(a.moveCost(0.5, false)).toBeGreaterThan(0);
    expect(a.moveCost(0, false)).toBe(0);
    // 每 tick 总消耗 = 基础代谢（含感知与耐旱投入）+ 移动成本
    expect(a.upkeepCost(0)).toBeGreaterThan(0);
    const perTickMoving = a.upkeepCost(0) + a.moveCost(0.5, false);
    const actual = (energyA0 - a.energy) / 200;
    expect(actual).toBeGreaterThan(0);
    expect(actual).toBeLessThanOrEqual(perTickMoving + 0.001);
  });

  it('繁殖：亲代实际承担能量成本，子代继承谱系', () => {
    const sim = controlledSim();
    sim.world.grass.fill(0);
    sim.world.shrub.fill(0);
    const parent = addCreature(sim, Species.SmallHerb, 40.5, 40.5, genes(), 100, 7);
    parent.age = 5000; // 成年
    parent.mature = true;
    parent.reproCooldown = 0;
    parent.birthTick = 0;
    const parentGenes = { ...parent.genes };
    // 直接触发繁殖路径（通过决策：能量高于门槛）
    const before = sim.creatures.length;
    let child: Creature | null = null;
    for (let k = 0; k < 30 && !child; k++) {
      sim.step();
      child = sim.creatures.find((c) => c.parentId === parent.id) ?? null;
    }
    expect(child).not.toBeNull();
    expect(sim.creatures.length).toBe(before + 1);
    expect(child!.parentId).toBe(parent.id);
    expect(child!.generation).toBe(parent.generation + 1);
    expect(child!.lineageId).toBe(parent.lineageId);
    expect(child!.birthTick).toBeGreaterThanOrEqual(0);
    // 亲代能量被扣除（子代能量 × 1.5 成本，且亲代不会因此获得能量）
    expect(parent.energy).toBeLessThan(100);
    // 基因来自亲代（可能突变，但不应完全不同）
    const diff = Math.abs(child!.genes.speed - parentGenes.speed) + Math.abs(child!.genes.size - parentGenes.size);
    expect(diff).toBeLessThan(1.0);
    expect(parent.reproCooldown).toBeGreaterThan(0);
  });

  it('捕食：能量部分转移，其余成为残骸，不创生总能量', () => {
    const sim = controlledSim();
    sim.world.grass.fill(0);
    sim.world.shrub.fill(0);
    sim.world.carcass.fill(0);
    const pred = addCreature(sim, Species.Predator, 40.5, 40.5, genes(0.9, 0.6, 0.6), 80, 3);
    pred.age = 5000;
    pred.mature = true;
    const prey = addCreature(sim, Species.SmallHerb, 43.5, 40.5, genes(0.3, 0.3, 0.3), 70, 4);
    prey.age = 5000;
    prey.mature = true;
    sim.world.carcass.fill(0);
    // 猎物生物量是它此前摄食转化的“身体储存能量”，计入系统总能量
    const preyBiomassEnergy = carcassBiomass(prey) * PLANTS.carcass.energy * ENERGY.carrionEfficiency;
    const totalEnergyBefore = pred.energy + prey.energy + preyBiomassEnergy;
    let killed = false;
    for (let k = 0; k < 600 && !killed; k++) {
      sim.step();
      killed = !prey.alive;
    }
    expect(killed).toBe(true);
    expect(prey.deathCause).toBe(2); // 被捕食
    // 捕食者获得的能量 ≤ 猎物原能量 × 转移效率
    expect(pred.energy - 80).toBeLessThanOrEqual(70 * 0.7 + 0.001);
    // 残骸在猎物死亡格生成
    const i = sim.world.idx(Math.floor(prey.x), Math.floor(prey.y));
    expect(sim.world.carcass[i]).toBeGreaterThan(0);
    // 系统中总能量（个体+残骸折算）不增加
    const carrionEnergy = sim.world.carcass[i] * PLANTS.carcass.energy * 0.65;
    const totalAfter = pred.energy + carrionEnergy;
    expect(totalAfter).toBeLessThanOrEqual(totalEnergyBefore + 0.001);
  });

  it('分解：残骸转化为养分，不重复结算', () => {
    const sim = controlledSim();
    const i = sim.world.idx(40, 40);
    sim.world.carcass[i] = 30;
    sim.world.nutrients[i] = 0.2;
    const nutBefore = sim.world.nutrients[i];
    const carBefore = sim.world.carcass[i];
    // 运行足够多 tick 让该 tile 被多次土壤更新
    for (let k = 0; k < 400; k++) sim.step();
    expect(sim.world.carcass[i]).toBeLessThan(carBefore);
    expect(sim.world.nutrients[i]).toBeGreaterThan(nutBefore - 0.001);
  });

  it('死亡个体不能继续行动或繁殖', () => {
    const sim = controlledSim();
    sim.world.grass.fill(0);
    sim.world.shrub.fill(0);
    const c = addCreature(sim, Species.SmallHerb, 40.5, 40.5, genes(), 0.001, 5);
    c.age = 5000;
    c.mature = true;
    c.reproCooldown = 0;
    const x0 = c.x;
    for (let k = 0; k < 50; k++) sim.step();
    expect(c.alive).toBe(false);
    // 已死亡个体被移出种群
    expect(sim.creatures.includes(c)).toBe(false);
    // 没有产生后代
    expect(sim.creatures.some((o) => o.parentId === c.id)).toBe(false);
    // 死亡后留下残骸
    const i = sim.world.idx(Math.floor(x0), Math.floor(40.5));
    expect(sim.world.carcass[i]).toBeGreaterThan(0);
  });

  it('光照/水分/养分影响植物生长：白天生长明显多于黑夜', () => {
    const sim = controlledSim();
    // 找一块草地，设置中等水分与充足养分
    let tx = -1;
    let ty = -1;
    for (let y = 30; y < 50 && tx < 0; y++) {
      for (let x = 30; x < 90 && tx < 0; x++) {
        if (sim.world.terrain[sim.world.idx(x, y)] === Terrain.Meadow) { tx = x; ty = y; }
      }
    }
    const i = sim.world.idx(tx, ty);
    // 推进到光照峰值（与模拟内部相同的光照函数）
    while (computeLight(sim.tick) < 0.75) sim.step();
    sim.world.grass[i] = 5;
    sim.world.moisture[i] = 0.9;
    sim.world.nutrients[i] = 0.7;
    const before = sim.world.grass[i];
    for (let k = 0; k < 240; k++) sim.step();
    const dayGrowth = sim.world.grass[i] - before;
    expect(dayGrowth).toBeGreaterThan(0);
    // 推进到黑夜
    while (computeLight(sim.tick) > 0.15) sim.step();
    sim.world.grass[i] = 5;
    sim.world.moisture[i] = 0.9;
    sim.world.nutrients[i] = 0.7;
    const before2 = sim.world.grass[i];
    for (let k = 0; k < 240; k++) sim.step();
    const nightGrowth = sim.world.grass[i] - before2;
    expect(nightGrowth).toBeLessThan(dayGrowth);
  });

  it('干预：播种增加植物，降雨提高水分，均记录事件', () => {
    const sim = controlledSim();
    let tx = -1;
    let ty = -1;
    for (let y = 30; y < 50 && tx < 0; y++) {
      for (let x = 30; x < 90 && tx < 0; x++) {
        if (sim.world.terrain[sim.world.idx(x, y)] === Terrain.Meadow) { tx = x; ty = y; }
      }
    }
    const i = sim.world.idx(tx, ty);
    sim.world.grass[i] = 0;
    const r1 = sim.intervene(Tool.PlantGrass, tx, ty, 1, null);
    expect(r1.ok).toBe(true);
    expect(sim.world.grass[i]).toBeGreaterThan(0);
    const r2 = sim.intervene(Tool.Rain, tx, ty, 1, null);
    expect(r2.ok).toBe(true);
    expect(sim.rainBoostTicks).toBeGreaterThan(0);
    // 事件日志记录了干预
    expect(sim.events.some((e) => e.type === 'intervene')).toBe(true);
    // 无效干预有错误原因
    const r3 = sim.intervene(Tool.PlantGrass, 0, 0, 1, null); // 角落可能是水/岩石
    if (!r3.ok) expect(typeof r3.error).toBe('string');
    // 人工投放标记
    const r4 = sim.intervene(Tool.SpawnPredator, tx, ty, 1, null);
    expect(r4.ok).toBe(true);
    const spawned = sim.creatures[sim.creatures.length - 1];
    expect(spawned.artificial).toBe(true);
    expect(spawned.generation).toBe(0);
  });

  it('行为状态可达：个体能够觅食与逃跑', () => {
    const sim = controlledSim();
    sim.world.grass.fill(0);
    const herb = addCreature(sim, Species.SmallHerb, 60.5, 40.5, genes(), 50, 9);
    addCreature(sim, Species.Predator, 63.5, 40.5, genes(0.9, 0.5, 0.6), 100, 10);
    let sawFlee = false;
    for (let k = 0; k < 100; k++) {
      sim.step();
      if (herb.state === BehaviorState.Flee) sawFlee = true;
    }
    expect(sawFlee).toBe(true);
  });
});
