# DESIGN — 《微境：人工生命生态箱》设计文档

> 版本：v1 · 更新：2026-11-06
> 本文所有参数数值均与 `src/sim/config.ts`、`src/shared/protocol.ts`、`src/sim/constants.ts` 逐项核对；
> 公式与行为与 `src/sim/{systems,ai,simulation,challenges,serialize}.ts`、`src/worker/*`、`src/game/renderer/*` 的实现一致。
> 凡界面（React）尚未落地或细节可能随实现演进的，文中标注"以 `src/sim/config.ts` 为准"。
>
> **实现状态（2026-11-06）**：模拟核心（`rng / config / types / constants / world / spatial / creature / systems / ai / simulation / challenges / serialize`）、
> Worker（`sim.worker.ts` + `storage.ts`）、渲染器（`camera / sprites / effects`）、程序化音频（`audio.ts`）已落地；
> React UI（`src/ui`）与 `scripts/batch-sim.ts`、`scripts/bench.ts` 在实现中（见 `PROGRESS.md`）。

---

## 1. 游戏概述与完整游玩流程

《微境：人工生命生态箱》是一款**单机 2D 人工生命生态模拟游戏**。玩家创建一个 128×80 tile 的小世界，
观察四类生物在其中觅食、逃逸、追猎、寻骸、休息、繁殖、死亡，并通过六项可遗传基因观察后代性状分布的变化；
玩家可以改变地形、播种、降雨或制造干旱、投放生物来干预生态，用有限的干预配额完成三关挑战，
并把有价值的个体收藏为"生命蓝图"重新投放。

**核心体验承诺**：没有适应度分数，没有隐藏保底——阳光是唯一的外部能量输入，一切代谢都是损失，
种群上限由植物产量决定，灭绝是可能发生的结果。

### 完整游玩流程（闭环）

1. **启动教学**：首次进入显示引导（界面分区、工具、单位、快捷键）；`prefs.guideDone` 记录完成状态，可随时从"帮助"重看。
2. **创建 / 继续**：主菜单选择"新建世界"（三选一预设：温带河谷 / 湿润草甸 / 干旱谷地，可自定义种子）或"继续"
   （读取自动存档 / 3 个手动槽 / 导入 JSON）。
3. **观察干预**：运行世界；暂停 / 单步 / 1× 2× 5× 10× 倍速；缩放与拖动平移；点击个体查看个体面板（含**行为原因**文本）；
   使用工具栏干预；切换叠加层（植被 / 水分 / 养分 / 活动 / 种群 / 残骸）；查看种群曲线、死因统计、性状分布与事件日志。
4. **个体谱系**：查看个体档案（ID / 父代 / 谱系 / 代次 / 生死时刻与死因 / 六项基因）、三代追溯、所在谱系统计；
   收藏为蓝图（命名）并重新投放（人工干预标记）。
5. **挑战**：进入三关之一；先看简报（briefing）再开始；挑战中每次干预消耗配额，界面实时显示目标进度、剩余干预与剩余时间。
6. **结算重试**：成功 / 失败后自动暂停并弹结算（各目标达成、关键统计、失败原因），可**重试**（同种子同配置重置）或**退出**。
7. **存档续玩**：沙盒每 3000 tick（60 tps 下约 50 秒）自动存档，可手动存 3 槽；随时回主菜单，下次"继续"读档恢复世界。

---

## 2. 技术架构

| 层 | 选型 | 约束 |
| --- | --- | --- |
| 语言 | TypeScript 严格模式（`strict` / `noUnusedLocals` / `noUnusedParameters` / `noFallthroughCasesInSwitch` / `noImplicitOverride` / `verbatimModuleSyntax` / `isolatedModules`） | 纯函数与数据优先 |
| 构建 | Vite 8.3.6（`worker.format: 'es'`，`build.target: 'es2022'`，dev 127.0.0.1:5173，preview 127.0.0.1:4173） | Dedicated Worker 以 ES module 加载 |
| 渲染 | PixiJS 8.22.0（WebGL） | v8 异步 `app.init()`；新版 `Graphics` API |
| UI | React 19.3.1 | **仅 UI**，不持有模拟状态，不参与每帧渲染 |
| 模拟线程 | Dedicated Web Worker | 固定时间步循环（`LOOP_MS = 16`，≈60Hz），产出快照 |
| 存储 | IndexedDB（世界 / 蓝图）+ localStorage（仅偏好） | 结构化克隆友好结构 |
| 测试 | Vitest 5.1.0（`npm test` / `test:long` / `sim:batch` / `sim:bench`）+ Ego-Browser 浏览器验收 | 核心规则单测 + 10 种子长测 |

### 模块划分（当前实现）

| 目录 | 职责 | 文件 |
| --- | --- | --- |
| `src/sim` | **纯 TS 模拟核心**，无 DOM / PixiJS / React 依赖，可在 Node 直接运行 | `constants.ts`（枚举与中文名）、`rng.ts`（sfc32）、`config.ts`（全部参数）、`types.ts`（基因/表现型/档案/谱系/事件/统计）、`world.ts`（世界与地形生成）、`spatial.ts`（空间哈希）、`creature.ts`（个体与能量核算）、`systems.ts`（土壤/植物/残骸/统计）、`ai.ts`（效用评分/状态机/转向/进食/捕食/繁殖）、`simulation.ts`（编排器：气候/事件/档案/干预/快照/存档字段）、`challenges.ts`（三关判定）、`serialize.ts`（存档校验） |
| `src/shared` | 跨模块**唯一契约** | `protocol.ts`（快照/存档/Worker 消息/客户端状态/调色板） |
| `src/worker` | Dedicated Worker：固定循环、快照下发、干预执行、自动存档、持久化 | `sim.worker.ts`、`storage.ts`（IndexedDB） |
| `src/game` | 胶水层 + 渲染 + 音频 | `client.ts`（Worker 与外部状态、订阅接口）、`renderer/camera.ts`（变换/缩放/边界）、`renderer/sprites.ts`（程序化像素素材）、`renderer/effects.ts`（反馈特效）、`audio.ts`（程序化 Web Audio） |
| `src/ui` | React 19 组件（面板 / 弹窗 / 工具栏 / 谱系视图 / 统计图） | 实现中 |
| `scripts` | 批量模拟与基准（挑战定标、长测） | 计划中 `batch-sim.ts` / `bench.ts` |

