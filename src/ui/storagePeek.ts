// 启动时直接读取 IndexedDB 中的存档与蓝图列表（只读）。
//
// 背景：client.ts 只在 newWorld / startChallenge / loadSlot 等消息响应后才拉取 savesList /
// blueprintsList，worker 启动时不会广播。因此新打开页面（phase=menu）时 UI 侧 state.saves /
// state.blueprints 为空，「继续游戏」与「生命档案」看不到已存在的旧数据。
//
// 这里按 src/worker/storage.ts 使用的同一 schema（库名 / 版本 / store / 记录结构）以只读方式
// 打开同一数据库补齐列表；任何失败都静默降级（保持原有"进入世界后刷新"的行为）。
// 集成时若 client.ts 暴露 refreshSaves() / refreshBlueprints()（或 worker 启动时广播列表），
// 可删除本文件并改调该接口。

import { client } from '../game/client';
import type { Blueprint, SaveSlotInfo } from '../shared/protocol';

/** 与 src/worker/storage.ts 保持一致 */
const DB_NAME = 'ecobox-db';
const SAVE_STORE = 'saves';
const BLUEPRINT_STORE = 'blueprints';

interface StoredSave {
  id: string;
  info: SaveSlotInfo;
}

function openExistingDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      // 不传版本号：只打开已存在的数据库，绝不触发升级（创建库是 worker 的职责）
      req = indexedDB.open(DB_NAME);
    } catch {
      resolve(null);
      return;
    }
    const done = (db: IDBDatabase | null): void => resolve(db);
    req.onsuccess = () => done(req.result);
    req.onerror = () => done(null);
    req.onblocked = () => done(null);
    req.onupgradeneeded = () => {
      // 数据库已存在时不应发生；放弃以免与 worker 的建库逻辑冲突
      try {
        req.transaction?.abort();
      } catch {
        /* 忽略 */
      }
      done(null);
    };
  });
}

async function dbExists(): Promise<boolean> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return false;
  try {
    const dbs = await indexedDB.databases();
    return dbs.some((d) => d.name === DB_NAME);
  } catch {
    return false;
  }
}

async function readAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  if (!db.objectStoreNames.contains(store)) return [];
  return new Promise<T[]>((resolve) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const rq = tx.objectStore(store).getAll();
      rq.onsuccess = () => resolve((rq.result ?? []) as T[]);
      rq.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

const SLOT_ORDER: Record<string, number> = { auto: 0, slot1: 1, slot2: 2, slot3: 3 };

/** 读取存档列表（auto → slot1 → slot3，同槽按保存时间新的在前） */
async function readSaves(): Promise<SaveSlotInfo[]> {
  if (!(await dbExists())) return [];
  const db = await openExistingDb();
  if (!db) return [];
  try {
    const all = await readAll<StoredSave>(db, SAVE_STORE);
    return all
      .map((s) => s?.info)
      .filter((i): i is SaveSlotInfo => !!i && typeof i.id === 'string')
      .sort((a, b) => (SLOT_ORDER[a.id] ?? 9) - (SLOT_ORDER[b.id] ?? 9) || b.savedAt - a.savedAt);
  } finally {
    db.close();
  }
}

/** 读取蓝图列表（新的在前） */
async function readBlueprints(): Promise<Blueprint[]> {
  if (!(await dbExists())) return [];
  const db = await openExistingDb();
  if (!db) return [];
  try {
    const all = await readAll<Blueprint>(db, BLUEPRINT_STORE);
    return all
      .filter((b): b is Blueprint => !!b && typeof b.id === 'string' && typeof b.name === 'string')
      .sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    db.close();
  }
}

/**
 * 启动时补齐存档/蓝图列表。仅在 UI 侧列表为空时生效，避免覆盖 worker 推送的数据。
 * 通过替换 client.state 并借用 setTrackId() 触发一次 UI 通知（client 无公开刷新接口）。
 */
export async function peekStoredLists(): Promise<void> {
  try {
    const [saves, blueprints] = await Promise.all([readSaves(), readBlueprints()]);
    const needSaves = saves.length > 0 && client.state.saves.length === 0;
    const needBlueprints = blueprints.length > 0 && client.state.blueprints.length === 0;
    if (!needSaves && !needBlueprints) return;
    client.state = {
      ...client.state,
      saves: needSaves ? saves : client.state.saves,
      blueprints: needBlueprints ? blueprints : client.state.blueprints,
    };
    client.setTrackId(client.state.trackId);
  } catch {
    /* 静默降级：进入世界后由 worker 的列表响应刷新 */
  }
}
