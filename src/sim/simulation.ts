// 模拟编排器：世界 + 个体 + 气候 + 统计 + 事件 + 挑战 + 干预 + 快照 + 存档字段。
// 纯 TypeScript，无任何 DOM/浏览器依赖，可在 Node 中直接运行（测试与批量实验用）。

import { World } from './world';
import { Creature, carcassBiomass, type IdAllocator } from './creature';
import { SpatialHash } from './spatial';
import { RNG } from './rng';
import { updateCreature, type SimEnv } from './ai';
import { updateSoil, sampleStats } from './systems';
import {
  CHALLENGES,
  CLIMATE,
  LIMITS,
  LIGHT,
  PLANTS,
  PRESETS,
  WORLD,
  presetById,
  speciesParams,
} from './config';
import {
  BehaviorState,
  DeathCause,
  Species,
  SPECIES_COUNT,
  Terrain,
  Tool,
  isPassableTerrain,
  terrainName,
} from './constants';
import type {
  CreatureRecord,
  GameEvent,
  Genes,
  LineageInfo,
  StatsSample,
} from './types';
import { randomGenes } from './types';
import type {
  SaveFile,
  SelectedDetail,
  SerializedCreature,
  SerializedRecord,
  SimSnapshot,
  TileRenderData,
} from '../shared/protocol';
import {
  challengePublic,
  createChallenge,
  deserializeChallengeRuntime,
  serializeChallengeRuntime,
  updateChallenge,
  type ChallengeRuntime,
} from './challenges';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 全局光照（昼夜）。tick 0 对应清晨（相位偏移 0.35 天），新世界开局即有自然光。 */
export function computeLight(tick: number): number {
  const phase = ((tick + WORLD.dayLength * 0.35) % WORLD.dayLength) / WORLD.dayLength;
  const s = Math.sin((phase - 0.25) * Math.PI * 2);
  const v = s > 0 ? Math.pow(s, 0.7) : 0;
  return WORLD.nightMinLight + (LIGHT.dayPeak - WORLD.nightMinLight) * v;
}

export class Simulation {
  world: World;
  creatures: Creature[] = [];
  records: CreatureRecord[] = [];
  recordMap = new Map<number, CreatureRecord>();
  lineages = new Map<number, LineageInfo>();
  events: GameEvent[] = [];
  stats: StatsSample[] = [];
  tick = 0;
  rng: RNG;
  seed: number;
  presetId: string;
  mode: 'sandbox' | 'challenge' = 'sandbox';
  challenge: ChallengeRuntime | null = null;
  running = true;
  speed = 1;
  interventionUsed = 0;
  capacityWarning: string | null = null;
  selectedId: number | null = null;
  terrainDirty = true;

  // 气候
  baseRainfall = 0.1;
  rainfall = 0.1;
  rainBoostTicks = 0;
  droughtTicks = 0;
  droughtTotal = 0;
  droughtIntensity = 0;
  light = 1;

  /** 个体 ID 序列（每个世界独立，存档保存与恢复） */
  nextId = 1;
  private allocId: IdAllocator = () => this.nextId++;
  // 内部
  private spatial: SpatialHash;
  private positions: Float64Array;
  private pendingBirths: { child: Creature; parent: Creature }[] = [];
  private eventSeq = 0;
  private birthsSinceSample = 0;
  private deathsSinceSample = 0;
  private deathByCauseSinceSample = [0, 0, 0, 0];
  private birthCounter = 0;
  private deathCounter = 0;
  private predationCounter = 0;
  private nextLineageId = 1;
  private env: SimEnv;
  /** 诊断计数器（攻击/捕杀/进食/残骸进食/追猎决策） */
  counters = { attacks: 0, kills: 0, feeds: 0, carrionFeeds: 0, chases: 0 };

  constructor(seed: number, presetId: string) {
    this.seed = seed;
    this.presetId = presetId;
    this.rng = new RNG(seed);
    const preset = presetById(presetId) ?? PRESETS[0];
    this.baseRainfall = preset.rainfall;
    this.rainfall = preset.rainfall;
    this.world = World.generate(preset, seed);
    this.spatial = new SpatialHash(WORLD.width, WORLD.height, LIMITS.spatialCell);
    this.positions = new Float64Array(LIMITS.maxCreatures * 2);
    this.spawnInitialPopulation(preset.initialCounts);
    this.terrainDirty = true;
    this.env = {
      world: this.world,
      creatures: this.creatures,
      positions: this.positions,
      spatial: this.spatial,
      rng: this.rng,
      tick: 0,
      light: 1,
      drought: 0,
      onEvent: (type, text, x, y) => this.pushEvent(type, text, x, y),
      onBirth: (child, parent) => this.handleBirth(child, parent),
      counters: this.counters,
      onKillCue: (x, y) => this.handleKillCue(x, y, 10),
      allocId: () => this.nextId++,
    };
    this.pushEvent('world', `世界创建：预设「${preset.name}」，种子 ${seed}`, 0, 0);
  }

  // ---------------------------------------------------------------- 初始化