### Worker 与 UI 的消息协议（`src/shared/protocol.ts`）

- **UI → Worker（`WorkerRequest`）**：`newWorld` / `startChallenge` / `retryChallenge` / `exitChallenge` / `confirmChallengeBrief` /
  `loadSave` / `setSpeed` / `pause` / `resume` / `stepOnce` / `intervene` / `select` / `visibility` /
  `requestExport` / `saveSlot` / `loadSlot` / `deleteSlot` / `listSaves` / `listBlueprints` / `saveBlueprint` / `deleteBlueprint` / `collectBlueprint`。
- **Worker → UI（`WorkerResponse`）**：`snapshot` / `saved` / `loaded` / `deleted` / `exportData` /
  `savesList` / `blueprintsList` / `blueprintSaved` / `blueprintCollected` / `error`。
- **主循环**（`sim.worker.ts`）：`setInterval(loop, 16)`；`effectiveRunning = userRunning && visible`
  （后台标签页自动暂停）；每轮 `doSteps(sim.speed)` 后 `pushSnapshot()`；`setSpeed` 截断到 **1..10** 的整数；
  挑战进入 `success` / `fail` 立即停止推进，等待玩家处理结算。
- **快照 `SimSnapshot`**：tick / running / speed / light / dayPhase / drought / rainfall / counts / totals /
  `creatures`（`CreatureRenderData`）/ `tiles`（`TileRenderData | null`）/ `terrain`（仅世界变更后首个快照携带）/
  stats / events / selected / challenge / world / interventionLeft / capacityWarning / simMsPerTick。
- **节流策略**：快照每帧到达，React 只以 **~4Hz**（`PANEL_INTERVAL = 250 ms`）消费面板数据；
  结构状态（phase / modal / saves / 挑战状态 / capacityWarning）变化立即 `notifyUi`。

### 结构化克隆限制的应对

MDN 明确：Worker 数据是**复制而非共享**；`Function` 与 DOM 节点抛 `DataCloneError`；**不保留原型链、类私有字段、`RegExp.lastIndex`**。据此：

1. 跨线程只传**协议接口定义的纯对象与 TypedArray**，不传类实例（`Creature` / `World` / `Simulation` 永不跨线程；
   运行时专用的猎物引用 `targetRef` 不序列化、不过线程）。
2. `CreatureRenderData` 全字段为 TypedArray（`x / y / heading / size / species / state / energy / id / artificial` + `count`）；
   `TileRenderData` 全部量化到 0..255 的 `Uint8Array`（草地 / 灌丛按各自上限归一，残骸按 90 归一）。
3. 快照的 TypedArray 经 `snapshotTransferables()` 以 **transferable** 转移所有权，避免逐帧深拷贝。
4. `SaveFile` 为纯 JSON（数字数组 + 纯对象），同时满足结构化克隆与 IndexedDB 约束。

---

## 3. 模拟核心设计

### 3.1 世界

- **尺寸**：128 × 80 tile（`WORLD.width / height`，共 10240 tile）。
- **地形**（`Terrain`，5 种）：水域 Water(0) / 岩石 Rock(1) / 湿润草地 Meadow(2) / 林地 Woodland(3) / 干旱地 Arid(4)；
  仅 Meadow / Woodland / Arid 可通行（`isPassableTerrain`），**水域与岩石构成边界与障碍**。
- **每 tile 状态**：`moisture` 水分、`nutrients` 养分、`grass` 青草、`shrub` 浆果灌丛、`carcass` 残骸（均 `Float32Array`）。
- **地形生成**（`World.generate`，确定性，仅依赖 seed 与 preset）：
  - 二维**值噪声**（周期网格 + 双线性 + smoothstep）多层叠加：高度（6×5 × 0.72 + 14×10 × 0.28）、
    湿度（7×5 × 0.7 + 16×11 × 0.3）、细节（26×18）。
  - 分层：高度 < `gen.waterLevel` → 水域；高度 > `gen.rockLevel`（或细节 > 0.86 且高度 > `rockLevel − 0.06`）→ 岩石；
    湿度 ≥ `woodlandMoisture` → 林地；≥ `meadowMoisture` → 湿润草地；否则干旱地。
  - **河道**：非 arid 预设叠加一条正弦河（振幅 6–11、相位、宽度 1.2–2.3 由种子决定）。
  - 初始资源：水域 moisture 1 / nutrients 0.15；岩石 moisture 0.05 / nutrients 0.05；
    可通行地形 moisture = `min(1, m×0.85 + 0.12 + d×0.08)`，nutrients = `(0.28 + d×0.3) ×（干旱 0.55 / 林地 1.1 / 其他 1）`；
    初始植物按地形播种（林地灌丛最多、干旱地最稀疏）。
- **预设**（`PRESETS`）：温带河谷 temperate（rainfall 0.1）、湿润草甸 meadow（0.15）、干旱谷地 arid（0.045，`randomDrought: true`）。

### 3.2 时间

| 项 | 值 | 说明 |
| --- | --- | --- |
| 固定步频率 | `WORLD.ticPerSecond = 60` | 1× = 每帧 1 步；倍速 = 每帧多步（`doSteps(speed)`，步长不变） |
| 倍速范围 | 1–10（Worker 截断） | UI 提供 1× / 2× / 5× / 10× |
| 昼夜周期 | `WORLD.dayLength = 2400` tick | 60 tps 下 40 秒一昼夜 |
| 光照曲线 | `computeLight(tick)` | `phase = (tick % 2400)/2400`；`s = sin((phase − 0.25)×2π)`；`v = s > 0 ? s^0.7 : 0`；`light = 0.06 + 0.94×v` |
| 夜间最低光照 | `WORLD.nightMinLight = 0.06` | AI 以 `light < 0.3` 判定"夜间" |
| 土壤更新 | 每 tile 每 `WORLD.soilStride = 8` tick 一次 | **错峰更新**（`i = tick % 8; i += 8`），速率按 stride 补偿 |
| AI 决策间隔 | `AI.decisionInterval = 5` tick | 效用评分节流 |
| 进食 / 攻击冷却 | `AI.eatCooldown = 8` / `attackCooldown = 24` tick | 咬合与捕食判定节流 |
| 统计采样 | `LIMITS.statsInterval = 30` tick | 环形缓冲 `statsBuffer = 3000` |
| 自动存档 | 每 3000 tick（约 50 秒） | `AUTOSAVE_INTERVAL` |

