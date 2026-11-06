// 存档校验：导入前验证格式、版本、数值范围与容量。
// 校验失败必须给出清楚原因，且不破坏当前世界（由调用方决定是否应用）。

import { LIMITS, PLANTS, WORLD } from './config';
import { SPECIES_COUNT, Terrain } from './constants';
import { CHALLENGES } from './config';
import type { SaveFile } from '../shared/protocol';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const MAX_IMPORT_BYTES = 64 * 1024 * 1024; // 64MB 容量上限

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function checkNumArray(v: unknown, len: number, min: number, max: number, name: string, errors: string[]): void {
  if (!Array.isArray(v)) {
    errors.push(`${name} 缺失或不是数组`);
    return;
  }
  if (v.length !== len) {
    errors.push(`${name} 长度应为 ${len}，实际为 ${v.length}`);
    return;
  }
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (!isFiniteNumber(x)) {
      errors.push(`${name}[${i}] 不是有效数值`);
      return;
    }
    if (x < min || x > max) {
      errors.push(`${name}[${i}]=${x} 超出范围 [${min}, ${max}]`);
      return;
    }
  }
}

/** 校验存档结构（不执行恢复） */
export function validateSave(data: unknown): ValidationResult {
  const errors: string[] = [];
  if (!data || typeof data !== 'object') {
    return { ok: false, errors: ['文件不是有效的 JSON 对象'] };
  }
  const d = data as Record<string, unknown>;
  if (d.format !== 'ecobox-world') {
    errors.push(`文件格式应为 "ecobox-world"，实际为 "${String(d.format)}"`);
  }
  if (d.version !== 1) {
    errors.push(`不支持的世界版本 ${String(d.version)}（当前支持 1）`);
  }
  if (!isFiniteNumber(d.seed) || d.seed < 0) errors.push('种子缺失或非法');
  if (typeof d.presetId !== 'string' || d.presetId.length === 0) errors.push('预设 ID 缺失');
  if (d.mode !== 'sandbox' && d.mode !== 'challenge') errors.push('模式必须是 sandbox 或 challenge');
  if (!isFiniteNumber(d.tick) || d.tick < 0 || !Number.isInteger(d.tick)) errors.push('模拟时间非法');
  if (!Array.isArray(d.rngState) || d.rngState.length !== 4 || !d.rngState.every((v) => isFiniteNumber(v))) {
    errors.push('随机数状态缺失或非法');
  }
  if (!isFiniteNumber(d.nextId) || d.nextId < 1) errors.push('ID 计数器非法');
  if (!d.climate || typeof d.climate !== 'object') {
    errors.push('气候状态缺失');
  } else {
    const c = d.climate as Record<string, unknown>;
    for (const k of ['rainfall', 'rainBoostTicks', 'droughtTicks', 'droughtIntensity']) {
      if (!isFiniteNumber(c[k]) || (c[k] as number) < 0) errors.push(`气候字段 ${k} 非法`);
    }
    // droughtTotal 为可选字段（旧版本存档没有），缺省时用 droughtTicks
    if (c.droughtTotal !== undefined && (!isFiniteNumber(c.droughtTotal) || (c.droughtTotal as number) < 0)) {
      errors.push('气候字段 droughtTotal 非法');
    }
  }

  const n = WORLD.width * WORLD.height;
  checkNumArray(d.terrain, n, 0, Terrain.Arid, '地形', errors);
  checkNumArray(d.moisture, n, 0, 1, '水分', errors);
  checkNumArray(d.nutrients, n, 0, 1, '养分', errors);
  checkNumArray(d.grass, n, 0, PLANTS.grass.max + 0.001, '青草', errors);
  checkNumArray(d.shrub, n, 0, PLANTS.shrub.max + 0.001, '浆果灌丛', errors);
  checkNumArray(d.carcass, n, 0, PLANTS.carcass.max + 0.001, '残骸', errors);

  if (!Array.isArray(d.creatures)) {
    errors.push('个体列表缺失');
  } else {
    if (d.creatures.length > LIMITS.maxCreatures + 50) {
      errors.push(`个体数量 ${d.creatures.length} 超出上限 ${LIMITS.maxCreatures}`);
    }
    const ids = new Set<number>();
    for (let i = 0; i < Math.min(d.creatures.length, 200); i++) {
      const c = d.creatures[i] as Record<string, unknown>;
      if (!c || typeof c !== 'object') {
        errors.push(`个体 #${i} 不是对象`);
        break;
      }
      for (const k of ['id', 'species', 'x', 'y', 'energy', 'age', 'lineageId', 'generation', 'birthTick']) {
        if (!isFiniteNumber(c[k])) {
          errors.push(`个体 #${i} 字段 ${k} 非法`);
          break;
        }
      }
      if (!isFiniteNumber(c.species) || (c.species as number) < 0 || (c.species as number) >= SPECIES_COUNT) {
        errors.push(`个体 #${i} 物种非法`);
        break;
      }
      if (!isFiniteNumber(c.x) || (c.x as number) < -1 || (c.x as number) > WORLD.width + 1) {
        errors.push(`个体 #${i} 位置 X 非法`);
        break;
      }
      if (!isFiniteNumber(c.y) || (c.y as number) < -1 || (c.y as number) > WORLD.height + 1) {
        errors.push(`个体 #${i} 位置 Y 非法`);
        break;
      }
      const id = c.id as number;
      if (ids.has(id)) {
        errors.push(`个体 ID 重复：${id}`);
        break;
      }
      ids.add(id);
      if (!c.genes || typeof c.genes !== 'object') {
        errors.push(`个体 #${i} 基因缺失`);
        break;
      }
      const g = c.genes as Record<string, unknown>;
      for (const k of ['speed', 'size', 'sense', 'droughtTol', 'reproInvest', 'boldness']) {
        const v = g[k];
        if (!isFiniteNumber(v) || (v as number) < 0 || (v as number) > 1) {
          errors.push(`个体 #${i} 基因 ${k} 非法`);
          break;
        }
      }
    }
  }

  if (d.records !== undefined) {
    if (!Array.isArray(d.records)) errors.push('档案列表不是数组');
    else if (d.records.length > LIMITS.maxRecords + 1000) errors.push('档案数量超出容量');
  }
  if (d.lineages !== undefined) {
    if (!Array.isArray(d.lineages)) errors.push('谱系列表不是数组');
    else if (d.lineages.length > LIMITS.maxLineages + 500) errors.push('谱系数量超出容量');
  }
  if (d.challenge !== undefined && d.challenge !== null) {
    if (typeof d.challenge !== 'object') errors.push('挑战状态非法');
    else {
      const cfgId = (d.challenge as Record<string, unknown>).configId;
      if (typeof cfgId !== 'string' || !CHALLENGES.some((c) => c.id === cfgId)) {
        errors.push(`挑战状态引用了未知挑战 "${String(cfgId)}"`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/** 从 JSON 文本解析并校验 */
export function parseSaveText(text: string): { ok: true; data: SaveFile } | { ok: false; error: string } {
  if (text.length > MAX_IMPORT_BYTES) {
    return { ok: false, error: `文件过大（${(text.length / 1048576).toFixed(1)}MB，上限 64MB）` };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `JSON 解析失败：${err instanceof Error ? err.message : String(err)}` };
  }
  const v = validateSave(data);
  if (!v.ok) {
    return { ok: false, error: v.errors.slice(0, 4).join('；') };
  }
  return { ok: true, data: data as SaveFile };
}
