// AI：效用评分决策 + 状态机 + 转向行为 + 进食/捕食/繁殖执行。
// 所有决策只使用个体感知半径内的信息（空间哈希局部查询），不使用全图知识。

import { World } from './world';
import { Creature, PREY_SPECIES } from './creature';
import { SpatialHash } from './spatial';
import { RNG } from './rng';
import { inheritGenes } from './types';
import {
  AI,
  ENERGY,
  LIMITS,
  PLANTS,
  speciesParams,
} from './config';
import { BehaviorState as BS, DeathCause, Species } from './constants';

export interface SimEnv {
  world: World;
  creatures: Creature[];
  positions: Float64Array;
  spatial: SpatialHash;
  rng: RNG;
  tick: number;
  light: number;
  drought: number;
  /** 事件回调（来自真实模拟事件） */
  onEvent(type: string, text: string, x?: number, y?: number): void;
  /** 子代出生回调（由 Simulation 做谱系登记与数组合并） */
  onBirth(child: Creature, parent: Creature): void;
  /** 诊断计数器（攻击/捕杀/进食/残骸进食次数） */
  counters: { attacks: number; kills: number; feeds: number; carrionFeeds: number; chases: number; reproCalls?: number };
  /** 捕杀现场召唤：附近的食腐者听到动静赶来（局部感知） */
  onKillCue(x: number, y: number): void;
  /** 个体 ID 分配器（每个 Simulation 独立序列） */
  allocId(): number;
}

