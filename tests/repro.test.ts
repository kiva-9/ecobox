// 可复现性与存档测试：同种子一致、存档续推一致、倍速一致、导入校验。
import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { parseSaveText, validateSave } from '../src/sim/serialize';
import { Tool } from '../src/sim/constants';
import type { SaveFile } from '../src/shared/protocol';

/** 每个 Simulation 拥有独立 ID 序列，直接创建即可 */
function freshSim(seed: number, preset = 'temperate'): Simulation {
  return new Simulation(seed, preset);
}

/** 提取关键状态（排除渲染/时间等无关字段） */
function keyState(sim: Simulation): string {
  const parts: string[] = [];
  parts.push(`tick=${sim.tick}`);
  parts.push(`rng=${sim.rng.getState().join(',')}`);
  const cs = sim.creatures.map((c) =>
    `${c.id}:${c.species}:${c.x.toFixed(6)}:${c.y.toFixed(6)}:${c.energy.toFixed(6)}:${c.age}:${c.state}:${c.genes.speed.toFixed(6)}:${c.genes.size.toFixed(6)}`,
  );
  parts.push(`creatures=${cs.join('|')}`);
  const t = sim.world.totals();
  parts.push(`plants=${t.grass.toFixed(4)},${t.shrub.toFixed(4)},${t.carcass.toFixed(4)}`);
  parts.push(`lineages=${sim.lineages.size}`);
  return parts.join('\n');
}

describe('可复现性', () => {
  it('同种子 + 相同干预序列 → 一致关键状态', () => {
    const a = freshSim(777001);
    const b = freshSim(777001);
    const interventions: [number, number, number][] = [
      [Tool.PlantGrass, 40, 40],
      [Tool.Rain, 50, 30],
      [Tool.SpawnPredator, 60, 45],
      [Tool.PaintWater, 20, 20],
      [Tool.Drought, 70, 50],
    ];
    for (let k = 0; k < 3000; k++) {
      a.step();
      b.step();
      if (k === 500 || k === 1500 || k === 2500) {
        const [tool, tx, ty] = interventions[(k / 1000) | 0] ?? interventions[0];
        a.intervene(tool, tx, ty, 2, null);
        b.intervene(tool, tx, ty, 2, null);
      }
    }
    expect(keyState(a)).toBe(keyState(b));
  });

  it('不同种子 → 不同状态', () => {
    const a = freshSim(777001);
    const b = freshSim(777002);
    for (let k = 0; k < 2000; k++) {
      a.step();
      b.step();
    }
    expect(keyState(a)).not.toBe(keyState(b));
  });

  it('存档后续推：保存→继续 与 恢复→继续 一致', () => {
    const sim = freshSim(777003);
    for (let k = 0; k < 2500; k++) sim.step();
    const save: SaveFile = sim.toSaveData();
    // 路径 A：从当前状态继续
    for (let k = 0; k < 1500; k++) sim.step();
    const stateA = keyState(sim);
    // 路径 B：恢复存档后继续相同步数
    const restored = Simulation.fromSave(JSON.parse(JSON.stringify(save)) as SaveFile);
    for (let k = 0; k < 1500; k++) restored.step();
    const stateB = keyState(restored);
    expect(stateB).toBe(stateA);
  });

  it('1× 与倍速到达同一 tick：关键状态一致', () => {
    const slow = freshSim(777004);
    const fast = freshSim(777004);
    fast.speed = 10;
    // 慢速：1000 次单步
    for (let k = 0; k < 1000; k++) slow.step();
    // 快速：100 轮 × 10 步（模拟倍速推进的固定步累加）
    for (let k = 0; k < 100; k++) {
      for (let s = 0; s < 10; s++) fast.step();
    }
    expect(fast.tick).toBe(slow.tick);
    expect(keyState(fast)).toBe(keyState(slow));
  });

  it('干预只在整数 tick 边界生效且可复现', () => {
    const a = freshSim(777005);
    const b = freshSim(777005);
    for (let k = 0; k < 1200; k++) {
      a.step();
      b.step();
      if (k === 600) {
        a.intervene(Tool.PlantGrass, 45, 45, 3, null);
        b.intervene(Tool.PlantGrass, 45, 45, 3, null);
      }
    }
    expect(keyState(a)).toBe(keyState(b));
    expect(a.tick).toBe(1200);
  });
});

describe('存档校验', () => {
  const goodSave = (): SaveFile => {
    const sim = freshSim(777006);
    for (let k = 0; k < 800; k++) sim.step();
    return sim.toSaveData();
  };

  it('合法存档通过校验', () => {
    const v = validateSave(goodSave());
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it('拒绝错误格式', () => {
    expect(validateSave({ format: 'other' }).ok).toBe(false);
    expect(validateSave(null).ok).toBe(false);
    expect(validateSave('not an object').ok).toBe(false);
  });

  it('拒绝错误版本', () => {
    const s = goodSave();
    (s as unknown as { version: number }).version = 99;
    const v = validateSave(s);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes('版本'))).toBe(true);
  });

  it('拒绝数组长度不符', () => {
    const s = goodSave();
    s.grass = s.grass.slice(0, 100);
    const v = validateSave(s);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes('青草'))).toBe(true);
  });

  it('拒绝非法数值（NaN / 越界基因 / 重复 ID）', () => {
    const s1 = goodSave();
    s1.moisture[10] = Number.NaN;
    expect(validateSave(s1).ok).toBe(false);

    const s2 = goodSave();
    if (s2.creatures.length > 0) s2.creatures[0].genes.speed = 5;
    expect(validateSave(s2).ok).toBe(false);

    const s3 = goodSave();
    if (s3.creatures.length > 1) s3.creatures[1].id = s3.creatures[0].id;
    expect(validateSave(s3).ok).toBe(false);
  });

  it('拒绝未知挑战引用', () => {
    const s = goodSave();
    (s as unknown as { challenge: unknown }).challenge = { configId: 'not-a-challenge' };
    const v = validateSave(s);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes('挑战'))).toBe(true);
  });

  it('parseSaveText：JSON 解析失败有明确错误', () => {
    const r = parseSaveText('{ broken json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('JSON');
  });

  it('parseSaveText：过大文件被拒绝', () => {
    const huge = 'x'.repeat(70 * 1024 * 1024);
    const r = parseSaveText(huge);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('过大');
  });

  it('存档往返：JSON 序列化后可恢复且状态一致', () => {
    const sim = freshSim(777007);
    for (let k = 0; k < 1200; k++) sim.step();
    const save = sim.toSaveData();
    const json = JSON.stringify(save);
    const parsed = parseSaveText(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const restored = Simulation.fromSave(parsed.data);
    // 恢复后推进相同步数，与直接推进一致
    for (let k = 0; k < 500; k++) sim.step();
    for (let k = 0; k < 500; k++) restored.step();
    expect(keyState(restored)).toBe(keyState(sim));
  });

  it('挑战存档带挑战状态，可恢复', () => {
    const sim = Simulation.startChallenge('guardian');
    for (let k = 0; k < 600; k++) sim.step();
    const save = sim.toSaveData();
    expect(save.mode).toBe('challenge');
    expect(save.challengeId).toBe('guardian');
    const json = JSON.stringify(save);
    const parsed = parseSaveText(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const restored = Simulation.fromSave(parsed.data);
    expect(restored.mode).toBe('challenge');
    expect(restored.challenge?.config.id).toBe('guardian');
  });
});
