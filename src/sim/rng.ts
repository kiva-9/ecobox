// 种子随机数生成器：sfc32 + splitmix32 种子扩散。
// 所有影响模拟结果的随机过程都必须使用该实例；渲染粒子的视觉随机不得使用它。

export class RNG {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;

  constructor(seed: number) {
    let s = seed >>> 0;
    if (s === 0) s = 0x9e3779b9;
    const mix = (): number => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.a = mix();
    this.b = mix();
    this.c = mix();
    this.d = mix();
  }

  /** [0,1) 均匀分布 */
  next(): number {
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** [min,max) 浮点 */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** [0,n) 整数 */
  int(n: number): number {
    return Math.floor(this.next() * n) % Math.max(1, n);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** 近似正态分布（均值 0，标准差 sigma），Clamped 到 ±3σ。 */
  gauss(sigma: number): number {
    const u = Math.max(this.next(), 1e-9);
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    const g = r * Math.cos(2 * Math.PI * v) * sigma;
    if (g > 3 * sigma) return 3 * sigma;
    if (g < -3 * sigma) return -3 * sigma;
    return g;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  getState(): [number, number, number, number] {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }

  setState(s: readonly [number, number, number, number]): void {
    this.a = s[0] >>> 0;
    this.b = s[1] >>> 0;
    this.c = s[2] >>> 0;
    this.d = s[3] >>> 0;
  }
}
