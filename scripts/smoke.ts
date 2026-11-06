// 快速冒烟：无头运行模拟，检查生态是否运转、数值是否稳定。
// 用法：npx vite-node scripts/smoke.ts [seed] [ticks]

import { Simulation } from '../src/sim/simulation';
import { LIMITS } from '../src/sim/config';
import { Species } from '../src/sim/constants';

const seed = Number(process.argv[2] ?? 12345);
const ticks = Number(process.argv[3] ?? 8000);
const preset = process.argv[4] ?? 'temperate';

const sim = new Simulation(seed, preset);
const t0 = Date.now();
let minCounts = [1e9, 1e9, 1e9, 1e9];
let maxCounts = [0, 0, 0, 0];
let nan = false;

for (let i = 0; i < ticks; i++) {
  sim.step();
  for (const c of sim.creatures) {
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.energy)) {
      nan = true;
      console.error(`NaN/Inf at tick ${sim.tick}: creature #${c.id}`, c.x, c.y, c.energy);
      break;
    }
  }
  if (nan) break;
  if (i % 200 === 0) {
    const counts = [0, 0, 0, 0];
    for (const c of sim.creatures) counts[c.species]++;
    for (let s = 0; s < 4; s++) {
      minCounts[s] = Math.min(minCounts[s], counts[s]);
      maxCounts[s] = Math.max(maxCounts[s], counts[s]);
    }
  }
}
const dt = Date.now() - t0;
const counts = [0, 0, 0, 0];
for (const c of sim.creatures) counts[c.species]++;
const totals = sim.world.totals();
const names = ['小食草', '大食草', '捕食者', '食腐者'];

console.log(`种子 ${seed} 预设 ${preset} 运行 ${ticks} tick，耗时 ${dt}ms（${(dt / ticks).toFixed(3)} ms/tick）`);
console.log(`最终种群: ${names.map((n, s) => `${n}=${counts[s]}`).join(' ')}`);
console.log(`种群范围: ${names.map((n, s) => `${n}=${minCounts[s]}~${maxCounts[s]}`).join(' ')}`);
console.log(`植物: 草=${totals.grass.toFixed(0)} 灌=${totals.shrub.toFixed(0)} 残骸=${totals.carcass.toFixed(0)}`);
console.log(`档案记录 ${sim.records.length}，谱系 ${sim.lineages.size}，事件 ${sim.events.length}`);
console.log(`NaN: ${nan ? '发现异常！' : '无'}`);
const lastStats = sim.stats[sim.stats.length - 1];
if (lastStats) {
  console.log(`性状均值(最后采样): ${lastStats.trait.map((t) => t.mean.toFixed(2)).join(' ')}`);
}
if (sim.creatures.length > 0) {
  const sample = sim.creatures[0];
  console.log(`样本个体 #${sample.id}: 能量=${sample.energy.toFixed(1)}/${sample.maxEnergy.toFixed(1)} 状态=${sample.reason}`);
}
void LIMITS;
void Species;
