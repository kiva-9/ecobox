// GameCanvas：React 与 PixiJS 渲染器之间的桥接层。
// 职责：
//  - 动态 import 渲染器（兼容静态 create / 构造函数 + ready 两种初始化方式）；
//  - requestAnimationFrame 循环中把 client.latest 快照推给渲染器（不进 React state）；
//  - 把 UI 的 tool / brushSize / overlay / trackId 同步给渲染器；
//  - 指针交互：渲染器回调优先；渲染器不回调时由本组件兜底（拾取/干预）；
//  - ResizeObserver + devicePixelRatio 管理画布尺寸；
//  - 渲染器加载失败时显示降级提示（模拟仍在 worker 中运行）。
//
// 说明：渲染器模块 src/game/renderer/renderer.ts 由并行工程师开发并已落地，
// 动态 import 直接解析真实模块（接口以该文件与任务书契约为准）；早期曾使用临时声明文件
// src/ui/__renderer_shim.d.ts 兜底，渲染器落地后已不再需要。

import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { client } from '../game/client';
import { Tool, Terrain, toolName } from '../sim/constants';
import { WORLD } from '../sim/config';
import type { Genes } from '../sim/types';
import type { OverlayState, SaveFile, SimSnapshot, WorkerResponse } from '../shared/protocol';

// ---------------------------------------------------------------- 渲染器接口（与并行工程师的契约）

export interface RendererCallbacks {
  onPickCreature?(id: number): void;
  onPaintTile?(tx: number, ty: number): void;
  onFps?(fps: number, actualTps?: number): void;
  onZoomChanged?(zoom: number): void;
  onHoverTile?(tx: number, ty: number): void;
}

export interface RendererInstance {
  ready?: Promise<void>;
  resize(width: number, height: number, dpr: number): void;
  setWorld(terrain: Uint8Array, width: number, height: number): void;
  setSnapshot(snapshot: SimSnapshot): void;
  setOverlay(o: OverlayState): void;
  setSelected(id: number | null): void;
  setBrushCursor(tx: number, ty: number, radius: number, visible: boolean): void;
  track(wx: number | null, wy: number | null): void;
  zoomAt(factor: number, sx?: number, sy?: number): void;
  screenToWorld(sx: number, sy: number): { x: number; y: number };
  centerOn(wx: number, wy: number): void;
  getZoom(): number;
  destroy(): void;
  /** 可选扩展：渲染器若支持按工具决定交互行为则调用 */
  setTool?(tool: number): void;
}

type RendererModule = {
  GameRenderer: {
    new (canvas: HTMLCanvasElement, callbacks: RendererCallbacks): RendererInstance;
    create?(canvas: HTMLCanvasElement, callbacks: RendererCallbacks): Promise<RendererInstance>;
  };
};

/** 暴露给工具栏的少量画布命令（缩放/回中） */
export interface CanvasApi {
  zoomBy(factor: number): void;
  centerWorld(): void;
}

export interface GameCanvasProps {
  tool: number;
  brushSize: number;
  overlay: OverlayState;
  trackId: number | null;
  /** 当前装备的蓝图基因（投放物种时作为 genes 参数） */
  genes: Genes | null;
  onApi: (api: CanvasApi | null) => void;
}

/** 渲染器输入回调的“活跃窗口”：窗口内认为渲染器正在驱动指针交互，UI 兜底让位 */
const RENDERER_DRIVE_MS = 400;
/** 轻点后等待渲染器自行处理的时间 */
const TAP_GRACE_MS = 60;

function overlaySignature(o: OverlayState): string {
  return `${o.vegetation ? 1 : 0}${o.moisture ? 1 : 0}${o.nutrients ? 1 : 0}${o.activity ? 1 : 0}${o.population ? 1 : 0}${o.carcass ? 1 : 0}`;
}

