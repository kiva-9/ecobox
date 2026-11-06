// 程序化像素素材生成：地形全图、植物单元格、生物像素图集、特效纹理。
// 全部用 canvas 2D 逐像素绘制，最近邻放大，统一 32px/地形块密度。
// 所有"随机"均为确定性哈希（纯视觉），不引用 src/sim 的模拟 RNG。

import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import { PALETTE } from '../../shared/protocol';

export const TILE_PIXELS = 32;
/** 植物动态层每 tile 的像素数（放大 4 倍到 32px，保持颗粒感） */
export const PLANT_PX = 8;
/** 生物图集单元格边长（px），精灵朝右为 0 方向 */
export const CREATURE_CELL = 16;
/** 每变体帧数：0-3 行走，4 进食，5 受惊 */
export const CREATURE_FRAMES = 6;
export const SENSE_TIERS = 3;
export const BELLY_TIERS = 2;
export const SPECIES_COUNT = 4;
/** 精灵设计直径（px），用于 size 基因 -> sprite.scale 换算 */
export const CREATURE_DIAMETER = 13;

// ---------------------------------------------------------------- 确定性随机

/** 二维整数坐标 + 种子 -> [0,1) 确定性哈希 */
export function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

/** mulberry32 小型 PRNG（仅用于素材生成的确定性细节） */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- 颜色工具

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToInt(c: Rgb): number {
  return ((c[0] & 255) << 16) | ((c[1] & 255) << 8) | (c[2] & 255);
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** RGB -> HSV -> 色相偏移 -> RGB（speed 基因驱动体色色相） */
export function shiftHue(c: Rgb, deg: number): Rgb {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = (h * 60 + deg + 360) % 60;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  const c2 = v * s;
  const x = c2 * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c2;
  let rgb: Rgb;
  if (h < 60) rgb = [c2, x, 0];
  else if (h < 120) rgb = [x, c2, 0];
  else if (h < 180) rgb = [0, c2, x];
  else if (h < 240) rgb = [0, x, c2];
  else if (h < 300) rgb = [x, 0, c2];
  else rgb = [c2, 0, x];
  return [
    Math.round((rgb[0] + m) * 255),
    Math.round((rgb[1] + m) * 255),
    Math.round((rgb[2] + m) * 255),
  ];
}

// ---------------------------------------------------------------- 地形

const TERRAIN = {
  water: hexToRgb(PALETTE.water),
  waterDeep: hexToRgb(PALETTE.waterDeep),
  rock: hexToRgb(PALETTE.rock),
  meadow: hexToRgb(PALETTE.meadow),
  meadowDark: hexToRgb(PALETTE.meadowDark),
  woodland: hexToRgb(PALETTE.woodland),
  woodlandDark: hexToRgb(PALETTE.woodlandDark),
  arid: hexToRgb(PALETTE.arid),
  aridDark: hexToRgb(PALETTE.aridDark),
  grass: hexToRgb(PALETTE.grass),
  ink: hexToRgb(PALETTE.ink),
  panel: hexToRgb(PALETTE.panel),
};

const SAND: Rgb = [232, 217, 168];
const SAND_DARK: Rgb = [216, 194, 132];
const FOAM: Rgb = [207, 234, 242];
const ROCK_LIGHT: Rgb = [154, 145, 132];
const ROCK_DARK: Rgb = [99, 92, 82];
const WOOD_LIGHT: Rgb = [111, 158, 90];
const TRUNK: Rgb = [90, 74, 56];
const CRACK: Rgb = [179, 155, 94];
const WAVE: Rgb = [111, 179, 208];

/** 单像素填充 */
function px(ctx: CanvasRenderingContext2D, x: number, y: number, c: Rgb): void {
  ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
  ctx.fillRect(x, y, 1, 1);
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: Rgb): void {
  ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
  ctx.fillRect(x, y, w, h);
}

/** 像素椭圆（行扫描） */
function ellipsePx(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  c: Rgb,
): void {
  for (let dy = -ry; dy <= ry; dy++) {
    const t = dy / ry;
    const half = Math.floor(rx * Math.sqrt(Math.max(0, 1 - t * t)) + 0.5);
    if (half <= 0) continue;
    rect(ctx, cx - half, cy + dy, half * 2 + 1, 1, c);
  }
}

/** 像素直线（Bresenham） */
function linePx(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c: Rgb,
): void {
  let x = x0 | 0, y = y0 | 0;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (let guard = 0; guard < 64; guard++) {
    px(ctx, x, y, c);
    if (x === (x1 | 0) && y === (y1 | 0)) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

type TilePainter = (ctx: CanvasRenderingContext2D, ox: number, oy: number, rnd: () => number) => void;

const paintMeadow: TilePainter = (ctx, ox, oy, rnd) => {
  rect(ctx, ox, oy, 32, 32, TERRAIN.meadow);
  // 深色草斑块
  const patches = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < patches; i++) {
    const bx = ox + Math.floor(rnd() * 28), by = oy + Math.floor(rnd() * 28);
    rect(ctx, bx, by, 2, 2, TERRAIN.meadowDark);
    if (rnd() < 0.5) rect(ctx, bx + 2, by + 1, 1, 1, TERRAIN.meadowDark);
  }
  // 草叶斑点
  const blades = 8 + Math.floor(rnd() * 8);
  for (let i = 0; i < blades; i++) {
    const bx = ox + Math.floor(rnd() * 31), by = oy + 4 + Math.floor(rnd() * 26);
    const h = 2 + Math.floor(rnd() * 2);
    for (let k = 0; k < h; k++) px(ctx, bx, by - k, TERRAIN.grass);
  }
  // 偶尔小花
  if (rnd() < 0.18) {
    const bx = ox + 2 + Math.floor(rnd() * 27), by = oy + 2 + Math.floor(rnd() * 27);
    px(ctx, bx, by, TERRAIN.panel);
    px(ctx, bx + 1, by, hexToRgb('#e8a95c'));
  }
};

const paintWoodland: TilePainter = (ctx, ox, oy, rnd) => {
  rect(ctx, ox, oy, 32, 32, TERRAIN.woodland);
  // 树冠颗粒簇
  const crowns = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < crowns; i++) {
    const bx = ox + 2 + Math.floor(rnd() * 24), by = oy + 2 + Math.floor(rnd() * 22);
    const w = 4 + Math.floor(rnd() * 3), h = 4 + Math.floor(rnd() * 2);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const edge = (dx === 0 || dy === 0 || dx === w - 1 || dy === h - 1) && rnd() < 0.45;
        if (edge) continue;
        px(ctx, bx + dx, by + dy, TERRAIN.woodlandDark);
      }
    }
    // 冠部受光颗粒
    for (let k = 0; k < 3; k++) {
      px(ctx, bx + Math.floor(rnd() * w), by + Math.floor(rnd() * 2), WOOD_LIGHT);
    }
    // 树干
    if (rnd() < 0.5) {
      rect(ctx, bx + (w >> 1), by + h, 1, 3, TRUNK);
    }
  }
  // 地面落叶
  for (let i = 0; i < 6; i++) {
    px(ctx, ox + Math.floor(rnd() * 32), oy + Math.floor(rnd() * 32), WOOD_LIGHT);
  }
};

