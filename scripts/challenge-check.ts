// 挑战验证：无头运行三关挑战，测量自然结果与不同干预策略下的成败。
// 用法：npx vite-node scripts/challenge-check.ts [guardian|drought|lineage|all]

import { Simulation } from '../src/sim/simulation';
import { CHALLENGES, challengeById } from '../src/sim/config';
import { Tool, Species } from '../src/sim/constants';
import { beginChallenge } from '../src/sim/challenges';

/** 反应式合理玩家：根据实时种群状态使用干预（模拟一个会玩的玩家） */
let lastInterveneTick = -9999;
function reactivePlayer(sim: Simulation, id: string): void {
  // 全局干预冷却：避免频繁消耗配额（玩家也会珍惜干预次数）
  if (sim.tick - lastInterveneTick < 200) return;
  const counts = [0, 0, 0, 0];
  let cx = 64;
  let cy = 40;
  for (const c of sim.creatures) {
    counts[c.species]++;
    cx += (c.x - cx) * 0.001;
    cy += (c.y - cy) * 0.001;
  }
  const tx = Math.floor(cx);
  const ty = Math.floor(cy);
  const totals = sim.world.totals();
  const plants = totals.grass + totals.shrub;
  const droughtActive = sim.droughtIntensity > 0.2;

  if (id === 'guardian') {
    // 生态修复顺序：先恢复植物与食草动物，再补捕食者（否则捕食者只会饿死）
    if (plants < 150000) { if (sim.intervene(Tool.PlantGrass, tx, ty, 5, null).ok) lastInterveneTick = sim.tick; }
    else if (counts[0] < 150) { if (sim.intervene(Tool.SpawnSmallHerb, tx, ty, 1, null).ok) lastInterveneTick = sim.tick; }
    else if (counts[1] < 30) { if (sim.intervene(Tool.SpawnLargeHerb, tx, ty, 1, null).ok) lastInterveneTick = sim.tick; }
    else if (counts[2] < 10) { if (sim.intervene(Tool.SpawnPredator, tx, ty, 1, null).ok) lastInterveneTick = sim.tick; }
    else if (droughtActive || sim.rainfall < 0.08) { if (sim.intervene(Tool.Rain, tx, ty, 3, null).ok) lastInterveneTick = sim.tick; }
    return;
  }
  if (id === 'drought') {
    // 干旱来临前：降雨蓄水（仅一次）
    if (sim.tick < 900 && sim.tick > 300) { if (sim.intervene(Tool.Rain, tx, ty, 5, null).ok) lastInterveneTick = sim.tick; return; }
    // 干旱中：持续降雨保住植物；捕食者危急时补充
    if (droughtActive) {
      if (counts[2] < 4) { if (sim.intervene(Tool.SpawnPredator, tx, ty, 1, null).ok) lastInterveneTick = sim.tick; }
      else { if (sim.intervene(Tool.Rain, tx, ty, 5, null).ok) lastInterveneTick = sim.tick; }
      return;
    }
    // 干旱后：按目标补齐
    if (counts[2] < 6) { if (sim.intervene(Tool.SpawnPredator, tx, ty, 1, null).ok) lastInterveneTick = sim.tick; }
    else if (counts[1] < 25) { if (sim.intervene(Tool.SpawnLargeHerb, tx, ty, 1, null).ok) lastInterveneTick = sim.tick; }
    else if (counts[0] < 100) { if (sim.intervene(Tool.SpawnSmallHerb, tx, ty, 1, null).ok) lastInterveneTick = sim.tick; }
    else if (plants < 150000) { if (sim.intervene(Tool.PlantGrass, tx, ty, 4, null).ok) lastInterveneTick = sim.tick; }
    return;
  }
  if (id === 'lineage') {
    // 保护起始谱系：在其聚集地补充食物与水源
    const lineageId = sim.challenge?.lineageId ?? -1;
    let lx = 0;
    let ly = 0;
    let ln = 0;
    for (const c of sim.creatures) {
      if (c.lineageId === lineageId) { lx += c.x; ly += c.y; ln++; }
    }
    if (ln > 0) { lx /= ln; ly /= ln; }
    const ltx = Math.floor(lx);
    const lty = Math.floor(ly);
    const localGrass = (() => {
      let g = 0;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const x = ltx + dx; const y = lty + dy;
        if (sim.world.inBounds(x, y)) g += sim.world.grass[sim.world.idx(x, y)];
      }
      return g;
    })();
    if (droughtActive) { if (sim.intervene(Tool.Rain, ltx, lty, 5, null).ok) lastInterveneTick = sim.tick; return; }
    // 把食物种在远离谱系的地方：聚食诱捕，让捕食者远离谱系
    if (localGrass < 400) {
      const dx = ltx > 64 ? -22 : 22;
      const dy = lty > 40 ? -18 : 18;
      if (sim.intervene(Tool.PlantGrass, ltx + dx, lty + dy, 5, null).ok) lastInterveneTick = sim.tick;
      return;
    }
    if (sim.rainfall < 0.08) { if (sim.intervene(Tool.Rain, ltx, lty, 4, null).ok) lastInterveneTick = sim.tick; return; }
    if (ln < 12) { if (sim.intervene(Tool.SpawnSmallHerb, ltx, lty, 1, null).ok) lastInterveneTick = sim.tick; }
    return;
  }
}