  private spawnInitialPopulation(counts: readonly { species: number; count: number }[]): void {
    for (const { species, count } of counts) {
      const herdSize = Math.max(4, Math.round(count / 5));
      const herds = Math.max(1, Math.round(count / herdSize));
      let spawned = 0;
      for (let h = 0; h < herds && spawned < count; h++) {
        const center = this.randomPassable();
        if (!center) continue;
        const n = Math.min(herdSize, count - spawned);
        for (let k = 0; k < n; k++) {
          let pos: { x: number; y: number } | null = null;
          for (let tries = 0; tries < 12 && !pos; tries++) {
            const a = this.rng.range(0, Math.PI * 2);
            const r = Math.abs(this.rng.gauss(3.2));
            const tx = Math.floor(center.x + Math.cos(a) * r);
            const ty = Math.floor(center.y + Math.sin(a) * r);
            if (this.world.inBounds(tx, ty) && isPassableTerrain(this.world.terrain[this.world.idx(tx, ty)])) {
              pos = { x: tx + 0.5, y: ty + 0.5 };
            }
          }
          if (!pos) pos = this.randomPassable();
          if (!pos) continue;
          const p = speciesParams(species);
          const genes = randomGenes(this.rng, species);
          const c = new Creature(species, genes, pos.x, pos.y, p.maxEnergy * p.startEnergy * (0.7 + 0.6 * genes.size), 0, this.allocId());
          c.wanderAngle = this.rng.range(0, Math.PI * 2);
          c.lineageId = this.registerLineage(c.id, species, this.tick, false);
          this.creatures.push(c);
          spawned++;
        }
      }
    }
  }

  private randomPassable(): { x: number; y: number } | null {
    for (let tries = 0; tries < 300; tries++) {
      const tx = this.rng.int(this.world.width);
      const ty = this.rng.int(this.world.height);
      if (isPassableTerrain(this.world.terrain[this.world.idx(tx, ty)])) {
        return { x: tx + 0.5, y: ty + 0.5 };
      }
    }
    return null;
  }

  private registerLineage(founderId: number, species: number, tick: number, artificial: boolean): number {
    const id = this.nextLineageId++;
    this.lineages.set(id, {
      id,
      founderId,
      species,
      startTick: tick,
      aliveCount: 1,
      totalBirths: 0,
      totalDeaths: 0,
      maxGeneration: 0,
      extinct: false,
      extinctTick: -1,
      artificial,
    });
    if (this.lineages.size > LIMITS.maxLineages) {
      // 容量保护：清理已灭绝且最古老的谱系摘要
      const oldest = this.lineages.keys().next().value;
      if (oldest !== undefined && this.lineages.get(oldest)?.extinct) this.lineages.delete(oldest);
    }
    return id;
  }

  // ---------------------------------------------------------------- 主循环

  /** 推进一个固定 tick */
  step(): void {
    // 气候
    if (this.rainBoostTicks > 0) this.rainBoostTicks--;
    if (this.droughtTicks > 0) {
      this.droughtTicks--;
      const elapsed = this.droughtTotal - this.droughtTicks;
      this.droughtIntensity = Math.min(1, elapsed / 240);
      if (this.droughtTicks === 0) {
        this.droughtIntensity = 0;
        this.pushEvent('climate', '干旱结束，生态系统开始恢复', 0, 0);
      }
    } else if (this.droughtIntensity > 0) {
      this.droughtIntensity = Math.max(0, this.droughtIntensity - 0.02);
    }
    this.rainfall =
      this.droughtTicks > 0
        ? CLIMATE.droughtRainfall
        : this.baseRainfall + (this.rainBoostTicks > 0 ? CLIMATE.rainBoost : 0);
    this.light = computeLight(this.tick);

    // 土壤与植物（错峰）
    updateSoil(this.world, this.tick, { light: this.light, rainfall: this.rainfall, drought: this.droughtIntensity });

    // 空间哈希重建
    this.rebuildSpatial();

    // 环境上下文
    this.env.tick = this.tick;
    this.env.light = this.light;
    this.env.drought = this.droughtIntensity;

    // 个体更新（顺序固定 = 数组索引序，保证可复现）
    for (let i = 0; i < this.creatures.length; i++) {
      const c = this.creatures[i];
      if (!c.alive) continue;
      updateCreature(this.env, c);
    }

    // 合并子代
    if (this.pendingBirths.length > 0) {
      for (const { child, parent } of this.pendingBirths) {
        if (this.creatures.length >= LIMITS.maxCreatures) {
          this.capacityWarning = `生物数量达到上限 ${LIMITS.maxCreatures}，新的自然繁殖被暂停（人工干预不受限）`;
          break;
        }
        this.creatures.push(child);
        const lineage = this.lineages.get(child.lineageId);
        if (lineage) {
          lineage.aliveCount++;
          lineage.totalBirths++;
          if (child.generation > lineage.maxGeneration) lineage.maxGeneration = child.generation;
        }
        this.birthsSinceSample++;
        this.birthCounter++;
        if (this.birthCounter % 100 === 0 || child.parentId === this.selectedId || child.id === this.selectedId) {
          this.pushEvent('birth', `#${parent.id} 繁殖后代 #${child.id}（第 ${child.generation} 代，${lineageName(this, child.lineageId)}）`, child.x, child.y);
        }
      }
      this.pendingBirths.length = 0;
    }

    // 死亡处理
    this.processDeaths();

    // 挑战评估
    if (this.challenge) updateChallenge(this.challenge, this);

    // 统计采样
    if (this.tick % LIMITS.statsInterval === 0) {
      this.stats.push(
        sampleStats(this.world, this.creatures, this.tick, this.birthsSinceSample, this.deathsSinceSample, this.deathByCauseSinceSample),
      );
      if (this.stats.length > LIMITS.statsBuffer) this.stats.splice(0, this.stats.length - LIMITS.statsBuffer);
      this.birthsSinceSample = 0;
      this.deathsSinceSample = 0;
      this.deathByCauseSinceSample = [0, 0, 0, 0];
    }

    this.tick++;
  }

