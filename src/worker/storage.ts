// IndexedDB 存储（Worker 上下文可用）：世界存档与遗传蓝图。
// 简单偏好由 UI 层存 localStorage；完整世界只进 IndexedDB。

import type { Blueprint, SaveFile, SaveSlotInfo } from '../shared/protocol';

const DB_NAME = 'ecobox-db';
const DB_VERSION = 1;
const SAVE_STORE = 'saves';
const BLUEPRINT_STORE = 'blueprints';

export interface StoredSave {
  id: string;
  info: SaveSlotInfo;
  data: SaveFile;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SAVE_STORE)) {
        db.createObjectStore(SAVE_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(BLUEPRINT_STORE)) {
        db.createObjectStore(BLUEPRINT_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'));
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB 操作失败'));
      }),
  );
}

export async function putSave(id: string, info: SaveSlotInfo, data: SaveFile): Promise<void> {
  await tx<IDBValidKey>(SAVE_STORE, 'readwrite', (s) => s.put({ id, info, data } satisfies StoredSave));
}

export async function getSave(id: string): Promise<StoredSave | null> {
  const r = await tx<StoredSave | undefined>(SAVE_STORE, 'readonly', (s) => s.get(id));
  return r ?? null;
}

export async function listSaves(): Promise<SaveSlotInfo[]> {
  const all = await tx<StoredSave[]>(SAVE_STORE, 'readonly', (s) => s.getAll());
  const order: Record<string, number> = { auto: 0, slot1: 1, slot2: 2, slot3: 3 };
  return all
    .map((s) => s.info)
    .sort((a, b) => (order[a.id] ?? 9) - (order[b.id] ?? 9) || b.savedAt - a.savedAt);
}

export async function deleteSave(id: string): Promise<void> {
  await tx<undefined>(SAVE_STORE, 'readwrite', (s) => s.delete(id));
}

export async function putBlueprint(bp: Blueprint): Promise<void> {
  await tx<IDBValidKey>(BLUEPRINT_STORE, 'readwrite', (s) => s.put(bp));
}

export async function listBlueprints(): Promise<Blueprint[]> {
  const all = await tx<Blueprint[]>(BLUEPRINT_STORE, 'readonly', (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteBlueprint(id: string): Promise<void> {
  await tx<undefined>(BLUEPRINT_STORE, 'readwrite', (s) => s.delete(id));
}

export function storageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}
