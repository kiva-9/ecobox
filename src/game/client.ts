// 客户端胶水层：拥有 Worker 与外部状态，向 React UI 暴露稳定的订阅接口。
// 设计约束：
// - 快照（SimSnapshot）每帧到达，但 React 只以 ~4Hz 消费"面板数据"，避免每帧重渲染；
// - 结构状态（phase/modal/saves/...）变化时才通知 UI；
// - PixiJS 渲染器直接读取 client.latest（ref），不走 React。

import type {
  Blueprint,
  ClientState,
  Genes,
  ModalKind,
  OverlayState,
  Prefs,
  SaveFile,
  SimSnapshot,
  Toast,
  WorkerRequest,
  WorkerResponse,
} from '../shared/protocol';
import { DEFAULT_OVERLAY } from '../shared/protocol';

export interface PanelData {
  tick: number;
  light: number;
  dayPhase: number;
  drought: number;
  rainfall: number;
  running: boolean;
  speed: number;
  counts: number[];
  totals: { grass: number; shrub: number; carcass: number };
  stats: SimSnapshot['stats'];
  events: SimSnapshot['events'];
  selected: SimSnapshot['selected'];
  challenge: SimSnapshot['challenge'];
  world: SimSnapshot['world'];
  interventionLeft: number | null;
  capacityWarning: string | null;
  simMsPerTick: number;
  fps: number;
  actualTps: number;
  creatureCount: number;
}

const PREFS_KEY = 'ecobox.prefs.v1';
const PANEL_INTERVAL = 250;

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Prefs>;
      return {
        volume: typeof p.volume === 'number' ? p.volume : 0.6,
        muted: !!p.muted,
        guideDone: !!p.guideDone,
        overlay: { ...DEFAULT_OVERLAY, ...(p.overlay ?? {}) },
      };
    }
  } catch {
    /* 忽略损坏的偏好 */
  }
  return { volume: 0.6, muted: false, guideDone: false, overlay: { ...DEFAULT_OVERLAY } };
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* 隐私模式等场景下忽略 */
  }
}

export class GameClient {
  latest: SimSnapshot | null = null;
  private worker: Worker | null = null;
  private uiListeners = new Set<() => void>();
  private panelListeners = new Set<() => void>();
  private toastSeq = 1;
  private exportResolve: ((json: string) => void) | null = null;
  private lastFps = 0;
  private lastActualTps = 0;

  state: ClientState = {
    phase: 'menu',
    snapshot: null,
    saves: [],
    blueprints: [],
    storageError: null,
    prefs: loadPrefs(),
    modal: null,
    modalData: null,
    toasts: [],
    selectedTool: 0,
    brushSize: 2,
    trackId: null,
    overlay: loadPrefs().overlay,
    busy: false,
    perf: { fps: 0, simMsPerTick: 0, creatures: 0, actualTps: 0 },
  };

  // ---------------------------------------------------------- 订阅

  subscribeUi = (cb: () => void): (() => void) => {
    this.uiListeners.add(cb);
    return () => this.uiListeners.delete(cb);
  };

  getUiSnapshot = (): ClientState => this.state;

  subscribePanel = (cb: () => void): (() => void) => {
    this.panelListeners.add(cb);
    return () => this.panelListeners.delete(cb);
  };

  private panelCache: PanelData | null = null;
  getPanelSnapshot = (): PanelData => {
    if (!this.panelCache) this.panelCache = this.buildPanelData();
    return this.panelCache;
  };