  private rebuildSpatial(): void {
    const n = this.creatures.length;
    for (let i = 0; i < n; i++) {
      this.positions[i * 2] = this.creatures[i].x;
      this.positions[i * 2 + 1] = this.creatures[i].y;
    }
    this.spatial.rebuild(this.positions, n);
  }

  /** 捕杀召唤：R 格内的食腐者听到动静，赶赴现场（纯局部信息） */
  private handleKillCue(x: number, y: number, R = 10): void {
    for (const c of this.creatures) {
      if (!c.alive || c.species !== Species.Scavenger) continue;
      const dx = c.x - x;
      const dy = c.y - y;
      if (dx * dx + dy * dy > R * R) continue;
      if (c.state === BehaviorState.Flee) continue;
      c.torpor = false;
      c.state = BehaviorState.Scavenge;
      c.targetKind = 1;
      c.targetX = x;
      c.targetY = y;
      c.targetRef = null;
      c.decisionTimer = 0;
      c.reason = '听到捕食动静，赶赴现场';
    }
  }

  private handleBirth(child: Creature, parent: Creature): void {
    if (this.creatures.length + this.pendingBirths.length >= LIMITS.maxCreatures) {
      this.capacityWarning = `生物数量达到上限 ${LIMITS.maxCreatures}，新的自然繁殖被暂停（人工干预不受限）`;
      return;
    }
    this.pendingBirths.push({ child, parent });
  }

  private processDeaths(): void {
    let write = 0;
    for (let read = 0; read < this.creatures.length; read++) {
      const c = this.creatures[read];
      if (!c.alive) {
        this.deathCounter++;
        this.deathsSinceSample++;
        this.deathByCauseSinceSample[c.deathCause] = (this.deathByCauseSinceSample[c.deathCause] ?? 0) + 1;
        // 档案记录
        const rec: CreatureRecord = {
          id: c.id,
          species: c.species,
          parentId: c.parentId,
          lineageId: c.lineageId,
          generation: c.generation,
          birthTick: c.birthTick,
          deathTick: this.tick,
          cause: c.deathCause,
          genes: { ...c.genes },
          artificial: c.artificial,
          kids: c.kids,
          x: c.x,
          y: c.y,
        };
        this.records.push(rec);
        this.recordMap.set(rec.id, rec);
        if (this.records.length > LIMITS.maxRecords) {
          const drop = this.records.length - LIMITS.maxRecords;
          for (let k = 0; k < drop; k++) {
            const r = this.records[k];
            // 保留存活个体的祖先链上的记录
            if (!this.isAncestorOfAlive(r.id)) this.recordMap.delete(r.id);
          }
          this.records.splice(0, drop);
        }
        // 谱系更新
        const lineage = this.lineages.get(c.lineageId);
        if (lineage) {
          lineage.aliveCount = Math.max(0, lineage.aliveCount - 1);
          lineage.totalDeaths++;
          if (lineage.aliveCount === 0 && !lineage.extinct) {
            lineage.extinct = true;
            lineage.extinctTick = this.tick;
            this.pushEvent('lineage', `谱系 #${c.lineageId} 灭绝（最后成员 #${c.id}，${causeName(c.deathCause)}）`, c.x, c.y);
          }
        }
        // 尸骸（被捕食的个体已在捕食时部分成骸，这里只补非捕食死亡）
        if (c.deathCause !== DeathCause.Predated) {
          const i = this.world.idx(clamp(Math.floor(c.x), 0, this.world.width - 1), clamp(Math.floor(c.y), 0, this.world.height - 1));
          this.world.carcass[i] = Math.min(PLANTS.carcass.max, this.world.carcass[i] + carcassBiomass(c));
        }
        // 自然死亡也会被附近的食腐者察觉（气味，范围更小）
        if (c.deathCause !== DeathCause.Predated) this.handleKillCue(c.x, c.y, 8);
        // 事件（限流）
        if (c.id === this.selectedId || this.deathCounter % 200 === 0) {
          this.pushEvent('death', `${speciesLabel(c.species)} #${c.id} 死亡（${causeName(c.deathCause)}，${c.reason}）`, c.x, c.y);
        }
        continue;
      }
      this.creatures[write++] = c;
    }
    this.creatures.length = write;
  }

