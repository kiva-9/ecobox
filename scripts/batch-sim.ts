// 批量生态实验：多种子无头运行，统计种群轨迹、灭绝、性状演化。
// 用法：npx vite-node scripts/batch-sim.ts [--seeds 10] [--ticks 100000] [--preset temperate] [--env wet|arid]
// 输出：每个种子的摘要 + 全部种子的汇总统计（写入 docs/VALIDATION.md 的数据来源）。

import { Simulation } from '../src/sim/simulation';
import { CHALLENGES } from '../src/sim/config';

interface Args {
  seeds: number;
  ticks: number;
  preset: string;
  mode: 'survival' | 'compare';
  seedBase: number;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (flag: string, def: number): number => {
    const i = a.indexOf(flag);
    return i >= 0 && a[i + 1] ? Number(a[i + 1]) : def;
  };
  const getStr = (flag: string, def: string): string => {
    const i = a.indexOf(flag);
    return i >= 0 && a[i + 1] ? a[i + 1] : def;
  };
  return {
    seeds: get('--seeds', 10),
    ticks: get('--ticks', 100000),
    preset: getStr('--preset', 'temperate'),
    mode: a.includes('--compare') ? 'compare' : 'survival',
    seedBase: get('--seedBase', 1000),
  };
}

interface RunResult {
  seed: number;
  finalCounts: number[];
  minCounts: number[];
  maxCounts: number[];
  extinctions: { species: number; tick: number }[];
  peakTotal: number;
  finalTotal: number;
  births: number;
  deaths: number;
  deathByCause: number[];
  traitMeans: number[];
  traitP90: number[];
  ms: number;
  nan: boolean;
  duplicateIds: boolean;
  badLineage: boolean;
  notes: string[];
}

function runOne(seed: number, ticks: number, preset: string): RunResult {
  const sim = new Simulation(seed, preset);
  const t0 = Date.now();
  const minCounts = [Infinity, Infinity, Infinity, Infinity];
  const maxCounts = [0, 0, 0, 0];
  const extinctions: { species: number; tick: number }[] = [];
  const seenExtinct = [false, false, false, false];
  let births = 0;
  let deaths = 0;
  const deathByCause = [0, 0, 0, 0];
  let nan = false;
  let duplicateIds = false;
  let badLineage = false;
  let peakTotal = 0;
  const notes: string[] = [];

  for (let i = 0; i < ticks; i++) {
    sim.step();
    // 异常检测
    if (i % 500 === 0) {
      const ids = new Set<number>();
      for (const c of sim.creatures) {
        if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.energy) || !Number.isFinite(c.age)) {
          nan = true;
          notes.push(`tick ${sim.tick}: 个体 #${c.id} 数值异常`);
        }
        if (ids.has(c.id)) duplicateIds = true;
        ids.add(c.id);
        if (c.generation < 0 || c.lineageId <= 0 || c.birthTick > sim.tick) badLineage = true;
      }
      const counts = [0, 0, 0, 0];
      for (const c of sim.creatures) counts[c.species]++;
      for (let s = 0; s < 4; s++) {
        minCounts[s] = Math.min(minCounts[s], counts[s]);
        maxCounts[s] = Math.max(maxCounts[s], counts[s]);
        if (counts[s] === 0 && !seenExtinct[s]) {
          seenExtinct[s] = true;
          extinctions.push({ species: s, tick: sim.tick });
        } else if (counts[s] > 0) {
          seenExtinct[s] = false;
        }
      }
      const total = counts[0] + counts[1] + counts[2] + counts[3];
      if (total > peakTotal) peakTotal = total;
    }
  }
  // 记录最终统计
  const counts = [0, 0, 0, 0];
  for (const c of sim.creatures) counts[c.species]++;
  births = sim.stats.reduce((s, x) => s + x.births, 0);
  deaths = sim.stats.reduce((s, x) => s + x.deaths, 0);
  for (const x of sim.stats) for (let k = 0; k < 4; k++) deathByCause[k] += x.deathByCause[k] ?? 0;
  const last = sim.stats[sim.stats.length - 1];
  return {
    seed,
    finalCounts: counts,
    minCounts,
    maxCounts,
    extinctions,
    peakTotal,
    finalTotal: counts[0] + counts[1] + counts[2] + counts[3],
    births,
    deaths,
    deathByCause,
    traitMeans: last ? last.trait.map((t) => t.mean) : [0, 0, 0, 0, 0, 0],
    traitP90: last ? last.trait.map((t) => t.p90) : [0, 0, 0, 0, 0, 0],
    ms: Date.now() - t0,
    nan,
    duplicateIds,
    badLineage,
    notes,
  };
}