const paintArid: TilePainter = (ctx, ox, oy, rnd) => {
  rect(ctx, ox, oy, 32, 32, TERRAIN.arid);
  // 干裂纹
  const cracks = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < cracks; i++) {
    let x = ox + Math.floor(rnd() * 26), y = oy + Math.floor(rnd() * 26);
    const len = 3 + Math.floor(rnd() * 4);
    const dir = rnd() < 0.5 ? 1 : -1;
    for (let k = 0; k < len; k++) {
      px(ctx, x, y, CRACK);
      x += 1;
      if (rnd() < 0.6) y += dir;
    }
  }
  // 碎石与暗斑
  for (let i = 0; i < 5; i++) {
    px(ctx, ox + Math.floor(rnd() * 32), oy + Math.floor(rnd() * 32), TERRAIN.aridDark);
  }
  for (let i = 0; i < 2; i++) {
    const bx = ox + Math.floor(rnd() * 30), by = oy + Math.floor(rnd() * 30);
    rect(ctx, bx, by, 2, 1, ROCK_LIGHT);
  }
};

const paintWater: TilePainter = (ctx, ox, oy, rnd) => {
  rect(ctx, ox, oy, 32, 32, TERRAIN.water);
  // 深水斑
  const deep = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < deep; i++) {
    const bx = ox + Math.floor(rnd() * 27), by = oy + Math.floor(rnd() * 28);
    rect(ctx, bx, by, 4, 2, TERRAIN.waterDeep);
  }
  // 水波纹（短横线）
  const waves = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < waves; i++) {
    const bx = ox + Math.floor(rnd() * 26), by = oy + Math.floor(rnd() * 31);
    rect(ctx, bx, by, 3, 1, WAVE);
  }
};

