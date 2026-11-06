// 工具栏工具定义与物种↔投放工具映射。

import { Species, Tool, toolName } from '../sim/constants';
import type { SpriteName } from './sprites';

export type ToolGroup = 'select' | 'terrain' | 'plant' | 'climate' | 'spawn';

export interface ToolDef {
  id: number;
  /** 按钮上的短标签 */
  label: string;
  sprite: SpriteName;
  group: ToolGroup;
  /** tooltip 说明 */
  hint: string;
}

export const TOOL_DEFS: readonly ToolDef[] = [
  { id: Tool.None, label: '选择', sprite: 'cursor', group: 'select', hint: '选择 / 观察：点击场景中的生物查看个体档案' },
  { id: Tool.PaintMeadow, label: '草地', sprite: 'meadow', group: 'terrain', hint: '地形笔：改为湿润草地，植物生长快' },
  { id: Tool.PaintWoodland, label: '林地', sprite: 'woodland', group: 'terrain', hint: '地形笔：改为林地，遮阴适合浆果灌丛' },
  { id: Tool.PaintArid, label: '旱地', sprite: 'arid', group: 'terrain', hint: '地形笔：改为干旱地，水分蒸发快' },
  { id: Tool.PaintWater, label: '水域', sprite: 'water', group: 'terrain', hint: '地形笔：改为水域，生物无法进入' },
  { id: Tool.PaintRock, label: '岩石', sprite: 'rock', group: 'terrain', hint: '地形笔：改为岩石，不可通行' },
  { id: Tool.PlantGrass, label: '播种', sprite: 'seed', group: 'plant', hint: '播种青草：在笔刷范围内补充草本食物' },
  { id: Tool.PlantShrub, label: '浆果', sprite: 'shrub', group: 'plant', hint: '种植浆果灌丛：高能量植物，喜林地' },
  { id: Tool.Rain, label: '降雨', sprite: 'rain', group: 'climate', hint: '降雨：提升笔刷范围水分' },
  { id: Tool.Drought, label: '干旱', sprite: 'drought', group: 'climate', hint: '触发干旱：降低水分，考验耐旱性' },
  { id: Tool.SpawnSmallHerb, label: '小食草', sprite: 'herbS', group: 'spawn', hint: '投放小型食草者（随机基因，或使用装备的蓝图）' },
  { id: Tool.SpawnLargeHerb, label: '大食草', sprite: 'herbL', group: 'spawn', hint: '投放大型食草者（随机基因，或使用装备的蓝图）' },
  { id: Tool.SpawnPredator, label: '捕食者', sprite: 'pred', group: 'spawn', hint: '投放捕食者（随机基因，或使用装备的蓝图）' },
  { id: Tool.SpawnScavenger, label: '食腐者', sprite: 'scav', group: 'spawn', hint: '投放食腐者（随机基因，或使用装备的蓝图）' },
] as const;

export const TOOL_GROUP_LABELS: Record<ToolGroup, string> = {
  select: '指针',
  terrain: '地形笔',
  plant: '植被',
  climate: '气候',
  spawn: '投放',
};

/** 物种 → 对应投放工具 */
export function spawnToolForSpecies(species: number): number | null {
  switch (species) {
    case Species.SmallHerb:
      return Tool.SpawnSmallHerb;
    case Species.LargeHerb:
      return Tool.SpawnLargeHerb;
    case Species.Predator:
      return Tool.SpawnPredator;
    case Species.Scavenger:
      return Tool.SpawnScavenger;
    default:
      return null;
  }
}

/** 投放工具 → 物种 */
export function speciesForSpawnTool(tool: number): number | null {
  switch (tool) {
    case Tool.SpawnSmallHerb:
      return Species.SmallHerb;
    case Tool.SpawnLargeHerb:
      return Species.LargeHerb;
    case Tool.SpawnPredator:
      return Species.Predator;
    case Tool.SpawnScavenger:
      return Species.Scavenger;
    default:
      return null;
  }
}

export function toolDefOf(id: number): ToolDef | undefined {
  return TOOL_DEFS.find((t) => t.id === id);
}

export { toolName };