  private isAncestorOfAlive(id: number): boolean {
    for (const c of this.creatures) {
      let pid = c.parentId;
      let guard = 0;
      while (pid >= 0 && guard++ < 64) {
        if (pid === id) return true;
        const rec = this.recordMap.get(pid);
        if (!rec) break;
        pid = rec.parentId;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- 干预

  /** 玩家干预：返回失败原因（无效操作需要解释） */
  intervene(tool: number, tx: number, ty: number, brush: number, genes: Genes | null): { ok: boolean; error?: string } {
    if (tool === Tool.None) return { ok: true };
    if (!this.world.inBounds(tx, ty)) return { ok: false, error: '超出世界边界' };
    if (this.mode === 'challenge' && this.challenge) {
      if (this.challenge.status !== 'running') return { ok: false, error: '挑战未在进行中' };
      if (this.challenge.interventionsLeft <= 0) return { ok: false, error: '干预配额已用完' };
    }
    const r = Math.max(1, brush);
    switch (tool) {
      case Tool.PaintMeadow:
      case Tool.PaintWoodland:
      case Tool.PaintArid:
      case Tool.PaintWater:
      case Tool.PaintRock: {
        const t = tool - Tool.PaintMeadow + Terrain.Meadow;
        let changed = 0;
        forEachTileInBrush(tx, ty, r, (x, y) => {
          const i = this.world.idx(x, y);
          if (this.world.terrain[i] === t) return;
          this.world.terrain[i] = t;
          changed++;
          if (t === Terrain.Water) {
            this.world.moisture[i] = 1;
            this.world.nutrients[i] = Math.min(this.world.nutrients[i], 0.15);
            this.world.grass[i] = 0;
            this.world.shrub[i] = 0;
          } else if (t === Terrain.Rock) {
            this.world.moisture[i] = 0.05;
            this.world.grass[i] = 0;
            this.world.shrub[i] = 0;
          } else if (t === Terrain.Arid) {
            this.world.moisture[i] *= 0.55;
            this.world.nutrients[i] *= 0.7;
          } else {
            this.world.moisture[i] = Math.min(1, this.world.moisture[i] + 0.12);
          }
        });
        if (changed === 0) return { ok: false, error: '该区域已经是目标地形' };
        this.pushEvent('intervene', `地形改造：${terrainName(t)}（${changed} 格）`, tx + 0.5, ty + 0.5);
        break;
      }
      case Tool.PlantGrass:
      case Tool.PlantShrub: {
        const isGrass = tool === Tool.PlantGrass;
        let changed = 0;
        forEachTileInBrush(tx, ty, r, (x, y) => {
          if (!isPassableTerrain(this.world.terrain[this.world.idx(x, y)])) return;
          const i = this.world.idx(x, y);
          if (isGrass) {
            const before = this.world.grass[i];
            this.world.grass[i] = Math.min(PLANTS.grass.max, this.world.grass[i] + 18);
            if (this.world.grass[i] > before) changed++;
          } else {
            const before = this.world.shrub[i];
            this.world.shrub[i] = Math.min(PLANTS.shrub.max, this.world.shrub[i] + 10);
            if (this.world.shrub[i] > before) changed++;
          }
        });
        if (changed === 0) return { ok: false, error: '这里无法播种（地形不可通行或已长满）' };
        this.pushEvent('intervene', `播种：${isGrass ? '青草' : '浆果灌丛'}（${changed} 格）`, tx + 0.5, ty + 0.5);
        break;
      }
      case Tool.Rain: {
        this.rainBoostTicks = CLIMATE.rainBoostTicks;
        this.pushEvent('climate', `人工降雨（持续 ${(CLIMATE.rainBoostTicks / 60).toFixed(0)} 秒）`, tx + 0.5, ty + 0.5);
        break;
      }
      case Tool.Drought: {
        this.startDrought(CLIMATE.droughtTicks);
        this.pushEvent('climate', `人工触发干旱（持续 ${(CLIMATE.droughtTicks / 60).toFixed(0)} 秒）`, tx + 0.5, ty + 0.5);
        break;
      }
      case Tool.SpawnSmallHerb:
      case Tool.SpawnLargeHerb:
      case Tool.SpawnPredator:
      case Tool.SpawnScavenger: {
        const species = tool - Tool.SpawnSmallHerb + Species.SmallHerb;
        const pos = this.randomPassableNear(tx, ty, 3);
        if (!pos) return { ok: false, error: '附近没有可投放的位置' };
        const g = genes ?? randomGenes(this.rng, species);
        const p = speciesParams(species);
        const c = new Creature(species, { ...g }, pos.x, pos.y, p.maxEnergy * 0.7 * (0.7 + 0.6 * g.size), 0, this.allocId());
        c.artificial = true;
        c.generation = 0;
        c.parentId = -1;
        c.birthTick = this.tick;
        c.wanderAngle = this.rng.range(0, Math.PI * 2);
        c.lineageId = this.registerLineage(c.id, species, this.tick, true);
        this.creatures.push(c);
        this.pushEvent('intervene', `人工投放：${speciesLabel(species)} #${c.id}（不记为自然出生）`, pos.x, pos.y);
        break;
      }
      default:
        return { ok: false, error: '未知工具' };
    }
    this.interventionUsed++;
    if (this.mode === 'challenge' && this.challenge) {
      this.challenge.interventionsLeft = Math.max(0, this.challenge.interventionsLeft - 1);
    }
    return { ok: true };
  }

  /** 触发干旱（挑战脚本或玩家干预） */
  startDrought(ticks: number): void {
    this.droughtTicks = ticks;
    this.droughtTotal = ticks;
    this.droughtIntensity = 0.01;
  }

  private randomPassableNear(tx: number, ty: number, radius: number): { x: number; y: number } | null {
    for (let tries = 0; tries < 60; tries++) {
      const x = tx + this.rng.int(radius * 2 + 1) - radius;
      const y = ty + this.rng.int(radius * 2 + 1) - radius;
      if (this.world.inBounds(x, y) && isPassableTerrain(this.world.terrain[this.world.idx(x, y)])) {
        return { x: x + 0.5, y: y + 0.5 };
      }
    }
    return this.randomPassable();
  }

  // ---------------------------------------------------------------- 选择与详情

  select(id: number | null): void {
    this.selectedId = id;
  }

  get selected(): SelectedDetail | null {
    if (this.selectedId === null) return null;
    const c = this.creatures.find((x) => x.id === this.selectedId);
    if (c) return this.detailFromCreature(c);
    const rec = this.recordMap.get(this.selectedId);
    if (rec) return this.detailFromRecord(rec);
    return null;
  }

  private detailFromCreature(c: Creature): SelectedDetail {
    const p = speciesParams(c.species);
    return {
      id: c.id,
      species: c.species,
      x: c.x,
      y: c.y,
      energy: c.energy,
      maxEnergy: c.maxEnergy,
      age: c.age,
      maxAge: p.maxAge,
      state: c.state,
      reason: c.reason,
      genes: { ...c.genes },
      maxSpeed: c.pheno.maxSpeed,
      adultSize: c.adultSize,
      senseRadius: c.pheno.senseRadius,
      currentSize: c.currentSize,
      parentId: c.parentId,
      lineageId: c.lineageId,
      generation: c.generation,
      birthTick: c.birthTick,
      artificial: c.artificial,
      kids: c.kids,
      mature: c.mature,
      reproCooldown: c.reproCooldown,
      lastMealTick: c.lastMealTick,
      deathTick: -1,
      cause: -1,
      ancestors: this.ancestorsOf(c.parentId),
      sameLineageAlive: this.lineages.get(c.lineageId)?.aliveCount ?? 0,
      lineage: this.lineages.get(c.lineageId) ?? null,
    };
  }

  private detailFromRecord(rec: CreatureRecord): SelectedDetail {
    const p = speciesParams(rec.species);
    return {
      id: rec.id,
      species: rec.species,
      x: rec.x,
      y: rec.y,
      energy: 0,
      maxEnergy: p.maxEnergy,
      age: rec.deathTick - rec.birthTick,
      maxAge: p.maxAge,
      state: -1,
      reason: `已死亡：${causeName(rec.cause)}`,
      genes: { ...rec.genes },
      maxSpeed: 0,
      adultSize: 0,
      senseRadius: 0,
      currentSize: 0,
      parentId: rec.parentId,
      lineageId: rec.lineageId,
      generation: rec.generation,
      birthTick: rec.birthTick,
      artificial: rec.artificial,
      kids: rec.kids,
      mature: true,
      reproCooldown: 0,
      lastMealTick: -1,
      deathTick: rec.deathTick,
      cause: rec.cause,
      ancestors: this.ancestorsOf(rec.parentId),
      sameLineageAlive: this.lineages.get(rec.lineageId)?.aliveCount ?? 0,
      lineage: this.lineages.get(rec.lineageId) ?? null,
    };
  }

  /** 三代追溯 */
  private ancestorsOf(parentId: number): SelectedDetail['ancestors'] {
    const out: SelectedDetail['ancestors'] = [];
    let pid = parentId;
    let guard = 0;
    while (pid >= 0 && guard++ < 3) {
      const rec = this.recordMap.get(pid);
      const alive = this.creatures.find((x) => x.id === pid);
      if (alive) {
        out.push({
          id: alive.id,
          generation: alive.generation,
          species: alive.species,
          birthTick: alive.birthTick,
          deathTick: -1,
          cause: -1,
          genes: { ...alive.genes },
        });
        pid = alive.parentId;
      } else if (rec) {
        out.push({
          id: rec.id,
          generation: rec.generation,
          species: rec.species,
          birthTick: rec.birthTick,
          deathTick: rec.deathTick,
          cause: rec.cause,
          genes: { ...rec.genes },
        });
        pid = rec.parentId;
      } else {
        break;
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- 快照

  snapshot(includeTiles: boolean): SimSnapshot {
    const n = this.creatures.length;
    const cx = new Float32Array(n);
    const cy = new Float32Array(n);
    const ch = new Float32Array(n);
    const cs = new Float32Array(n);
    const csp = new Uint8Array(n);
    const cst = new Uint8Array(n);
    const cen = new Float32Array(n);
    const cid = new Int32Array(n);
    const cart = new Uint8Array(n);
    const cgs = new Float32Array(n);
    const cgn = new Float32Array(n);
    const cgr = new Float32Array(n);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const c = this.creatures[i];
      cx[i] = c.x;
      cy[i] = c.y;
      ch[i] = c.heading;
      cs[i] = c.currentSize;
      csp[i] = c.species;
      cst[i] = c.state;
      cen[i] = c.maxEnergy > 0 ? c.energy / c.maxEnergy : 0;
      cid[i] = c.id;
      cart[i] = c.artificial ? 1 : 0;
      cgs[i] = c.genes.speed;
      cgn[i] = c.genes.sense;
      cgr[i] = c.genes.reproInvest;
      counts[c.species]++;
    }
    let tiles: TileRenderData | null = null;
    if (includeTiles) {
      const size = this.world.width * this.world.height;
      const grass = new Uint8Array(size);
      const shrub = new Uint8Array(size);
      const moist = new Uint8Array(size);
      const nut = new Uint8Array(size);
      const car = new Uint8Array(size);
      for (let i = 0; i < size; i++) {
        grass[i] = Math.round((this.world.grass[i] / PLANTS.grass.max) * 255);
        shrub[i] = Math.round((this.world.shrub[i] / PLANTS.shrub.max) * 255);
        moist[i] = Math.round(this.world.moisture[i] * 255);
        nut[i] = Math.round(this.world.nutrients[i] * 255);
        car[i] = Math.round((this.world.carcass[i] / PLANTS.carcass.max) * 255);
      }
      tiles = { grass, shrub, moisture: moist, nutrients: nut, carcass: car };
    }
    const totals = this.world.totals();
    return {
      tick: this.tick,
      running: this.running,
      speed: this.speed,
      light: this.light,
      dayPhase: (this.tick % WORLD.dayLength) / WORLD.dayLength,
      drought: this.droughtIntensity,
      rainfall: this.rainfall,
      counts,
      totals,
      creatures: {
        x: cx, y: cy, heading: ch, size: cs, species: csp, state: cst, energy: cen,
        id: cid, artificial: cart, geneSpeed: cgs, geneSense: cgn, geneReproInvest: cgr, count: n,
      },
      tiles,
      terrain: this.terrainDirty ? new Uint8Array(this.world.terrain) : null,
      stats: this.stats.slice(-600),
      events: this.events.slice(-80),
      selected: this.selected,
      challenge: this.challenge ? challengePublic(this.challenge, this) : null,
      world: {
        seed: this.seed,
        presetId: this.presetId,
        mode: this.mode,
        challengeId: this.challenge?.config.id ?? null,
      },
      interventionLeft: this.challenge ? this.challenge.interventionsLeft : null,
      capacityWarning: this.capacityWarning,
      simMsPerTick: 0,
    };
  }

  clearTerrainDirty(): void {
    this.terrainDirty = false;
  }

  // ---------------------------------------------------------------- 事件

  pushEvent(type: string, text: string, x = 0, y = 0): void {
    // 限流：出生/捕食类事件按计数器抽样，避免日志被刷爆
    if (type === 'birth') {
      this.birthCounter++;
      if (this.birthCounter % 100 !== 0) return;
    }
    if (type === 'predation') {
      this.predationCounter++;
      if (this.predationCounter % 10 !== 0) return;
    }
    if (type === 'attack') {
      this.predationCounter++;
      if (this.predationCounter % 50 !== 0) return;
    }
    this.events.push({ seq: this.eventSeq++, tick: this.tick, type, text, x, y });
    if (this.events.length > LIMITS.maxEvents) {
      this.events.splice(0, this.events.length - LIMITS.maxEvents);
    }
  }

  get eventCounter(): number {
    return this.eventSeq;
  }

  setEventSeq(v: number): void {
    this.eventSeq = v;
  }

  // ---------------------------------------------------------------- 存档字段

  toSaveData(): SaveFile {
    const creatures: SerializedCreature[] = this.creatures.map((c) => ({
      id: c.id, species: c.species, x: c.x, y: c.y, vx: c.vx, vy: c.vy, heading: c.heading,
      energy: c.energy, age: c.age, genes: { ...c.genes }, state: c.state, reason: c.reason,
      targetX: c.targetX, targetY: c.targetY, targetKind: c.targetKind, targetId: c.targetId,
      threatX: c.threatX, threatY: c.threatY, hasThreat: c.hasThreat,
      reproCooldown: c.reproCooldown, eatCooldown: c.eatCooldown, attackCooldown: c.attackCooldown,
      decisionTimer: c.decisionTimer,
      blockedTimer: c.blockedTimer, lastX: c.lastX, lastY: c.lastY,
      blacklistX: c.blacklistX, blacklistY: c.blacklistY, blacklistTimer: c.blacklistTimer,
      wanderAngle: c.wanderAngle, parentId: c.parentId, lineageId: c.lineageId, generation: c.generation,
      birthTick: c.birthTick, artificial: c.artificial, kids: c.kids, lastMealTick: c.lastMealTick,
      starveTicks: c.starveTicks, torpor: c.torpor,
    }));
    const records: SerializedRecord[] = this.records.map((r) => ({ ...r, genes: { ...r.genes } }));
    return {
      format: 'ecobox-world',
      version: 1,
      savedAt: Date.now(),
      seed: this.seed,
      presetId: this.presetId,
      mode: this.mode,
      challengeId: this.challenge?.config.id ?? null,
      tick: this.tick,
      rngState: this.rng.getState(),
      nextId: this.nextId,
      terrain: Array.from(this.world.terrain),
      moisture: Array.from(this.world.moisture),
      nutrients: Array.from(this.world.nutrients),
      grass: Array.from(this.world.grass),
      shrub: Array.from(this.world.shrub),
      carcass: Array.from(this.world.carcass),
      climate: {
        rainfall: this.rainfall,
        rainBoostTicks: this.rainBoostTicks,
        droughtTicks: this.droughtTicks,
        droughtTotal: this.droughtTotal,
        droughtIntensity: this.droughtIntensity,
      },
      creatures,
      records,
      lineages: Array.from(this.lineages.values()),
      stats: this.stats.slice(-1200),
      events: this.events.slice(-200),
      challenge: this.challenge ? serializeChallengeRuntime(this.challenge) : null,
      interventionUsed: this.interventionUsed,
      eventSeq: this.eventSeq,
      statsCursor: 0,
    };
  }

  /** 从存档恢复（假定已通过 validateSave 校验） */
  static fromSave(data: SaveFile): Simulation {
    const sim = Object.create(Simulation.prototype) as Simulation;
    sim.seed = data.seed;
    sim.presetId = data.presetId;
    sim.mode = data.mode;
    sim.tick = data.tick;
    sim.rng = new RNG(data.seed);
    sim.rng.setState(data.rngState);
    const preset = presetById(data.presetId) ?? PRESETS[0];
    sim.baseRainfall = preset.rainfall;
    sim.world = new World(WORLD.width, WORLD.height);
    sim.world.terrain.set(Uint8Array.from(data.terrain));
    sim.world.moisture.set(Float32Array.from(data.moisture));
    sim.world.nutrients.set(Float32Array.from(data.nutrients));
    sim.world.grass.set(Float32Array.from(data.grass));
    sim.world.shrub.set(Float32Array.from(data.shrub));
    sim.world.carcass.set(Float32Array.from(data.carcass));
    sim.spatial = new SpatialHash(WORLD.width, WORLD.height, LIMITS.spatialCell);
    sim.positions = new Float64Array(LIMITS.maxCreatures * 2);
    sim.creatures = [];
    sim.records = [];
    sim.recordMap = new Map();
    sim.lineages = new Map();
    sim.events = [];
    sim.stats = data.stats ?? [];
    sim.pendingBirths = [];
    sim.birthsSinceSample = 0;
    sim.deathsSinceSample = 0;
    sim.deathByCauseSinceSample = [0, 0, 0, 0];
    sim.birthCounter = 0;
    sim.deathCounter = 0;
    sim.predationCounter = 0;
    sim.capacityWarning = null;
    sim.selectedId = null;
    sim.terrainDirty = true;
    sim.running = true;
    sim.speed = 1;
    sim.nextId = data.nextId;
    sim.allocId = () => sim.nextId++;
    sim.counters = { attacks: 0, kills: 0, feeds: 0, carrionFeeds: 0, chases: 0 };
    sim.interventionUsed = data.interventionUsed ?? 0;
    sim.rainBoostTicks = data.climate.rainBoostTicks;
    sim.droughtTicks = data.climate.droughtTicks;
    sim.droughtTotal = data.climate.droughtTotal ?? data.climate.droughtTicks;
    sim.droughtIntensity = data.climate.droughtIntensity;
    sim.rainfall = data.climate.rainfall;
    sim.light = computeLight(data.tick);
    sim.nextId = data.nextId;

    // 谱系
    let maxLineage = 0;
    for (const l of data.lineages) {
      sim.lineages.set(l.id, { ...l });
      if (l.id > maxLineage) maxLineage = l.id;
    }
    sim.nextLineageId = maxLineage + 1;

    // 档案
    for (const r of data.records) {
      sim.records.push({ ...r, genes: { ...r.genes } });
      sim.recordMap.set(r.id, sim.records[sim.records.length - 1]);
    }

    // 事件
    for (const e of data.events) sim.events.push({ ...e });
    sim.eventSeq = data.eventSeq ?? sim.events.length;

    // 个体
    for (const sc of data.creatures) {
      const c = new Creature(sc.species, { ...sc.genes }, sc.x, sc.y, sc.energy, sc.lineageId, sc.id);
      c.id = sc.id; // 保持 ID（构造函数已分配一个，这里覆盖）
      c.vx = sc.vx;
      c.vy = sc.vy;
      c.heading = sc.heading;
      c.age = sc.age;
      c.state = sc.state;
      c.reason = sc.reason;
      c.targetX = sc.targetX;
      c.targetY = sc.targetY;
      c.targetKind = sc.targetKind;
      c.targetId = sc.targetId;
      c.threatX = sc.threatX;
      c.threatY = sc.threatY;
      c.hasThreat = sc.hasThreat;
      c.reproCooldown = sc.reproCooldown;
      c.eatCooldown = sc.eatCooldown;
      c.attackCooldown = sc.attackCooldown;
      c.decisionTimer = sc.decisionTimer ?? 0;
      c.blockedTimer = sc.blockedTimer;
      c.lastX = sc.lastX;
      c.lastY = sc.lastY;
      c.blacklistX = sc.blacklistX;
      c.blacklistY = sc.blacklistY;
      c.blacklistTimer = sc.blacklistTimer;
      c.wanderAngle = sc.wanderAngle;
      c.parentId = sc.parentId;
      c.generation = sc.generation;
      c.birthTick = sc.birthTick;
      c.artificial = sc.artificial;
      c.kids = sc.kids;
      c.lastMealTick = sc.lastMealTick;
      c.starveTicks = sc.starveTicks ?? 0;
      c.torpor = sc.torpor ?? false;
      c.mature = c.age >= speciesParams(c.species).maturity;
      sim.creatures.push(c);
    }
    // 恢复目标引用（追击/跟随的猎物对象）
    for (const c of sim.creatures) {
      if (c.targetId >= 0 && (c.targetKind === 2 || c.targetKind === 5)) {
        c.targetRef = sim.creatures.find((o) => o.id === c.targetId) ?? null;
      }
    }
    // ID 计数器回到正确位置
    sim.nextId = Math.max(data.nextId, sim.creatures.reduce((m, c) => Math.max(m, c.id), 0) + 1);

    // 挑战
    sim.challenge = data.challenge ? deserializeChallengeRuntime(data.challenge) : null;
    if (sim.challenge) sim.mode = 'challenge';

    sim.env = {
      world: sim.world,
      creatures: sim.creatures,
      positions: sim.positions,
      spatial: sim.spatial,
      rng: sim.rng,
      tick: sim.tick,
      light: sim.light,
      drought: sim.droughtIntensity,
      onEvent: (type, text, x, y) => sim.pushEvent(type, text, x, y),
      onBirth: (child, parent) => sim.handleBirth(child, parent),
      counters: sim.counters,
      onKillCue: (x, y) => sim.handleKillCue(x, y, 10),
      allocId: () => sim.nextId++,
    };
    return sim;
  }

  // ---------------------------------------------------------------- 挑战

  static startChallenge(configId: string): Simulation {
    const config = CHALLENGES.find((c) => c.id === configId);
    if (!config) throw new Error(`未知挑战: ${configId}`);
    const sim = new Simulation(config.seed, config.preset);
    sim.mode = 'challenge';
    // 初始数量覆盖
    if (config.initialCounts) {
      sim.creatures.length = 0;
      sim.lineages.clear();
      sim.nextLineageId = 1;
      sim.spawnInitialPopulation(config.initialCounts);
    }
    sim.challenge = createChallenge(config, sim);
    sim.pushEvent('challenge', `挑战开始：${config.name}`, 0, 0);
    return sim;
  }

  retryChallenge(): void {
    if (!this.challenge) return;
    const config = this.challenge.config;
    const fresh = Simulation.startChallenge(config.id);
    // 用新状态替换自身（保持引用稳定）
    Object.assign(this, fresh);
  }
}

// ---------------------------------------------------------------- 辅助函数

function forEachTileInBrush(tx: number, ty: number, r: number, fn: (x: number, y: number) => void): void {
  const ri = Math.floor(r);
  for (let dy = -ri; dy <= ri; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
      if (dx * dx + dy * dy > (r + 0.25) * (r + 0.25)) continue;
      fn(tx + dx, ty + dy);
    }
  }
}

function causeName(c: number): string {
  switch (c) {
    case DeathCause.Starve: return '饿死';
    case DeathCause.Age: return '衰老';
    case DeathCause.Predated: return '被捕食';
    case DeathCause.Dehydrate: return '脱水';
    default: return '未知';
  }
}

function speciesLabel(s: number): string {
  return s === Species.SmallHerb ? '小型食草者' : s === Species.LargeHerb ? '大型食草者' : s === Species.Predator ? '捕食者' : '食腐者';
}

function lineageName(sim: Simulation, id: number): string {
  const l = sim.lineages.get(id);
  return l ? `谱系 #${id}` : '未知谱系';
}

// 供 worker/测试使用
export const SPECIES_TOTAL = SPECIES_COUNT;
export { BehaviorState };