// 复用的临时缓冲（避免每 tick 分配）
const neighborScratch: number[] = [];
const sepScratch: number[] = [];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 效用评分决策：每 AI.decisionInterval tick 一次 */
export function decide(env: SimEnv, c: Creature): void {
  const p = speciesParams(c.species);
  const sense = c.pheno.senseRadius;
  // 追击承诺：已经开始且目标仍在一定范围内时，不因暂时看不见而放弃
  const engagedHunt =
    c.state === BS.Hunt && c.targetRef !== null && c.targetRef.alive &&
    dist2(c, c.targetRef) < (sense + 2.5) * (sense + 2.5);
  const engagedFollow =
    c.state === BS.Scavenge && c.targetKind === 5 && c.targetRef !== null && c.targetRef.alive &&
    dist2(c, c.targetRef) < (sense * 1.8 + 2) * (sense * 1.8 + 2);
  const hunger = clamp(1 - c.energy / c.maxEnergy, 0, 1);
  const bold = c.genes.boldness;
  const night = env.light < 0.3;

  // ---- 感知：局部邻居查询（威胁与猎物都从同一次查询中得到） ----
  let threatD = Infinity;
  let threatX = 0;
  let threatY = 0;
  env.spatial.querySorted(c.x, c.y, sense, env.positions, neighborScratch);
  if (p.preyable) {
    for (let k = 0; k < neighborScratch.length; k++) {
      const o = env.creatures[neighborScratch[k]];
      if (!o.alive || o.id === c.id || o.species !== Species.Predator) continue;
      const dx = o.x - c.x;
      const dy = o.y - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= sense * sense) continue;
      const d = Math.sqrt(d2);
      if (d < threatD) {
        threatD = d;
        threatX = o.x;
        threatY = o.y;
      }
    }
  }
  c.hasThreat = threatD < Infinity;
  if (c.hasThreat) {
    c.threatX = threatX;
    c.threatY = threatY;
  }

  // ---- 感知：食物 / 残骸 / 猎物（局部格子扫描） ----
  let foodScore = 0;
  let foodTX = -1;
  let foodTY = -1;
  let foodDist = Infinity;
  let foodIsShrub = false;
  let preyScore = 0;
  let preyRef: Creature | null = null;

  const tx0 = Math.floor(c.x - sense);
  const tx1 = Math.floor(c.x + sense);
  const ty0 = Math.floor(c.y - sense);
  const ty1 = Math.floor(c.y + sense);
  const w = env.world;

  for (let ty = ty0; ty <= ty1; ty++) {
    if (ty < 0 || ty >= w.height) continue;
    for (let tx = tx0; tx <= tx1; tx++) {
      if (tx < 0 || tx >= w.width) continue;
      const dx = tx + 0.5 - c.x;
      const dy = ty + 0.5 - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > sense * sense) continue;
      if (c.blacklistTimer > 0 && tx === Math.floor(c.blacklistX) && ty === Math.floor(c.blacklistY)) continue;
      const i = w.idx(tx, ty);
      const dist = Math.sqrt(d2);
      let value = 0;
      let isShrub = false;
      if (p.diet === 3) {
        value = w.carcass[i] * PLANTS.carcass.energy;
      } else if (p.diet === 2 && hunger > 0.4 && dist < 4) {
        // 捕食者的应急食腐：只在很近的距离才顺路吃残骸，不会被远处气味引走而放弃追猎
        value = w.carcass[i] * PLANTS.carcass.energy * 0.8;
      } else if (p.diet === 0) {
        value = w.grass[i] * PLANTS.grass.energy;
      } else if (p.diet === 1) {
        // 大型食草者：浆果能量高，优先；青草为备用
        const sv = w.shrub[i] * PLANTS.shrub.energy;
        const gv = w.grass[i] * PLANTS.grass.energy;
        if (sv >= gv) {
          value = sv;
          isShrub = true;
        } else {
          value = gv;
        }
      }
      if (value <= 0.05) continue;
      const score = hunger * (value / (value + 10)) * (1 / (1 + dist * 0.55));
      if (score > foodScore) {
        foodScore = score;
        foodTX = tx;
        foodTY = ty;
        foodDist = dist;
        foodIsShrub = isShrub;
      }
    }
  }

  // 捕食者感知猎物
  let preyDist = Infinity;
  if (p.diet === 2) {
    for (let k = 0; k < neighborScratch.length; k++) {
      const o = env.creatures[neighborScratch[k]];
      if (!o.alive || o.id === c.id) continue;
      if (PREY_SPECIES.indexOf(o.species) < 0) continue;
      // 小型食草者始终是可捕食对象；大型食草者只有幼年（体型不大）才可捕
      const maxPreySize = o.species === Species.LargeHerb ? c.currentSize * 0.8 : c.currentSize * 1.1;
      if (o.currentSize > maxPreySize) continue;
      const dx = o.x - c.x;
      const dy = o.y - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= sense * sense) continue;
      const d = Math.sqrt(d2);
      if (d < preyDist) preyDist = d;
      const vitality = 0.45 + 0.55 * (o.energy / o.maxEnergy);
      const score = (1 / (1 + d * 0.6)) * vitality * (night ? AI.nightHuntBoost : 1);
      if (score > preyScore) {
        preyScore = score;
        preyRef = o;
      }
    }
  }
  // 最近食物距离（植物格 / 残骸 / 猎物），用于休眠判断
  const nearestFoodDist = Math.min(foodDist, preyDist);

  // ---- 捕食者啃食自己的猎物：站在残骸上且未吃饱时优先进食 ----
  let feastScore = 0;
  if (p.diet === 2 && c.energy < 0.92 * c.maxEnergy) {
    const ownTX = Math.floor(c.x);
    const ownTY = Math.floor(c.y);
    if (w.inBounds(ownTX, ownTY)) {
      const ownCarrion = w.carcass[w.idx(ownTX, ownTY)];
      if (ownCarrion > 2) feastScore = 0.5 + hunger * 0.3;
    }
  }

  // ---- 食腐者策略：附近没有残骸时，跟随捕食者或食草动物群（死亡最可能发生的地方） ----
  let followRef: Creature | null = null;
  if (p.diet === 3 && foodScore < 0.05) {
    const followR = sense * 1.8;
    env.spatial.querySorted(c.x, c.y, followR, env.positions, neighborScratch);
    let fd = Infinity;
    for (let k = 0; k < neighborScratch.length; k++) {
      const o = env.creatures[neighborScratch[k]];
      if (!o.alive || o.id === c.id) continue;
      // 优先跟随捕食者（猎物确定性高），其次跟随食草动物群
      const isPredator = o.species === Species.Predator;
      const isHerb = o.species === Species.SmallHerb || o.species === Species.LargeHerb;
      if (!isPredator && !isHerb) continue;
      const d = Math.hypot(o.x - c.x, o.y - c.y);
      const weighted = isPredator ? d : d * 1.6; // 食草者权重低一些
      if (weighted < fd) {
        fd = weighted;
        followRef = o;
      }
    }
  }

  // ---- 效用评分 ----
  const fleeU = c.hasThreat
    ? (1 - clamp(threatD / sense, 0, 1)) * (1.35 - 0.95 * bold) * (threatD < 1.6 ? 1.6 : 1)
    : 0;
  const eatU = foodScore;
  let huntU = p.diet === 2 ? preyScore * (0.55 + 0.45 * hunger) * AI.huntHungerBoost : 0;
  if (engagedHunt) huntU = Math.max(huntU, 0.35); // 追击中：保持承诺
  const scavU = p.diet === 3 ? foodScore : 0;
  const canRepro = c.canReproduce() && env.creatures.length < LIMITS.maxCreatures;
  const reproU = canRepro
    ? clamp((c.energy / c.maxEnergy - p.reproThreshold) * 6, 0, 1.5) *
      (c.hasThreat && threatD < 3 ? 0.12 : 1)
    : 0;
  // 只有在能量危急或夜间才休息；否则饥饿个体会主动游走搜索（否则会原地饿死）
  const restU =
    !c.hasThreat &&
    !engagedHunt &&
    !engagedFollow &&
    foodScore < 0.02 &&
    preyScore < 0.02 &&
    (c.energy < 0.22 * c.maxEnergy || (night && p.nocturnal < 1.1 && c.energy < 0.4 * c.maxEnergy))
      ? 0.5 + (night ? AI.nightRestBoost - 1 : 0)
      : 0;
  const wanderU = 0.04;

  // ---- 休眠：捕食者与食腐者长期找不到食物时进入深度节能（真实猛禽/食腐鸟类可长时间禁食） ----
  const torporThreshold = p.diet === 2 ? 1000 : 200;
  if (
    (p.diet === 2 || p.diet === 3) &&
    c.starveTicks > torporThreshold &&
    c.energy < (p.diet === 2 ? 0.75 : 0.45) * c.maxEnergy &&
    nearestFoodDist > 4
  ) {
    if (!c.torpor) {
      c.torpor = true;
      c.reason = p.diet === 2 ? '长期没有捕获猎物，进入休眠保存实力' : '长期没有找到残骸，进入休眠节省能量';
    }
  } else if (c.torpor && ((p.diet === 2 ? nearestFoodDist < 3 : nearestFoodDist < 5) || c.energy > 0.9 * c.maxEnergy)) {
    c.torpor = false;
  }

  // ---- 选择 ----
  let best = wanderU;
  let bestName = 'wander';
  if (restU > best) { best = restU; bestName = 'rest'; }
  if (reproU > best) { best = reproU; bestName = 'repro'; }
  if (feastScore > best) { best = feastScore; bestName = 'feast'; }
  if (p.diet === 2 && huntU > best) { best = huntU; bestName = 'hunt'; }
  if (eatU > best) { best = eatU; bestName = 'eat'; }
  if (p.diet === 3 && scavU > best) { best = scavU; bestName = 'scav'; }
  if ((followRef || engagedFollow) && foodScore < 0.02) {
    const followU = 0.12 + 0.1 * hunger + (engagedFollow ? 0.25 : 0);
    if (followU > best) { best = followU; bestName = 'follow'; }
  }
  if (fleeU > best) { best = fleeU; bestName = 'flee'; }

  switch (bestName) {
    case 'flee': {
      c.state = BS.Flee;
      c.targetKind = 4;
      // 逃逸点：远离威胁的方向
      let ex = c.x - (threatX - c.x);
      let ey = c.y - (threatY - c.y);
      const len = Math.hypot(ex - c.x, ey - c.y) || 1;
      c.targetX = clamp(c.x + ((ex - c.x) / len) * sense, 0.3, w.width - 0.3);
      c.targetY = clamp(c.y + ((ey - c.y) / len) * sense, 0.3, w.height - 0.3);
      c.targetRef = null;
      c.reason = `发现捕食者（${threatD.toFixed(1)} 格外），正在逃离`;
      break;
    }
    case 'hunt': {
      c.state = BS.Hunt;
      c.targetKind = 2;
      env.counters.chases++;
      c.targetRef = preyRef;
      if (preyRef) {
        c.targetId = preyRef.id;
        c.targetX = preyRef.x;
        c.targetY = preyRef.y;
      }
      c.reason = `锁定猎物（小型食草者，距离 ${Math.hypot(c.targetX - c.x, c.targetY - c.y).toFixed(1)} 格），追猎中`;
      break;
    }
    case 'eat':
    case 'scav': {
      if (p.diet === 3) {
        c.state = BS.Scavenge;
        c.reason = '发现残骸，前往进食';
      } else {
        c.state = BS.Forage;
        c.reason = foodIsShrub ? '发现浆果灌丛，前往进食' : '发现青草，前往进食';
      }
      c.targetKind = p.diet === 3 ? 3 : 1;
      c.targetX = foodTX + 0.5;
      c.targetY = foodTY + 0.5;
      c.targetRef = null;
      break;
    }
    case 'repro': {
      // 立即繁殖（单亲无性）
      reproduce(env, c);
      break;
    }
    case 'feast': {
      c.state = BS.Scavenge;
      c.targetKind = 1;
      c.targetX = Math.floor(c.x) + 0.5;
      c.targetY = Math.floor(c.y) + 0.5;
      c.targetRef = null;
      c.reason = '啃食猎物的残骸';
      break;
    }
    case 'follow': {
      c.state = BS.Scavenge;
      c.targetKind = 5; // 跟随点
      const target = followRef ?? c.targetRef;
      c.targetRef = target;
      c.targetId = target ? target.id : -1;
      if (target) {
        c.targetX = target.x;
        c.targetY = target.y;
      }
      c.reason = '跟随捕食者，等待觅食残骸';
      break;
    }
    case 'rest': {
      c.state = BS.Rest;
      c.targetKind = 0;
      c.targetRef = null;
      c.reason = night ? '夜间休息，节省能量' : '能量偏低且附近无食物，休息保存体力';
      break;
    }
    default: {
      c.state = BS.Wander;
      c.targetKind = 0;
      c.targetRef = null;
      const patrolling = p.diet === 2 || p.diet === 3;
      c.wanderAngle += env.rng.gauss(patrolling ? AI.patrolTurn : AI.wanderTurn);
      c.reason = patrolling ? '巡逻中，搜寻猎物与残骸' : '闲逛中，寻找食物与同伴';
    }
  }
}

