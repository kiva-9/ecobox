// 共享契约：Worker 消息协议、渲染快照、客户端状态、存档与蓝图结构。
// 本文件是所有并行模块（模拟核心 / Worker / 渲染器 / React UI）的唯一接口来源。

import type { Blueprint, GameEvent, Genes, LineageInfo, StatsSample } from '../sim/types';
export type { Blueprint, Genes };

// ---------------------------------------------------------------- 世界与快照

export interface CreatureRenderData {
  x: Float32Array;
  y: Float32Array;
  heading: Float32Array;
  size: Float32Array;
  species: Uint8Array;
  state: Uint8Array;
  energy: Float32Array;
  id: Int32Array;
  artificial: Uint8Array;
  /** 基因（0..1）：用于外观映射（速度→色相、感知→附肢、繁殖投入→腹部斑块） */
  geneSpeed: Float32Array;
  geneSense: Float32Array;
  geneReproInvest: Float32Array;
  count: number;
}

export interface TileRenderData {
  /** 全部量化到 0..255；草地/灌丛按各自上限归一 */
  grass: Uint8Array;
  shrub: Uint8Array;
  moisture: Uint8Array;
  nutrients: Uint8Array;
  carcass: Uint8Array;
}

export interface SelectedDetail {
  id: number;
  species: number;
  x: number;
  y: number;
  energy: number;
  maxEnergy: number;
  age: number;
  maxAge: number;
  state: number;
  reason: string;
  genes: Genes;
  maxSpeed: number;
  adultSize: number;
  senseRadius: number;
  currentSize: number;
  parentId: number;
  lineageId: number;
  generation: number;
  birthTick: number;
  artificial: boolean;
  kids: number;
  mature: boolean;
  reproCooldown: number;
  lastMealTick: number;
  deathTick: number;
  cause: number;
  /** 三代追溯（父、祖、曾祖，可能缺失） */
  ancestors: { id: number; generation: number; species: number; birthTick: number; deathTick: number; cause: number; genes: Genes }[];
  sameLineageAlive: number;
  lineage: LineageInfo | null;
}

export interface ChallengeGoalView {
  label: string;
  current: number;
  target: number;
  ok: boolean;
}

export interface ChallengePublicState {
  id: string;
  name: string;
  brief: string;
  status: 'briefing' | 'running' | 'success' | 'fail';
  goals: ChallengeGoalView[];
  interventionsLeft: number;
  ticksLeft: number;
  coexistProgress: number;
  note: string;
}

export interface SimSnapshot {
  tick: number;
  running: boolean;
  speed: number;
  light: number;
  dayPhase: number;
  drought: number;
  rainfall: number;
  counts: number[];
  totals: { grass: number; shrub: number; carcass: number };
  creatures: CreatureRenderData;
  tiles: TileRenderData | null;
  /** 世界地形（仅在世界变更后的首个快照携带） */
  terrain: Uint8Array | null;
  stats: StatsSample[];
  events: GameEvent[];
  selected: SelectedDetail | null;
  challenge: ChallengePublicState | null;
  world: {
    seed: number;
    presetId: string;
    mode: 'sandbox' | 'challenge';
    challengeId: string | null;
  };
  interventionLeft: number | null;
  capacityWarning: string | null;
  simMsPerTick: number;
}

// ---------------------------------------------------------------- 存档

export interface SaveFile {
  format: 'ecobox-world';
  version: number;
  savedAt: number;
  seed: number;
  presetId: string;
  mode: 'sandbox' | 'challenge';
  challengeId: string | null;
  tick: number;
  rngState: [number, number, number, number];
  nextId: number;
  /** 地形与资源（精确浮点，保证存档续推一致） */
  terrain: number[];
  moisture: number[];
  nutrients: number[];
  grass: number[];
  shrub: number[];
  carcass: number[];
  climate: { rainfall: number; rainBoostTicks: number; droughtTicks: number; droughtTotal: number; droughtIntensity: number };
  creatures: SerializedCreature[];
  records: SerializedRecord[];
  lineages: LineageInfo[];
  stats: StatsSample[];
  events: GameEvent[];
  challenge: unknown;
  interventionUsed: number;
  eventSeq: number;
  statsCursor: number;
}

export interface SerializedCreature {
  id: number;
  species: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  energy: number;
  age: number;
  genes: Genes;
  state: number;
  reason: string;
  targetX: number;
  targetY: number;
  targetKind: number;
  targetId: number;
  threatX: number;
  threatY: number;
  hasThreat: boolean;
  reproCooldown: number;
  eatCooldown: number;
  attackCooldown: number;
  decisionTimer: number;
  blockedTimer: number;
  lastX: number;
  lastY: number;
  blacklistX: number;
  blacklistY: number;
  blacklistTimer: number;
  wanderAngle: number;
  parentId: number;
  lineageId: number;
  generation: number;
  birthTick: number;
  artificial: boolean;
  kids: number;
  lastMealTick: number;
  starveTicks: number;
  torpor: boolean;
}

