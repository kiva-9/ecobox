// 像素粒子特效池：全部精灵在构造时一次性创建，运行期只复用，禁止每帧新建对象。
// 随机源为 Math.random（纯视觉），不引用 src/sim 的模拟 RNG。

import { Container, Sprite } from 'pixi.js';
import type { EffectTextures } from './sprites';

interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  grav: number;
  drag: number;
}

interface RingFx {
  active: boolean;
  sprite: Sprite;
  life: number;
  maxLife: number;
  r0: number;
  r1: number;
}

interface RainDrop {
  active: boolean;
  sprite: Sprite;
  vx: number;
  vy: number;
}

interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const COLOR = {
  eat: 0x7dc84f,
  birth: 0xf2d06b,
  death: 0x8a8578,
  pred: 0xd9534f,
  sand: 0xd8c284,
  rain: 0x9cc8e8,
  select: 0xf2e6b8,
};

const MAX_PARTICLES = 700;
const MAX_RINGS = 24;
const MAX_RAIN = 150;

export class EffectSystem {
  /** 世界空间容器（挂在相机容器下） */
  readonly container = new Container();

  private particles: Particle[] = [];
  private sprites: Sprite[] = [];
  private freeList: number[] = [];
  private rings: RingFx[] = [];
  private ringFree: number[] = [];
  private rain: RainDrop[] = [];
  private rainFree: number[] = [];
  private rainActive = 0;
  private rainBounds: Bounds = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private rainTarget = 0;
  private selArrow: Sprite;
  private selRing: Sprite;
  private selTime = 0;