function fmtCounts(c: number[]): string {
  return `小${c[0]} 大${c[1]} 捕${c[2]} 腐${c[3]}`;
}

function main(): void {
  const args = parseArgs();
  const names = ['小食草', '大食草', '捕食者', '食腐者'];
  console.log(`\n=== 批量生态实验：${args.seeds} 个种子 × ${args.ticks} tick，预设 ${args.preset} ===\n`);
  const results: RunResult[] = [];
  for (let i = 0; i < args.seeds; i++) {
    const seed = args.seedBase + i * 7919;
    const r = runOne(seed, args.ticks, args.preset);
    results.push(r);
    const ext = r.extinctions.length
      ? r.extinctions.map((e) => `${names[e.species]}@${e.tick}`).join(',')
      : '无';
    console.log(
      `种子 ${seed}: 最终[${fmtCounts(r.finalCounts)}] 范围[${fmtCounts(r.minCounts.map((v) => (v === Infinity ? 0 : v)))}~${fmtCounts(r.maxCounts)}] 峰值${r.peakTotal} 出生${r.births} 死亡${r.deaths} 灭绝:${ext} ${r.ms}ms`,
    );
    if (r.nan || r.duplicateIds || r.badLineage) console.log(`  !! 异常: NaN=${r.nan} 重复ID=${r.duplicateIds} 谱系错误=${r.badLineage}`);
    for (const n of r.notes.slice(0, 3)) console.log(`  note: ${n}`);
  }
  // 汇总
  const avg = (f: (r: RunResult) => number): number => results.reduce((s, r) => s + f(r), 0) / results.length;
  console.log(`\n--- 汇总（${results.length} 个种子）---`);
  console.log(`平均最终种群: ${fmtCounts([0, 1, 2, 3].map((s) => Math.round(avg((r) => r.finalCounts[s]))))}`);
  console.log(`平均峰值总数: ${Math.round(avg((r) => r.peakTotal))}，平均最终总数: ${Math.round(avg((r) => r.finalTotal))}`);
  console.log(`平均出生/死亡: ${Math.round(avg((r) => r.births))} / ${Math.round(avg((r) => r.deaths))}`);
  console.log(`平均死因(饿/老/捕食/脱水): ${[0, 1, 2, 3].map((k) => Math.round(avg((r) => r.deathByCause[k]))).join('/')}`);
  console.log(`平均耗时: ${Math.round(avg((r) => r.ms))}ms（${(avg((r) => r.ms) / args.ticks).toFixed(3)} ms/tick）`);
  const withExt = results.filter((r) => r.extinctions.length > 0).length;
  console.log(`发生过灭绝的种子: ${withExt}/${results.length}`);
  for (let s = 0; s < 4; s++) {
    const n = results.filter((r) => r.extinctions.some((e) => e.species === s)).length;
    console.log(`  ${names[s]} 灭绝种子数: ${n}/${results.length}`);
  }
  const bad = results.filter((r) => r.nan || r.duplicateIds || r.badLineage).length;
  console.log(`数值/ID/谱系异常种子数: ${bad}/${results.length}`);
  console.log(`\n性状均值(速度/体型/感知/耐旱/繁殖投入/胆量) 各种子:`);
  for (const r of results) console.log(`  种子 ${r.seed}: ${r.traitMeans.map((v) => v.toFixed(2)).join(' ')} | p90: ${r.traitP90.map((v) => v.toFixed(2)).join(' ')}`);

  if (args.mode === 'compare') {
    console.log(`\n=== 对照组说明：见 docs/VALIDATION.md 的环境对照实验 ===`);
    void CHALLENGES;
  }
}

main();
