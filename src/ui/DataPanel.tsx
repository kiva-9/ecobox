// 数据面板：种群曲线 / 死因分布 / 性状分布 / 事件日志。
// 图表全部用 canvas 手绘（不依赖图表库）。

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useSyncExternalStore } from 'react';
import { client } from '../game/client';
import { GENE_DEFS } from '../sim/config';
import type { StatsSample } from '../sim/types';
import { PALETTE } from '../shared/protocol';
import { PixelIcon } from './sprites';
import type { SpriteName } from './sprites';
import { eventCategory, fmtInt, recentStats } from './format';

const INK = PALETTE.ink;
const INK_SOFT = '#6a5f50';
const GRID = 'rgba(43,38,32,0.16)';
const FONT = '10px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

// ---------------------------------------------------------------- canvas 基础

interface ChartSize {
  w: number;
  h: number;
}

function useChartCanvas(height: number): { ref: RefObject<HTMLCanvasElement | null>; size: ChartSize } {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<ChartSize>({ w: 0, h: height });
  useEffect(() => {
    const canvas = ref.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const measure = (): void => {
      const w = parent.clientWidth;
      setSize((prev) => (prev.w === w && prev.h === height ? prev : { w, h: height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [height]);
  return { ref, size };
}

function prepareCanvas(
  ref: RefObject<HTMLCanvasElement | null>,
  size: ChartSize,
): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const canvas = ref.current;
  if (!canvas || size.w <= 0) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = size.w;
  const h = size.h;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function niceCeil(v: number): number {
  if (v <= 10) return 10;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const n = v / base;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * base;
}

/** 坐标轴紧凑数字：12345 → 12k */
function compact(v: number): string {
  if (Math.abs(v) >= 10000) return `${Math.round(v / 1000)}k`;
  return String(v);
}

// ---------------------------------------------------------------- 种群曲线

const POP_SERIES = [
  { label: '小食草', color: PALETTE.speciesDark[0] },
  { label: '大食草', color: PALETTE.speciesDark[1] },
  { label: '捕食者', color: PALETTE.speciesDark[2] },
  { label: '食腐者', color: PALETTE.speciesDark[3] },
  { label: '植物生物量', color: PALETTE.accent2 },
];

function PopulationChart({ stats }: { stats: StatsSample[] }): React.ReactElement {
  const [visible, setVisible] = useState<boolean[]>([true, true, true, true, true]);
  const { ref, size } = useChartCanvas(150);
  const rows = useMemo(
    () => stats.map((s) => [s.counts[0] ?? 0, s.counts[1] ?? 0, s.counts[2] ?? 0, s.counts[3] ?? 0, s.plants ?? 0]),
    [stats],
  );

  useEffect(() => {
    const c = prepareCanvas(ref, size);
    if (!c) return;
    const { ctx, w, h } = c;
    const padL = 42;
    const padR = 40;
    const padT = 8;
    const padB = 16;
    const iw = w - padL - padR;
    const ih = h - padT - padB;
    // 植物生物量用独立右轴（数量级与动物计数差别大）
    let maxCount = 10;
    let maxPlant = 10;
    for (let si = 0; si < 4; si++) {
      if (!visible[si]) continue;
      for (const row of rows) if (row[si] > maxCount) maxCount = row[si];
    }
    if (visible[4]) {
      for (const row of rows) if (row[4] > maxPlant) maxPlant = row[4];
    }
    maxCount = niceCeil(maxCount);
    maxPlant = niceCeil(maxPlant);

    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    for (let g = 0; g <= 4; g++) {
      const y = padT + ih - (ih * g) / 4;
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, Math.round(y) + 0.5);
      ctx.lineTo(padL + iw, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.fillStyle = INK_SOFT;
      ctx.textAlign = 'right';
      ctx.fillText(compact(Math.round((maxCount * g) / 4)), padL - 5, y);
      if (visible[4]) {
        ctx.fillStyle = PALETTE.accent2;
        ctx.textAlign = 'left';
        ctx.fillText(compact(Math.round((maxPlant * g) / 4)), padL + iw + 5, y);
      }
    }

    const n = rows.length;
    const xOf = (i: number): number => padL + (n <= 1 ? 0 : (iw * i) / (n - 1));
    const yCount = (v: number): number => padT + ih - (ih * Math.min(v, maxCount)) / maxCount;
    const yPlant = (v: number): number => padT + ih - (ih * Math.min(v, maxPlant)) / maxPlant;

    // 植物生物量：面积 + 线（右轴）
    if (visible[4]) {
      ctx.fillStyle = 'rgba(79,125,74,0.16)';
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = xOf(i);
        const y = yPlant(rows[i][4]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(xOf(n - 1), padT + ih);
      ctx.lineTo(xOf(0), padT + ih);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = POP_SERIES[4].color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = xOf(i);
        const y = yPlant(rows[i][4]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // 四个物种（左轴）
    for (let si = 0; si < 4; si++) {
      if (!visible[si]) continue;
      ctx.strokeStyle = POP_SERIES[si].color;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = xOf(i);
        const y = yCount(rows[i][si]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    ctx.fillStyle = INK_SOFT;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText(`tick ${stats[0]?.tick ?? 0}`, padL, h - 4);
    ctx.textAlign = 'right';
    ctx.fillText(`tick ${stats[stats.length - 1]?.tick ?? 0}`, padL + iw, h - 4);
  });

  return (
    <div className="chart">
      <div className="chart__title">
        <PixelIcon name="tabData" size={13} /> 种群曲线
        <span className="muted" style={{ fontWeight: 400 }}>
          （最近 {stats.length} 次采样；左轴动物数量，右轴植物生物量，点击图例可开关）
        </span>
      </div>
      {stats.length < 2 ? (
        <div className="chart__empty">模拟开始后，这里会绘制四个物种与植物的数量变化。</div>
      ) : (
        <>
          <div style={{ lineHeight: 0 }}>
            <canvas ref={ref} className="chart__canvas" />
          </div>
          <div className="chart__legend">
            {POP_SERIES.map((s, i) => (
              <button
                key={s.label}
                type="button"
                className={`legend-item${visible[i] ? '' : ' is-off'}`}
                onClick={() => setVisible((v) => v.map((x, j) => (j === i ? !x : x)))}
                title="点击显示 / 隐藏该序列"
                aria-pressed={visible[i]}
              >
                <span className="legend-item__swatch" style={{ background: s.color }} />
                {s.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 死因分布

const DEATH_CAUSES = [
  { label: '饿死', color: '#b57f16', sprite: 'spark' as SpriteName },
  { label: '衰老', color: '#7d7468', sprite: 'clock' as SpriteName },
  { label: '被捕食', color: '#b3452f', sprite: 'pred' as SpriteName },
  { label: '脱水', color: '#2e6f8e', sprite: 'drought' as SpriteName },
];

function DeathCauseChart({ stats }: { stats: StatsSample[] }): React.ReactElement {
  const window = useMemo(() => stats.slice(-20), [stats]);
  const totals = useMemo(() => {
    const t = [0, 0, 0, 0];
    for (const s of window) {
      const d = s.deathByCause;
      if (!d) continue;
      for (let i = 0; i < 4; i++) t[i] += d[i] ?? 0;
    }
    return t;
  }, [window]);
  const sum = totals.reduce((a, b) => a + b, 0);
  const { ref, size } = useChartCanvas(4 * 24 + 10);

  useEffect(() => {
    const c = prepareCanvas(ref, size);
    if (!c) return;
    const { ctx, w, h } = c;
    const padL = 58;
    const padR = 46;
    const rowH = 24;
    ctx.font = FONT;
    for (let i = 0; i < 4; i++) {
      const y = 6 + i * rowH;
      const v = totals[i];
      const ratio = sum > 0 ? v / sum : 0;
      const barW = Math.max(0, w - padL - padR) * ratio;
      ctx.fillStyle = INK;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(DEATH_CAUSES[i].label, 2, y + 8);
      ctx.strokeStyle = 'rgba(43,38,32,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(padL + 0.5, y + 0.5, Math.max(0, w - padL - padR), 15);
      ctx.fillStyle = DEATH_CAUSES[i].color;
      ctx.fillRect(padL + 1, y + 1, Math.max(0, barW - 1), 13);
      ctx.fillStyle = INK;
      ctx.textAlign = 'right';
      ctx.fillText(`${v}（${sum > 0 ? Math.round(ratio * 100) : 0}%）`, w - 2, y + 8);
    }
    void h;
  });

  return (
    <div className="chart">
      <div className="chart__title">
        <PixelIcon name="death" size={13} /> 死因分布
        <span className="muted" style={{ fontWeight: 400 }}>
          （最近 {window.length} 次采样，共 {fmtInt(sum)} 例死亡）
        </span>
      </div>
      {sum === 0 ? (
        <div className="chart__empty">这段时间内没有个体死亡——生态正在繁荣期。</div>
      ) : (
        <div style={{ lineHeight: 0 }}>
          <canvas ref={ref} className="chart__canvas" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 性状分布

const EVENT_ICONS: Record<string, SpriteName> = {
  birth: 'birth',
  death: 'death',
  climate: 'cloud',
  lineage: 'tree',
  challenge: 'flag',
  world: 'globe',
  info: 'info',
};

function TraitChart({
  stats,
  geneIndex,
  onGeneChange,
}: {
  stats: StatsSample[];
  geneIndex: number;
  onGeneChange: (i: number) => void;
}): React.ReactElement {
  const win = useMemo(() => recentStats(stats, 120), [stats]);
  const { ref, size } = useChartCanvas(150);
  const cur = stats.length > 0 ? stats[stats.length - 1].trait?.[geneIndex] : undefined;

  useEffect(() => {
    const c = prepareCanvas(ref, size);
    if (!c || win.length < 2) return;
    const { ctx, w, h } = c;
    const padL = 30;
    const padR = 8;
    const boxH = 46;
    const histH = h - boxH - 14;
    const padT = 6;
    const iw = w - padL - padR;
    const n = win.length;
    const xOf = (i: number): number => padL + (iw * i) / Math.max(1, n - 1);
    const yOf = (v: number): number => padT + histH - histH * Math.max(0, Math.min(1, v));

    // 网格（0 / 0.5 / 1）
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    for (const g of [0, 0.5, 1]) {
      const y = yOf(g);
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, Math.round(y) + 0.5);
      ctx.lineTo(padL + iw, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.fillStyle = INK_SOFT;
      ctx.textAlign = 'right';
      ctx.fillText(g.toFixed(1), padL - 5, y);
    }

    // p10–p90 带
    ctx.fillStyle = 'rgba(201,111,58,0.18)';
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const t = win[i].trait?.[geneIndex];
      if (!t) continue;
      const x = xOf(i);
      const y = yOf(t.p90);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = n - 1; i >= 0; i--) {
      const t = win[i].trait?.[geneIndex];
      if (!t) continue;
      ctx.lineTo(xOf(i), yOf(t.p10));
    }
    ctx.closePath();
    ctx.fill();

    // p50 中位数线
    ctx.strokeStyle = PALETTE.accent;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const t = win[i].trait?.[geneIndex];
      if (!t) continue;
      const x = xOf(i);
      const y = yOf(t.p50);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 均值虚线
    ctx.strokeStyle = PALETTE.water;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const t = win[i].trait?.[geneIndex];
      if (!t) continue;
      const x = xOf(i);
      const y = yOf(t.mean);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // 图例
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = INK_SOFT;
    ctx.fillText('p10–p90 带 / 中位数 / 均值', padL + 2, padT + 8);

    // 当前箱线图
    if (cur) {
      const cy = h - boxH / 2 - 2;
      const bx = (v: number): number => padL + iw * Math.max(0, Math.min(1, v));
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, cy);
      ctx.lineTo(padL + iw, cy);
      ctx.stroke();
      // 须
      ctx.beginPath();
      ctx.moveTo(bx(cur.p10), cy - 8);
      ctx.lineTo(bx(cur.p10), cy + 8);
      ctx.moveTo(bx(cur.p90), cy - 8);
      ctx.lineTo(bx(cur.p90), cy + 8);
      ctx.stroke();
      // 箱体
      ctx.fillStyle = 'rgba(79,125,74,0.28)';
      ctx.fillRect(bx(cur.p10), cy - 9, Math.max(1, bx(cur.p90) - bx(cur.p10)), 18);
      ctx.strokeRect(bx(cur.p10) + 0.5, cy - 9.5, Math.max(1, bx(cur.p90) - bx(cur.p10)), 18);
      // 中位数
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(bx(cur.p50), cy - 9);
      ctx.lineTo(bx(cur.p50), cy + 9);
      ctx.stroke();
      // 均值菱形
      ctx.fillStyle = PALETTE.water;
      const mx = bx(cur.mean);
      ctx.beginPath();
      ctx.moveTo(mx, cy - 5);
      ctx.lineTo(mx + 5, cy);
      ctx.lineTo(mx, cy + 5);
      ctx.lineTo(mx - 5, cy);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = INK_SOFT;
      ctx.font = FONT;
      ctx.textAlign = 'left';
      ctx.fillText('0', padL, h - 2);
      ctx.textAlign = 'right';
      ctx.fillText('1', padL + iw, h - 2);
      ctx.textAlign = 'center';
      ctx.fillText('当前分布（箱线图）', padL + iw / 2, h - 2);
    }
  });

  return (
    <div className="chart">
      <div className="chart__title">
        <PixelIcon name="dna" size={13} /> 性状分布
        <select
          className="input"
          style={{ width: 'auto', marginLeft: 'auto', padding: '2px 6px', fontSize: 12, fontFamily: 'var(--font)' }}
          value={geneIndex}
          onChange={(e) => onGeneChange(Number(e.target.value))}
          aria-label="选择要查看的基因"
        >
          {GENE_DEFS.map((d, i) => (
            <option key={d.key} value={i}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      {win.length < 2 || !cur ? (
        <div className="chart__empty">个体成年后，这里会统计该基因在种群中的分布。</div>
      ) : (
        <>
          <div style={{ lineHeight: 0 }}>
            <canvas ref={ref} className="chart__canvas" />
          </div>
          <div className="stat-grid" style={{ marginTop: 8 }}>
            <div className="stat-cell">
              <div className="stat-cell__k">p10</div>
              <div className="stat-cell__v">{cur.p10.toFixed(2)}</div>
            </div>
            <div className="stat-cell">
              <div className="stat-cell__k">p50（中位数）</div>
              <div className="stat-cell__v">{cur.p50.toFixed(2)}</div>
            </div>
            <div className="stat-cell">
              <div className="stat-cell__k">p90</div>
              <div className="stat-cell__v">{cur.p90.toFixed(2)}</div>
            </div>
            <div className="stat-cell">
              <div className="stat-cell__k">均值</div>
              <div className="stat-cell__v">{cur.mean.toFixed(2)}</div>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
            分布整体向左/右移动，说明自然选择正在偏好更小或更大的{GENE_DEFS[geneIndex].name}。
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 数据面板

export function DataPanel(): React.ReactElement {
  const panel = useSyncExternalStore(client.subscribePanel, client.getPanelSnapshot);
  const [geneIndex, setGeneIndex] = useState(0);
  const stats = panel.stats;

  return (
    <div>
      <PopulationChart stats={stats} />
      <DeathCauseChart stats={stats} />
      <TraitChart stats={stats} geneIndex={geneIndex} onGeneChange={setGeneIndex} />
      <div className="chart">
        <div className="chart__title">
          <PixelIcon name="clock" size={13} /> 事件日志
          <span className="muted" style={{ fontWeight: 400 }}>
            （最近 {panel.events.length} 条）
          </span>
        </div>
        {panel.events.length === 0 ? (
          <div className="chart__empty">出生、死亡、干旱等真实事件会记录在这里。</div>
        ) : (
          <div className="event-list">
            {[...panel.events]
              .sort((a, b) => b.seq - a.seq)
              .map((ev) => {
                const cat = eventCategory(ev.type, ev.text);
                return (
                  <div className="event-item" key={`${ev.seq}-${ev.tick}`}>
                    <span className="event-item__icon">
                      <PixelIcon name={EVENT_ICONS[cat] ?? 'info'} size={14} />
                    </span>
                    <span className="event-item__text">{ev.text}</span>
                    <span className="event-item__tick">t{fmtInt(ev.tick)}</span>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