const paintRock: TilePainter = (ctx, ox, oy, rnd) => {
  rect(ctx, ox, oy, 32, 32, TERRAIN.rock);
  // 受光面 / 背光面
  const bx = ox + 2 + Math.floor(rnd() * 20), by = oy + 2 + Math.floor(rnd() * 20);
  rect(ctx, bx, by, 3, 3, ROCK_LIGHT);
  rect(ctx, bx + 4, by + 4, 3, 3, ROCK_DARK);
  // 颗粒
  for (let i = 0; i < 6; i++) {
    px(ctx, ox + Math.floor(rnd() * 32), oy + Math.floor(rnd() * 32), ROCK_LIGHT);
    px(ctx, ox + Math.floor(rnd() * 32), oy + Math.floor(rnd() * 32), ROCK_DARK);
  }
};

const PAINTERS: TilePainter[] = [paintWater, paintRock, paintMeadow, paintWoodland, paintArid];

/**
 * 生成完整地形层（w*32 x h*32 像素）：
 * 五种地形统一 32px 密度与 PALETTE 配色，水域与陆地交界处绘制沙滩过渡像素。
 */
export function buildTerrainCanvas(terrain: Uint8Array, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w * TILE_PIXELS;
  canvas.height = h * TILE_PIXELS;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = false;

  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= w || y >= h ? -1 : terrain[y * w + x];

  // 第一遍：基础地形 + 细节
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const t = terrain[ty * w + tx];
      const painter = PAINTERS[t] ?? paintMeadow;
      painter(ctx, tx * TILE_PIXELS, ty * TILE_PIXELS, mulberry32((tx * 733 + ty * 977 + t * 131) | 0));
    }
  }

  // 第二遍：水域 -> 沙滩过渡（水侧 3px 沙带 + 泡沫线，陆地侧 2px 沙缘）
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const t = terrain[ty * w + tx];
      const ox = tx * TILE_PIXELS, oy = ty * TILE_PIXELS;
      const rnd = mulberry32((tx * 613 + ty * 1559) | 0);
      if (t === 0) {
        // 水块：朝陆地的边绘沙带
        if (at(tx, ty - 1) > 0) {
          for (let x = 0; x < 32; x++) {
            if (rnd() < 0.7) px(ctx, ox + x, oy, FOAM);
            px(ctx, ox + x, oy + 1, SAND);
            if (rnd() < 0.6) px(ctx, ox + x, oy + 2, SAND);
            if (rnd() < 0.3) px(ctx, ox + x, oy + 3, SAND_DARK);
          }
        }
        if (at(tx, ty + 1) > 0) {
          for (let x = 0; x < 32; x++) {
            if (rnd() < 0.7) px(ctx, ox + x, oy + 31, FOAM);
            px(ctx, ox + x, oy + 30, SAND);
            if (rnd() < 0.6) px(ctx, ox + x, oy + 29, SAND);
            if (rnd() < 0.3) px(ctx, ox + x, oy + 28, SAND_DARK);
          }
        }
        if (at(tx - 1, ty) > 0) {
          for (let y = 0; y < 32; y++) {
            if (rnd() < 0.7) px(ctx, ox, oy + y, FOAM);
            px(ctx, ox + 1, oy + y, SAND);
            if (rnd() < 0.6) px(ctx, ox + 2, oy + y, SAND);
            if (rnd() < 0.3) px(ctx, ox + 3, oy + y, SAND_DARK);
          }
        }
        if (at(tx + 1, ty) > 0) {
          for (let y = 0; y < 32; y++) {
            if (rnd() < 0.7) px(ctx, ox + 31, oy + y, FOAM);
            px(ctx, ox + 30, oy + y, SAND);
            if (rnd() < 0.6) px(ctx, ox + 29, oy + y, SAND);
            if (rnd() < 0.3) px(ctx, ox + 28, oy + y, SAND_DARK);
          }
        }
      } else if (t !== 1) {
        // 陆地（非岩石）：朝水的边绘 2px 沙缘（抖动过渡）
        if (at(tx, ty - 1) === 0) {
          for (let x = 0; x < 32; x++) {
            px(ctx, ox + x, oy, SAND);
            if (rnd() < 0.5) px(ctx, ox + x, oy + 1, SAND_DARK);
          }
        }
        if (at(tx, ty + 1) === 0) {
          for (let x = 0; x < 32; x++) {
            px(ctx, ox + x, oy + 31, SAND);
            if (rnd() < 0.5) px(ctx, ox + x, oy + 30, SAND_DARK);
          }
        }
        if (at(tx - 1, ty) === 0) {
          for (let y = 0; y < 32; y++) {
            px(ctx, ox, oy + y, SAND);
            if (rnd() < 0.5) px(ctx, ox + 1, oy + y, SAND_DARK);
          }
        }
        if (at(tx + 1, ty) === 0) {
          for (let y = 0; y < 32; y++) {
            px(ctx, ox + 31, oy + y, SAND);
            if (rnd() < 0.5) px(ctx, ox + 30, oy + y, SAND_DARK);
          }
        }
      }
    }
  }
  return canvas;
}

