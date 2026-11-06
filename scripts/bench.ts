// 性能基准：无头测量模拟核心的每 tick 耗时（不同生物数量）。
// 用法：npx vite-node scripts/bench.ts [--creatures 400] [--ticks 10000]

import { Simulation } from '../src/sim/simulation';
import { Creature } from '../src/sim/creature';
import { randomGenes } from '../src/sim/types';
import { RNG } from '../src/sim/rng';
import { Species, isPassableTerrain } from '../src/sim/constants';
import { LIMITS } from '../src/sim/config';

function parse(): { creatures: number; ticks: number } {
  const a = process.argv.slice(2);
  const get = (f: string, d: number): number => {
    const i = a.indexOf(f);
    return i >= 0 && a[i + 1] ? Number(a[i + 1]) : d;
  };
  return { creatures: get('--creatures', 400), ticks: get('--ticks', 10000) };
}

function bench(label: string, creatureCount: number, ticks: number): void {
  const sim = new Simulation(999, 'temperate');
  if (creatureCount > 0) {
    // 清空并填充到目标数量（按物种混合）
    sim.creatures.length = 0;
    sim.lineages.clear();
    const rng = new RNG(4242);
    let guard = 0;
    while (sim.creatures.length < creatureCount && guard++ < creatureCount * 50) {
      const tx = Math.floor(rng.next() * sim.world.width);
      const ty = Math.floor(rng.next() * sim.world.height);
      if (!isPassableTerrain(sim.world.terrain[sim.world.idx(tx, ty)])) continue;
      const roll = rng.next();
      const sp = roll < 0.6 ? Species.SmallHerb : roll < 0.8 ? Species.LargeHerb : roll < 0.92 ? Species.Predator : Species.Scavenger;
      const c = new Creature(sp, randomGenes(rng, sp), tx + 0.5, ty + 0.5, 80, 1, 100000 + sim.creatures.length);
      sim.creatures.push(c);
    }
  }
  // 预热
  for (let i = 0; i < 300; i++) sim.step();
  // 分三段测量
  const phases: { label: string; ms: number; ticks: number; n: number }[] = [];
  const per = Math.floor(ticks / 3);
  for (let ph = 0; ph < 3; ph++) {
    const t0 = performance.now();
    for (let i = 0; i < per; i++) sim.step();
    const dt = performance.now() - t0;
    phases.push({ label: `第${ph + 1}段`, ms: dt, ticks: per, n: sim.creatures.length });
  }
  const totalMs = phases.reduce((s, p) => s + p.ms, 0);
  console.log(`${label}:`);
  for (const p of phases) {
    console.log(`  ${p.label}: ${p.n} 个体，${(p.ms / p.ticks).toFixed(3)} ms/tick（${(1000 / (p.ms / p.ticks)).toFixed(0)} tick/s 理论上限）`);
  }
  console.log(`  合计 ${totalMs.toFixed(0)}ms / ${ticks} tick`);
}

const { creatures, ticks } = parse();
console.log('=== 模拟核心性能基准（Node 无头，无渲染；浏览器中另有 PixiJS 渲染开销） ===');
console.log(`环境: Node ${process.version} / ${process.platform} ${process.arch}`);
bench(`任务基准 ${creatures} 生物（128×80 地形）`, creatures, ticks);
bench('高密度压力 1000 生物', 1000, Math.min(ticks, 6000));
bench('默认规模（温带预设初始种群）', 0, ticks);
void LIMITS;
