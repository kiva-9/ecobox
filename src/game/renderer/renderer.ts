// 主渲染器：PixiJS 8（WebGL）像素风渲染 + Canvas2D 兜底。
// 场景分层（世界空间，挂在相机容器下）：
//   地形层(32px/块, 静态) -> 植物层(8px/块, 动态) -> 数据叠加层(1px/块)
//   -> 生物精灵池 -> 特效池 -> 画笔预览；夜色层为屏幕空间。
// 世界坐标约定：公开 API（screenToWorld/centerOn/track/setBrushCursor）使用"瓦片单位"，
// 与快照中 creature.x/y 一致；内部相机使用世界像素（x32）。

import { Application, CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { SimSnapshot, CreatureRenderData, OverlayState } from '../../shared/protocol';
import { PALETTE, DEFAULT_OVERLAY, speciesColor } from '../../shared/protocol';
import { Camera } from './camera';
import { EffectSystem } from './effects';
import {
  CREATURE_DIAMETER,
  PLANT_PX,
  TILE_PIXELS,
  buildCreatureAtlas,
  buildEffectTextures,
  buildTerrainCanvas,
  drawPlantCell,
  hexToRgb,
  mixRgb,
  mulberry32,
  rgbToInt,
  shiftHue,
  type CreatureAtlas,
  type EffectTextures,
  type Rgb,
} from './sprites';

export interface RendererCallbacks {
  onPickCreature(id: number | null): void; // 点击命中生物（空格为 null）
  onPaintTile(tx: number, ty: number): void; // 画笔拖到格子（tx,ty 为整数格子坐标）
  onZoomChanged(zoom: number): void;
  onFps(fps: number): void;
}

/** BehaviorState（src/sim/constants.ts）：逃逸=2，进食=7 */
const STATE_FLEE = 2;
const STATE_EAT = 7;
const POOL_SIZE = 1400;
/** 动态层更新帧间隔 */
const LAYER_INTERVAL = 3;
/** 能量参考值（用于体色明暗），约等于物种能量上限中位数 */
const ENERGY_REF = 110;
/** 点击判定阈值（屏幕 px） */
const CLICK_SLOP = 5;
/** 拾取容差（屏幕 px） */
const PICK_TOLERANCE = 12;

/** 快照可能携带的基因数组（当前协议未定义，运行时探测以实现基因->外观映射） */
interface CreatureGenesLoose {
  speed?: Float32Array;
  sense?: Float32Array;
  reproInvest?: Float32Array;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

const C_WATER: Rgb = hexToRgb(PALETTE.water);
const C_NUTRIENT: Rgb = hexToRgb('#8a6a3a');
const C_CARCASS: Rgb = hexToRgb('#e8e2d0');
const C_PANEL: Rgb = hexToRgb(PALETTE.panel);
const C_NIGHT: Rgb = [24, 32, 56]; // PALETTE.night 的 rgb 部分
const C_DAY_WARM: Rgb = [255, 220, 160];
const C_MEADOW_DARK: Rgb = hexToRgb(PALETTE.meadowDark);
const C_GRASS: Rgb = hexToRgb(PALETTE.grass);
const C_SHRUB: Rgb = hexToRgb(PALETTE.shrub);
const HEAT_STOPS: Rgb[] = [C_WATER, hexToRgb(PALETTE.accent2), hexToRgb(PALETTE.arid), hexToRgb(PALETTE.species[2])];

/** 活动热力色带：蓝->绿->黄->红 */
function heatColor(t: number): Rgb {
  const x = clamp01(t) * 3;
  const i = Math.min(2, Math.floor(x));
  return mixRgb(HEAT_STOPS[i], HEAT_STOPS[i + 1], x - i);
}

export class GameRenderer {
  /** PixiJS 初始化完成的 Promise（UI 侧 await） */
  readonly ready: Promise<void>;
  /** WebGL 不可用时为 true，已回退 Canvas2D 最低限度渲染 */
  fallback2d = false;

  private canvas: HTMLCanvasElement;
  private cb: RendererCallbacks;

  // Pixi
  private app: Application | null = null;
  private worldRoot: Container | null = null;
  private terrainSprite: Sprite | null = null;
  private plantSprite: Sprite | null = null;
  private overlaySprite: Sprite | null = null;
  private creatureLayer: Container | null = null;
  private nightGfx: Graphics | null = null;
  private brushGfx: Graphics | null = null;
  private terrainSource: CanvasSource | null = null;
  private plantSource: CanvasSource | null = null;
  private overlaySource: CanvasSource | null = null;

  // 素材
  private atlas: CreatureAtlas | null = null;
  private fxTex: EffectTextures | null = null;
  private fx: EffectSystem | null = null;

  // 生物精灵池
  private pool: Sprite[] = [];
  private poolKeys = new Int32Array(POOL_SIZE);
  private eatCd = new Float32Array(POOL_SIZE);
  private tintTable: number[][] = [];

  // 世界数据
  private worldW = 128;
  private worldH = 80;
  private worldInitialized = false;
  private terrainCanvas: HTMLCanvasElement | null = null;
  private plantCanvas: HTMLCanvasElement | null = null;
  private plantCtx: CanvasRenderingContext2D | null = null;
  private plantKeys = new Int32Array(0);
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private overlayImg: ImageData | null = null;
  private density = new Uint16Array(0);

  // 状态
  private snap: SimSnapshot | null = null;
  private overlay: OverlayState = { ...DEFAULT_OVERLAY };
  private selectedId: number | null = null;
  private geneSpeed: Float32Array | null = null;
  private geneSense: Float32Array | null = null;
  private geneRepro: Float32Array | null = null;
  private time = 0;
  private frameCount = 0;
  private animPhase = 0;
  private lastEventSeq = -1;
  private lastFps = 0;
  private fpsTimer = 0;
  private fpsFrames = 0;
  private lastReportedZoom = -1;

  // 视图
  private viewW = 1280;
  private viewH = 800;
  private dpr = 1;
  private readonly cam = new Camera();

  // 画笔 / 选中 / 夜色缓存
  private brushTX = 0;
  private brushTY = 0;
  private brushR = 1;
  private brushVis = false;
  private brushSeenAt = -10;
  private brushLastKey = -1;
  private nightLastLight = -2;
  private nightDirty = true;
  private overlayVisible = false;

  // 交互
  private dragging = false;
  private dragMoved = 0;
  private lastPX = 0;
  private lastPY = 0;
  private paintTX = -1;
  private paintTY = -1;
  private trackTileX: number | null = null;
  private trackTileY: number | null = null;

  // 兜底循环
  private fbRaf = 0;
  private fbLastT = 0;

  constructor(canvas: HTMLCanvasElement, callbacks: RendererCallbacks) {
    this.canvas = canvas;
    this.cb = callbacks;
    this.ready = this.init();
  }

  static async create(canvas: HTMLCanvasElement, callbacks: RendererCallbacks): Promise<GameRenderer> {
    const r = new GameRenderer(canvas, callbacks);
    await r.ready;
    return r;
  }

  // ---------------------------------------------------------- 初始化

  private async init(): Promise<void> {
    try {
      const app = new Application();
      await app.init({
        canvas: this.canvas,
        preference: 'webgl',
        antialias: false,
        resolution: 1,
        background: 0x1a1712,
        powerPreference: 'high-performance',
        width: this.canvas.width || this.viewW,
        height: this.canvas.height || this.viewH,
      });
      this.app = app;
      this.buildScene();
      app.ticker.add(this.onTick);
      this.bindPointer();
    } catch {
      // WebGL 不可用：Canvas2D 兜底（最低限度地形 + 圆点生物，保证可玩）
      try {
        this.app?.destroy(false, { children: true, texture: true, textureSource: true, context: true });
      } catch {
        /* 忽略清理失败 */
      }
      this.app = null;
      this.fallback2d = true;
      this.buildTintTable();
      this.bindPointer();
      this.startFallback();
    }
  }

  private buildScene(): void {
    const app = this.app;
    if (!app) return;
    this.atlas = buildCreatureAtlas();
    this.fxTex = buildEffectTextures();
    this.fx = new EffectSystem(this.fxTex);
    this.buildTintTable();

    const root = new Container();
    app.stage.addChild(root);
    this.worldRoot = root;

    this.creatureLayer = new Container();
    root.addChild(this.creatureLayer);
    root.addChild(this.fx.container);

    this.brushGfx = new Graphics();
    root.addChild(this.brushGfx);

    this.nightGfx = new Graphics();
    app.stage.addChild(this.nightGfx);

    for (let i = 0; i < POOL_SIZE; i++) {
      const sp = new Sprite(this.atlas.get(0, 0, 0, 0));
      sp.anchor.set(0.5, 0.5);
      sp.visible = false;
      this.creatureLayer.addChild(sp);
      this.pool.push(sp);
    }

    this.cam.setViewport(this.viewW, this.viewH, this.dpr);
    this.nightDirty = true;
    // setWorld 可能先于 init 完成被调用：此时补建图层
    if (this.worldInitialized) this.createLayerSprites();
  }

  /** speed 基因 -> 体色色相偏移查找表（4 物种 x 16 档） */
  private buildTintTable(): void {
    this.tintTable = [];
    for (let sp = 0; sp < 4; sp++) {
      const base = hexToRgb(PALETTE.species[sp]);
      const row: number[] = [];
      for (let b = 0; b < 16; b++) {
        row.push(rgbToInt(shiftHue(base, (b / 15 - 0.5) * 44)));
      }
      this.tintTable.push(row);
    }
  }

  // ---------------------------------------------------------- 世界 / 快照

  setWorld(terrain: Uint8Array, width: number, height: number): void {
    this.worldW = width;
    this.worldH = height;
    this.lastEventSeq = -1;
    this.cam.setWorld(width, height);
    this.cam.setViewport(this.viewW, this.viewH, this.dpr);

    // 静态地形层画布（32px/块离屏整图，五地形 + 水域沙滩过渡）
    this.terrainCanvas = buildTerrainCanvas(terrain, width, height);

    // 植物层（8px/tile）与数据叠加层（1px/tile）
    this.plantCanvas = document.createElement('canvas');
    this.plantCanvas.width = width * PLANT_PX;
    this.plantCanvas.height = height * PLANT_PX;
    this.plantCtx = this.plantCanvas.getContext('2d');
    if (this.plantCtx) this.plantCtx.imageSmoothingEnabled = false;
    this.plantKeys = new Int32Array(width * height).fill(-1);

    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.width = width;
    this.overlayCanvas.height = height;
    this.overlayCtx = this.overlayCanvas.getContext('2d');
    this.overlayImg = this.overlayCtx?.createImageData(width, height) ?? null;
    this.density = new Uint16Array(width * height);
    this.worldInitialized = true;

    // 若 Pixi 已就绪则立即建层；否则等 buildScene 时补建
    if (this.worldRoot) this.createLayerSprites();
  }

  /** 创建/重建地形、植物、叠加三个图层 Sprite（世界变更或 init 完成后调用） */
  private createLayerSprites(): void {
    const root = this.worldRoot;
    if (!root || !this.terrainCanvas || !this.plantCanvas || !this.overlayCanvas) return;

    this.disposeLayer(this.terrainSprite, this.terrainSource);
    this.disposeLayer(this.plantSprite, this.plantSource);
    this.disposeLayer(this.overlaySprite, this.overlaySource);
    this.terrainSprite = null;
    this.plantSprite = null;
    this.overlaySprite = null;
    this.terrainSource = null;
    this.plantSource = null;
    this.overlaySource = null;

    const terrainSource = new CanvasSource({ resource: this.terrainCanvas, scaleMode: 'nearest', resolution: 1 });
    const terrainSp = new Sprite(new Texture({ source: terrainSource }));
    root.addChildAt(terrainSp, 0);
    this.terrainSprite = terrainSp;
    this.terrainSource = terrainSource;

    if (this.plantCtx) {
      const plantSource = new CanvasSource({ resource: this.plantCanvas, scaleMode: 'nearest', resolution: 1 });
      const plantSp = new Sprite(new Texture({ source: plantSource }));
      plantSp.scale.set(TILE_PIXELS / PLANT_PX);
      root.addChildAt(plantSp, 1);
      this.plantSprite = plantSp;
      this.plantSource = plantSource;
    }

    if (this.overlayCtx) {
      const ovSource = new CanvasSource({ resource: this.overlayCanvas, scaleMode: 'nearest', resolution: 1 });
      const ovSp = new Sprite(new Texture({ source: ovSource }));
      ovSp.scale.set(TILE_PIXELS);
      ovSp.alpha = 0.85;
      ovSp.visible = this.overlayVisible;
      root.addChildAt(ovSp, 2);
      this.overlaySprite = ovSp;
      this.overlaySource = ovSource;
    }
  }

  private disposeLayer(sp: Sprite | null, source: CanvasSource | null): void {
    if (sp) {
      this.worldRoot?.removeChild(sp);
      sp.destroy();
    }
    if (source) source.destroy();
  }

  setSnapshot(s: SimSnapshot): void {
    this.snap = s;
    // 探测可选的基因数组（协议当前未携带；若将来补充则自动启用真实基因映射）
    const loose = s.creatures as unknown as CreatureGenesLoose;
    const n = s.creatures.count;
    this.geneSpeed = loose.speed instanceof Float32Array && loose.speed.length >= n ? loose.speed : null;
    this.geneSense = loose.sense instanceof Float32Array && loose.sense.length >= n ? loose.sense : null;
    this.geneRepro = loose.reproInvest instanceof Float32Array && loose.reproInvest.length >= n ? loose.reproInvest : null;
  }

  setOverlay(o: OverlayState): void {
    this.overlay = o;
    const any = o.vegetation || o.moisture || o.nutrients || o.activity || o.population || o.carcass;
    this.overlayVisible = any;
    if (this.overlaySprite) this.overlaySprite.visible = any;
  }

  setSelected(id: number | null): void {
    this.selectedId = id;
  }

  setBrushCursor(tx: number, ty: number, radius: number, visible: boolean): void {
    this.brushTX = tx;
    this.brushTY = ty;
    this.brushR = Math.max(0, radius);
    if (visible && !this.brushVis) this.brushSeenAt = this.time;
    this.brushVis = visible;
    this.brushLastKey = -1;
  }

  // ---------------------------------------------------------- 视图

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.viewW = Math.max(1, cssWidth);
    this.viewH = Math.max(1, cssHeight);
    this.dpr = dpr > 0 ? dpr : 1;
    if (this.app) {
      this.app.renderer.resize(Math.round(this.viewW * this.dpr), Math.round(this.viewH * this.dpr));
    } else if (this.fallback2d) {
      this.canvas.width = Math.round(this.viewW * this.dpr);
      this.canvas.height = Math.round(this.viewH * this.dpr);
    }
    this.cam.setViewport(this.viewW, this.viewH, this.dpr);
    this.nightDirty = true;
  }

  /** 瓦片单位 */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const p = this.cam.screenToWorld(sx, sy);
    return { x: p.x / TILE_PIXELS, y: p.y / TILE_PIXELS };
  }

  /** 瓦片单位 */
  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return this.cam.worldToScreen(wx * TILE_PIXELS, wy * TILE_PIXELS);
  }

  /** 瓦片单位 */
  centerOn(wx: number, wy: number): void {
    this.cam.centerOn(wx * TILE_PIXELS, wy * TILE_PIXELS);
  }

  /** 瓦片单位；null 取消追踪 */
  track(wx: number | null, wy: number | null): void {
    this.trackTileX = wx;
    this.trackTileY = wy;
    this.cam.trackX = wx === null ? null : wx * TILE_PIXELS;
    this.cam.trackY = wy === null ? null : wy * TILE_PIXELS;
  }

  /** 以屏幕点（CSS px）为中心缩放 */
  zoomAt(factor: number, screenX?: number, screenY?: number): void {
    this.cam.zoomAt(factor, screenX ?? this.viewW / 2, screenY ?? this.viewH / 2);
    this.reportZoom(true);
  }

  getZoom(): number {
    return this.cam.zoom;
  }

  private reportZoom(force = false): void {
    const z = this.cam.zoom;
    if (force || Math.abs(z - this.lastReportedZoom) > 0.001) {
      this.lastReportedZoom = z;
      this.cb.onZoomChanged(z);
    }
  }

  // ---------------------------------------------------------- 帧循环（Pixi）

  private onTick = (ticker: { deltaMS: number }): void => {
    const dt = Math.min(0.1, Math.max(0, ticker.deltaMS) / 1000);
    this.stepFrame(dt);
    this.fpsFrames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      const fps = this.app ? Math.round(this.app.ticker.FPS) : Math.round(this.fpsFrames / this.fpsTimer);
      this.lastFps = fps;
      this.fpsFrames = 0;
      this.fpsTimer = 0;
      this.cb.onFps(fps);
      this.reportZoom();
    }
  };

  /** 每帧公共更新（Pixi 与兜底路径共用） */
  private stepFrame(dt: number): void {
    this.time += dt;
    this.animPhase = Math.floor(this.time * 7) & 3;
    this.frameCount++;
    if (this.trackTileX !== null && this.trackTileY !== null) this.cam.followTrack(dt);
    if (this.worldRoot) this.cam.applyTo(this.worldRoot);
    this.updateCreatures(dt);
    this.processEvents();
    if (this.frameCount % LAYER_INTERVAL === 0) this.updateDynamicLayers();
    if (this.fx) this.fx.update(dt);
    this.updateNight();
    this.updateBrushCursor();
  }

  // ---------------------------------------------------------- 生物精灵池

  private updateCreatures(dt: number): void {
    const s = this.snap;
    if (!s) {
      for (let i = 0; i < this.pool.length; i++) this.pool[i].visible = false;
      this.fx?.hideSelection();
      return;
    }
    const c = s.creatures;
    const n = Math.min(c.count, this.pool.length);
    const b = this.cam.visibleBounds(48);

    for (let i = 0; i < n; i++) {
      const sp = this.pool[i];
      const wx = c.x[i] * TILE_PIXELS, wy = c.y[i] * TILE_PIXELS;
      if (wx < b.x0 || wx > b.x1 || wy < b.y0 || wy > b.y1) {
        sp.visible = false;
        this.eatCd[i] = 0;
        continue;
      }
      const sizeTiles = c.size[i];
      const scale = clamp((sizeTiles * TILE_PIXELS * 2) / CREATURE_DIAMETER, 0.5, 4.5);

      const species = c.species[i] & 3;
      const state = c.state[i];
      let frame: number;
      if (state === STATE_EAT) frame = 4;
      else if (state === STATE_FLEE) frame = 5;
      else frame = (this.animPhase + (c.id[i] & 3)) & 3;

      const sense = this.senseTierOf(i, c);
      const belly = this.bellyTierOf(i, c);
      const key = (species << 6) | (sense << 4) | (belly << 3) | frame;
      if (key !== this.poolKeys[i]) {
        this.poolKeys[i] = key;
        if (this.atlas) sp.texture = this.atlas.get(species, sense, belly, frame);
      }

      sp.visible = true;
      sp.position.set(wx, wy);
      sp.rotation = c.heading[i];
      sp.scale.set(scale);
      sp.tint = this.tintOf(i, c, species);

      // 进食粒子（节流）
      if (state === STATE_EAT) {
        this.eatCd[i] -= dt;
        if (this.eatCd[i] <= 0) {
          this.eatCd[i] = 0.22 + Math.random() * 0.18;
          this.fx?.eat(wx, wy);
        }
      } else {
        this.eatCd[i] = 0;
      }
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].visible = false;

    // 选中标记跟随
    if (this.selectedId !== null && this.fx) {
      let found = -1;
      for (let i = 0; i < n; i++) {
        if (c.id[i] === this.selectedId) { found = i; break; }
      }
      if (found >= 0) {
        this.fx.setSelection(c.x[found] * TILE_PIXELS, c.y[found] * TILE_PIXELS, Math.max(4, c.size[found] * TILE_PIXELS));
      } else {
        this.fx.hideSelection();
      }
    } else {
      this.fx?.hideSelection();
    }
  }

  /** sense 基因 -> 附肢长度 3 档；无基因数据时按 id 稳定哈希分档 */
  private senseTierOf(i: number, c: CreatureRenderData): number {
    const g = this.geneSense;
    if (g) {
      const v = g[i];
      return v < 0.34 ? 0 : v < 0.67 ? 1 : 2;
    }
    return ((c.id[i] * 2654435761) >>> 12) % 3;
  }

  /** reproInvest 基因 -> 腹部斑块明暗 2 档 */
  private bellyTierOf(i: number, c: CreatureRenderData): number {
    const g = this.geneRepro;
    if (g) return g[i] > 0.55 ? 1 : 0;
    return ((c.id[i] * 40503) >>> 10) % 5 < 2 ? 1 : 0;
  }

  /** speed 基因 -> 体色色相；energy -> 明暗；artificial -> 偏青 */
  private tintOf(i: number, c: CreatureRenderData, species: number): number {
    const g = this.geneSpeed;
    const bucket = g ? Math.min(15, Math.max(0, Math.floor(g[i] * 16))) : ((c.id[i] * 2246822519) >>> 13) % 16;
    const base = this.tintTable[species]?.[bucket] ?? 0xffffff;
    const k = 0.68 + 0.32 * clamp01(c.energy[i] / ENERGY_REF);
    let r = ((base >> 16) & 255) * k;
    let gg = ((base >> 8) & 255) * k;
    let bb = (base & 255) * k;
    if (c.artificial[i]) {
      r = r * 0.68 + 0x9f * 0.32;
      gg = gg * 0.68 + 0xe8 * 0.32;
      bb = bb * 0.68 + 0xff * 0.32;
    }
    return ((r < 255 ? r : 255) << 16) | ((gg < 255 ? gg : 255) << 8) | (bb < 255 ? bb : 255);
  }

  // ---------------------------------------------------------- 事件特效

  private processEvents(): void {
    const s = this.snap;
    const fx = this.fx;
    if (!s || !fx) return;
    const evs = s.events;
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      if (ev.seq <= this.lastEventSeq) continue;
      if (ev.seq > this.lastEventSeq) this.lastEventSeq = ev.seq;
      if (ev.x === undefined || ev.y === undefined) continue;
      const wx = ev.x * TILE_PIXELS, wy = ev.y * TILE_PIXELS;
      const t = ev.type;
      if (t.includes('pred') || t.includes('捕食')) fx.predation(wx, wy);
      else if (t.includes('birth') || t.includes('出生') || t.includes('繁殖')) fx.birth(wx, wy);
      else if (t.includes('death') || t.includes('死')) fx.death(wx, wy);
      else if (t.includes('eat') || t.includes('进食')) fx.eat(wx, wy);
      else if (t.includes('drought') || t.includes('干旱')) fx.drought(wx, wy);
    }
    if (s.rainfall > 0.01) fx.setRain(s.rainfall, this.cam.visibleBounds(48));
    else fx.setRain(0, this.cam.visibleBounds(48));
  }

  // ---------------------------------------------------------- 动态层（植物 / 叠加）

  private updateDynamicLayers(): void {
    const s = this.snap;
    const tiles = s?.tiles ?? null;
    const w = this.worldW, h = this.worldH;

    // 植物层：仅重数值变化的单元格
    if (tiles && this.plantCtx) {
      const keys = this.plantKeys;
      for (let ty = 0; ty < h; ty++) {
        for (let tx = 0; tx < w; tx++) {
          const i = ty * w + tx;
          const g = tiles.grass[i], sh = tiles.shrub[i], ca = tiles.carcass[i];
          const key = (g >> 3) * 4096 + (sh >> 3) * 64 + (ca >> 3);
          if (key === keys[i]) continue;
          keys[i] = key;
          drawPlantCell(this.plantCtx, tx, ty, g, sh, ca, mulberry32((tx * 733 + ty * 977 + this.frameCount) | 0));
        }
      }
      this.plantSource?.update();
    }

    // 数据叠加层
    const ov = this.overlay;
    const anyOn = ov.vegetation || ov.moisture || ov.nutrients || ov.activity || ov.population || ov.carcass;
    if (!anyOn || !tiles || !this.overlayCtx || !this.overlayImg) {
      this.overlayVisible = false;
      if (this.overlaySprite) this.overlaySprite.visible = false;
      return;
    }
    this.overlayVisible = true;
    if (this.overlaySprite) this.overlaySprite.visible = true;

    // 活动 / 种群：统计每格生物数
    if (ov.activity || ov.population) {
      this.density.fill(0);
      const c = s?.creatures;
      if (c) {
        const n = Math.min(c.count, POOL_SIZE);
        for (let i = 0; i < n; i++) {
          const tx = c.x[i] | 0, ty = c.y[i] | 0;
          if (tx >= 0 && ty >= 0 && tx < w && ty < h) this.density[ty * w + tx]++;
        }
      }
    }

    const data = this.overlayImg.data;
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const i = ty * w + tx, o = i * 4;
        let r = 0, g = 0, b = 0, a = 0;
        if (ov.vegetation) {
          const gv = tiles.grass[i] / 255, sv = tiles.shrub[i] / 255;
          if (gv > 0.03) {
            const col = mixRgb(C_MEADOW_DARK, C_GRASS, gv);
            const al = gv * 110;
            r += col[0] * al; g += col[1] * al; b += col[2] * al; a += al;
          }
          if (sv > 0.03) {
            const al = sv * 100;
            r += C_SHRUB[0] * al; g += C_SHRUB[1] * al; b += C_SHRUB[2] * al; a += al;
          }
        }
        if (ov.moisture) {
          const al = (tiles.moisture[i] / 255) * 140;
          r += C_WATER[0] * al; g += C_WATER[1] * al; b += C_WATER[2] * al; a += al;
        }
        if (ov.nutrients) {
          const al = (tiles.nutrients[i] / 255) * 120;
          r += C_NUTRIENT[0] * al; g += C_NUTRIENT[1] * al; b += C_NUTRIENT[2] * al; a += al;
        }
        if (ov.carcass) {
          const al = (tiles.carcass[i] / 255) * 150;
          r += C_CARCASS[0] * al; g += C_CARCASS[1] * al; b += C_CARCASS[2] * al; a += al;
        }
        const cnt = this.density[i];
        if (ov.activity && cnt > 0) {
          const col = heatColor(cnt / 5);
          const al = Math.min(170, 50 + 45 * cnt);
          r += col[0] * al; g += col[1] * al; b += col[2] * al; a += al;
        }
        if (ov.population && cnt > 0) {
          const al = Math.min(110, cnt * 10);
          r += C_PANEL[0] * al; g += C_PANEL[1] * al; b += C_PANEL[2] * al; a += al;
        }
        if (a > 0) {
          const inv = 1 / a; // 预乘累加值还原为普通颜色
          data[o] = r * inv;
          data[o + 1] = g * inv;
          data[o + 2] = b * inv;
          data[o + 3] = a > 255 ? 255 : a;
        } else {
          data[o + 3] = 0;
        }
      }
    }
    this.overlayCtx.putImageData(this.overlayImg, 0, 0);
    this.overlaySource?.update();
  }

  // ---------------------------------------------------------- 夜色 / 画笔

  private updateNight(): void {
    const gfx = this.nightGfx;
    if (!gfx) return;
    const light = clamp01(this.snap?.light ?? 1);
    if (!this.nightDirty && Math.abs(light - this.nightLastLight) <= 0.015) return;
    this.nightDirty = false;
    this.nightLastLight = light;
    const t = 1 - light;
    const r = Math.round(C_DAY_WARM[0] + (C_NIGHT[0] - C_DAY_WARM[0]) * t);
    const g = Math.round(C_DAY_WARM[1] + (C_NIGHT[1] - C_DAY_WARM[1]) * t);
    const b = Math.round(C_DAY_WARM[2] + (C_NIGHT[2] - C_DAY_WARM[2]) * t);
    const a = 0.05 + 0.4 * t; // PALETTE.night 夜色上限 0.45
    gfx.clear();
    gfx.scale.set(this.dpr);
    gfx.rect(0, 0, this.viewW, this.viewH).fill({ color: (r << 16) | (g << 8) | b, alpha: a });
  }

  private updateBrushCursor(): void {
    const gfx = this.brushGfx;
    if (!gfx) return;
    if (!this.brushVis) {
      if (this.brushLastKey !== -1) {
        gfx.clear();
        this.brushLastKey = -1;
      }
      return;
    }
    const key =
      ((this.brushTX * 73856093) ^ (this.brushTY * 19349663) ^ (this.brushR * 83492791) ^ (Math.round(this.cam.zoom * 64) * 31)) | 0;
    if (key === this.brushLastKey) return;
    this.brushLastKey = key;
    const r = this.brushR * TILE_PIXELS;
    const w = 1.5 / (this.cam.zoom * this.cam.dpr);
    gfx.clear();
    gfx.circle(0, 0, r).fill({ color: 0xf2e6b8, alpha: 0.08 });
    gfx.circle(0, 0, r).stroke({ width: w, color: 0xf2e6b8, alpha: 0.9 });
    gfx.position.set(this.brushTX * TILE_PIXELS + TILE_PIXELS / 2, this.brushTY * TILE_PIXELS + TILE_PIXELS / 2);
  }

  // ---------------------------------------------------------- 交互

  private bindPointer(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private unbindPointer(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  private toLocal(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = this.toLocal(e);
    this.dragging = true;
    this.dragMoved = 0;
    this.lastPX = p.x;
    this.lastPY = p.y;
    this.paintTX = -1;
    this.paintTY = -1;
    if (this.brushVis) this.paintAt(p.x, p.y);
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* 忽略 */
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const p = this.toLocal(e);
    const dx = p.x - this.lastPX, dy = p.y - this.lastPY;
    this.lastPX = p.x;
    this.lastPY = p.y;
    this.dragMoved += Math.abs(dx) + Math.abs(dy);
    if (this.brushVis) {
      // 画笔模式：拖动只绘制，不平移相机（避免涂抹拖影）
      this.paintAt(p.x, p.y);
      return;
    }
    if (this.cam.trackX !== null || this.cam.trackY !== null) this.track(null, null);
    this.cam.panByScreen(dx, dy);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    try {
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* 忽略 */
    }
    // 画笔模式（含刚切换工具的首次点击）只绘制不拾取，与 UI 兜底语义一致
    if (this.dragMoved < CLICK_SLOP && !this.brushVis && this.time - this.brushSeenAt > 1) {
      this.pickAt(this.lastPX, this.lastPY);
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.toLocal(e);
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    this.zoomAt(factor, p.x, p.y);
  };

  /** 从近到远命中，容差 PICK_TOLERANCE 屏幕 px */
  private pickAt(sx: number, sy: number): void {
    const s = this.snap;
    if (!s) {
      this.cb.onPickCreature(null);
      return;
    }
    const c = s.creatures;
    const n = Math.min(c.count, POOL_SIZE);
    const tol2 = PICK_TOLERANCE * PICK_TOLERANCE;
    let bestId: number | null = null;
    let bestD2 = tol2;
    for (let i = 0; i < n; i++) {
      const p = this.cam.worldToScreen(c.x[i] * TILE_PIXELS, c.y[i] * TILE_PIXELS);
      const dx = p.x - sx, dy = p.y - sy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestId = c.id[i];
      }
    }
    this.cb.onPickCreature(bestId);
  }

  /** 同一格子只触发一次，直到移出该格 */
  private paintAt(sx: number, sy: number): void {
    const w = this.cam.screenToWorld(sx, sy);
    const tx = Math.floor(w.x / TILE_PIXELS);
    const ty = Math.floor(w.y / TILE_PIXELS);
    if (tx === this.paintTX && ty === this.paintTY) return;
    this.paintTX = tx;
    this.paintTY = ty;
    if (tx < 0 || ty < 0 || tx >= this.worldW || ty >= this.worldH) return;
    this.cb.onPaintTile(tx, ty);
  }

  // ---------------------------------------------------------- Canvas2D 兜底

  private startFallback(): void {
    this.canvas.width = Math.round(this.viewW * this.dpr);
    this.canvas.height = Math.round(this.viewH * this.dpr);
    this.fbLastT = performance.now();
    this.fbRaf = requestAnimationFrame(this.fbLoop);
  }

  private fbLoop = (now: number): void => {
    this.fbRaf = requestAnimationFrame(this.fbLoop);
    const dt = Math.min(0.1, Math.max(0, now - this.fbLastT) / 1000);
    this.fbLastT = now;
    this.stepFrame(dt);
    this.drawFallbackFrame();
    this.fpsFrames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      const fps = Math.round(this.fpsFrames / this.fpsTimer);
      this.lastFps = fps;
      this.fpsFrames = 0;
      this.fpsTimer = 0;
      this.cb.onFps(fps);
      this.reportZoom();
    }
  };

  /** 兜底渲染：地形 + 植物 + 叠加 + 圆点生物 + 夜色 + 画笔 */
  private drawFallbackFrame(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const cam = this.cam;
    const dpr = cam.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1a1712';
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);

    const z = cam.zoom;
    const worldPxW = this.worldW * TILE_PIXELS;
    const worldPxH = this.worldH * TILE_PIXELS;
    ctx.save();
    ctx.translate(cam.viewW / 2 - cam.cx * z, cam.viewH / 2 - cam.cy * z);
    ctx.scale(z, z);
    if (this.terrainCanvas) ctx.drawImage(this.terrainCanvas, 0, 0);
    // 植物层 8px/tile、叠加层 1px/tile：拉伸到 32px/tile 的世界尺寸（最近邻）
    if (this.plantCanvas) ctx.drawImage(this.plantCanvas, 0, 0, worldPxW, worldPxH);
    if (this.overlayVisible && this.overlayCanvas) {
      ctx.globalAlpha = 0.55;
      ctx.drawImage(this.overlayCanvas, 0, 0, worldPxW, worldPxH);
      ctx.globalAlpha = 1;
    }

    const s = this.snap;
    if (s) {
      const c = s.creatures;
      const n = Math.min(c.count, POOL_SIZE);
      const b = cam.visibleBounds(32);
      let selX = -1, selY = -1, selR = 4;
      for (let i = 0; i < n; i++) {
        const wx = c.x[i] * TILE_PIXELS, wy = c.y[i] * TILE_PIXELS;
        if (wx < b.x0 || wx > b.x1 || wy < b.y0 || wy > b.y1) continue;
        const r = clamp(c.size[i] * TILE_PIXELS, 2, 11);
        ctx.fillStyle = speciesColor(c.species[i] & 3);
        ctx.beginPath();
        ctx.arc(wx, wy, r, 0, Math.PI * 2);
        ctx.fill();
        const hd = c.heading[i];
        ctx.fillStyle = '#2b2620';
        ctx.beginPath();
        ctx.arc(wx + Math.cos(hd) * r * 0.65, wy + Math.sin(hd) * r * 0.65, Math.max(0.9, r * 0.3), 0, Math.PI * 2);
        ctx.fill();
        if (c.id[i] === this.selectedId) {
          selX = wx; selY = wy; selR = r;
        }
      }
      if (selX >= 0) {
        ctx.strokeStyle = '#f2e6b8';
        ctx.lineWidth = 1.5 / (z * dpr);
        ctx.beginPath();
        ctx.arc(selX, selY, selR + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#f2e6b8';
        ctx.beginPath();
        ctx.moveTo(selX - 4, selY - selR - 12);
        ctx.lineTo(selX + 4, selY - selR - 12);
        ctx.lineTo(selX, selY - selR - 6);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();

    // 夜色
    const t = 1 - clamp01(s?.light ?? 1);
    if (t > 0.01) {
      const r = Math.round(C_DAY_WARM[0] + (C_NIGHT[0] - C_DAY_WARM[0]) * t);
      const g = Math.round(C_DAY_WARM[1] + (C_NIGHT[1] - C_DAY_WARM[1]) * t);
      const b = Math.round(C_DAY_WARM[2] + (C_NIGHT[2] - C_DAY_WARM[2]) * t);
      ctx.fillStyle = `rgba(${r},${g},${b},${(0.05 + 0.4 * t).toFixed(3)})`;
      ctx.fillRect(0, 0, cam.viewW, cam.viewH);
    }

    // 画笔范围
    if (this.brushVis) {
      ctx.strokeStyle = 'rgba(242,230,184,0.9)';
      ctx.fillStyle = 'rgba(242,230,184,0.08)';
      ctx.lineWidth = 1.5;
      const cxp = (this.brushTX * TILE_PIXELS + TILE_PIXELS / 2 - cam.cx) * z + cam.viewW / 2;
      const cyp = (this.brushTY * TILE_PIXELS + TILE_PIXELS / 2 - cam.cy) * z + cam.viewH / 2;
      const rp = this.brushR * TILE_PIXELS * z;
      ctx.beginPath();
      ctx.arc(cxp, cyp, rp, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------- 销毁

  destroy(): void {
    this.unbindPointer();
    if (this.fbRaf) cancelAnimationFrame(this.fbRaf);
    this.fbRaf = 0;
    if (this.app) {
      this.app.ticker.remove(this.onTick);
      this.app.destroy(false, { children: true, texture: true, textureSource: true, context: true });
      this.app = null;
    }
    this.fx?.destroy();
    this.fx = null;
    this.fxTex?.destroy();
    this.fxTex = null;
    this.atlas?.destroy();
    this.atlas = null;
    this.disposeLayer(this.terrainSprite, this.terrainSource);
    this.disposeLayer(this.plantSprite, this.plantSource);
    this.disposeLayer(this.overlaySprite, this.overlaySource);
    this.terrainSprite = null;
    this.plantSprite = null;
    this.overlaySprite = null;
    this.pool = [];
  }

  debugInfo(): { fps: number; rendererType: string; sprites: number } {
    return {
      fps: this.lastFps,
      rendererType: this.app ? 'webgl' : 'canvas2d',
      sprites: this.atlas?.count ?? 0,
    };
  }
}