  constructor(private tex: EffectTextures) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const sp = new Sprite(tex.dot);
      sp.anchor.set(0.5, 0.5);
      sp.visible = false;
      this.container.addChild(sp);
      this.sprites.push(sp);
      this.particles.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 2, grav: 0, drag: 0 });
      this.freeList.push(i);
    }
    for (let i = 0; i < MAX_RINGS; i++) {
      const sp = new Sprite(tex.ring);
      sp.anchor.set(0.5, 0.5);
      sp.visible = false;
      this.container.addChild(sp);
      this.rings.push({ active: false, sprite: sp, life: 0, maxLife: 1, r0: 4, r1: 20 });
      this.ringFree.push(i);
    }
    for (let i = 0; i < MAX_RAIN; i++) {
      const sp = new Sprite(tex.rain);
      sp.anchor.set(0.5, 0.5);
      sp.rotation = 0.42;
      sp.visible = false;
      this.container.addChild(sp);
      this.rain.push({ active: false, sprite: sp, vx: 0, vy: 0 });
      this.rainFree.push(i);
    }
    this.selArrow = new Sprite(tex.arrow);
    this.selArrow.anchor.set(0.5, 0.5);
    this.selArrow.visible = false;
    this.selArrow.tint = COLOR.select;
    this.container.addChild(this.selArrow);
    this.selRing = new Sprite(tex.ring);
    this.selRing.anchor.set(0.5, 0.5);
    this.selRing.visible = false;
    this.selRing.tint = COLOR.select;
    this.container.addChild(this.selRing);
  }

  // ---------------------------------------------------------- 内部

  private spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    grav: number,
    drag: number,
    tint: number,
    spark: boolean,
  ): void {
    const idx = this.freeList.pop();
    if (idx === undefined) return;
    const p = this.particles[idx];
    const sp = this.sprites[idx];
    p.active = true;
    p.x = x; p.y = y;
    p.vx = vx; p.vy = vy;
    p.life = life; p.maxLife = life;
    p.size = size; p.grav = grav; p.drag = drag;
    sp.texture = spark ? this.tex.spark : this.tex.dot;
    sp.position.set(x, y);
    sp.scale.set(size / 3);
    sp.tint = tint;
    sp.alpha = 1;
    sp.visible = true;
  }

  private spawnRing(x: number, y: number, r0: number, r1: number, life: number, tint: number): void {
    const idx = this.ringFree.pop();
    if (idx === undefined) return;
    const r = this.rings[idx];
    r.active = true;
    r.life = life;
    r.maxLife = life;
    r.r0 = r0;
    r.r1 = r1;
    r.sprite.position.set(x, y);
    r.sprite.tint = tint;
    r.sprite.alpha = 1;
    r.sprite.visible = true;
  }

  // ---------------------------------------------------------- 事件特效

  /** 进食：绿色像素粒子（个体 state=Eat 时由渲染器节流调用） */
  eat(x: number, y: number): void {
    const n = 2 + (Math.random() * 3 | 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 8 + Math.random() * 26;
      this.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp - 18, 0.35 + Math.random() * 0.35,
        2 + Math.random() * 2, 40, 2.5, COLOR.eat, false);
    }
  }

  /** 出生：金色闪光 */
  birth(x: number, y: number): void {
    const n = 10 + (Math.random() * 5 | 0);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const sp = 30 + Math.random() * 60;
      this.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.45 + Math.random() * 0.45,
        3 + Math.random() * 3, 0, 1.6, COLOR.birth, true);
    }
    this.spawnRing(x, y, 4, 22, 0.4, COLOR.birth);
  }

  /** 死亡：灰色粒子渐隐 */
  death(x: number, y: number): void {
    const n = 8 + (Math.random() * 5 | 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 10 + Math.random() * 30;
      this.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp - 26, 0.6 + Math.random() * 0.5,
        2 + Math.random() * 2.5, -12, 1.4, COLOR.death, false);
    }
  }

  /** 捕食：红色冲击环 + 红色碎屑 */
  predation(x: number, y: number): void {
    this.spawnRing(x, y, 6, 34, 0.42, COLOR.pred);
    const n = 6 + (Math.random() * 4 | 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 50 + Math.random() * 90;
      this.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + Math.random() * 0.25,
        2 + Math.random() * 2, 0, 3, COLOR.pred, false);
    }
  }

  /** 干旱：沙色粒子横飘 */
  drought(x: number, y: number): void {
    const n = 5 + (Math.random() * 4 | 0);
    for (let i = 0; i < n; i++) {
      const a = -0.6 + Math.random() * 1.2;
      const sp = 20 + Math.random() * 40;
      this.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp - 10, 0.5 + Math.random() * 0.4,
        2 + Math.random() * 2, 6, 1.2, COLOR.sand, false);
    }
  }

  // ---------------------------------------------------------- 降雨

  /** 设置降雨强度（0..1）与可见世界范围 */
  setRain(intensity: number, bounds: Bounds): void {
    this.rainBounds = bounds;
    this.rainTarget = Math.min(MAX_RAIN, Math.floor(Math.max(0, Math.min(1, intensity)) * MAX_RAIN));
  }

  private updateRain(dt: number): void {
    // 补齐到目标数量
    while (this.rainActive < this.rainTarget) {
      const idx = this.rainFree.pop();
      if (idx === undefined) break;
      const d = this.rain[idx];
      d.active = true;
      d.sprite.visible = true;
      d.sprite.tint = COLOR.rain;
      d.sprite.alpha = 0.55 + Math.random() * 0.35;
      d.sprite.scale.set(0.7 + Math.random() * 0.6, 0.8 + Math.random() * 0.7);
      d.vx = -260 - Math.random() * 120;
      d.vy = 780 + Math.random() * 320;
      d.sprite.position.set(
        this.rainBounds.x0 + Math.random() * (this.rainBounds.x1 - this.rainBounds.x0),
        this.rainBounds.y0 + Math.random() * (this.rainBounds.y1 - this.rainBounds.y0),
      );
      this.rainActive++;
    }
    // 超出目标数量时回收尾部
    while (this.rainActive > this.rainTarget) {
      let found = -1;
      for (let i = this.rain.length - 1; i >= 0; i--) {
        if (this.rain[i].active) { found = i; break; }
      }
      if (found < 0) break;
      this.deactivateRain(found);
    }
    const b = this.rainBounds;
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    for (let i = 0; i < this.rain.length; i++) {
      const d = this.rain[i];
      if (!d.active) continue;
      const sp = d.sprite;
      sp.x += d.vx * dt;
      sp.y += d.vy * dt;
      if (sp.y > b.y1 || sp.x < b.x0 - 40) {
        sp.y = b.y0 - Math.random() * h * 0.3;
        sp.x = b.x1 - Math.random() * w * 0.3;
      }
    }
  }

  private deactivateRain(idx: number): void {
    const d = this.rain[idx];
    d.active = false;
    d.sprite.visible = false;
    this.rainFree.push(idx);
    this.rainActive--;
  }

  // ---------------------------------------------------------- 选中标记

  /** 选中个体的像素箭头 + 圆圈（世界坐标，尺寸随个体半径） */
  setSelection(x: number, y: number, radiusWorldPx: number): void {
    this.selArrow.visible = true;
    this.selRing.visible = true;
    this.selArrow.position.set(x, y - radiusWorldPx - 10);
    this.selRing.position.set(x, y);
    const s = Math.max(0.5, (radiusWorldPx + 6) / 12);
    this.selRing.scale.set(s);
    this.selArrow.scale.set(Math.max(0.6, s));
  }

  hideSelection(): void {
    this.selArrow.visible = false;
    this.selRing.visible = false;
  }

  // ---------------------------------------------------------- 帧更新

  update(dt: number): void {
    // 粒子
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this.sprites[i].visible = false;
        this.freeList.push(i);
        continue;
      }
      const dragF = Math.max(0, 1 - p.drag * dt);
      p.vx *= dragF;
      p.vy = p.vy * dragF + p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const sp = this.sprites[i];
      sp.position.set(p.x, p.y);
      sp.alpha = p.life / p.maxLife;
    }
    // 冲击环
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (!r.active) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.active = false;
        r.sprite.visible = false;
        this.ringFree.push(i);
        continue;
      }
      const t = 1 - r.life / r.maxLife;
      const radius = r.r0 + (r.r1 - r.r0) * t;
      r.sprite.scale.set(Math.max(0.05, radius / 12));
      r.sprite.alpha = 1 - t;
    }
    // 降雨
    this.updateRain(dt);
    // 选中箭头浮动
    if (this.selArrow.visible) {
      this.selTime += dt;
      this.selArrow.y -= 0;
      this.selArrow.position.y += Math.sin(this.selTime * 6) * 6 * dt;
    }
  }

  get activeParticles(): number {
    return MAX_PARTICLES - this.freeList.length;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