// ---------------------------------------------------------------- 植物单元格（8x8）

const PLANT = {
  grassLight: hexToRgb(PALETTE.grass),
  grassDark: hexToRgb(PALETTE.meadowDark),
  shrubDark: hexToRgb('#a85470'),
  shrub: hexToRgb(PALETTE.shrub),
  berry: hexToRgb(PALETTE.species[2]),
  bone: hexToRgb('#cfc8b4'),
  boneDark: hexToRgb('#6b6353'),
};

/**
 * 在植物层（8px/tile）绘制一个单元格：青草矮丛 / 浆果灌丛（红果）/ 残骸白骨。
 * 调用方负责在数值变化时重绘并 texSource.update()。
 */
export function drawPlantCell(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  grass: number,
  shrub: number,
  carcass: number,
  rnd: () => number,
): void {
  const x0 = tx * PLANT_PX, y0 = ty * PLANT_PX;
  ctx.clearRect(x0, y0, PLANT_PX, PLANT_PX);

  if (grass > 10) {
    const n = 2 + (grass >> 6);
    const inten = grass / 255;
    for (let i = 0; i < n; i++) {
      const bx = x0 + Math.floor(rnd() * 7);
      const by = y0 + 6 + Math.floor(rnd() * 2);
      const hgt = 2 + Math.floor(inten * 2.2);
      const c = mixRgb(PLANT.grassDark, PLANT.grassLight, 0.35 + rnd() * 0.65);
      for (let k = 0; k < hgt; k++) px(ctx, bx, by - k, c);
    }
  }

  if (shrub > 10) {
    const bw = 3 + (shrub >> 7);
    const bh = 2 + (shrub >> 7);
    const bx = x0 + Math.floor(rnd() * (PLANT_PX - bw));
    const by = y0 + PLANT_PX - 1 - bh;
    rect(ctx, bx, by, bw, bh, PLANT.shrubDark);
    rect(ctx, bx, by, bw - 1, 1, PLANT.shrub);
    px(ctx, bx, by, PLANT.grassLight);
    if (shrub > 110) {
      // 红果像素
      px(ctx, bx + 1, by + 1, PLANT.berry);
      px(ctx, bx + bw - 1, by + bh - 1, PLANT.berry);
    }
  }

  if (carcass > 10) {
    const bx = x0 + 1 + Math.floor(rnd() * 4);
    const by = y0 + 2 + Math.floor(rnd() * 4);
    rect(ctx, bx, by, 3, 1, PLANT.bone);
    px(ctx, bx + 3, by, PLANT.boneDark);
    px(ctx, bx + 1, by + 2, PLANT.boneDark);
    px(ctx, bx, by - 1, PLANT.bone);
  }
}