**干旱强度**：`startDrought(ticks)` 后强度按 `min(1, elapsed/240)` 上升（约 4 秒到满），
结束时强度以 0.02/tick 衰减；干旱期间降雨降为 `CLIMATE.droughtRainfall = 0.012`。

### 3.3 因果链（能量与物质流）

> **总原则：开放系统——阳光为外部输入，代谢为损失。**
> 能量从光照进入植物，沿食物链传递，每个环节都有固定损耗（基础代谢、移动、感知、繁殖成本、分解损失）；
> 养分在系统内循环（残骸分解、枯死植物返还），外部输入只有阳光与极慢的土壤风化。**不存在免费资源。**

**(1) 光照 / 水分 / 养分 → 植物生长**（`systems.ts updateSoil`，每 tile 每 8 tick）

令 `light = 全局光照 × LIGHT.byTerrain[t]`（林地 0.72 遮阴、干旱地 1.18）：

| 步骤 | 公式（参数见 `PLANTS` / `CLIMATE`） |
| --- | --- |
| 蒸发 | `evap = 0.012 × evaporationByTerrain[t] × (0.7 + light×0.6) × (干旱 ? 1.6 : 1)` |
| 水分 | `moisture += rainfall × 0.02 − evap × moisture`，截断 0..1 |
| 养分再生 | `nutrients += nutrientRegen(0.00012) × stride(8)`（土壤风化，极小外部输入） |
| 青草生长 | `gl = clamp((light − 0.12)/(0.55 − 0.12), 0, 1)`；`gm = clamp(moisture/0.5, 0, 1)`；`gn = clamp(nutrients/0.35, 0, 1)`；`growth = 0.5 × gl × gm × gn × (1 − grass/60)`；`nutrients −= growth × 0.0016`；`moisture −= growth × 0.0011` |
| 青草枯死 | `moisture < 0.07` 时 `loss = min(grass, 0.35)`；`nutrients += loss × 0.12`（枯死返还） |
| 灌丛生长 | `sl = clamp(1.15 − abs(light − 0.4)/0.42, 0, 1)`（喜林地遮阴）；`sm = clamp(moisture/0.45, 0, 1)`；`sn = clamp(nutrients/0.35, 0, 1)`；`growth = 0.16 × sl × sm × sn × (1 − shrub/40)`；`nutrients −= growth × 0.003`；`moisture −= growth × 0.0016` |
| 灌丛枯死 | `moisture < 0.06` 时 `loss = min(shrub, 0.12)`；`nutrients += loss × 0.12` |
| 残骸分解 | `dec = min(carcass, 0.05)`；`dry = min(carcass − dec, 0.01)`；`nutrients += (dec + dry×0.5) × 0.02` |

> 养分饱和参考值 0.35 为 `systems.ts` 中的实现常量（不在 `config.ts`），如需调整以该文件为准。

**(2) 进食 → 能量**（`ai.ts tryEat`）

- 需到达目标格（`reach = currentSize + eatRadius`）且 `eatCooldown = 0`。
- 植物：`bite = min(咬合上限, 生物量, 剩余能量空间 / (能量密度 × 消化效率))`；
  `gain = bite × 密度 × 消化效率`；消化效率 = `0.82 + 0.22 × droughtTol`（耐旱从干草榨取更多）。
  青草 bite 2.4 / 密度 0.42；浆果 bite 1.6 / 密度 0.85（大型食草者优先浆果）。
- 残骸（食腐者）：`bite = min(1.3, 存量, 空间/(0.55 × 0.6))`；`gain = bite × 0.55 × 0.6`。
- **食物被真实消耗**，无免费资源；吃完置 `Eat` 状态并更新 `lastMealTick`。

**(3) 耗能**（每 tick，`creature.ts upkeepCost / moveCost` + `ai.ts`）

| 项目 | 公式 |
| --- | --- |
| 基础代谢 | `basal × (currentSize/0.4)^1.5 × (1 + 0.12 × droughtTol)` |
| 感知维持 | `senseK × senseRadius` |
| 干旱脱水 | `0.05 × (1 − droughtTol) × 干旱强度` |
| 移动 | `moveK × (v/0.08)² × (currentSize/0.4)^1.5`，逃逸 × 1.35；**静止不耗移动能** |
| 低能量减速 | `energy < 0.22 × maxEnergy` 时速度 × 0.65 |

**(4) 繁殖**（`ai.ts reproduce`，单亲无性）

- 条件（`canReproduce`）：已成熟 + `reproCooldown ≤ 0` + `energy ≥ reproThreshold × maxEnergy`；效用达标才执行。
- `invest = investRatio()`（0.1–0.45）；`childEnergy = energy × invest`；
  **亲代成本 = childEnergy × 1.5**；`reproCooldown = 物种冷却 × (0.7 + 0.6 × invest)`（投入越高虚弱期越长）。
- 子代：`inheritGenes`（copy + 突变），出生在父代 0.6–1.6 tile 内随机可通行点，`energy = max(4, childEnergy)`，
  `generation + 1`、`parentId`、`birthTick` 登记，父代 `kids++`。
- 容量：`creatures + pendingBirths ≥ 1600` 时跳过出生并置 `capacityWarning`。

**(5) 捕食**（`ai.ts tryAttack`）

- 仅捕食者（diet 2）可捕食；猎物 = 小型食草者 + 大型食草者（`PREY_SPECIES`）。
- **目标筛选**：只能锁定 `prey.currentSize ≤ 捕食者 currentSize × 0.95` 的个体——**成年大型食草者因体型超出捕食者 95% 而无法被锁定**，
  捕食压力主要落在小型食草者与幼年大型食草者上（这是"大型食草者成年后难以捕捉"的实现机制）。
- 攻击距离 `reach = 捕食者体型 + 猎物体型 + catchRadius(0.34)`；每次攻击进入 `attackCooldown(24)`。
- **成功率**：`prob = clamp(catchBase(0.3) + catchSlope(3.2) × (捕食者 maxSpeed − 猎物 maxSpeed), 0.05, 0.95)`。
- **成功**：猎物死亡（`Predated`）；`gain = min(捕食者剩余空间, 猎物能量 × 0.6)`（`predationTransfer`）；
  同格生成残骸 `0.4 × (3 + 26 × 猎物体型) + 0.4 × 猎物能量 × 0.5`（上限 90）。
- **失手**：猎物 `energy −= 4` 并立即进入逃逸状态，捕食者白白消耗攻击冷却。