/** 错误玩家策略：演示真实的失败路径（误操作与放任） */
function badPlayer(sim: Simulation, id: string): void {
  if (sim.tick - lastInterveneTick < 200) return;
  if (id === 'drought') {
    // 激烈误操作：连续触发干旱且不降雨抗旱（已验证导致捕食者灭绝）
    if (sim.tick === 1200 || sim.tick === 2400 || sim.tick === 3600 || sim.tick === 4800 || sim.tick === 6000 || sim.tick === 7200 || sim.tick === 8400 || sim.tick === 9600) {
      if (sim.intervene(Tool.Drought, 64, 40, 1, null).ok) lastInterveneTick = sim.tick;
    }
    return;
  }
  if (id === 'lineage') {
    // 用尽干预造成破坏：连续投放 5 只捕食者压制谱系
    if (sim.tick === 2000 || sim.tick === 4000 || sim.tick === 6000 || sim.tick === 8000 || sim.tick === 10000) {
      if (sim.intervene(Tool.SpawnPredator, 64, 40, 1, null).ok) lastInterveneTick = sim.tick;
    }
    return;
  }
  if (id === 'guardian') {
    // 反复触发干旱，耗尽干预配额
    if (sim.tick % 3000 === 0) { if (sim.intervene(Tool.Drought, 64, 40, 1, null).ok) lastInterveneTick = sim.tick; }
    return;
  }
}

function runChallenge(id: string, withPlayer: boolean): void {
  const sim = Simulation.startChallenge(id);
  const cfg = challengeById(id);
  if (!cfg) return;
  if (sim.challenge) beginChallenge(sim.challenge); // 确认简报，正式开始
  const strategy = withPlayer ? (sim: Simulation) => reactivePlayer(sim, id) : undefined;
  let successTick = -1;
  let failReason = '';
  const minCounts = [Infinity, Infinity, Infinity, Infinity];
  let minPlants = Infinity;
  for (let t = 0; t < cfg.timeLimit + 5000; t++) {
    if (strategy && sim.tick % 60 === 0) strategy(sim); // 每 60 tick 评估一次（约 1 秒）
    sim.step();
    if (t % 100 === 0) {
      const counts = [0, 0, 0, 0];
      for (const c of sim.creatures) counts[c.species]++;
      for (let s = 0; s < 4; s++) minCounts[s] = Math.min(minCounts[s], counts[s]);
      const totals = sim.world.totals();
      minPlants = Math.min(minPlants, totals.grass + totals.shrub);
    }
    if (sim.challenge?.status === 'success') { successTick = sim.tick; break; }
    if (sim.challenge?.status === 'fail') { failReason = sim.challenge.failReason; break; }
  }
  const rt = sim.challenge;
  const counts = [0, 0, 0, 0];
  for (const c of sim.creatures) counts[c.species]++;
  const totals = sim.world.totals();
  const result = rt?.status === 'success' ? `✅ 成功 @tick ${successTick}` : rt?.status === 'fail' ? `❌ 失败（${failReason}）@tick ${sim.tick}` : `⏱ 超时未决`;
  console.log(
    `[${id}] ${withPlayer ? '合理干预' : '无干预  '} → ${result} | 最终[小${counts[0]} 大${counts[1]} 捕${counts[2]} 腐${counts[3]}] 植物${(totals.grass + totals.shrub).toFixed(0)} | 过程最小[小${minCounts[0] === Infinity ? 0 : minCounts[0]} 捕${minCounts[2] === Infinity ? 0 : minCounts[2]}] 最小植物${minPlants === Infinity ? 0 : minPlants.toFixed(0)}`,
  );
}

const which = process.argv[2] ?? 'all';
for (const cfg of CHALLENGES) {
  if (which !== 'all' && which !== cfg.id) continue;
  runChallenge(cfg.id, false);
  runChallenge(cfg.id, true);
  // 失败路径验证：错误策略
  const sim = Simulation.startChallenge(cfg.id);
  if (sim.challenge) beginChallenge(sim.challenge);
  let failReason = '';
  for (let t = 0; t < cfg.timeLimit + 2000; t++) {
    if (sim.tick % 60 === 0) badPlayer(sim, cfg.id);
    sim.step();
    if (sim.challenge?.status === 'fail') { failReason = sim.challenge.failReason; break; }
    if (sim.challenge?.status === 'success') { failReason = '意外成功'; break; }
  }
  const counts = [0, 0, 0, 0];
  for (const c of sim.creatures) counts[c.species]++;
  console.log(`[${cfg.id}] 错误策略   → ${failReason ? `❌ ${failReason} @tick ${sim.tick}` : '未触发失败（异常）'} | 最终[小${counts[0]} 大${counts[1]} 捕${counts[2]} 腐${counts[3]}]`);
}
void Species;
