// 空间哈希：邻域查询，避免全体两两扫描。
// 确定性：按行主序遍历格子，格内按个体数组顺序（索引序）收集。

export class SpatialHash {
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  private buckets: number[][];

  constructor(width: number, height: number, cellSize: number) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.buckets = new Array(this.cols * this.rows);
    for (let i = 0; i < this.buckets.length; i++) this.buckets[i] = [];
  }

  clear(): void {
    for (let i = 0; i < this.buckets.length; i++) this.buckets[i].length = 0;
  }

  /** 重建：positions 为 [x0,y0,x1,y1,...]（tile 单位） */
  rebuild(positions: Float64Array, count: number): void {
    this.clear();
    const cs = this.cellSize;
    for (let i = 0; i < count; i++) {
      const cx = Math.floor(positions[i * 2] / cs);
      const cy = Math.floor(positions[i * 2 + 1] / cs);
      if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) continue;
      this.buckets[cy * this.cols + cx].push(i);
    }
  }

  /** 收集 (x,y) 半径 r 内的候选索引到 out（未排序，含半径外候选） */
  query(x: number, y: number, r: number, out: number[]): number[] {
    out.length = 0;
    const cs = this.cellSize;
    const x0 = Math.floor((x - r) / cs);
    const x1 = Math.floor((x + r) / cs);
    const y0 = Math.floor((y - r) / cs);
    const y1 = Math.floor((y + r) / cs);
    for (let cy = Math.max(0, y0); cy <= Math.min(this.rows - 1, y1); cy++) {
      for (let cx = Math.max(0, x0); cx <= Math.min(this.cols - 1, x1); cx++) {
        const b = this.buckets[cy * this.cols + cx];
        for (let k = 0; k < b.length; k++) out.push(b[k]);
      }
    }
    return out;
  }

  /** 收集并按 (距离, 索引) 升序排序，结果写入 out */
  querySorted(x: number, y: number, r: number, positions: Float64Array, out: number[]): number[] {
    this.query(x, y, r, out);
    const r2 = r * r;
    const list = out;
    // 原地过滤 + 稳定排序（距离、索引）
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const idx = list[i];
      const dx = positions[idx * 2] - x;
      const dy = positions[idx * 2 + 1] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2) list[w++] = idx;
    }
    list.length = w;
    list.sort((a, b) => {
      const dax = positions[a * 2] - x;
      const day = positions[a * 2 + 1] - y;
      const dbx = positions[b * 2] - x;
      const dby = positions[b * 2 + 1] - y;
      const da = dax * dax + day * day;
      const db = dbx * dbx + dby * dby;
      if (da < db) return -1;
      if (da > db) return 1;
      return a - b;
    });
    return list;
  }
}
