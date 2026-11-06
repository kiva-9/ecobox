// 模拟 Worker：固定时间步推进、快照下发、干预执行、存档与蓝图持久化。
// UI 线程不直接接触模拟；所有通信走 src/shared/protocol.ts 定义的消息。

import { Simulation } from '../sim/simulation';
import { beginChallenge } from '../sim/challenges';
import { parseSaveText, validateSave } from '../sim/serialize';
import { Tool, toolIsIntervention } from '../sim/constants';
import type {
  Blueprint,
  SaveFile,
  SaveSlotInfo,
  SimSnapshot,
  WorkerRequest,
  WorkerResponse,
} from '../shared/protocol';
import {
  deleteBlueprint,
  deleteSave,
  getSave,
  listBlueprints,
  listSaves,
  putBlueprint,
  putSave,
  storageAvailable,
} from './storage';

const LOOP_MS = 16; // ~60Hz 固定循环
const AUTOSAVE_INTERVAL = 3000; // tick
const TILE_SNAPSHOT_EVERY = 3; // 动态 tile 数据每 3 帧下发一次

let sim: Simulation | null = null;
let userRunning = false;
let visible = true;
let loopTimer: number | null = null;
let lastAutosaveTick = -1;
let frameCount = 0;
let stepMsAccum = 0;
let stepCount = 0;
let pendingStepOnce = false;
let storageError: string | null = storageAvailable() ? null : '当前环境不支持 IndexedDB，世界只能通过 JSON 导出保存';

function post(msg: WorkerResponse, transfer?: Transferable[]): void {
  (self as unknown as Worker).postMessage(msg, transfer ?? []);
}

function snapshotTransferables(s: SimSnapshot): Transferable[] {
  const list: Transferable[] = [];
  const c = s.creatures;
  list.push(c.x.buffer, c.y.buffer, c.heading.buffer, c.size.buffer, c.species.buffer, c.state.buffer, c.energy.buffer, c.id.buffer, c.artificial.buffer, c.geneSpeed.buffer, c.geneSense.buffer, c.geneReproInvest.buffer);
  if (s.tiles) {
    list.push(s.tiles.grass.buffer, s.tiles.shrub.buffer, s.tiles.moisture.buffer, s.tiles.nutrients.buffer, s.tiles.carcass.buffer);
  }
  if (s.terrain) list.push(s.terrain.buffer);
  return list;
}

function pushSnapshot(): void {
  if (!sim) return;
  frameCount++;
  const includeTiles = frameCount % TILE_SNAPSHOT_EVERY === 0 || sim.terrainDirty;
  const snap = sim.snapshot(includeTiles);
  snap.simMsPerTick = stepCount > 0 ? stepMsAccum / stepCount : 0;
  stepMsAccum = 0;
  stepCount = 0;
  if (!includeTiles) snap.tiles = null;
  sim.clearTerrainDirty();
  post({ type: 'snapshot', data: snap }, snapshotTransferables(snap));
}

function doSteps(n: number): void {
  if (!sim) return;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    sim.step();
    // 自动存档
    if (sim.tick - lastAutosaveTick >= AUTOSAVE_INTERVAL) {
      lastAutosaveTick = sim.tick;
      void autosave();
    }
    // 挑战结束 → 暂停，等待玩家处理结算
    if (sim.challenge && (sim.challenge.status === 'success' || sim.challenge.status === 'fail')) {
      userRunning = false;
      break;
    }
  }
  const dt = performance.now() - t0;
  stepMsAccum += dt;
  stepCount += n;
}

function loop(): void {
  if (!sim) return;
  const effectiveRunning = userRunning && visible;
  sim.running = effectiveRunning;
  if (effectiveRunning) {
    doSteps(sim.speed);
  } else if (pendingStepOnce) {
    pendingStepOnce = false;
    doSteps(1);
  }
  pushSnapshot();
}

function ensureLoop(): void {
  if (loopTimer === null) {
    loopTimer = self.setInterval(loop, LOOP_MS);
  }
}

function slotInfo(slot: string, data: SaveFile): SaveSlotInfo {
  const label = slot === 'auto' ? '自动存档' : slot === 'slot1' ? '槽位 1' : slot === 'slot2' ? '槽位 2' : '槽位 3';
  return {
    id: slot,
    label,
    savedAt: data.savedAt,
    tick: data.tick,
    mode: data.mode,
    challengeId: data.challengeId,
    presetId: data.presetId,
    population: data.creatures.length,
  };
}

