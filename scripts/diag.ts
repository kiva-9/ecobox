// 诊断：追踪指定物种个体的能量/状态随时间变化，定位灭绝原因。
import { Simulation } from '../src/sim/simulation';
import { Species } from '../src/sim/constants';

const seed = Number(process.argv[2] ?? 12345);
const ticks = Number(process.argv[3] ?? 3000);
const watch = Number(process.argv[4] ?? Species.Predator);

const sim = new Simulation(seed, 'temperate');
const tracked = new Map<number, { lastEnergy: number; lastState: string }>();
for (const c of sim.creatures) {
  if (c.species === watch) tracked.set(c.id, { lastEnergy: c.energy, lastState: c.reason });
}
console.log(`初始 ${watch === 2 ? '捕食者' : watch === 3 ? '食腐者' : '其他'} ${tracked.size} 只`);

for (let i = 0; i < ticks; i++) {
  sim.step();
  if (i % 300 === 0) {
    const alive = sim.creatures.filter((c) => c.species === watch);
    const lines: string[] = [];
    for (const c of alive.slice(0, 4)) {
      lines.push(`#${c.id} E=${c.energy.toFixed(0)}/${c.maxEnergy.toFixed(0)} age=${c.age} ${c.reason}`);
    }
    const preyNear = sim.creatures.filter((c) => c.species === Species.SmallHerb).length;
    console.log(`t=${sim.tick} 存活=${alive.length} 小食草=${preyNear} ${lines.join(' | ')}`);
    if (alive.length === 0 && i > 100) {
      console.log(`→ 在 t=${sim.tick} 附近灭绝`);
      break;
    }
  }
}
// 死因统计
const recs = sim.records.filter((r) => r.species === watch);
const causes = new Map<number, number>();
for (const r of recs) causes.set(r.cause, (causes.get(r.cause) ?? 0) + 1);
console.log('计数器:', JSON.stringify(sim.counters));
console.log('死因分布(0饿死1衰老2被捕食3脱水):', [...causes.entries()]);
console.log('平均寿命:', recs.length ? (recs.reduce((s, r) => s + (r.deathTick - r.birthTick), 0) / recs.length).toFixed(0) : 'n/a');