**(6) 死亡 → 残骸 → 养分**

- 非捕食死亡（饿死 / 衰老 / 脱水）在死亡格生成残骸：
  `carcassBiomass = 3 + 26 × currentSize + 剩余能量 × 0.12`（上限 90）。
- 残骸被食腐者取食（见 (2)）或按 `decompRate` 分解转养分（见 (1)）。

**如何避免重复结算**

| 风险 | 对策 |
| --- | --- |
| 同一个体一 tick 多次扣代谢 | 每 tick 每体只结算一次 `upkeepCost`；移动能耗按**实际速度比**结算，静止为 0 |
| 一次咬合多次回能 | `eatCooldown(8)` 与 `eatRadius` 限制；捕食另受 `attackCooldown(24)` 限制，一次攻击一次判定 |
| 植物每 tick 重复生长 | 只在所属 tile 的土壤更新 tick 结算（每 8 tick 一次，速率补偿后等价全图每 tick 更新） |
| 同一份能量既进捕食者又全额进残骸 | 捕食时一次性结算：60% 转移 + 残骸生物量（公式见 (5)），二者互不重叠 |
| 残骸重复分解 | 分解只在该 tile 的土壤更新 tick 发生 |
| 子代当 tick 就被更新 | 出生进入 `pendingBirths`，本 tick 个体更新结束后才合入数组，下一 tick 才开始行动 |

### 3.4 物种差异表

**生态位**

| 物种 | 食谱 | 进食半径 | 被捕食 | 夜行性 | 定位 |
| --- | --- | --- | --- | --- | --- |
| 小型食草者 | 只吃青草（diet 0） | 0.32 | 是 | 0.85（偏昼行） | 繁殖快、数量大，捕食者的主要口粮 |
| 大型食草者 | 青草 + 浆果（diet 1，优先浆果） | 0.42 | 是 | 0.80（偏昼行） | 能量上限高、成熟慢；成年后超出捕食者锁定体型上限 |
| 捕食者 | 只吃肉（diet 2） | 0.30（攻击距离另 +0.34） | 否 | 1.35（夜行） | 唯一捕食者，攻击冷却 24 tick |
| 食腐者 | 只吃残骸（diet 3） | 0.36 | 是 | 1.10（偏夜） | 清理残骸，把能量导回系统循环 |

**数值参数**（`SPECIES`，全部以 `src/sim/config.ts` 为准）

| 物种 | basal | moveK | senseK | maxEnergy | startEnergy | maturity | maxAge | speedRange | sizeRange | senseRange | reproThreshold | reproCooldown | boldCenter |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 小型食草者 | 0.05 | 0.052 | 0.0055 | 105 | 0.72 | 900 | 14000 | 0.055–0.105 | 0.2–0.32 | 2.2–5.2 | 0.60 | 1000 | 0.45 |
| 大型食草者 | 0.10 | 0.10 | 0.0045 | 230 | 0.72 | 1800 | 22000 | 0.032–0.062 | 0.42–0.62 | 2.0–4.6 | 0.62 | 2200 | 0.40 |
| 捕食者 | 0.075 | 0.075 | 0.006 | 175 | 0.75 | 1400 | 18000 | 0.062–0.118 | 0.3–0.5 | 3.2–6.4 | 0.65 | 1800 | 0.70 |
| 食腐者 | 0.045 | 0.05 | 0.005 | 120 | 0.72 | 1000 | 16000 | 0.035–0.07 | 0.26–0.42 | 2.6–5.8 | 0.60 | 1200 | 0.35 |

> `speedRange / sizeRange / senseRange` 为该物种的基因表现参考区间；基因→具名参数的统一映射由 `GENE_DEFS` + `mapGene` 完成（见 §3.6）。

### 3.5 AI：效用评分、状态机与转向行为

**决策结构**（`ai.ts decide`）：每 `decisionInterval(5)` tick 一次效用评分，取最高分进入状态机；
状态 = `BehaviorState`（闲逛 Wander / 觅食 Forage / 逃逸 Flee / 追猎 Hunt / 寻骸 Scavenge / 休息 Rest / 繁殖 Reproduce / 进食 Eat）；
`updateCreature` 每 tick 执行转向、移动、行为与能量结算。

**感知（局部性）**

- 一次 `spatial.querySorted(x, y, senseRadius, positions)` 同时得到威胁（捕食者）与猎物候选；
  食物 / 残骸用感知半径内的格子扫描（价值 = 生物量 × 能量密度）。
- 空间哈希 `SpatialHash`（`LIMITS.spatialCell = 8` tile ≥ 最大感知半径 6.4）每 tick 重建；
  查询结果按 **(距离, 个体索引) 升序**——确定性排序保证同种子同结果。
- 黑名单格（`blacklistTimer > 0`）在食物扫描中被跳过。

**效用评分**（实现即设计，参数全部来自 `config.ts`）

| 行为 | 公式 |
| --- | --- |
| 逃逸 Flee | `fleeU = (1 − clamp(威胁距离/sense, 0, 1)) × (1.35 − 0.95 × boldness) × (威胁距离 < 1.6 ? 1.6 : 1)`；无威胁为 0 |
| 觅食 eat | `eatU = 最佳食物格分数`，每格 `hunger × value/(value+10) × 1/(1+dist×0.55)`，`value = 生物量 × 能量密度`，`hunger = 1 − energy/maxEnergy` |
| 追猎 Hunt | `huntU = preyScore × (0.55 + 0.45 × hunger) × huntHungerBoost(1.1)`；`preyScore = 1/(1+d×0.6) × vitality × (夜间 ? nightHuntBoost 1.35 : 1)`，`vitality = 0.45 + 0.55 × 猎物能量比` |
| 寻骸 Scavenge | `scavU = eatU`（食腐者复用食物分数，价值取残骸） |
| 繁殖 Reproduce | `reproU = clamp((energy/maxEnergy − reproThreshold) × 6, 0, 1.5) × (3 格内有威胁 ? 0.12 : 1)` |
| 休息 Rest | `energy < 0.35×maxEnergy && 食物分数 < 0.02 && 无威胁` 时 `0.5 + (夜间 ? 0.6 : 0)`，否则 0 |
| 闲逛 Wander | 固定 `0.04`（兜底） |

选择顺序：`wander → rest → repro → hunt → eat → scav → flee`（后者分数严格更高才覆盖；逃逸上限约 2.16，实际构成强抢占）。