  private buildPanelData(): PanelData {
    const s = this.latest;
    if (!s) {
      return {
        tick: 0, light: 1, dayPhase: 0, drought: 0, rainfall: 0, running: false, speed: 1,
        counts: [0, 0, 0, 0], totals: { grass: 0, shrub: 0, carcass: 0 },
        stats: [], events: [], selected: null, challenge: null,
        world: { seed: 0, presetId: 'temperate', mode: 'sandbox', challengeId: null },
        interventionLeft: null, capacityWarning: null, simMsPerTick: 0,
        fps: this.lastFps, actualTps: this.lastActualTps, creatureCount: 0,
      };
    }
    return {
      tick: s.tick,
      light: s.light,
      dayPhase: s.dayPhase,
      drought: s.drought,
      rainfall: s.rainfall,
      running: s.running,
      speed: s.speed,
      counts: s.counts,
      totals: s.totals,
      stats: s.stats.slice(-240),
      events: s.events.slice(-60),
      selected: s.selected,
      challenge: s.challenge,
      world: s.world,
      interventionLeft: s.interventionLeft,
      capacityWarning: s.capacityWarning,
      simMsPerTick: s.simMsPerTick,
      fps: this.lastFps,
      actualTps: this.lastActualTps,
      creatureCount: s.creatures.count,
    };
  }

  private notifyUi(): void {
    for (const cb of this.uiListeners) cb();
  }

  private notifyPanel(): void {
    this.panelCache = null;
    for (const cb of this.panelListeners) cb();
  }

  private patch(p: Partial<ClientState>): void {
    this.state = { ...this.state, ...p };
    this.notifyUi();
  }