async function saveToSlot(slot: string): Promise<void> {
  if (!sim) return;
  try {
    const data = sim.toSaveData();
    await putSave(slot, slotInfo(slot, data), data);
    storageError = null;
    post({ type: 'saved', slot, ok: true });
  } catch (err) {
    post({ type: 'saved', slot, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

async function autosave(): Promise<void> {
  if (!sim) return;
  try {
    const data = sim.toSaveData();
    await putSave('auto', slotInfo('auto', data), data);
    storageError = null;
  } catch (err) {
    storageError = `自动存档失败：${err instanceof Error ? err.message : String(err)}（请使用 JSON 导出）`;
  }
}

async function loadFromSlot(slot: string): Promise<void> {
  try {
    const stored = await getSave(slot);
    if (!stored) {
      post({ type: 'loaded', slot, ok: false, error: '存档不存在' });
      return;
    }
    applySave(stored.data, slot);
  } catch (err) {
    post({ type: 'loaded', slot, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

function applySave(data: SaveFile, slot: string): void {
  const v = validateSave(data);
  if (!v.ok) {
    post({ type: 'loaded', slot, ok: false, error: v.errors.slice(0, 3).join('；') });
    return;
  }
  sim = Simulation.fromSave(data);
  lastAutosaveTick = sim.tick;
  userRunning = true;
  frameCount = 0;
  ensureLoop();
  post({ type: 'loaded', slot, ok: true });
  pushSnapshot();
}

async function sendSavesList(): Promise<void> {
  try {
    const saves = await listSaves();
    storageError = storageAvailable() ? null : storageError;
    post({ type: 'savesList', saves, storageError });
  } catch (err) {
    post({ type: 'savesList', saves: [], storageError: `读取存档列表失败：${err instanceof Error ? err.message : String(err)}` });
  }
}

async function sendBlueprintsList(): Promise<void> {
  try {
    const blueprints = await listBlueprints();
    post({ type: 'blueprintsList', blueprints });
  } catch {
    post({ type: 'blueprintsList', blueprints: [] });
  }
}

function handleIntervene(tool: number, tx: number, ty: number, brush: number, genes: SaveFile['creatures'][number]['genes'] | null): void {
  if (!sim) return;
  const res = sim.intervene(tool, tx, ty, brush, genes);
  if (!res.ok && res.error) {
    post({ type: 'error', message: res.error, fatal: false });
  }
  void toolIsIntervention;
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'newWorld': {
      sim = new Simulation(msg.seed, msg.presetId);
      lastAutosaveTick = 0;
      userRunning = true;
      frameCount = 0;
      ensureLoop();
      pushSnapshot();
      void sendSavesList();
      void sendBlueprintsList();
      break;
    }
    case 'startChallenge': {
      try {
        sim = Simulation.startChallenge(msg.challengeId);
        lastAutosaveTick = 0;
        userRunning = false; // briefing 阶段暂停，等待确认
        frameCount = 0;
        ensureLoop();
        pushSnapshot();
        void sendSavesList();
        void sendBlueprintsList();
      } catch (err) {
        post({ type: 'error', message: `挑战启动失败：${err instanceof Error ? err.message : String(err)}`, fatal: false });
      }
      break;
    }
    case 'confirmChallengeBrief': {
      if (sim?.challenge) {
        beginChallenge(sim.challenge);
        userRunning = true;
      }
      break;
    }
    case 'retryChallenge': {
      if (sim?.challenge) {
        sim.retryChallenge();
        lastAutosaveTick = sim.tick;
        userRunning = false;
        pushSnapshot();
      }
      break;
    }
    case 'exitChallenge': {
      sim = null;
      userRunning = false;
      break;
    }
    case 'loadSave': {
      applySave(msg.data, '__import__');
      break;
    }
    case 'setSpeed': {
      if (sim) sim.speed = Math.max(1, Math.min(10, Math.round(msg.speed)));
      break;
    }
    case 'pause':
      userRunning = false;
      if (sim) sim.running = false;
      break;
    case 'resume':
      userRunning = true;
      break;
    case 'stepOnce':
      pendingStepOnce = true;
      break;
    case 'intervene':
      handleIntervene(msg.tool, msg.tx, msg.ty, msg.brush, msg.genes);
      break;
    case 'select':
      sim?.select(msg.id);
      break;
    case 'visibility':
      visible = msg.visible;
      break;
    case 'requestExport': {
      if (!sim) {
        post({ type: 'error', message: '没有可导出的世界', fatal: false });
        return;
      }
      const data = sim.toSaveData();
      post({ type: 'exportData', json: JSON.stringify(data) });
      break;
    }
    case 'saveSlot':
      void saveToSlot(msg.slot);
      break;
    case 'loadSlot':
      void loadFromSlot(msg.slot);
      break;
    case 'deleteSlot':
      void deleteSave(msg.slot)
        .then(() => post({ type: 'deleted', slot: msg.slot, ok: true }))
        .catch((err: unknown) => post({ type: 'error', message: `删除失败：${err instanceof Error ? err.message : String(err)}`, fatal: false }))
        .finally(() => void sendSavesList());
      break;
    case 'listSaves':
      void sendSavesList();
      break;
    case 'listBlueprints':
      void sendBlueprintsList();
      break;
    case 'saveBlueprint':
      void putBlueprint(msg.blueprint)
        .then(() => post({ type: 'blueprintSaved', blueprint: msg.blueprint }))
        .catch((err: unknown) => post({ type: 'error', message: `蓝图保存失败：${err instanceof Error ? err.message : String(err)}`, fatal: false }));
      break;
    case 'deleteBlueprint':
      void deleteBlueprint(msg.id)
        .then(() => sendBlueprintsList())
        .catch(() => sendBlueprintsList());
      break;
    case 'collectBlueprint': {
      if (!sim) return;
      const c = sim.creatures.find((x) => x.id === msg.id);
      if (!c) {
        post({ type: 'error', message: '个体不存在或已死亡，无法收藏', fatal: false });
        return;
      }
      const bp: Blueprint = {
        id: `bp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        name: msg.name || `${c.species === 0 ? '小食草' : c.species === 1 ? '大食草' : c.species === 2 ? '捕食者' : '食腐者'}-${c.id}`,
        species: c.species,
        genes: { ...c.genes },
        capturedTick: sim.tick,
        sourceWorldSeed: sim.seed,
        note: `来自谱系 #${c.lineageId} 第 ${c.generation} 代`,
        createdAt: Date.now(),
      };
      void putBlueprint(bp)
        .then(() => post({ type: 'blueprintCollected', blueprint: bp }))
        .catch((err: unknown) => post({ type: 'error', message: `蓝图保存失败：${err instanceof Error ? err.message : String(err)}`, fatal: false }));
      break;
    }
    default:
      break;
  }
};

// 供测试与调试：解析导入文本的辅助（保持与 UI 一致）
export function parseImport(text: string): { ok: true; data: SaveFile } | { ok: false; error: string } {
  return parseSaveText(text);
}

export { Tool };