// ---------------------------------------------------------------- 生物图集

export interface CreatureAtlas {
  source: CanvasSource;
  /** 取一帧纹理：species x sense 档 x 腹部档 x 帧号 */
  get(species: number, sense: number, belly: number, frame: number): Texture;
  /** 图集帧纹理总数 */
  count: number;
  destroy(): void;
}

interface SpeciesLook {
  base: Rgb;
  dark: Rgb;
  light: Rgb;
  eye: Rgb;
}

const LOOKS: SpeciesLook[] = PALETTE.species.map((hex, i) => ({
  base: hexToRgb(hex),
  dark: hexToRgb(PALETTE.speciesDark[i]),
  light: mixRgb(hexToRgb(hex), [255, 255, 255], 0.35),
  eye: TERRAIN.ink,
}));

const BELLY_LIGHT: Rgb = [255, 246, 216];

/** 腿部相位：frame 0..3 两套交替步态 + 身体起伏 */
const LEG_PHASE = [0, 1, 0, 1];

/**
 * 生成生物像素图集：4 物种 x 3 感知档（附肢长度）x 2 腹部明暗档 x 6 帧。
 * 精灵朝右绘制（heading 弧度直接作为 sprite.rotation）。
 */
export function buildCreatureAtlas(): CreatureAtlas {
  const cols = 12;
  const rows = (SPECIES_COUNT * SENSE_TIERS * BELLY_TIERS * CREATURE_FRAMES) / cols;
  const canvas = document.createElement('canvas');
  canvas.width = cols * CREATURE_CELL;
  canvas.height = rows * CREATURE_CELL;
  const ctx = canvas.getContext('2d');
  const textures: Texture[] = [];

  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    for (let sp = 0; sp < SPECIES_COUNT; sp++) {
      for (let sense = 0; sense < SENSE_TIERS; sense++) {
        for (let belly = 0; belly < BELLY_TIERS; belly++) {
          for (let f = 0; f < CREATURE_FRAMES; f++) {
            const idx = ((sp * SENSE_TIERS + sense) * BELLY_TIERS + belly) * CREATURE_FRAMES + f;
            const col = idx % cols, row = (idx / cols) | 0;
            ctx.save();
            ctx.translate(col * CREATURE_CELL, row * CREATURE_CELL);
            drawCreatureCell(ctx, sp, sense, belly, f);
            ctx.restore();
          }
        }
      }
    }
  }

  const source = new CanvasSource({ resource: canvas, scaleMode: 'nearest', resolution: 1 });
  for (let i = 0; i < SPECIES_COUNT * SENSE_TIERS * BELLY_TIERS * CREATURE_FRAMES; i++) {
    const col = i % cols, row = (i / cols) | 0;
    textures.push(new Texture({ source, frame: new Rectangle(col * CREATURE_CELL, row * CREATURE_CELL, CREATURE_CELL, CREATURE_CELL) }));
  }

  return {
    source,
    count: textures.length,
    get(species: number, sense: number, belly: number, frame: number): Texture {
      const s = Math.max(0, Math.min(SPECIES_COUNT - 1, species | 0));
      const se = Math.max(0, Math.min(SENSE_TIERS - 1, sense | 0));
      const be = Math.max(0, Math.min(BELLY_TIERS - 1, belly | 0));
      const f = Math.max(0, Math.min(CREATURE_FRAMES - 1, frame | 0));
      return textures[((s * SENSE_TIERS + se) * BELLY_TIERS + be) * CREATURE_FRAMES + f];
    },
    destroy(): void {
      for (const t of textures) t.destroy(true);
      source.destroy();
    },
  };
}