  // ---------------------------------------------------------- Worker 生命周期

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
      window.setInterval(() => this.notifyPanel(), PANEL_INTERVAL);
      this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onWorkerMessage(ev.data);
      this.worker.onerror = (e) => {
        this.toast('error', `模拟线程错误：${e.message || '未知错误'}`);
      };
    }
    return this.worker;
  }

  private post(msg: WorkerRequest): void {
    this.ensureWorker().postMessage(msg);
  }

  private onWorkerMessage(res: WorkerResponse): void {
    switch (res.type) {
      case 'snapshot': {
        const prev = this.latest;
        this.latest = res.data;
        if (res.data.terrain || !prev) this.panelCache = null;
        // 挑战状态/存储错误等结构性变化立即刷新 UI
        if (
          !prev ||
          prev.challenge?.status !== res.data.challenge?.status ||
          prev.world.mode !== res.data.world.mode ||
          prev.capacityWarning !== res.data.capacityWarning
        ) {
          this.notifyPanel();
          this.notifyUi();
        }
        break;
      }
      case 'saved':
        this.toast(res.ok ? 'success' : 'error', res.ok ? `已保存到「${slotLabel(res.slot)}」` : `保存失败：${res.error ?? '未知原因'}`);
        if (res.ok) this.post({ type: 'listSaves' });
        break;
      case 'loaded':
        if (res.ok) {
          this.toast('success', `已载入「${slotLabel(res.slot)}」`);
          this.post({ type: 'listSaves' });
          this.patch({ phase: 'playing', modal: null, modalData: null });
        } else {
          this.toast('error', `载入失败：${res.error ?? '未知原因'}`);
        }
        break;
      case 'deleted':
        this.toast('info', '存档已删除');
        this.post({ type: 'listSaves' });
        break;
      case 'exportData':
        if (this.exportResolve) {
          this.exportResolve(res.json);
          this.exportResolve = null;
        }
        break;
      case 'savesList':
        this.patch({ saves: res.saves, storageError: res.storageError });
        break;
      case 'blueprintsList':
        this.patch({ blueprints: res.blueprints });
        break;
      case 'blueprintSaved':
        this.patch({ blueprints: [...this.state.blueprints, res.blueprint] });
        this.toast('success', `已收藏蓝图「${res.blueprint.name}」`);
        break;
      case 'blueprintCollected':
        this.patch({ blueprints: [...this.state.blueprints, res.blueprint] });
        this.toast('success', `已收藏个体 #${res.blueprint.capturedTick >= 0 ? '' : ''}${res.blueprint.name} 的蓝图`);
        break;
      case 'error':
        this.toast('error', res.message);
        if (res.fatal) this.patch({ phase: 'menu' });
        break;
    }
  }

  // ---------------------------------------------------------- 生命周期动作

  newWorld(seed: number, presetId: string): void {
    this.state.trackId = null;
    this.patch({ phase: 'playing', modal: null, modalData: null, busy: true, saves: [], blueprints: [] });
    this.post({ type: 'newWorld', seed, presetId });
    this.post({ type: 'listSaves' });
    this.post({ type: 'listBlueprints' });
    window.setTimeout(() => this.patch({ busy: false }), 400);
  }

  startChallenge(challengeId: string): void {
    this.state.trackId = null;
    this.patch({ phase: 'playing', modal: null, modalData: null, busy: true });
    this.post({ type: 'startChallenge', challengeId });
    this.post({ type: 'listSaves' });
    this.post({ type: 'listBlueprints' });
    window.setTimeout(() => this.patch({ busy: false }), 400);
  }

  loadSlot(slot: string): void {
    this.patch({ busy: true });
    this.post({ type: 'loadSlot', slot });
    window.setTimeout(() => this.patch({ busy: false }), 600);
  }

  saveSlot(slot: string): void {
    this.post({ type: 'saveSlot', slot });
  }

  deleteSlot(slot: string): void {
    this.post({ type: 'deleteSlot', slot });
  }

  /** 确认挑战说明，正式开始计时 */
  confirmChallengeBrief(): void {
    this.post({ type: 'confirmChallengeBrief' });
    if (this.state.modal === 'challengeResult' || this.state.modal === 'challengeBrief') {
      this.patch({ modal: null, modalData: null });
    }
  }

  retryChallenge(): void {
    this.state.trackId = null;
    this.post({ type: 'retryChallenge' });
    this.patch({ modal: null, modalData: null });
  }

  exitChallenge(): void {
    this.post({ type: 'exitChallenge' });
    this.patch({ phase: 'menu', modal: null, modalData: null, trackId: null });
  }

  backToMenu(): void {
    this.patch({ phase: 'menu', modal: null, modalData: null, trackId: null });
  }

  setSpeed(speed: number): void {
    this.post({ type: 'setSpeed', speed });
  }

  pause(): void {
    this.post({ type: 'pause' });
  }

  resume(): void {
    this.post({ type: 'resume' });
  }

  stepOnce(): void {
    this.post({ type: 'stepOnce' });
  }

  toggleRun(): void {
    if (this.latest?.running) this.pause();
    else this.resume();
  }

  select(id: number | null): void {
    this.post({ type: 'select', id });
    this.state.trackId = id;
  }

  setTrackId(id: number | null): void {
    this.state.trackId = id;
    this.notifyUi();
  }

  intervene(tool: number, tx: number, ty: number, brush: number, genes: Genes | null): void {
    this.post({ type: 'intervene', tool, tx, ty, brush, genes });
  }

  setTool(tool: number): void {
    this.patch({ selectedTool: tool });
  }

  setBrush(size: number): void {
    this.patch({ brushSize: Math.max(1, Math.min(6, size)) });
  }

  setOverlay(o: Partial<OverlayState>): void {
    const overlay = { ...this.state.overlay, ...o };
    const prefs = { ...this.state.prefs, overlay };
    savePrefs(prefs);
    this.patch({ overlay, prefs });
  }

  setVolume(v: number): void {
    const prefs = { ...this.state.prefs, volume: Math.max(0, Math.min(1, v)) };
    savePrefs(prefs);
    this.patch({ prefs });
  }

  setMuted(m: boolean): void {
    const prefs = { ...this.state.prefs, muted: m };
    savePrefs(prefs);
    this.patch({ prefs });
  }

  /** 重置引导（设置中“重看首次引导”） */
  resetGuide(): void {
    const prefs = { ...this.state.prefs, guideDone: false };
    savePrefs(prefs);
    this.patch({ prefs, modal: 'guide' });
  }

  markGuideDone(): void {
    const prefs = { ...this.state.prefs, guideDone: true };
    savePrefs(prefs);
    this.patch({ prefs, modal: null });
  }

  // ---------------------------------------------------------- 弹窗与提示

  openModal(modal: ModalKind, data: Record<string, unknown> | null = null): void {
    this.patch({ modal, modalData: data });
  }

  closeModal(): void {
    this.patch({ modal: null, modalData: null });
  }

  toast(kind: Toast['kind'], text: string): void {
    const id = this.toastSeq++;
    const toasts = [...this.state.toasts, { id, kind, text }].slice(-4);
    this.patch({ toasts });
    window.setTimeout(() => {
      this.patch({ toasts: this.state.toasts.filter((t) => t.id !== id) });
    }, 4200);
  }

  dismissToast(id: number): void {
    this.patch({ toasts: this.state.toasts.filter((t) => t.id !== id) });
  }

  // ---------------------------------------------------------- 存档导入导出

  async exportWorld(): Promise<string> {
    this.ensureWorker();
    const json = await new Promise<string>((resolve) => {
      this.exportResolve = resolve;
      this.post({ type: 'requestExport' });
      window.setTimeout(() => {
        if (this.exportResolve) {
          this.exportResolve = null;
          resolve('');
        }
      }, 5000);
    });
    return json;
  }

  async importWorldFile(file: File): Promise<{ ok: boolean; error?: string }> {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as SaveFile;
      this.ensureWorker();
      const ok = await new Promise<boolean>((resolve) => {
        const handler = (ev: MessageEvent<WorkerResponse>): void => {
          const res = ev.data;
          if (res.type === 'loaded' && res.slot === '__import__') {
            this.worker?.removeEventListener('message', handler);
            resolve(res.ok);
            if (!res.ok) this.toast('error', `导入失败：${res.error ?? '文件无效'}`);
            else this.toast('success', '世界导入成功');
          }
        };
        this.worker?.addEventListener('message', handler);
        this.post({ type: 'loadSave', data });
        window.setTimeout(() => resolve(false), 8000);
      });
      if (ok) this.patch({ phase: 'playing', modal: null });
      return { ok };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.toast('error', `导入失败：${msg}`);
      return { ok: false, error: msg };
    }
  }

  // ---------------------------------------------------------- 蓝图

  collectBlueprint(id: number, name: string): void {
    this.post({ type: 'collectBlueprint', id, name });
  }

  releaseBlueprint(bp: Blueprint): void {
    // 人工投放：由 UI 传入蓝图基因，工具为对应物种投放
    this.post({ type: 'listBlueprints' });
    this.toast('info', `请在场景中选择位置投放「${bp.name}」（人工干预）`);
  }

  deleteBlueprint(id: string): void {
    this.post({ type: 'deleteBlueprint', id });
    this.patch({ blueprints: this.state.blueprints.filter((b) => b.id !== id) });
  }

  // ---------------------------------------------------------- 渲染器反馈

  reportPerf(fps: number, actualTps: number): void {
    this.lastFps = fps;
    this.lastActualTps = actualTps;
    const s = this.latest;
    this.state.perf = {
      fps,
      actualTps,
      creatures: s?.creatures.count ?? 0,
      simMsPerTick: s?.simMsPerTick ?? 0,
    };
  }

  /** 主动刷新存档与蓝图列表（菜单进入时调用） */
  refreshStorage(): void {
    this.post({ type: 'listSaves' });
    this.post({ type: 'listBlueprints' });
  }

  setVisibility(visible: boolean): void {
    this.post({ type: 'visibility', visible });
  }

  /** 下载 JSON 文件 */
  downloadJson(filename: string, json: string): void {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

function slotLabel(slot: string): string {
  switch (slot) {
    case 'auto': return '自动存档';
    case 'slot1': return '槽位 1';
    case 'slot2': return '槽位 2';
    case 'slot3': return '槽位 3';
    case '__import__': return '导入文件';
    default: return slot;
  }
}

// 单例
export const client = new GameClient();