/** 繁殖：单亲无性，亲代实际承担能量成本 */
export function reproduce(env: SimEnv, c: Creature): void {
  env.counters.reproCalls = (env.counters.reproCalls ?? 0) + 1;
  const p = speciesParams(c.species);
  const invest = c.investRatio();
  const childEnergy = c.energy * invest;
  const parentCost = childEnergy * 1.5;
  c.energy -= parentCost;
  c.reproCooldown = p.reproCooldown * (0.7 + 0.6 * invest);
  c.state = BS.Reproduce;
  c.targetKind = 0;
  c.targetRef = null;
  c.reason = `繁殖：投入 ${(invest * 100).toFixed(0)}% 能量给后代`;

  // 找附近可通行位置
  let sx = c.x;
  let sy = c.y;
  for (let tries = 0; tries < 8; tries++) {
    const a = env.rng.range(0, Math.PI * 2);
    const r = env.rng.range(0.6, 1.6);
    const nx = clamp(c.x + Math.cos(a) * r, 0.3, env.world.width - 0.3);
    const ny = clamp(c.y + Math.sin(a) * r, 0.3, env.world.height - 0.3);
    if (env.world.passableAt(nx, ny)) {
      sx = nx;
      sy = ny;
      break;
    }
  }
  const child = new Creature(c.species, inheritGenes(c.genes, env.rng), sx, sy, Math.max(4, childEnergy), c.lineageId, env.allocId());
  child.parentId = c.id;
  child.generation = c.generation + 1;
  child.birthTick = env.tick;
  child.wanderAngle = env.rng.range(0, Math.PI * 2);
  c.kids++;
  c.energy = Math.max(c.energy, 1);
  env.onBirth(child, c);
  env.onEvent('birth', `#${c.id} 繁殖了后代 #${child.id}（第 ${child.generation} 代）`, sx, sy);
}