export interface SerializedRecord {
  id: number;
  species: number;
  parentId: number;
  lineageId: number;
  generation: number;
  birthTick: number;
  deathTick: number;
  cause: number;
  genes: Genes;
  artificial: boolean;
  kids: number;
  x: number;
  y: number;
}

export interface SaveSlotInfo {
  id: string; // 'auto' | 'slot1' | 'slot2' | 'slot3'
  label: string;
  savedAt: number;
  tick: number;
  mode: 'sandbox' | 'challenge';
  challengeId: string | null;
  presetId: string;
  population: number;
}

// ---------------------------------------------------------------- Worker 消息

export type WorkerRequest =
  | { type: 'newWorld'; seed: number; presetId: string }
  | { type: 'startChallenge'; challengeId: string }
  | { type: 'retryChallenge' }
  | { type: 'exitChallenge' }
  | { type: 'confirmChallengeBrief' }
  | { type: 'loadSave'; data: SaveFile }
  | { type: 'setSpeed'; speed: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stepOnce' }
  | { type: 'intervene'; tool: number; tx: number; ty: number; brush: number; genes: Genes | null }
  | { type: 'select'; id: number | null }
  | { type: 'visibility'; visible: boolean }
  | { type: 'requestExport' }
  | { type: 'saveSlot'; slot: string }
  | { type: 'loadSlot'; slot: string }
  | { type: 'deleteSlot'; slot: string }
  | { type: 'listSaves' }
  | { type: 'listBlueprints' }
  | { type: 'saveBlueprint'; blueprint: Blueprint }
  | { type: 'deleteBlueprint'; id: string }
  | { type: 'collectBlueprint'; id: number; name: string };

export type WorkerResponse =
  | { type: 'snapshot'; data: SimSnapshot }
  | { type: 'saved'; slot: string; ok: boolean; error?: string }
  | { type: 'loaded'; slot: string; ok: boolean; error?: string }
  | { type: 'deleted'; slot: string; ok: boolean }
  | { type: 'exportData'; json: string }
  | { type: 'savesList'; saves: SaveSlotInfo[]; storageError: string | null }
  | { type: 'blueprintsList'; blueprints: Blueprint[] }
  | { type: 'blueprintSaved'; blueprint: Blueprint }
  | { type: 'blueprintCollected'; blueprint: Blueprint }
  | { type: 'error'; message: string; fatal: boolean };

// ---------------------------------------------------------------- 客户端状态

export type ModalKind =
  | 'help'
  | 'settings'
  | 'newWorld'
  | 'saveLoad'
  | 'importExport'
  | 'challengeBrief'
  | 'challengeResult'
  | 'confirmReset'
  | 'guide'
  | null;

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'warn' | 'error';
  text: string;
}

export interface Prefs {
  volume: number;
  muted: boolean;
  guideDone: boolean;
  overlay: OverlayState;
}

export interface OverlayState {
  vegetation: boolean;
  moisture: boolean;
  nutrients: boolean;
  activity: boolean;
  population: boolean;
  carcass: boolean;
}

export const DEFAULT_OVERLAY: OverlayState = {
  vegetation: true,
  moisture: false,
  nutrients: false,
  activity: false,
  population: false,
  carcass: false,
};

export interface ClientState {
  phase: 'menu' | 'playing';
  snapshot: SimSnapshot | null;
  saves: SaveSlotInfo[];
  blueprints: Blueprint[];
  storageError: string | null;
  prefs: Prefs;
  modal: ModalKind;
  modalData: Record<string, unknown> | null;
  toasts: Toast[];
  selectedTool: number;
  brushSize: number;
  trackId: number | null;
  overlay: OverlayState;
  busy: boolean;
  perf: { fps: number; simMsPerTick: number; creatures: number; actualTps: number };
}

// ---------------------------------------------------------------- 调色板（UI 与渲染器共用）

export const PALETTE = {
  water: '#2e6f8e',
  waterDeep: '#235670',
  rock: '#7d7468',
  meadow: '#8fbf6a',
  meadowDark: '#79a958',
  woodland: '#4f7d4a',
  woodlandDark: '#3f6a3d',
  arid: '#d8c284',
  aridDark: '#c2a96b',
  grass: '#a7d77a',
  shrub: '#c96f8a',
  carcass: '#8a7f6a',
  species: ['#f2e6b8', '#e8a95c', '#d9534f', '#9a8fd0'],
  speciesDark: ['#c9b878', '#c07f36', '#a83632', '#6f66a8'],
  ink: '#2b2620',
  panel: '#f7f2e6',
  panelEdge: '#d8cfbc',
  accent: '#c96f3a',
  accent2: '#4f7d4a',
  night: 'rgba(24,32,56,0.45)',
} as const;

export function speciesColor(s: number): string {
  return PALETTE.species[s] ?? '#ffffff';
}