/** 绘制单个生物单元格（16x16，朝右） */
function drawCreatureCell(
  ctx: CanvasRenderingContext2D,
  sp: number,
  sense: number,
  belly: number,
  frame: number,
): void {
  const look = LOOKS[sp];
  const isEat = frame === 4;
  const isStartle = frame === 5;
  const walk = frame & 3;
  const step = LEG_PHASE[walk];
  const bob = walk === 1 || walk === 3 ? -1 : 0; // 行走身体起伏
  const yBase = 8 + bob + (isStartle ? -1 : 0);
  const legDrop = isStartle ? 4 : step === 0 ? 3 : 2;

  // ---- 附肢（sense 基因 -> 触角/耳羽/棘刺长度，短/中/长 3 档）
  if (sp === 0 || sp === 1) {
    // 耳羽
    const earLen = 1 + sense;
    for (let k = 0; k < earLen; k++) {
      px(ctx, 12 - (sense === 2 ? k : 0), yBase - 4 - k, look.dark);
    }
    if (sense === 2) px(ctx, 10, yBase - 4, look.light);
  } else if (sp === 2) {
    // 背部棘刺
    const n = sense + 1;
    for (let k = 0; k < n; k++) {
      px(ctx, 8 - k * 2, yBase - 4 - k, look.dark);
    }
  } else {
    // 触角
    const antLen = 1 + sense;
    for (let k = 0; k < antLen; k++) {
      px(ctx, 12 + (sense === 2 ? k : 0), yBase - 4 - k, look.dark);
    }
  }

  // ---- 腿部（4 条，步态交替）
  const legXs = sp === 1 ? [3, 5, 9, 11] : [4, 6, 9, 11];
  for (let i = 0; i < 4; i++) {
    const lift = (i + step) % 2 === 0 ? 0 : 1;
    const ly = yBase + (sp === 1 ? 4 : 3) + (lift ? -1 : 0);
    linePx(ctx, legXs[i], ly, legXs[i], ly + legDrop - lift, look.dark);
  }

  // ---- 躯干
  if (sp === 0) {
    ellipsePx(ctx, 7, yBase, 4, 3, look.base);
    rect(ctx, 4, yBase + 2, 8, 1, look.dark); // 腹线
    // 尾
    px(ctx, 2, yBase - 1, look.dark);
    px(ctx, 3, yBase - 1, look.base);
  } else if (sp === 1) {
    ellipsePx(ctx, 7, yBase, 5, 4, look.base);
    rect(ctx, 3, yBase + 3, 10, 1, look.dark);
    px(ctx, 2, yBase - 1, look.dark);
    px(ctx, 3, yBase - 1, look.base);
    // 角
    px(ctx, 11, yBase - 5, look.light);
    px(ctx, 12, yBase - 6, look.light);
  } else if (sp === 2) {
    ellipsePx(ctx, 7, yBase, 5, 3, look.base);
    rect(ctx, 3, yBase + 2, 10, 1, look.dark);
    // 背部条纹
    px(ctx, 6, yBase - 3, look.dark);
    px(ctx, 8, yBase - 3, look.dark);
    // 长尾
    linePx(ctx, 2, yBase - 1, 0, yBase - 3, look.dark);
  } else {
    ellipsePx(ctx, 7, yBase + 1, 4, 3, look.base);
    rect(ctx, 4, yBase + 3, 8, 1, look.dark);
    // 翅簇
    rect(ctx, 6, yBase - 3, 3, 2, look.dark);
    px(ctx, 7, yBase - 4, look.light);
    // 尾羽
    px(ctx, 2, yBase, look.dark);
    px(ctx, 3, yBase - 1, look.dark);
  }

  // ---- reproInvest 基因 -> 腹部斑块明暗
  if (belly === 1) {
    if (sp === 0) rect(ctx, 5, yBase + 1, 4, 1, BELLY_LIGHT);
    else if (sp === 1) rect(ctx, 4, yBase + 2, 6, 1, BELLY_LIGHT);
    else if (sp === 2) rect(ctx, 5, yBase + 1, 4, 1, BELLY_LIGHT);
    else rect(ctx, 5, yBase + 2, 4, 1, BELLY_LIGHT);
  }

  // ---- 头部（朝右）
  const headY = yBase - 2 + (isEat ? 1 : 0);
  if (sp === 0) {
    rect(ctx, 11, headY, 3, 3, look.base);
    px(ctx, 11, headY + 2, look.dark);
    px(ctx, 12, headY + 1, look.eye); // 眼
    if (isEat) {
      px(ctx, 13, headY + 3, look.eye);
      px(ctx, 14, headY + 3, look.eye); // 张嘴
      px(ctx, 14, headY + 2, PLANT.grassLight); // 食物
    } else {
      px(ctx, 13, headY + 2, look.dark);
    }
  } else if (sp === 1) {
    rect(ctx, 11, headY, 4, 3, look.base);
    px(ctx, 11, headY + 2, look.dark);
    px(ctx, 13, headY + 1, look.eye);
    if (isEat) {
      rect(ctx, 13, headY + 3, 2, 1, look.eye);
      px(ctx, 15, headY + 2, PLANT.grassLight);
    } else {
      px(ctx, 14, headY + 2, look.dark);
    }
  } else if (sp === 2) {
    rect(ctx, 11, headY, 3, 3, look.base);
    rect(ctx, 13, headY + 1, 2, 1, look.base); // 尖吻
    px(ctx, 12, headY + 1, look.eye);
    if (isEat) {
      px(ctx, 14, headY + 2, look.eye);
      px(ctx, 15, headY + 2, look.eye);
      px(ctx, 15, headY + 1, hexToRgb(PALETTE.species[2]));
    } else {
      px(ctx, 14, headY + 2, look.dark);
    }
    // 眼
    if (isStartle) px(ctx, 12, headY, look.eye);
  } else {
    rect(ctx, 11, headY, 3, 3, look.base);
    px(ctx, 13, headY + 1, look.dark);
    px(ctx, 14, headY + 1, look.dark); // 喙
    px(ctx, 12, headY + 1, look.eye);
    if (isEat) {
      px(ctx, 14, headY + 2, look.eye);
      px(ctx, 15, headY + 2, PLANT.bone);
    }
  }

  // ---- 受惊：背部竖立像素
  if (isStartle) {
    for (let k = 0; k < 3; k++) {
      px(ctx, 5 + k * 2, yBase - 5, look.light);
    }
  }
}