/** 每 tick 执行：转向、移动、进食、捕食、能量结算、死亡判定 */
export function updateCreature(env: SimEnv, c: Creature): void {
  if (!c.alive) return;
  const p = speciesParams(c.species);
  const w = env.world;

  // 计时器
  c.reproCooldown = Math.max(0, c.reproCooldown - 1);
  c.eatCooldown = Math.max(0, c.eatCooldown - 1);
  c.attackCooldown = Math.max(0, c.attackCooldown - 1);
  c.blacklistTimer = Math.max(0, c.blacklistTimer - 1);
  c.decisionTimer -= 1;
  if (c.decisionTimer <= 0) {
    decide(env, c);
    c.decisionTimer = AI.decisionInterval;
  }

  // 目标有效性：猎物死亡或确实追丢
  if (c.targetRef) {
    const limit = c.state === BS.Hunt ? c.pheno.senseRadius + 2.5 : c.targetKind === 5 ? c.pheno.senseRadius * 1.8 + 2 : c.pheno.senseRadius + 2;
    if (!c.targetRef.alive || dist2(c, c.targetRef) > limit * limit) {
      const wasHunting = c.state === BS.Hunt;
      c.targetRef = null;
      c.targetId = -1;
      if (wasHunting || c.targetKind === 5) {
        c.state = BS.Wander;
        c.targetKind = 0;
        c.reason = '目标丢失，重新搜索';
      }
    }
  }

  // ---- 期望速度 ----
  const tired = c.energy < AI.tiredBelow * c.maxEnergy;
  let factor: number = AI.wanderSpeedFactor;
  let fleeing = false;
  switch (c.state) {
    case BS.Flee:
      factor = 1;
      fleeing = true;
      break;
    case BS.Forage:
    case BS.Scavenge:
      factor = AI.forageSpeedFactor;
      break;
    case BS.Hunt:
      factor = 1.3; // 追猎冲刺：必须明显快过逃跑的猎物，否则慢基因捕食者永远无法进食
      break;
    case BS.Rest:
    case BS.Reproduce:
      factor = 0;
      break;
    default:
      factor = p.diet === 2 || p.diet === 3 ? AI.patrolSpeedFactor : AI.wanderSpeedFactor;
  }
  if (fleeing) factor *= AI.fleeSpeedBoost;
  // 疲劳减速不适用于追猎与逃逸（肾上腺素），否则饿着的捕食者永远追不上猎物形成死亡螺旋
  const adrenaline = c.state === BS.Hunt || c.state === BS.Flee;
  if (tired && !adrenaline) factor *= AI.tiredFactor;
  const vmax = c.pheno.maxSpeed * factor;

  // ---- 期望方向 ----
  let dx = 0;
  let dy = 0;
  if (c.state === BS.Flee) {
    dx = c.x - c.threatX;
    dy = c.y - c.threatY;
    // Zigzag 机动：在逃跑主方向上叠加垂直摆动，更难被直线追击
    c.wanderAngle += 0.16;
    const away = Math.hypot(dx, dy) || 1;
    const jink = Math.sin(c.wanderAngle) * 0.55;
    const nx = dx / away;
    const ny = dy / away;
    dx = nx - ny * jink;
    dy = ny + nx * jink;
  } else if (c.state === BS.Forage || c.state === BS.Scavenge) {
    dx = c.targetX - c.x;
    dy = c.targetY - c.y;
  } else if (c.state === BS.Hunt && c.targetRef) {
    dx = c.targetRef.x - c.x;
    dy = c.targetRef.y - c.y;
  } else if (c.state === BS.Scavenge && c.targetKind === 5 && c.targetRef) {
    dx = c.targetRef.x - c.x;
    dy = c.targetRef.y - c.y;
  } else if (c.state === BS.Wander) {
    dx = Math.cos(c.wanderAngle);
    dy = Math.sin(c.wanderAngle);
  }
  const dlen = Math.hypot(dx, dy);
  if (dlen > 1e-6) {
    dx /= dlen;
    dy /= dlen;
  } else {
    dx = 0;
    dy = 0;
  }

  // ---- 分离力（避免重叠抖动） ----
  if (vmax > 0) {
    env.spatial.query(c.x, c.y, c.currentSize * 2.2, sepScratch);
    let sx = 0;
    let sy = 0;
    for (let k = 0; k < sepScratch.length; k++) {
      const o = env.creatures[sepScratch[k]];
      if (!o.alive || o.id === c.id) continue;
      const ox = c.x - o.x;
      const oy = c.y - o.y;
      const d2 = ox * ox + oy * oy;
      const minD = c.currentSize + o.currentSize;
      if (d2 > 1e-9 && d2 < minD * minD) {
        const d = Math.sqrt(d2);
        sx += (ox / d) * (1 - d / minD);
        sy += (oy / d) * (1 - d / minD);
      }
    }
    dx += sx * AI.separation * 8;
    dy += sy * AI.separation * 8;
  }

  // ---- 转向平滑 + 速度上限 ----
  const desVx = dx * vmax;
  const desVy = dy * vmax;
  let nvx = c.vx + (desVx - c.vx) * AI.turnSmooth;
  let nvy = c.vy + (desVy - c.vy) * AI.turnSmooth;
  const sp = Math.hypot(nvx, nvy);
  const maxStep = vmax * AI.maxTurnFactor + vmax * 0.45;
  if (sp > maxStep && sp > 1e-9) {
    nvx = (nvx / sp) * maxStep;
    nvy = (nvy / sp) * maxStep;
  }
  c.vx = nvx;
  c.vy = nvy;

  // ---- 移动（含边界与地形滑行） ----
  const moving = Math.hypot(c.vx, c.vy) > 1e-5;
  if (moving) {
    const nx = clamp(c.x + c.vx, 0.25, w.width - 0.25);
    const ny = clamp(c.y + c.vy, 0.25, w.height - 0.25);
    if (w.passableAt(nx, ny)) {
      c.x = nx;
      c.y = ny;
    } else {
      // 分轴滑动（贴墙而行，不抖动）
      if (w.passableAt(nx, c.y)) c.x = nx;
      if (w.passableAt(c.x, ny)) c.y = ny;
    }
    const target = Math.atan2(c.vy, c.vx);
    let diff = target - c.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    c.heading += diff * 0.35;
  } else if (c.state !== BS.Rest && c.state !== BS.Reproduce) {
    // 被完全阻挡时缓慢转向
    c.wanderAngle += env.rng.gauss(0.3);
  }

  // 站在了不可通行格（玩家改地形）→ 救援到最近可通行格
  if (!w.passableAt(c.x, c.y)) {
    const near = w.findPassableNear(Math.floor(c.x), Math.floor(c.y), 5);
    if (near) {
      c.x = near.tx + 0.5;
      c.y = near.ty + 0.5;
      c.vx = 0;
      c.vy = 0;
      c.reason = '环境变化，移动到附近可通行区域';
    }
  }

  // ---- 卡住检测 ----
  if (c.state === BS.Forage || c.state === BS.Scavenge || c.state === BS.Hunt) {
    const progress = Math.hypot(c.x - c.lastX, c.y - c.lastY);
    if (progress < AI.stuckProgress) {
      c.blockedTimer += 1;
    } else {
      c.blockedTimer = 0;
    }
    if (c.blockedTimer > AI.stuckTicks) {
      c.blockedTimer = 0;
      c.blacklistX = c.targetX;
      c.blacklistY = c.targetY;
      c.blacklistTimer = AI.blacklistTicks;
      c.state = BS.Wander;
      c.targetKind = 0;
      c.targetRef = null;
      c.decisionTimer = 0;
      c.reason = '目标难以到达，暂时放弃并另寻他处';
    }
  }
  c.lastX = c.x;
  c.lastY = c.y;

  // ---- 行为执行：进食 / 捕食 ----
  if (c.state === BS.Forage || c.state === BS.Scavenge) tryEat(env, c);
  if (c.state === BS.Hunt) tryAttack(env, c);

  // ---- 能量结算 ----
  const speedRatio = moving ? Math.hypot(c.vx, c.vy) / ENERGY.refSpeed : 0;
  c.energy -= c.upkeepCost(env.drought) + (moving ? c.moveCost(speedRatio, fleeing) : 0);

  // ---- 禁食计时 ----
  if (c.lastMealTick >= 0) c.starveTicks = env.tick - c.lastMealTick;
  else c.starveTicks = env.tick - c.birthTick;
  if (c.torpor && c.state !== BS.Rest && c.state !== BS.Scavenge) {
    c.state = BS.Rest;
    c.targetKind = 0;
    c.targetRef = null;
    c.reason = '休眠中，等待食物出现';
  }

  // ---- 年龄与成熟 ----
  c.age += 1;
  if (!c.mature && c.age >= p.maturity) {
    c.mature = true;
    c.reason = '已成年，可以繁殖';
  }

  // ---- 死亡判定 ----
  if (c.energy <= 0) {
    c.energy = 0;
    c.alive = false;
    c.deathCause = env.drought > 0.35 && c.genes.droughtTol < 0.5 ? DeathCause.Dehydrate : DeathCause.Starve;
  } else if (c.age >= p.maxAge) {
    c.alive = false;
    c.deathCause = DeathCause.Age;
  }
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** 进食：植物或残骸。食物被真实消耗，能量按咬合量×密度×效率结算。 */
function tryEat(env: SimEnv, c: Creature): void {
  if (c.eatCooldown > 0) return;
  const w = env.world;
  const p = speciesParams(c.species);
  const tx = Math.floor(c.targetX);
  const ty = Math.floor(c.targetY);
  if (!w.inBounds(tx, ty)) return;
  const cx = tx + 0.5;
  const cy = ty + 0.5;
  const reach = c.currentSize + speciesParams(c.species).eatRadius;
  if (Math.hypot(c.x - cx, c.y - cy) > reach) return; // 尚未到达
  const i = w.idx(tx, ty);

  if (c.species === Species.Scavenger || (c.species === Species.Predator && p.diet === 2)) {
    // 优先进食所在格的残骸（跟随捕食者/应急食腐途中即可进食）
    const ownTX = Math.floor(c.x);
    const ownTY = Math.floor(c.y);
    let ti = i;
    if (!(tx === ownTX && ty === ownTY) && w.inBounds(ownTX, ownTY)) {
      const ownI = w.idx(ownTX, ownTY);
      if (w.carcass[ownI] > 0.05) ti = ownI;
    }
    const avail = w.carcass[ti];
    if (avail <= 0.05) {
      if (c.targetKind !== 5) {
        c.state = BS.Wander;
        c.decisionTimer = 0;
        if (c.species === Species.Predator) c.reason = '残骸已被消耗，继续追猎';
      }
      return;
    }
    const space = c.maxEnergy - c.energy;
    if (space <= 0.01) return;
    const eff = c.species === Species.Predator ? ENERGY.carrionEfficiency * 0.7 : ENERGY.carrionEfficiency;
    const bite = Math.min(PLANTS.carcass.bite, avail, space / (PLANTS.carcass.energy * eff));
    if (bite <= 0.01) return;
    env.counters.carrionFeeds++;
    const gain = bite * PLANTS.carcass.energy * eff;
    c.energy = Math.min(c.maxEnergy, c.energy + gain);
    w.carcass[ti] = avail - bite;
    c.eatCooldown = AI.eatCooldown;
    c.lastMealTick = env.tick;
    c.starveTicks = 0;
    if (c.torpor) {
      c.torpor = false;
      c.reason = '找到食物，结束休眠';
    }
    c.state = BS.Eat;
    c.reason = `进食残骸（+${gain.toFixed(1)} 能量）`;
    return;
  }

  const useShrub = p.diet === 1 && w.shrub[i] * PLANTS.shrub.energy >= w.grass[i] * PLANTS.grass.energy;
  const biomass = useShrub ? w.shrub[i] : w.grass[i];
  const density = useShrub ? PLANTS.shrub.energy : PLANTS.grass.energy;
  const biteMax = useShrub ? PLANTS.shrub.bite : PLANTS.grass.bite;
  if (biomass <= 0.05) {
    // 食物没了（可能被其他个体吃光）→ 重新决策
    c.state = BS.Wander;
    c.targetKind = 0;
    c.decisionTimer = 0;
    c.reason = '食物已被消耗，重新寻找';
    return;
  }
  const space = c.maxEnergy - c.energy;
  if (space <= 0.01) return;
  const bite = Math.min(biteMax, biomass, space / (density * c.digestEfficiency()));
  if (bite <= 0.01) return;
  env.counters.feeds++;
  const gain = bite * density * c.digestEfficiency();
  c.energy = Math.min(c.maxEnergy, c.energy + gain);
  if (useShrub) w.shrub[i] = biomass - bite;
  else w.grass[i] = biomass - bite;
  c.eatCooldown = AI.eatCooldown;
  c.lastMealTick = env.tick;
  c.starveTicks = 0;
  if (c.torpor) c.torpor = false;
  c.state = BS.Eat;
  c.reason = `进食${useShrub ? '浆果' : '青草'}（+${gain.toFixed(1)} 能量）`;
}

/** 捕食：成功率取决于速度差；成功转移部分能量并留下残骸。 */
function tryAttack(env: SimEnv, c: Creature): void {
  if (c.attackCooldown > 0) return;
  const prey = c.targetRef;
  const p = speciesParams(c.species);
  if (!prey || !prey.alive) {
    c.state = BS.Wander;
    c.targetRef = null;
    c.decisionTimer = 0;
    return;
  }
  const d = Math.hypot(prey.x - c.x, prey.y - c.y);
  const reach = c.currentSize + prey.currentSize + p.catchRadius;
  if (d > reach) return; // 还没追上
  c.attackCooldown = p.attackCooldown;
  env.counters.attacks++;
  const speedDiff = c.pheno.maxSpeed - prey.pheno.maxSpeed;
  let prob = p.catchBase + p.catchSlope * speedDiff;
  if (prey.currentSize < c.currentSize * 0.72) prob += 0.14; // 远小于自己的猎物更容易捕获
  if (prey.energy < prey.maxEnergy * 0.4) prob += 0.14; // 虚弱猎物更容易捕获
  prob = clamp(prob, 0.05, 0.95);
  if (env.rng.chance(prob)) {
    // 捕食成功：猎物死亡，能量部分转移，其余成残骸
    env.counters.kills++;
    prey.alive = false;
    prey.deathCause = DeathCause.Predated;
    prey.reason = `被 #${c.id} 捕食`;
    const gain = Math.min(c.maxEnergy - c.energy, prey.energy * ENERGY.predationTransfer);
    c.energy += gain;
    const i = env.world.idx(Math.floor(prey.x), Math.floor(prey.y));
    const carrion =
      ENERGY.carcassFromBiomass * (ENERGY.carcassBase + ENERGY.carcassSizeFactor * prey.currentSize) +
      ENERGY.carcassFromEnergy * prey.energy * 0.5;
    env.world.carcass[i] = Math.min(PLANTS.carcass.max, env.world.carcass[i] + carrion);
    c.state = BS.Eat;
    c.eatCooldown = p.attackCooldown;
    c.lastMealTick = env.tick;
    c.reason = `捕食成功（获得 ${gain.toFixed(1)} 能量，剩余成残骸）`;
    env.onKillCue(prey.x, prey.y);
    env.onEvent('predation', `捕食者 #${c.id} 捕获了 ${speciesLabel(prey.species)} #${prey.id}`, prey.x, prey.y);
  } else {
    // 失手：猎物受伤逃跑，捕食者浪费体力
    prey.energy = Math.max(1, prey.energy - 4);
    c.energy = Math.max(1, c.energy - 2);
    prey.state = BS.Flee;
    prey.hasThreat = true;
    prey.threatX = c.x;
    prey.threatY = c.y;
    prey.decisionTimer = 0;
    prey.reason = '遭到捕食者攻击，受伤逃离';
    env.onEvent('attack', `捕食者 #${c.id} 失手，${speciesLabel(prey.species)} #${prey.id} 逃脱`, prey.x, prey.y);
  }
}

function speciesLabel(s: number): string {
  return s === Species.SmallHerb ? '小型食草者' : s === Species.LargeHerb ? '大型食草者' : s === Species.Predator ? '捕食者' : '食腐者';
}

export { clamp };