export function GameCanvas(props: GameCanvasProps): ReactElement {
  const { tool, brushSize, trackId, genes, onApi } = props;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<RendererInstance | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const onApiRef = useRef(onApi);
  onApiRef.current = onApi;

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [zoom, setZoom] = useState(1);

  // 指针/手势状态（不进 React state）
  const gesture = useRef({
    active: false,
    moved: false,
    panCancelled: false,
    startX: 0,
    startY: 0,
    downTx: 0,
    downTy: 0,
    lastTx: 0,
    lastTy: 0,
  });
  const lastInputAt = useRef(0);
  const lastWarnAt = useRef(0);
  const pointerInside = useRef(false);
  const pointerTile = useRef({ tx: 0, ty: 0 });

  // ---------------------------------------------------------------- 干预（带配额保护）

  const paintTile = (tx: number, ty: number): void => {
    const p = propsRef.current;
    if (p.tool === Tool.None) return;
    const snap = client.latest;
    if (snap && snap.interventionLeft !== null && snap.interventionLeft <= 0) {
      const now = performance.now();
      if (now - lastWarnAt.current > 2000) {
        lastWarnAt.current = now;
        client.toast('warn', '干预配额已用尽，本挑战无法继续干预');
      }
      return;
    }
    client.intervene(p.tool, tx, ty, p.brushSize, p.genes);
  };

  const paintLine = (x0: number, y0: number, x1: number, y1: number): void => {
    let x = x0;
    let y = y0;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    // 上限保护，避免异常坐标导致超长循环
    for (let guard = 0; guard < 512; guard++) {
      paintTile(x, y);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  };

  /** 在快照中查找世界坐标处最接近的生物（兜底拾取用） */
  const pickCreatureAt = (tx: number, ty: number): number | null => {
    const snap = client.latest;
    if (!snap) return null;
    const c = snap.creatures;
    const px = tx + 0.5;
    const py = ty + 0.5;
    let best: number | null = null;
    let bestD = Infinity;
    for (let i = 0; i < c.count; i++) {
      const dx = c.x[i] - px;
      const dy = c.y[i] - py;
      const d = Math.hypot(dx, dy);
      const reach = Math.max(c.size[i] * 1.6, 0.55);
      if (d <= reach && d < bestD) {
        bestD = d;
        best = c.id[i];
      }
    }
    return best;
  };

  const toTile = (clientX: number, clientY: number): { tx: number; ty: number } | null => {
    const r = rendererRef.current;
    const canvas = canvasRef.current;
    if (!r || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    try {
      const w = r.screenToWorld(clientX - rect.left, clientY - rect.top);
      return { tx: Math.floor(w.x), ty: Math.floor(w.y) };
    } catch {
      return null;
    }
  };

  // ---------------------------------------------------------------- 渲染器生命周期

  useEffect(() => {
    let disposed = false;
    let raf = 0;
    let renderer: RendererInstance | null = null;
    let disconnectRo: (() => void) | null = null;
    let appliedTerrain: Uint8Array | null = null;
    let lastSelId: number | null | undefined;
    let lastOverlaySig = '';
    let lastTool = Number.NaN;
    let lastTrackOn = false;
    let frames = 0;
    let lastReportAt = performance.now();
    let lastTickForTps = -1;
    let tps = 0;
    let dpr = 1;

    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    // 地形只随"世界变更后的首个快照"下发，且该快照在 16ms 后就被后续快照覆盖
    // （worker 固定 60Hz 循环），而渲染器是异步加载的。三条捕获通道：
    //  1) 直接监听 worker 消息（主通道，最快最可靠）；
    //  2) rAF 循环里检查 client.latest；
    //  3) 低频轮询兜底。
    let cachedTerrain: { data: Uint8Array; w: number; h: number } | null = null;
    let terrainSeen = false;
    const noteTerrain = (t: Uint8Array): void => {
      terrainSeen = true;
      cachedTerrain = { data: t, w: WORLD.width, h: WORLD.height };
    };

    const worker = (client as unknown as { worker?: Worker | null }).worker;
    const onWorkerMessage = (ev: MessageEvent): void => {
      const res = ev.data as WorkerResponse | undefined;
      if (res && res.type === 'snapshot' && res.data?.terrain) noteTerrain(res.data.terrain);
    };
    worker?.addEventListener('message', onWorkerMessage);

    const terrainPoll = window.setInterval(() => {
      const s = client.latest;
      if (s?.terrain) noteTerrain(s.terrain);
    }, 50);

    // 兜底：渲染器就绪 1.5 秒后仍未见到地形快照，则先用占位地形把相机初始化（保证可交互），
    // 并尝试通过导出接口取回真实地形替换占位。
    const terrainFallback = window.setTimeout(() => {
      if (terrainSeen || appliedTerrain) return;
      console.warn('[GameCanvas] 未收到地形快照，使用占位地形初始化视图');
      cachedTerrain = {
        data: new Uint8Array(WORLD.width * WORLD.height).fill(Terrain.Meadow),
        w: WORLD.width,
        h: WORLD.height,
      };
      void client.exportWorld().then((json) => {
        if (!json || appliedTerrain) return;
        try {
          const data = JSON.parse(json) as SaveFile;
          if (Array.isArray(data.terrain) && data.terrain.length === WORLD.width * WORLD.height) {
            cachedTerrain = { data: Uint8Array.from(data.terrain), w: WORLD.width, h: WORLD.height };
          }
        } catch {
          /* 忽略解析失败 */
        }
      });
    }, 1500);

    const applySize = (): void => {
      const r = rendererRef.current;
      if (!r) return;
      const w = Math.max(1, Math.round(wrap.clientWidth));
      const h = Math.max(1, Math.round(wrap.clientHeight));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      try {
        r.resize(w, h, dpr);
      } catch {
        /* 渲染器尚未就绪时忽略 */
      }
    };

    const callbacks: RendererCallbacks = {
      onPickCreature: (id) => {
        lastInputAt.current = performance.now();
        client.select(id);
      },
      onPaintTile: (tx, ty) => {
        lastInputAt.current = performance.now();
        paintTile(tx, ty);
      },
      onFps: (fps, actualTps) => {
        client.reportPerf(fps, actualTps ?? tps);
      },
      onZoomChanged: (z) => setZoom(z),
    };

    void (async () => {
      try {
        const mod = (await import('../game/renderer/renderer')) as unknown as RendererModule;
        if (disposed) return;
        const R = mod.GameRenderer;
        if (!R) throw new Error('渲染器模块未导出 GameRenderer');
        if (typeof R.create === 'function') {
          renderer = await R.create(canvas, callbacks);
        } else {
          renderer = new R(canvas, callbacks);
        }
        if (renderer.ready) {
          try {
            await renderer.ready;
          } catch {
            /* ready 失败时仍尝试使用实例 */
          }
        }
        if (disposed) {
          renderer.destroy();
          return;
        }
        rendererRef.current = renderer;
        setStatus('ready');
        applySize();
        const ro = new ResizeObserver(() => applySize());
        ro.observe(wrap);
        disconnectRo = () => ro.disconnect();
        onApiRef.current?.({
          zoomBy: (f) => {
            try {
              rendererRef.current?.zoomAt(f);
            } catch {
              /* 忽略 */
            }
          },
          centerWorld: () => {
            try {
              rendererRef.current?.centerOn(WORLD.width / 2, WORLD.height / 2);
            } catch {
              /* 忽略 */
            }
          },
        });

        const loop = (): void => {
          raf = requestAnimationFrame(loop);
          const r = rendererRef.current;
          if (!r) return;
          const snap = client.latest;
          const p = propsRef.current;

          if (snap) {
            if (snap.terrain) {
              cachedTerrain = { data: snap.terrain, w: WORLD.width, h: WORLD.height };
            }
            // 地形快照可能错过（渲染器异步加载），用缓存的引用做变更检测
            if (cachedTerrain && cachedTerrain.data !== appliedTerrain) {
              appliedTerrain = cachedTerrain.data;
              try {
                r.setWorld(cachedTerrain.data, cachedTerrain.w, cachedTerrain.h);
              } catch {
                /* 忽略 */
              }
            }
            try {
              r.setSnapshot(snap);
            } catch {
              /* 忽略 */
            }
            const selId = snap.selected?.id ?? null;
            if (selId !== lastSelId) {
              lastSelId = selId;
              try {
                r.setSelected(selId);
              } catch {
                /* 忽略 */
              }
            }
            // 追踪：把目标世界坐标交给渲染器
            if (p.trackId != null) {
              const c = snap.creatures;
              let fx = 0;
              let fy = 0;
              let found = false;
              for (let i = 0; i < c.count; i++) {
                if (c.id[i] === p.trackId) {
                  fx = c.x[i];
                  fy = c.y[i];
                  found = true;
                  break;
                }
              }
              try {
                r.track(found ? fx : null, found ? fy : null);
              } catch {
                /* 忽略 */
              }
              lastTrackOn = true;
            } else if (lastTrackOn) {
              lastTrackOn = false;
              try {
                r.track(null, null);
              } catch {
                /* 忽略 */
              }
            }
          }

          // 结构状态同步（每帧做一次廉价比较）
          const sig = overlaySignature(p.overlay);
          if (sig !== lastOverlaySig) {
            lastOverlaySig = sig;
            try {
              r.setOverlay(p.overlay);
            } catch {
              /* 忽略 */
            }
          }
          if (p.tool !== lastTool) {
            lastTool = p.tool;
            if (typeof r.setTool === 'function') {
              try {
                r.setTool(p.tool);
              } catch {
                /* 忽略 */
              }
            }
          }
          if (pointerInside.current) {
            // 指针停留时也持续刷新笔刷光标（工具/笔刷变化即时生效）
            try {
              r.setBrushCursor(
                pointerTile.current.tx,
                pointerTile.current.ty,
                p.brushSize,
                p.tool !== Tool.None,
              );
            } catch {
              /* 忽略 */
            }
          }

          // 性能统计（UI 自算，渲染器 onFps 为补充通道）
          frames++;
          const now = performance.now();
          if (now - lastReportAt >= 500) {
            const dt = (now - lastReportAt) / 1000;
            const fps = frames / dt;
            if (snap) {
              if (lastTickForTps >= 0) tps = Math.max(0, (snap.tick - lastTickForTps) / dt);
              lastTickForTps = snap.tick;
            }
            client.reportPerf(fps, tps);
            frames = 0;
            lastReportAt = now;
            const nd = Math.min(window.devicePixelRatio || 1, 2);
            if (nd !== dpr) applySize();
          }
        };
        raf = requestAnimationFrame(loop);
      } catch (err) {
        if (disposed) return;
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.clearInterval(terrainPoll);
      window.clearTimeout(terrainFallback);
      worker?.removeEventListener('message', onWorkerMessage);
      disconnectRo?.();
      rendererRef.current = null;
      try {
        renderer?.destroy();
      } catch {
        /* 忽略 */
      }
      onApiRef.current?.(null);
    };
  }, []);

  // ---------------------------------------------------------------- 指针交互（渲染器回调优先，本组件兜底）

  const onPointerDown = (ev: React.PointerEvent<HTMLCanvasElement>): void => {
    if (ev.button !== 0) return;
    const t = toTile(ev.clientX, ev.clientY);
    if (!t) return;
    const g = gesture.current;
    g.active = true;
    g.moved = false;
    g.panCancelled = false;
    g.startX = ev.clientX;
    g.startY = ev.clientY;
    g.downTx = t.tx;
    g.downTy = t.ty;
    g.lastTx = t.tx;
    g.lastTy = t.ty;
    pointerInside.current = true;
    pointerTile.current = t;
    try {
      ev.currentTarget.setPointerCapture(ev.pointerId);
    } catch {
      /* 忽略 */
    }
  };

  const onPointerMove = (ev: React.PointerEvent<HTMLCanvasElement>): void => {
    const r = rendererRef.current;
    const t = toTile(ev.clientX, ev.clientY);
    if (!t || !r) return;
    pointerInside.current = true;
    pointerTile.current = t;
    const p = propsRef.current;
    try {
      r.setBrushCursor(t.tx, t.ty, p.brushSize, p.tool !== Tool.None);
    } catch {
      /* 忽略 */
    }
    const g = gesture.current;
    if (!g.active) return;
    if (Math.abs(ev.clientX - g.startX) + Math.abs(ev.clientY - g.startY) > 4) g.moved = true;
    if (p.tool === Tool.None) {
      // 选择工具下的拖动 = 平移视角：与渲染器"拖动即取消追踪"的语义保持一致
      if (g.moved && p.trackId != null && !g.panCancelled) {
        g.panCancelled = true;
        client.setTrackId(null);
      }
      return;
    }
    // 渲染器正在驱动输入时让位，避免重复干预
    if (performance.now() - lastInputAt.current < RENDERER_DRIVE_MS) return;
    paintLine(g.lastTx, g.lastTy, t.tx, t.ty);
    g.lastTx = t.tx;
    g.lastTy = t.ty;
  };

  const onPointerUp = (ev: React.PointerEvent<HTMLCanvasElement>): void => {
    const g = gesture.current;
    if (!g.active) return;
    g.active = false;
    try {
      ev.currentTarget.releasePointerCapture(ev.pointerId);
    } catch {
      /* 忽略 */
    }
    if (performance.now() - lastInputAt.current < RENDERER_DRIVE_MS) return;
    if (g.moved) return;
    const p = propsRef.current;
    const tx = g.downTx;
    const ty = g.downTy;
    // 轻点：给渲染器一帧机会自行处理，未处理则兜底
    window.setTimeout(() => {
      if (performance.now() - lastInputAt.current < TAP_GRACE_MS) return;
      if (p.tool === Tool.None) {
        client.select(pickCreatureAt(tx, ty));
      } else {
        paintTile(tx, ty);
      }
    }, TAP_GRACE_MS);
  };

  const onPointerLeave = (): void => {
    pointerInside.current = false;
    gesture.current.active = false;
    const r = rendererRef.current;
    if (!r) return;
    try {
      r.setBrushCursor(0, 0, propsRef.current.brushSize, false);
    } catch {
      /* 忽略 */
    }
  };

  const onContextMenu = (ev: React.MouseEvent<HTMLCanvasElement>): void => {
    ev.preventDefault();
  };

  // ---------------------------------------------------------------- 渲染

  const showToolHint = status === 'ready';
  return (
    <div className="stage" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="game-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerLeave}
        onPointerLeave={onPointerLeave}
        onContextMenu={onContextMenu}
      />
      {status === 'loading' ? (
        <div className="stage-overlay stage-overlay--soft">
          <span className="stage-overlay__text">渲染器加载中…</span>
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="stage-overlay" role="alert">
          <div className="degrade">
            <h3>渲染器加载失败</h3>
            <p>
              画面渲染模块未能启动（{errorMsg || '未知错误'}）。模拟仍在后台运行，数据面板与存档功能不受影响。
              请检查浏览器是否支持 WebGL，或稍后重试。
            </p>
            <p className="degrade__hint">若刚刚集成渲染器，请刷新页面重试。</p>
          </div>
        </div>
      ) : null}
      {showToolHint ? (
        <div className="stage-hud">
          <span className="stage-hud__item">
            {tool !== Tool.None ? `${toolName(tool)} · 笔刷 ${brushSize}` : '选择 / 观察（点击生物查看）'}
          </span>
          <span className="stage-hud__item stage-hud__item--num">缩放 {Math.round(zoom * 100)}%</span>
        </div>
      ) : null}
      {genes ? (
        <div className="stage-hud stage-hud--bottom">
          <span className="stage-hud__item">已装备蓝图基因：点击场景投放</span>
        </div>
      ) : null}
      {trackId != null ? (
        <div className="stage-hud stage-hud--bottom stage-hud--right">
          <span className="stage-hud__item">追踪中</span>
        </div>
      ) : null}
    </div>
  );
}
