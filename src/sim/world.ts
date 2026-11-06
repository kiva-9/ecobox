// 世界状态：地形与资源场（水分/养分/两种植物/残骸），全部使用 TypedArray。
// 地形生成：值噪声 + 高度/湿度分层；预设可带河道与岩石簇。

import { RNG } from './rng';
import { Terrain, isPassableTerrain } from './constants';
import { WORLD, PLANTS } from './config';
import type { PresetDef } from './config';

/** 二维值噪声（周期性网格 + 双线性插值） */
class ValueNoise {
  private grid: Float32Array;
  private gw: number;
  private gh: number;

  constructor(rng: RNG, gw: number, gh: number) {
    this.gw = gw;
    this.gh = gh;
    this.grid = new Float32Array(gw * gh);
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = rng.next();
  }

  sample(x: number, y: number): number {
    const gx = x * this.gw;
    const gy = y * this.gh;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const wrap = (v: number, m: number): number => ((v % m) + m) % m;
    const i00 = wrap(y0, this.gh) * this.gw + wrap(x0, this.gw);
    const i10 = wrap(y0, this.gh) * this.gw + wrap(x0 + 1, this.gw);
    const i01 = wrap(y0 + 1, this.gh) * this.gw + wrap(x0, this.gw);
    const i11 = wrap(y0 + 1, this.gh) * this.gw + wrap(x0 + 1, this.gw);
    const top = this.grid[i00] + (this.grid[i10] - this.grid[i00]) * sx;
    const bottom = this.grid[i01] + (this.grid[i11] - this.grid[i01]) * sx;
    return top + (bottom - top) * sy;
  }
}

export class World {
  readonly width: number;
  readonly height: number;
  readonly terrain: Uint8Array;
  readonly moisture: Float32Array;
  readonly nutrients: Float32Array;
  readonly grass: Float32Array;
  readonly shrub: Float32Array;
  readonly carcass: Float32Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const n = width * height;
    this.terrain = new Uint8Array(n);
    this.moisture = new Float32Array(n);
    this.nutrients = new Float32Array(n);
    this.grass = new Float32Array(n);
    this.shrub = new Float32Array(n);
    this.carcass = new Float32Array(n);
  }

  idx(tx: number, ty: number): number {
    return ty * this.width + tx;
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  terrainAt(tx: number, ty: number): number {
    if (!this.inBounds(tx, ty)) return Terrain.Rock;
    return this.terrain[ty * this.width + tx];
  }

  /** 浮点坐标所在格子是否可通行 */
  passableAt(x: number, y: number): boolean {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (!this.inBounds(tx, ty)) return false;
    return isPassableTerrain(this.terrain[ty * this.width + tx]);
  }

  /** 统计植物与残骸总量 */
  totals(): { grass: number; shrub: number; carcass: number } {
    let grass = 0;
    let shrub = 0;
    let carcass = 0;
    for (let i = 0; i < this.grass.length; i++) {
      grass += this.grass[i];
      shrub += this.shrub[i];
      carcass += this.carcass[i];
    }
    return { grass, shrub, carcass };
  }

  /** 生成地形（确定性：仅依赖 seed 与 preset） */
  static generate(preset: PresetDef, seed: number): World {
    const rng = new RNG(seed ^ 0x5f3a);
    const w = new World(WORLD.width, WORLD.height);
    const g = preset.gen;
    const heightNoise = new ValueNoise(rng, 6, 5);
    const heightNoise2 = new ValueNoise(rng, 14, 10);
    const moistNoise = new ValueNoise(rng, 7, 5);
    const moistNoise2 = new ValueNoise(rng, 16, 11);
    const detailNoise = new ValueNoise(rng, 26, 18);
    const riverAmp = 6 + rng.next() * 5;
    const riverPhase = rng.next() * Math.PI * 2;
    const riverWidth = 1.2 + rng.next() * 1.1;
    const hasRiver = preset.id !== 'arid';

    for (let ty = 0; ty < w.height; ty++) {
      for (let tx = 0; tx < w.width; tx++) {
        const nx = tx / w.width;
        const ny = ty / w.height;
        const h = heightNoise.sample(nx, ny) * 0.72 + heightNoise2.sample(nx, ny) * 0.28;
        const m = moistNoise.sample(nx, ny) * 0.7 + moistNoise2.sample(nx, ny) * 0.3;
        const d = detailNoise.sample(nx, ny);
        const i = w.idx(tx, ty);
        let terrain: number;
        let river = false;
        if (hasRiver) {
          const riverY = w.height * 0.5 + Math.sin((tx / w.width) * Math.PI * 2 + riverPhase) * riverAmp;
          const dist = Math.abs(ty - riverY);
          if (dist < riverWidth + d * 0.8) river = true;
        }
        if (river || h < g.waterLevel) {
          terrain = Terrain.Water;
        } else if (h > g.rockLevel || (d > 0.86 && h > g.rockLevel - 0.06)) {
          terrain = Terrain.Rock;
        } else if (m >= g.woodlandMoisture) {
          terrain = Terrain.Woodland;
        } else if (m >= g.meadowMoisture) {
          terrain = Terrain.Meadow;
        } else {
          terrain = Terrain.Arid;
        }
        w.terrain[i] = terrain;
        if (terrain === Terrain.Water) {
          w.moisture[i] = 1;
          w.nutrients[i] = 0.15;
        } else if (terrain === Terrain.Rock) {
          w.moisture[i] = 0.05;
          w.nutrients[i] = 0.05;
        } else {
          const arid = terrain === Terrain.Arid;
          w.moisture[i] = Math.min(1, m * 0.85 + 0.12 + d * 0.08);
          w.nutrients[i] = (0.28 + d * 0.3) * (arid ? 0.55 : terrain === Terrain.Woodland ? 1.1 : 1);
          const plantNoise = detailNoise.sample(nx * 1.7 + 0.3, ny * 1.7);
          if (terrain === Terrain.Meadow) {
            w.grass[i] = plantNoise * 26;
            w.shrub[i] = Math.max(0, plantNoise - 0.55) * 8;
          } else if (terrain === Terrain.Woodland) {
            w.grass[i] = plantNoise * 14;
            w.shrub[i] = Math.min(PLANTS.shrub.max, plantNoise * 18 + 4);
          } else {
            w.grass[i] = plantNoise * 7;
            w.shrub[i] = Math.max(0, plantNoise - 0.7) * 5;
          }
        }
      }
    }
    return w;
  }

  /** 找到最近的可通行格（用于生成与卡住救援） */
  findPassableNear(tx: number, ty: number, maxRadius = 6): { tx: number; ty: number } | null {
    for (let r = 0; r <= maxRadius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx;
          const y = ty + dy;
          if (this.inBounds(x, y) && isPassableTerrain(this.terrain[this.idx(x, y)])) {
            return { tx: x, ty: y };
          }
        }
      }
    }
    return null;
  }
}
