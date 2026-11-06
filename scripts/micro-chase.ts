// 微测试：孤立环境下的追逐/逃跑机制验证。
import { Simulation } from '../src/sim/simulation';
import { Creature } from '../src/sim/creature';
import { Species } from '../src/sim/constants';
import type { Genes } from '../src/sim/types';

function genes(speed: number, size: number, sense: number): Genes {
  return { speed, size, sense, droughtTol: 0.5, reproInvest: 0.3, boldness: 0.5 };
}

const sim = new Simulation(777, 'temperate');
// 清空初始种群，只留测试个体
sim.creatures.length = 0;
sim.lineages.clear();

// 在中心区域放置：捕食者与小型食草者，距离 4 格
const cx = 40;
const cy = 30;
const pred = new Creature(Species.Predator, genes(0.68, 0.5, 0.6), cx, cy, 150, 1, 900001);
const herb = new Creature(Species.SmallHerb, genes(0.5, 0.45, 0.55), cx + 4, cy, 80, 2, 900002);
sim.creatures.push(pred, herb);

console.log('初始距离 4.0 格');
for (let i = 0; i < 600; i++) {
  sim.step();
  if (i % 60 === 0 || (i > 100 && i % 10 === 0)) {
    const d = Math.hypot(herb.x - pred.x, herb.y - pred.y);
    console.log(
      `t=${sim.tick} 距离=${d.toFixed(2)} 捕食者E=${pred.energy.toFixed(0)} v=(${pred.vx.toFixed(3)},${pred.vy.toFixed(3)}) |${pred.reason}| 猎物E=${herb.energy.toFixed(0)} |${herb.reason}|`,
    );
  }
  if (!herb.alive) {
    console.log(`→ 猎物在 t=${sim.tick} 被捕获（距离 ${Math.hypot(herb.x - pred.x, herb.y - pred.y).toFixed(2)}）`);
    break;
  }
  if (!pred.alive) {
    console.log(`→ 捕食者在 t=${sim.tick} 饿死`);
    break;
  }
}
console.log('计数器:', JSON.stringify(sim.counters));
