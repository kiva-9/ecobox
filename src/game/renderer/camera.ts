// 相机：世界像素坐标 <-> 屏幕 CSS 像素坐标的变换、缩放、拖动平移、边界钳制与平滑追踪。
// 变换约定：screen = (world - center) * zoom + viewport / 2（center 为世界像素坐标）。
// zoom = baseZoom * zoomRel，zoomRel 限幅 [MIN_REL, MAX_REL]（相对"适配 128x80 世界的默认视图"）。

export const MIN_REL = 0.35;
export const MAX_REL = 4;

export class Camera {
  /** 世界尺寸（像素） */
  worldW = 0;
  worldH = 0;
  /** 视口尺寸（CSS 像素） */
  viewW = 0;
  viewH = 0;
  /** 设备像素比，用于世界->渲染像素的换算 */
  dpr = 1;
  /** 视野中心（世界像素） */
  cx = 0;
  cy = 0;
  /** 相对默认视图的缩放倍率 */
  zoomRel = 1;
  /** 默认视图缩放（fit ~62% 世界），保证 1280x800 / 1920x1080 都有合理视野 */
  baseZoom = 1;
  /** 追踪目标（世界像素），null 表示不追踪 */
  trackX: number | null = null;
  trackY: number | null = null;

  /** 设置世界尺寸（瓦片数），并立即把视野居中 */
  setWorld(tilesW: number, tilesH: number): void {
    this.worldW = tilesW * 32;
    this.worldH = tilesH * 32;
    this.cx = this.worldW / 2;
    this.cy = this.worldH / 2;
  }

  /** 设置视口与像素比；保持用户的相对缩放倍率 */
  setViewport(cssW: number, cssH: number, dpr: number): void {
    this.viewW = Math.max(1, cssW);
    this.viewH = Math.max(1, cssH);
    this.dpr = dpr > 0 ? dpr : 1;
    this.baseZoom = this.computeBaseZoom();
    this.clampToWorld();
  }

  private computeBaseZoom(): number {
    if (this.worldW <= 0 || this.worldH <= 0) return 1;
    const z = Math.min(this.viewW / (this.worldW * 0.62), this.viewH / (this.worldH * 0.62));
    return Math.max(0.25, Math.min(1.5, z));
  }

  /** 实际缩放 = 默认视图缩放 x 相对倍率 */
  get zoom(): number {
    return this.baseZoom * this.zoomRel;
  }

  get minZoom(): number {
    return this.baseZoom * MIN_REL;
  }

  get maxZoom(): number {
    return this.baseZoom * MAX_REL;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const z = this.zoom;
    return {
      x: (sx - this.viewW / 2) / z + this.cx,
      y: (sy - this.viewH / 2) / z + this.cy,
    };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const z = this.zoom;
    return {
      x: (wx - this.cx) * z + this.viewW / 2,
      y: (wy - this.cy) * z + this.viewH / 2,
    };
  }

  centerOn(wx: number, wy: number): void {
    this.cx = wx;
    this.cy = wy;
    this.clampToWorld();
  }

  /** 以屏幕点 (sx, sy) 为锚点缩放（该点下的世界坐标保持不变） */
  zoomAt(factor: number, sx: number, sy: number): void {
    const before = this.screenToWorld(sx, sy);
    this.zoomRel = Math.max(MIN_REL, Math.min(MAX_REL, this.zoomRel * factor));
    const after = this.screenToWorld(sx, sy);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    this.clampToWorld();
  }

  /** 屏幕位移（拖动）转换为世界平移 */
  panByScreen(dx: number, dy: number): void {
    const z = this.zoom;
    this.cx -= dx / z;
    this.cy -= dy / z;
    this.clampToWorld();
  }

  /** 平滑追踪目标点；dt 为秒 */
  followTrack(dt: number): void {
    if (this.trackX === null || this.trackY === null) return;
    const k = 1 - Math.exp(-6 * Math.min(dt, 0.25));
    this.cx += (this.trackX - this.cx) * k;
    this.cy += (this.trackY - this.cy) * k;
    this.clampToWorld();
  }

  /** 边界钳制：视野不超出世界；世界比视野小时居中 */
  clampToWorld(): void {
    if (this.worldW <= 0 || this.worldH <= 0) return;
    const z = this.zoom;
    const halfW = this.viewW / (2 * z);
    const halfH = this.viewH / (2 * z);
    this.cx = halfW * 2 >= this.worldW
      ? this.worldW / 2
      : Math.max(halfW, Math.min(this.worldW - halfW, this.cx));
    this.cy = halfH * 2 >= this.worldH
      ? this.worldH / 2
      : Math.max(halfH, Math.min(this.worldH - halfH, this.cy));
  }

  /** 可见世界矩形（含边距），用于剔除与降雨范围 */
  visibleBounds(margin: number): { x0: number; y0: number; x1: number; y1: number } {
    const z = this.zoom;
    const halfW = this.viewW / (2 * z) + margin;
    const halfH = this.viewH / (2 * z) + margin;
    return {
      x0: this.cx - halfW,
      y0: this.cy - halfH,
      x1: this.cx + halfW,
      y1: this.cy + halfH,
    };
  }

  /**
   * 把相机变换应用到世界容器（含 dpr 因子，使屏幕侧计算统一用 CSS 像素）。
   * 位置取整到渲染像素，减少亚像素抖动。
   */
  applyTo(container: { scale: { set(v: number): void }; position: { set(x: number, y: number): void } }): void {
    const z = this.zoom * this.dpr;
    container.scale.set(z);
    const px = (this.viewW / 2 - this.cx * this.zoom) * this.dpr;
    const py = (this.viewH / 2 - this.cy * this.zoom) * this.dpr;
    container.position.set(Math.round(px), Math.round(py));
  }
}