// ---------------------------------------------------------------- 特效纹理

export interface EffectTextures {
  /** 3x3 圆点 */
  dot: Texture;
  /** 5x5 星点 */
  spark: Texture;
  /** 24x24 圆环（捕食冲击 / 选中圈） */
  ring: Texture;
  /** 2x7 竖线（降雨斜线，运行时旋转） */
  rain: Texture;
  /** 7x9 下箭头（选中标记） */
  arrow: Texture;
  destroy(): void;
}

function makeTexture(draw: (ctx: CanvasRenderingContext2D) => void, w: number, h: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    draw(ctx);
  }
  return new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: 'nearest', resolution: 1 }) });
}

/** 生成特效用白色小纹理（运行时用 tint 上色） */
export function buildEffectTextures(): EffectTextures {
  const dot = makeTexture((ctx) => {
    rect(ctx, 1, 0, 1, 3, [255, 255, 255]);
    rect(ctx, 0, 1, 3, 1, [255, 255, 255]);
  }, 3, 3);

  const spark = makeTexture((ctx) => {
    rect(ctx, 2, 0, 1, 5, [255, 255, 255]);
    rect(ctx, 0, 2, 5, 1, [255, 255, 255]);
    rect(ctx, 1, 1, 3, 3, [255, 255, 255]);
  }, 5, 5);

  const ring = makeTexture((ctx) => {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(12, 12, 10, 0, Math.PI * 2);
    ctx.stroke();
  }, 24, 24);

  const rain = makeTexture((ctx) => {
    rect(ctx, 0, 0, 2, 7, [255, 255, 255]);
  }, 2, 7);

  const arrow = makeTexture((ctx) => {
    rect(ctx, 3, 3, 1, 4, [255, 255, 255]);
    rect(ctx, 2, 6, 3, 1, [255, 255, 255]);
    rect(ctx, 1, 7, 5, 1, [255, 255, 255]);
    rect(ctx, 0, 8, 7, 1, [255, 255, 255]);
  }, 7, 9);

  return {
    dot,
    spark,
    ring,
    rain,
    arrow,
    destroy(): void {
      dot.destroy(true);
      spark.destroy(true);
      ring.destroy(true);
      rain.destroy(true);
      arrow.destroy(true);
    },
  };
}