**速度档与转向**

| 状态 | 速度系数 |
| --- | --- |
| 逃逸 | 1.0 × `fleeSpeedBoost 1.18`（能耗 × 1.35） |
| 觅食 / 寻骸 | `forageSpeedFactor 0.72` |
| 追猎 | 0.95 |
| 休息 / 繁殖 | 0 |
| 闲逛 | `wanderSpeedFactor 0.42` |
| 低能量 | 上述再 × `tiredFactor 0.65` |

- **转向平滑**：`v += (目标速度 − v) × turnSmooth(0.3)`；单 tick 速度变化上限 `vmax × (maxTurnFactor 0.55 + 0.45)`。
- **分离力**：查询半径 `currentSize × 2.2`，按重叠程度施加 `separation(0.018) × 8` 的排斥，避免重叠抖动。
- **障碍滑行**：目标方向被不可通行地形阻挡时分轴滑动（先 X 后 Y）；站在不可通行格（玩家改地形）时
  `findPassableNear(…, 5)` 救援到最近可通行格。
- **卡住检测与目标黑名单**：仅觅食 / 寻骸 / 追猎状态计时；进度 < `stuckProgress(0.02)` 累计超过 `stuckTicks(40)` →
  目标进黑名单 `blacklistTicks(240)` tick，回闲逛并立即重新决策。
- 朝向 `heading` 以 0.35 系数平滑跟随速度方向。

**行为原因 `reason`（玩家可读懂，实现中的真实文案）**

默认"刚刚出生，正在观察环境"；随状态实时更新，例如：
"发现捕食者（2.3 格外），正在逃离"／"发现青草，前往进食"／"发现浆果灌丛，前往进食"／"进食青草（+8.4 能量）"／
"发现残骸，前往进食"／"锁定猎物（小型食草者，距离 3.1 格），追猎中"／"猎物丢失，重新搜索"／
"遭到捕食者攻击，受伤逃离"／"捕食成功（获得 42.0 能量，剩余成残骸）"／"繁殖：投入 30% 能量给后代"／
"夜间休息，节省能量"／"能量偏低且附近无食物，休息保存体力"／"目标难以到达，暂时放弃并另寻他处"／
"食物已被消耗，重新寻找"／"已成年，可以繁殖"／"环境变化，移动到附近可通行区域"。
个体面板直接展示该文本与当前状态名（`behaviorName`）。

### 3.6 遗传系统

**六项基因**（`Genes`，取值 0..1，**出生时确定、终身不变**）：

| 基因 | 名称 | 映射区间 `mapGene` | 收益 | 代价 |
| --- | --- | --- | --- | --- |
| `speed` | 运动速度 | 0.028–0.115 tile/tick | 移动更快：追击猎物、逃离天敌、更早到达食物 | 移动能耗按速度平方增长，追逐失败代价更高 |
| `size` | 成年体型 | 0.2–0.62 tile 半径 | 能量储备上限更高；体型大可捕食更大猎物；受惊时更难被锁定 | 基础代谢随体型上升（1.5 次方）；目标更大更容易被玩家与捕食者注意 |
| `sense` | 感知范围 | 1.6–6.4 tile | 更早发现食物、残骸与天敌，决策质量更高 | 每 tick 消耗感知维持能，范围越大持续开销越高 |
| `droughtTol` | 耐旱性 | 0–1 | 干旱时脱水消耗更慢；从干枯植物中榨取能量效率更高（+0.22） | 耐旱生理需要额外基础代谢投入（+12%，任何时期都付出） |
| `reproInvest` | 繁殖投入 | 0.1–0.45 | 后代获得更多起步能量，幼体存活率更高 | 亲代能量损失按 1.5 倍结算，繁殖后虚弱期更长 |
| `boldness` | 胆量 | 0–1 | 更偏向觅食与追猎，进食时间更长 | 对天敌反应更慢，被捕食概率上升 |

- **映射公式**：`mapGene(key, g) = def.min + (def.max − def.min) × clamp01(g)`。
- **表现型**（`computePhenotype`）：`maxSpeed = mapGene('speed')`、`adultSize = mapGene('size')`、
  `senseRadius = mapGene('sense')`、`maxEnergy = 物种 maxEnergy × (0.7 + 0.6 × genes.size)`。
- **年龄只影响表现型**：`currentSize = adultSize × (0.38 + 0.62 × min(1, age/maturity))`——幼体体型比例小，不修改基因。

**单亲无性繁殖**（游戏内说明：帮助、引导与个体面板均明示）：子代基因 = 亲代基因 copy 后施加突变，
无第二亲代、无 crossover——参考 The Nature of Code bloop 范例（见 `docs/REFERENCES.md`）。

**突变**（`inheritGenes`）：每项基因以 `MUTATION.prob 0.35` 概率突变；幅度为高斯噪声——
常规 `sigma 0.06`，以 `jumpProb 0.04` 概率触发大幅跳变 `jumpSigma 0.16`（±3σ 截断）；基因值裁剪到 0.02–0.98。
初代基因随机（`randomGenes`）：各基因在物种适宜区间均匀抽样，`boldness` 以物种 `boldCenter` 为中心 ± 0.18 高斯。

**档案与谱系**

- `CreatureRecord`：ID / species / `parentId`（−1 为初代）/ lineageId / generation / birthTick / deathTick / cause /
  genes / artificial / kids / 死亡坐标；上限 `LIMITS.maxRecords 24000`（淘汰时保留存活个体的祖先链）。
- `LineageInfo`：id / founderId / species / startTick / aliveCount / totalBirths / totalDeaths / maxGeneration /
  extinct / extinctTick / `artificial`（是否人工投放建立）；上限 `LIMITS.maxLineages 4000`（优先清理已灭绝的最古老谱系）。
- **三代追溯**：`SelectedDetail.ancestors` 提供父、祖、曾祖（存活个体或档案记录，可能缺失）的
  ID / 代次 / 物种 / 生死时刻 / 死因 / 基因。
- **统计**（`systems.ts sampleStats`，每 30 tick 采样）：四种群计数、植物总量、残骸、出生/死亡、四类死因分段计数，
  以及**每项基因的 p10 / p50 / p90 与均值**——以分布而非仅均值呈现。
  （实现统计**全部存活个体**；`protocol.ts` 中"只统计存活成年个体"的注释与实现不一致，以 `systems.ts` 为准，待统一。）
