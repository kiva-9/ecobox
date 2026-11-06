// 界面通用格式化与小型纯函数。只读 sim 常量，不持有状态。

import { WORLD } from '../sim/config';
import type { Genes, StatsSample } from '../sim/types';

export const VERSION = 'v1.0.0';

/** 千分位 */
export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('zh-CN');
}

export function fmtFixed(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

/** tick → 「第 N 天」 */
export function dayOf(tick: number): number {
  return Math.floor(tick / WORLD.dayLength) + 1;
}

/** dayPhase 0..1 → 昼/夜（光照曲线在 dayPhase=0.5 达到峰值，0.25/0.75 为晨昏线） */
export function isDaytime(dayPhase: number): boolean {
  return dayPhase > 0.25 && dayPhase < 0.75;
}

/** 由实际光照值判断昼夜（更可靠，直接反映画面明暗） */
export function isDaytimeLight(light: number): boolean {
  return light > 0.45;
}

/** tick → 秒（1× = 60 tick/s） */
export function ticksToSeconds(ticks: number): number {
  return ticks / WORLD.ticksPerSecond;
}

/** 秒 → 「45 秒」/「2 分 05 秒」 */
export function fmtSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m} 分 ${String(r).padStart(2, '0')} 秒`;
}

/** tick → 「1 分 20 秒」 */
export function fmtTicksAsTime(ticks: number): string {
  return fmtSeconds(ticksToSeconds(ticks));
}

/** 存档时间戳 → 本地日期时间 */
export function fmtClock(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (v: number): string => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 基因值 0..1 → 百分比文本 */
export function fmtGene(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** 六项基因的一行紧凑摘要 */
export function geneSummary(g: Genes): string {
  return `速${g.speed.toFixed(2)} 体${g.size.toFixed(2)} 感${g.sense.toFixed(2)} 旱${g.droughtTol.toFixed(2)} 繁${g.reproInvest.toFixed(2)} 胆${g.boldness.toFixed(2)}`;
}

/** 进度百分比 */
export function pct(current: number, target: number): number {
  if (target <= 0) return current > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, (current / target) * 100));
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 由事件文本猜一个分类（渲染器/模拟事件类型尚未冻结，按关键词兜底） */
export type EventCategory = 'birth' | 'death' | 'climate' | 'lineage' | 'challenge' | 'world' | 'info';

export function eventCategory(type: string, text: string): EventCategory {
  const s = `${type} ${text}`.toLowerCase();
  if (s.includes('出生') || s.includes('繁殖') || s.includes('birth')) return 'birth';
  if (s.includes('死') || s.includes('捕食') || s.includes('饿') || s.includes('脱水') || s.includes('衰老') || s.includes('death')) return 'death';
  if (s.includes('干旱') || s.includes('降雨') || s.includes('雨') || s.includes('气候') || s.includes('drought') || s.includes('rain')) return 'climate';
  if (s.includes('谱系') || s.includes('灭绝') || s.includes('lineage')) return 'lineage';
  if (s.includes('挑战') || s.includes('目标') || s.includes('结算') || s.includes('challenge')) return 'challenge';
  if (s.includes('世界') || s.includes('导入') || s.includes('保存') || s.includes('world')) return 'world';
  return 'info';
}

/** 取最近 N 个统计采样（不足时返回全部） */
export function recentStats(stats: StatsSample[], n: number): StatsSample[] {
  if (stats.length <= n) return stats;
  return stats.slice(stats.length - n);
}

/** 依据 savedAt/tick 生成导出文件名 */
export function exportFilename(presetId: string, seed: number, tick: number): string {
  return `ecobox-${presetId}-${seed}-t${tick}.json`;
}
