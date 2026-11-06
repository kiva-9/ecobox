// 三关挑战：目标、限制、成功/失败判定、进度与结算。
// 判定全部基于模拟真实状态；测试与界面都不能直接改写胜利状态。

import { Species, toolIsIntervention } from './constants';
import type { ChallengeConfig } from './config';
import type { ChallengePublicState } from '../shared/protocol';
import type { Simulation } from './simulation';

export interface ChallengeRuntime {
  config: ChallengeConfig;
  status: 'briefing' | 'running' | 'success' | 'fail';
  interventionsLeft: number;
  /** A 关：连续达标 tick 数 */
  coexistTicks: number;
  failReason: string;
  note: string;
  /** C 关：目标谱系 */
  lineageId: number;
  droughtTriggered: boolean;
  startedTick: number;
  resultStats: {
    ticks: number;
    counts: number[];
    plants: number;
    maxGeneration: number;
    lineageAlive: number;
    naturalBirths: number;
  } | null;
}

/** 创建挑战运行时（世界已由 Simulation.startChallenge 生成） */
export function createChallenge(config: ChallengeConfig, sim: Simulation): ChallengeRuntime {
  const rt: ChallengeRuntime = {
    config,
    status: 'briefing',
    interventionsLeft: config.interventions,
    coexistTicks: 0,
    failReason: '',
    note: '准备开始',
    lineageId: -1,
    droughtTriggered: false,
    startedTick: sim.tick,
    resultStats: null,
  };
  if (config.id === 'lineage') {
    // 起始谱系：最靠近世界中心的 6 只小型食草者归为同一条谱系（一个创始群体）
    const cx = sim.world.width / 2;
    const cy = sim.world.height / 2;
    const herbs = sim.creatures
      .filter((c) => c.species === Species.SmallHerb)
      .map((c) => ({ c, d: (c.x - cx) ** 2 + (c.y - cy) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 6);
    if (herbs.length > 0) {
      const founder = herbs[0].c;
      rt.lineageId = founder.lineageId;
      for (const h of herbs) {
        const old = sim.lineages.get(h.c.lineageId);
        if (old && h.c.lineageId !== rt.lineageId) {
          // 合并谱系统计
          const target = sim.lineages.get(rt.lineageId);
          if (target) {
            target.aliveCount += old.aliveCount;
            target.totalBirths += old.totalBirths;
          }
          sim.lineages.delete(h.c.lineageId);
        }
        h.c.lineageId = rt.lineageId;
      }
      rt.note = `起始谱系：#${rt.lineageId}（创始群体 ${herbs.length} 只，核心 #${founder.id}）`;
    }
  }
  if (config.droughtStart !== undefined) {
    rt.note = `干旱将在开局 ${(config.droughtStart / 60).toFixed(0)} 秒后到来，持续约 ${((config.droughtLength ?? 0) / 60).toFixed(0)} 秒`;
  }
  return rt;
}

/** 确认开始（ briefing → running ） */
export function beginChallenge(rt: ChallengeRuntime): void {
  if (rt.status === 'briefing') rt.status = 'running';
}

/** 每 tick 评估 */
export function updateChallenge(rt: ChallengeRuntime, sim: Simulation): void {
  if (rt.status !== 'running') return;
  const cfg = rt.config;
  const elapsed = sim.tick - rt.startedTick;
  const counts = [0, 0, 0, 0];
  for (const c of sim.creatures) counts[c.species]++;
  const totals = sim.world.totals();
  const plants = totals.grass + totals.shrub;

  // B 关：脚本干旱
  if (cfg.droughtStart !== undefined && !rt.droughtTriggered && elapsed >= cfg.droughtStart) {
    rt.droughtTriggered = true;
    sim.startDrought(cfg.droughtLength ?? 3600);
    sim.pushEvent('challenge', '干旱来临（预定事件）', 0, 0);
  }

  // 失败：关键物种灭绝
  for (const g of cfg.goals) {
    if (counts[g.species] === 0) {
      fail(rt, sim, `${speciesName(g.species)}已灭绝`);
      return;
    }
  }

  if (cfg.id === 'guardian') {
    const allOk =
      cfg.goals.every((g) => counts[g.species] >= g.min) && plants >= cfg.plantGoal;
    if (allOk) {
      rt.coexistTicks++;
      const need = cfg.coexistTicks ?? 1800;
      rt.note = `共存持续 ${(rt.coexistTicks / 60).toFixed(1)} / ${(need / 60).toFixed(0)} 秒`;
      if (rt.coexistTicks >= need) {
        succeed(rt, sim, '生态在目标数量上保持了足够时间');
        return;
      }
    } else {
      rt.coexistTicks = 0;
      rt.note = '等待所有种群同时达到目标';
    }
    if (elapsed >= cfg.timeLimit) {
      fail(rt, sim, '未能在时限内让生态持续共存');
      return;
    }
  } else if (cfg.id === 'drought') {
    const allOk = cfg.goals.every((g) => counts[g.species] >= g.min) && plants >= cfg.plantGoal;
    // 只在干旱结束后的恢复期累计“持续达标”时间
    const droughtOver = rt.droughtTriggered && elapsed > (cfg.droughtStart ?? 0) + (cfg.droughtLength ?? 0);
    if (allOk && droughtOver) {
      rt.coexistTicks++;
      const need = cfg.coexistTicks ?? 1800;
      rt.note = `恢复持续 ${(rt.coexistTicks / 60).toFixed(1)} / ${(need / 60).toFixed(0)} 秒`;
      if (rt.droughtTriggered && rt.coexistTicks >= need) {
        succeed(rt, sim, '关键种群在干旱后持续恢复到目标范围');
        return;
      }
    } else {
      rt.coexistTicks = 0;
      rt.note = droughtOver
        ? `恢复未持续：距截止还有 ${Math.max(0, (cfg.timeLimit - elapsed) / 60).toFixed(0)} 秒`
        : rt.droughtTriggered
        ? `干旱后恢复中：距截止还有 ${Math.max(0, (cfg.timeLimit - elapsed) / 60).toFixed(0)} 秒`
        : `干旱将在 ${Math.max(0, ((cfg.droughtStart ?? 0) - elapsed) / 60).toFixed(0)} 秒后到来`;
    }
    if (elapsed >= cfg.timeLimit) {
      fail(rt, sim, '截止时间到达时种群未恢复到目标范围');
      return;
    }
  } else if (cfg.id === 'lineage') {
    const lineage = sim.lineages.get(rt.lineageId);
    let naturalAlive = 0;
    let maxGen = 0;
    if (lineage) {
      for (const c of sim.creatures) {
        if (c.lineageId !== rt.lineageId) continue;
        if (c.generation > maxGen) maxGen = c.generation;
        if (!c.artificial && c.generation >= 1) naturalAlive++;
      }
      maxGen = Math.max(maxGen, lineage.maxGeneration);
    }
    rt.note = `谱系 #${rt.lineageId}：最高第 ${maxGen} 代，自然存活后代 ${naturalAlive} / ${cfg.lineageAlive ?? 0}`;
    if (maxGen >= (cfg.lineageGenerations ?? 6) && naturalAlive >= (cfg.lineageAlive ?? 0)) {
      succeed(rt, sim, '谱系自然繁衍达到目标代数与数量');
      return;
    }
    if (lineage && lineage.aliveCount === 0) {
      fail(rt, sim, '谱系灭绝');
      return;
    }
    if (elapsed >= cfg.timeLimit) {
      fail(rt, sim, '未能在时限内达到繁衍目标');
      return;
    }
  }
}

function succeed(rt: ChallengeRuntime, sim: Simulation, note: string): void {
  rt.status = 'success';
  rt.failReason = '';
  rt.note = note;
  rt.resultStats = collectStats(sim, rt);
  sim.pushEvent('challenge', `挑战成功：${rt.config.name}（${note}）`, 0, 0);
}

function fail(rt: ChallengeRuntime, sim: Simulation, reason: string): void {
  rt.status = 'fail';
  rt.failReason = reason;
  rt.note = `失败：${reason}`;
  rt.resultStats = collectStats(sim, rt);
  sim.pushEvent('challenge', `挑战失败：${rt.config.name}（${reason}）`, 0, 0);
}

function collectStats(sim: Simulation, rt: ChallengeRuntime) {
  const counts = [0, 0, 0, 0];
  for (const c of sim.creatures) counts[c.species]++;
  const totals = sim.world.totals();
  const lineage = sim.lineages.get(rt.lineageId);
  return {
    ticks: sim.tick - rt.startedTick,
    counts,
    plants: totals.grass + totals.shrub,
    maxGeneration: lineage?.maxGeneration ?? 0,
    lineageAlive: lineage?.aliveCount ?? 0,
    naturalBirths: lineage?.totalBirths ?? 0,
  };
}

/** 界面可见的挑战状态 */
export function challengePublic(rt: ChallengeRuntime, sim: Simulation): ChallengePublicState {
  const counts = [0, 0, 0, 0];
  for (const c of sim.creatures) counts[c.species]++;
  const totals = sim.world.totals();
  const plants = totals.grass + totals.shrub;
  const goals: ChallengePublicState['goals'] = [];
  for (const g of rt.config.goals) {
    goals.push({
      label: `${speciesName(g.species)}存活数`,
      current: counts[g.species],
      target: g.min,
      ok: counts[g.species] >= g.min,
    });
  }
  if (rt.config.plantGoal > 0) {
    goals.push({ label: '植物总生物量', current: Math.round(plants), target: rt.config.plantGoal, ok: plants >= rt.config.plantGoal });
  }
  if (rt.config.id === 'lineage') {
    const lineage = sim.lineages.get(rt.lineageId);
    let naturalAlive = 0;
    let maxGen = 0;
    for (const c of sim.creatures) {
      if (c.lineageId !== rt.lineageId) continue;
      if (c.generation > maxGen) maxGen = c.generation;
      if (!c.artificial && c.generation >= 1) naturalAlive++;
    }
    goals.push({ label: '自然存活后代', current: naturalAlive, target: rt.config.lineageAlive ?? 0, ok: naturalAlive >= (rt.config.lineageAlive ?? 0) });
    goals.push({ label: '谱系最高代数', current: Math.max(maxGen, lineage?.maxGeneration ?? 0), target: rt.config.lineageGenerations ?? 0, ok: Math.max(maxGen, lineage?.maxGeneration ?? 0) >= (rt.config.lineageGenerations ?? 0) });
  }
  const need = rt.config.coexistTicks ?? 0;
  return {
    id: rt.config.id,
    name: rt.config.name,
    brief: rt.config.brief,
    status: rt.status,
    goals,
    interventionsLeft: rt.interventionsLeft,
    ticksLeft: Math.max(0, rt.config.timeLimit - (sim.tick - rt.startedTick)),
    coexistProgress: need > 0 ? Math.min(1, rt.coexistTicks / need) : 0,
    note: rt.note + (rt.status === 'fail' ? `（${rt.failReason}）` : ''),
  };
}

export function serializeChallengeRuntime(rt: ChallengeRuntime): unknown {
  return {
    configId: rt.config.id,
    status: rt.status,
    interventionsLeft: rt.interventionsLeft,
    coexistTicks: rt.coexistTicks,
    failReason: rt.failReason,
    note: rt.note,
    lineageId: rt.lineageId,
    droughtTriggered: rt.droughtTriggered,
    startedTick: rt.startedTick,
    resultStats: rt.resultStats,
  };
}

export function deserializeChallengeRuntime(data: unknown): ChallengeRuntime | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const cfg = CHALLENGE_BY_ID[String(d.configId)];
  if (!cfg) return null;
  return {
    config: cfg,
    status: (d.status as ChallengeRuntime['status']) ?? 'running',
    interventionsLeft: Number(d.interventionsLeft) ?? 0,
    coexistTicks: Number(d.coexistTicks) ?? 0,
    failReason: String(d.failReason ?? ''),
    note: String(d.note ?? ''),
    lineageId: Number(d.lineageId) ?? -1,
    droughtTriggered: !!d.droughtTriggered,
    startedTick: Number(d.startedTick) ?? 0,
    resultStats: (d.resultStats as ChallengeRuntime['resultStats']) ?? null,
  };
}

import { CHALLENGES } from './config';
import { speciesName } from './constants';
const CHALLENGE_BY_ID: Record<string, ChallengeConfig> = Object.fromEntries(CHALLENGES.map((c) => [c.id, c]));

export { toolIsIntervention };