- **蓝图**（`Blueprint`）：收藏个体的基因快照（id / name / species / genes / capturedTick / sourceWorldSeed / note / createdAt），
  可命名、可重新投放（人工干预标记）。

### 3.7 死亡原因（`DeathCause`）

| 死因 | 触发（实现） |
| --- | --- |
| 饿死 Starve(0) | 能量 ≤ 0 且不满足脱水条件 |
| 衰老 Age(1) | age ≥ `maxAge` |
| 被捕食 Predated(2) | 捕食者攻击判定成功 |
| 脱水 Dehydrate(3) | 能量 ≤ 0 且 `干旱强度 > 0.35` 且 `droughtTol < 0.5` |

死因写入个体档案、事件日志与统计分段计数，并在谱系视图中可见。

---

## 4. 干预系统

**工具清单**（`Tool`，14 项；`toolIsIntervention`：除 `None` 外都算干预）

| 分组 | 工具 | 实际效果（`simulation.ts intervene`） |
| --- | --- | --- |
| 选择/观察 | `None` | 选中、追踪个体（不消耗配额） |
| 地形笔 | `PaintMeadow` / `PaintWoodland` / `PaintArid` / `PaintWater` / `PaintRock` | 圆形笔刷改地形；改水域：moisture=1、nutrients≤0.15、植物清零；改岩石：moisture=0.05、植物清零；改干旱地：moisture×0.55、nutrients×0.7；改草地/林地：moisture+0.12 |
| 播种/种植 | `PlantGrass` / `PlantShrub` | 可通行格 grass +18（上限 60）/ shrub +10（上限 40） |
| 气候 | `Rain` / `Drought` | `rainBoostTicks = 900`（约 15 秒加强降雨）/ `startDrought(2400)`（约 40 秒） |
| 投放 | `SpawnSmallHerb` / `SpawnLargeHerb` / `SpawnPredator` / `SpawnScavenger` | 在点击处 3 格内随机可通行点生成；能量 = `maxEnergy × 0.7 × (0.7 + 0.6 × size)`；可指定蓝图基因；`artificial = true`、代次 0、新建谱系 |

**规则**

- 笔刷大小 `brushSize` 1–6（`client.setBrush` 截断；Worker 端 `forEachTileInBrush` 按圆形取格）。
- **可见范围与反馈**：干预即时改变世界状态，并通过叠加层、事件日志（`intervene` / `climate` 类型）与 Toast 反馈。
- **无效操作有明确原因**：超出世界边界 / 该区域已经是目标地形 / 这里无法播种 / 附近没有可投放的位置 /
  干预配额已用完 / 挑战未在进行中。
- **挑战配额**：挑战中每次干预消耗 1 点配额（`interventionsLeft` 递减，`interventionUsed` 递增）；沙盒无限次。
- **人工投放标记**：投放个体 `artificial = true`，其谱系 `LineageInfo.artificial = true`；
  **不计入自然繁殖目标**（挑战 C 依赖此规则）。

---

## 5. 三关挑战设计

**通用机制**（`challenges.ts` + `ChallengePublicState`）

- 状态机：`briefing` → `confirmChallengeBrief`（`beginChallenge`）→ `running` → `success` / `fail`。
- 界面显示：目标列表（`label / current / target / ok`）、`interventionsLeft`、`ticksLeft`、`coexistProgress`、`note`（含失败原因）。
- **暂停不计时**：`pause` 不推进 tick，`ticksLeft` 不变。
- **判定全部基于模拟真实状态**：物种灭绝即失败；测试与界面都不能直接改写胜利状态。
- **防绕过**：挑战存档带 `challenge` 状态（`SaveFile.mode = 'challenge'` + `challengeId` + `challenge` 载荷，
  且 `configId` 必须在 `CHALLENGES` 中，否则导入校验失败）；**沙盒存档不能载入挑战**；
  刷新恢复的是挑战存档（自动存档持续记录挑战进度）。
- **结算与重试**：成功/失败时 Worker 自动暂停并等待玩家处理结算弹窗；
  `retryChallenge` 用**同种子同配置**重建（`Simulation.startChallenge` + `Object.assign` 保持引用稳定），`exitChallenge` 返回主菜单。
- `resultStats` 记录：用时 tick、四种群计数、植物总量、谱系最高代数、谱系存活数、自然出生总数。

**三关数值与判定**（与 `src/sim/config.ts` 的 `CHALLENGES` 逐项核对）

| 关卡 | id | 预设 / 种子 | 干预配额 | 时限(tick) | 目标 | 特殊机制 |
| --- | --- | --- | --- | --- | --- | --- |
| **A · 生态守护** | `guardian` | temperate / 20260101 | 8 | 27000 | 小型食草 ≥ 24、大型食草 ≥ 10、捕食者 ≥ 5、植物 ≥ 700 | 共存需连续保持 `coexistTicks 1800` tick |
| **B · 旱季之后** | `drought` | meadow / 20260202 | 6 | 24000 | 小型食草 ≥ 28、大型食草 ≥ 12、捕食者 ≥ 4、植物 ≥ 600 | 定时干旱：开局 900 tick 后到来，持续 3600 tick |
| **C · 谱系延续** | `lineage` | temperate / 20260303 | 5 | 30000 | 起始谱系自然繁衍到第 6 代且自然存活后代 ≥ 36 | 起始数量覆盖（小食草 26 / 大食草 10 / 捕食者 5 / 食腐者 6） |

**判定细节（实现）**

- **A**：每 tick 检查"三物种全部达标且植物 ≥ 700"；全部达标时 `coexistTicks++`（需累计 1800，界面显示秒数进度），
  掉出达标即归零；任一致目标物种数量归零 → 失败（"XX已灭绝"）；`elapsed ≥ 27000` → 失败。
- **B**：`elapsed ≥ 900` 时脚本触发干旱（`startDrought(3600)`）；干旱结束后若全部达标 → 成功；
  超时未恢复或关键物种灭绝 → 失败。
- **C**：起始谱系自动选为**最靠近世界中心的小型食草者**所属谱系（简报中显示谱系号与创始人）；
  每 tick 统计该谱系中 `generation ≥ 1 且 !artificial` 的存活数（`naturalAlive`）与最高代数；
  `maxGen ≥ 6 且 naturalAlive ≥ 36` → 成功；谱系 `aliveCount === 0` → 失败（"谱系灭绝"）；超时 → 失败。
  **人工投放的个体不计入**——保护它，但不要替它生育。

---

## 6. 视觉与音频

**硬性方向：精致 2D 俯视角像素风。**

- **像素规格**（`renderer/sprites.ts`）：地形块 `TILE_PIXELS = 32`；植物动态层每 tile `PLANT_PX = 8`（放大到 32px 保持颗粒感）；
  生物图集单元格 `CREATURE_CELL = 16`、设计直径 `CREATURE_DIAMETER = 13`；最近邻放大（`PIXI.SCALES.NEAREST`）。
- **程序化像素素材**：全部 canvas 2D 逐像素绘制后缓存为纹理；所有素材随机用确定性哈希（`hash2` / `mulberry32`），
  **不使用模拟 RNG**；不使用外部图片，保证原创与风格统一。
- **地形可分辨性**：水域 `#2e6f8e`/`#235670`、岩石 `#7d7468`、湿润草地 `#8fbf6a`/`#79a958`、
  林地 `#4f7d4a`/`#3f6a3d`、干旱地 `#d8c284`/`#c2a96b`（各有暗部色形成纸感层次）。
- **植被 / 残骸**：青草 `#a7d77a`、浆果灌丛 `#c96f8a`、残骸 `#8a7f6a`；植被密度用明暗/密度渐变表达。
- **生物**：轮廓 + 朝向 + 帧动画；图集每变体 `CREATURE_FRAMES = 6`（0–3 行走、4 进食、5 受惊），
  四物种主色 `['#f2e6b8','#e8a95c','#d9534f','#9a8fd0']`，暗部 `speciesDark`。
- **基因 → 外观映射（4 项，玩家可见）**：
  - 体型 = `size` 基因 → `sprite.scale`（设计直径 13px 换算）；
  - 花纹 / 色相 = `speed` 基因 → `shiftHue` 体色色相偏移（`creature.hueShift = genes.speed`）；
  - 附肢长度 = `sense` 基因 → 三档（`SENSE_TIERS = 3`）：食草类耳羽、捕食者背部棘刺、食腐者触角，档位越高越长/越多；
  - 腹部斑块 = `reproInvest` 基因 → 两档（`BELLY_TIERS = 2`）腹部亮斑明暗。
- **昼夜色调**：`night` 叠加 `rgba(24,32,56,0.45)`，按 `dayPhase` 渐入渐出；林地遮阴由 `terrainLightMul` 体现。
- **反馈特效**（`renderer/effects.ts`，对象池化）：进食（绿色粒子被吸入）、出生（金色粒子 + 扩散环）、
  死亡（灰色粒子上飘）、捕食（冲击效果）、干旱（地表泛黄/裂纹叠加）、降雨（雨线粒子，数量随强度 0..`MAX_RAIN` 缩放）。
- **相机**（`renderer/camera.ts`）：`screen = (world − center) × zoom + viewport/2`；
  `baseZoom` 适配 128×80 世界的 62% 视野，`zoomRel` 限幅；拖动平移带惯性平滑并 `clampToWorld`。
- **UI 与像素场景协调**：米色纸感面板 `panel #f7f2e6` + 像素边框 `panelEdge #d8cfbc`，墨色文字 `ink #2b2620`，
  强调色 `accent #c96f3a` / `accent2 #4f7d4a`；中文清晰易读；
  **颜色之外必须有形状 / 文字区分**（叠加层图例带形状、状态带文字标签、死因图标 + 文字）。
- **音频**（`game/audio.ts`）：程序化 Web Audio（振荡器 + 包络 + 噪声缓存）合成音效；
  **首次用户手势调用 `audio.unlock()`** 解锁 `AudioContext`；`play()` 前检查运行状态，`suspended` 时静默返回；
  静音时不创建任何音频节点；音量 / 静音通过 master gain 平滑过渡**实时生效**；默认 `volume 0.6`；兼容 `webkitAudioContext`。

---

## 7. 存档系统

**`SaveFile` 结构**（`protocol.ts` + `simulation.ts toSaveData`，`version = 1`）

| 分组 | 字段 |
| --- | --- |
| 头部 | `format: 'ecobox-world'` / `version` / `savedAt` / `seed` / `presetId` / `mode`('sandbox' \| 'challenge') / `challengeId` / `tick` |
| RNG 与 ID | `rngState: [a,b,c,d]`（sfc32 四态）+ `nextId`（个体 ID 计数器，跨存档单调） |
| 世界 | `terrain` / `moisture` / `nutrients` / `grass` / `shrub` / `carcass`（**精确浮点数组**）+ `climate { rainfall, rainBoostTicks, droughtTicks, droughtIntensity }` |
| 生物 | `creatures: SerializedCreature[]`（位置/速度/朝向/能量/年龄/基因/状态/reason/目标/威胁/各计时器/谱系/出生 tick/artificial/kids/lastMealTick） |
| 档案 | `records` / `lineages` / `stats`（末 1200 条）/ `events`（末 200 条）/ `eventSeq` / `statsCursor` |
| 挑战 | `challenge`（沙盒为 `null`）+ `interventionUsed` |

**策略**

- **自动存档 + 3 手动槽**（`'auto' | 'slot1' | 'slot2' | 'slot3'`）；自动存档每 3000 tick 一次；
  `SaveSlotInfo` 带 label / savedAt / tick / mode / challengeId / presetId / population。
- **JSON 导入导出**：`requestExport` → Worker 产出 JSON → `downloadJson` 下载；
  导入走 `loadSave`（`'__import__'`）→ `parseSaveText` 校验 → `Simulation.fromSave` 载入。
- **导入校验**（`serialize.ts validateSave`，`parseSaveText`）：
  文件 ≤ 64MB；`format === 'ecobox-world'`；`version === 1`；`seed ≥ 0`；`presetId` 非空；`mode` 合法；
  `tick` 为非负整数；`rngState` 为 4 个有限数；`nextId ≥ 1`；`climate` 四字段非负；
  六个世界数组长度均为 10240，地形 0..4、水分养分 0..1、青草 ≤ 60.001、浆果 ≤ 40.001、残骸 ≤ 90.001；
  `creatures ≤ 1650`（`maxCreatures + 50`），前 200 个个体校验 ID 唯一、物种合法、坐标在世界 ±1 内、六项基因 0..1；
  `records ≤ 25000`、`lineages ≤ 4500`；`challenge.configId` 必须存在于 `CHALLENGES`。
  错误信息取前 4 条返回；**校验失败保留当前世界**并提示，不清空。
- **存储介质**：IndexedDB 数据库 `ecobox-db`（v1），object store `saves`（keyPath `id`，存 `{id, info, data}`）与
  `blueprints`；`onupgradeneeded` 建库；`listSaves` 按 auto < slot1 < slot2 < slot3 排序。
  localStorage 仅存偏好（`ecobox.prefs.v1`：volume / muted / guideDone / overlay）。
- **失败兜底**：`storageAvailable()` 为假时 Worker 启动即置
  `storageError = '当前环境不支持 IndexedDB，世界只能通过 JSON 导出保存'`；保存 / 载入失败以 Toast 提示，并引导用"导出 JSON"手动备份。
- **恢复语义**（`fromSave`）：RNG 状态与 ID 计数器精确恢复；`mature` 由 age 重算；`running = true`、`speed = 1`；
  `terrainDirty = true`（首帧重发地形）；`light = computeLight(tick)`。

---

## 8. 性能设计

| 手段 | 实现 |
| --- | --- |
| 空间哈希邻域查询 | `SpatialHash`（cellSize 8 ≥ 最大感知半径 6.4），每 tick `clear + rebuild`，`querySorted` 按 (距离, 索引) 排序 |
| 土壤错峰 | 每 tile 每 8 tick 更新一次（速率补偿），10 万步长测可行 |
| 快照节流 | 动态 tile 数据每 3 帧下发一次（`TILE_SNAPSHOT_EVERY = 3`），地形变更当帧必发；生物数据每帧下发 |
| transferable | `snapshotTransferables()` 转移全部 TypedArray 所有权，零拷贝过线程 |
| React 4Hz 面板更新 | `PANEL_INTERVAL = 250 ms`；结构状态变化才立即刷新；渲染器直读 `client.latest`，不走 React |
| 固定循环 | Worker `setInterval(loop, 16)`；`doSteps(speed)` 聚合多步，`stepMsAccum` 统计真实 `simMsPerTick` |
| 后台标签页暂停 | `visibility` 消息 → `visible = false` 时 `effectiveRunning = false`，不推进模拟 |
| 显示实际速度 | `client.reportPerf(fps, actualTps)` 记录真实 FPS 与实际 tps，界面显示"实际速度" |
| 事件限流 | 出生事件每 100 条记 1 条、捕食每 10 条、失手每 50 条、死亡每 200 条（或选中个体必记），`maxEvents 800` |
| 容量保护 | `maxCreatures 1600`（停止自然繁殖 + 提示，人工投放不受限）、`maxRecords 24000`、`statsBuffer 3000`、`maxLineages 4000` |

---

## 9. 可复现性设计

- **种子 RNG 控制一切模拟随机**：sfc32 + splitmix32 种子扩散（`rng.ts`）驱动突变、初代基因、决策随机项、
  卡住救援、子代落点、人工投放位置等全部模拟随机过程。
- **渲染随机独立**：素材生成的 `hash2` / `mulberry32` 与特效的 `Math.random` 都不触碰模拟 RNG 状态
  （`rng.ts` 与 `sprites.ts` 注释明确此约束）。
- **个体更新顺序固定**：`step()` 按数组索引序更新，子代在当 tick 结束后才合入——同种子同结果。
- **干预在确定 tick 执行**：`intervene` 在固定步长边界处理，同一干预序列在同一 tick 序列上结果一致。
- **存档精确浮点**：`SaveFile` 以 JSON 保存浮点（Float32 → double round-trip 精确）+ `rngState` + `nextId`，
  保证"存档续推"与"不存档直接跑"一致。
- **倍速不改变生态规则**：倍速只是每帧执行更多固定步（步长不变），1× / 2× / 5× / 10× 结果序列一致。
- **排序确定性**：感知候选与空间哈希结果按 (距离, 个体索引) 排序，消除遍历顺序带来的不确定性。

---

## 10. 视觉验收标准清单

**截图检查点**（每项需人工过图，结果记入 `docs/VALIDATION.md`）

- **启动页**：标题 / 按钮完整无遮挡，无文字溢出，按钮热区不重叠；引导弹窗可关闭。
- **运行世界**：工具栏 / 面板不遮挡场景主要区域；拖拽平移与点击选中不冲突；叠加层图例带形状 + 文字；昼夜渐变无突变。
- **个体面板**：基因 / 能量 / 年龄 / 谱系字段不溢出；`reason` 文本完整可读；三代追溯缺失时显示"初代 / 无记录"而非空白。
- **谱系视图**：树 / 列表布局不重叠，代数与灭绝标记清晰；长谱系可滚动。
- **挑战结算**：目标行 `current / target / ok` 三态可辨（颜色 + 图标 + 文字），重试 / 退出按钮不重叠。
- **存档界面**：槽位信息完整（时间 / tick / 模式 / 种群），导入导出入口明确，错误提示可见。
- **生物可辨认度**：四物种在默认缩放与最小缩放下均可按颜色 + 轮廓区分；朝向明确；行走 / 进食 / 受惊帧差异可辨。
- **基因外观映射可见性**：同物种两个体在 `size` / `speed` / `sense` / `reproInvest` 上应有可见差异
  （体型、色相、附肢长度、腹部斑块）；验收时用蓝图对照验证。

---

## 11. 已知限制与不做的事

- **移动端专属操作不做**（触屏手势、竖屏适配）；界面面向桌面浏览器。
- **两性繁殖不做**：单亲无性繁殖，游戏内说明。
- **神经网络 AI 不做**：效用评分 + 状态机，保证可解释（玩家能读懂每个基因的收益与代价）。
- **训练系统、后端服务、线上部署不做**：本地单机运行；gh 私有仓库仅作代码托管，不部署 GitHub Pages。
- **规模固定（v1）**：世界 128×80、4 物种、2 类植物。
- **音频为程序化合成**，不使用真实录音素材。
- **待办**：React UI（`src/ui`）、`scripts/batch-sim.ts` 与 `scripts/bench.ts`、测试与长测、三关数值定标、
  E2E 浏览器验收、`docs/VALIDATION.md`。实现推进后需回头核对的部分：
  `systems.ts` 中养分饱和参考值 0.35（硬编码，未进 `config.ts`）；
  `sampleStats` 统计全部存活个体而 `protocol.ts` 注释写"只统计存活成年个体"（待统一）。
