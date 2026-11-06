# REFERENCES — 调研参考资料

> 本文整理自《微境：人工生命生态箱》项目已完成的两份外部调研报告（生态模拟参考资料 + 工程参考资料）。
> 所有条目均为**实际访问记录**，未虚构访问过程；访问方式、失败与降级路径如实记录。
> 访问日期：2026-11-06（Asia/Shanghai）。专有名词保留英文。

---

## 一、生态模拟参考资料

### 1. NetLogo Wolf Sheep Predation（狼羊捕食模型）

| 项 | 内容 |
| --- | --- |
| 来源 | NetLogo Models Library（Northwestern University CCL） |
| URL | <https://ccl.northwestern.edu/netlogo/models/WolfSheepPredation> |
| 访问结果 | HTTP 200，模型说明页完整读取 |

**关键机制要点**

- `model-version` 切换两个变体：`sheep-wolves`（草无限，羊无食物约束）与 `sheep-wolves-grass`（显式建模草，草是被消耗的资源）。
- 个体每步**随机游走**，每步**固定扣 1 能量**；狼吃羊回能（`wolf-gain-from-food`），羊吃所在 patch 的草回能（`sheep-gain-from-food`），**能量耗尽即死**。
- 繁殖为**固定概率**（`sheep-reproduce` / `wolf-reproduce`），与能量无关。
- 草被吃掉后需 `grass-regrowth-time` 步再生，即资源有**恢复周期**。
- 模型页结论：无草变体 "ultimately unstable"；含草变体 "generally stable"，行为更接近 Lotka-Volterra 振荡。
- 模型页同时指出：Lotka-Volterra 假设**连续实数**种群，在**小种群下低估灭绝**；agent-based 模型显式表达个体，灭绝行为更真实。
- `initial-number-wolves=0` 时，羊 + 草系统稳定（顶层捕食者缺失时振荡源被移除）。
- "EXTENDING THE MODEL" 建议：繁殖改由**能量**决定、羊聚群（flocking）、狼**主动追羊**。
- 可复现性：BehaviorSpace 用 `random-seed`（`474 + behaviorspace-run-number`）批量复现实验。

**回答设计问题 a：有限植物资源如何限制种群？为何共存与灭绝都可能？**

1. **限制机制**：羊的能量收入完全来自吃草（`sheep-gain-from-food`），狼的能量收入来自吃羊。草的再生速率（`grass-regrowth-time`）构成整个系统的"收入上限"——食草者总数被植物产量封顶，而不是被某个硬编码数字封顶。
2. **为何共存**：含草变体把"无限食物"这个不真实的假设去掉后，捕食关系落在资源约束内，系统 "generally stable"，呈现接近 Lotka-Volterra 的振荡式共存。
3. **为何也可能灭绝**：Lotka-Volterra 的连续实数假设在小种群下失效——个体数量很少时，随机游走找不到食物、被连续捕食等个体级随机事件会让种群真正归零，这是微分方程预测不到的。`initial-number-wolves=0` 的稳定性实验进一步说明：捕食者是放大振荡、把系统推向崩溃的因素。
4. **对本项目的直接推论**：植物必须有上限、有生长条件、有恢复周期；种群上限由植物产量决定；灭绝必须作为**可能结果**被允许，并用固定种子多次长测来观察灭绝频率，而不是靠隐藏机制"保底"。

**对本项目的结论**

- 采用：能量经济学（进食回能、每 tick 扣能、归零死亡）、植物再生计时、参数外置 + 固定种子批量实验、"繁殖由能量阈值触发"（吸收 EXTENDING 建议）。
- 不采用：固定概率繁殖（改为成熟 + 能量门槛 + 冷却，见 `src/sim/config.ts` 的 `reproThreshold` / `reproCooldown`）；无限草变体（青草与浆果均为有限资源，见 `PLANTS.grass.max` / `PLANTS.shrub.max`）。

---

### 2. The Nature of Code 第 9 章 Genetic Algorithms

| 项 | 内容 |
| --- | --- |
| 来源 | Daniel Shiffman, *The Nature of Code*, Chapter 9 |
| URL | <https://natureofcode.com/genetic-algorithms/> |
| 访问结果 | `web_fetch` 返回空，改用 firecrawl scrape 成功读取全文 |

**关键机制要点**

- 遗传算法三原则：**heredity / variation / selection**；区分 **genotype**（基因型）与 **phenotype**（表现型）。
- mating pool 三法对比：**elitist** 损害变异（多样性塌缩）、**top-50%** 不优于随机、**wheel of fortune**（轮盘赌）为推荐做法。
- Ecosystem 部分明言：真实世界"没有人拿着计算器给生物打适应度分"（no one is holding a calculator scoring fitness）——改用 **health 每帧扣 0.2、health < 0 即死、死亡即选择**（死去的 bloop 不能当父代）。
- 单亲无性繁殖范例：`repro()` 每帧 `if (random(1) < 0.005)`；`childDNA = this.dna.copy()` 后 `mutate(0.01)`；子代生于父代位置；**明确用 `copy()` 而非 `crossover()`**。
- 基因映射范例：`genes[0]` 经 `map()` **同时决定** `maxSpeed`（15→0）与半径 `r`（0→25）——体型与速度**反向耦合**，结果中等体型/中速胜出；并观察到"大 bloop 挤成一团饿不死"的**局部亚群异常**。
- 能量闭环：食物吃掉即移除；bloop 死亡处 `food.add(bloop.position)`，**尸体变食物**。
- 结尾 Ecosystem Project 明言：**平衡是最大难点**。
- 形态学差异：传统 GA 是**离散世代**（示例约 60 代/秒，每代清空重建）；bloop 生态示例是**连续过程、无世代边界**。

**回答设计问题 b：哪些基因改变实际行为？选择压力如何从环境产生？**

1. **基因改变的是具名参数，不是抽象分数**：`genes[0]` 经 `map()` 直接落到 `maxSpeed` 与半径 `r` 两个具名物理量上，行为差异（追得上/逃不掉、吃得着/够不着）完全由这些参数与环境的交互产生。一个基因可同时影响多个参数（大小-速度反向耦合），这正是"收益-代价"结构的来源。
2. **选择压力来自环境而非评分函数**：health 每帧固定扣除（代谢成本），食物由位置与摄食能力决定，健康归零即死，死去的个体不参与繁殖——**环境本身就是裁判**，不需要设计者写 fitness。
3. **代价显式化**：大体型在这一耦合下速度变慢，于是出现"中等体型/中速胜出"的稳定策略；同时也暴露了耦合设计的风险——"大 bloop 挤成一团饿不死"说明局部环境（食物密度 + 群体遮挡）会制造异常亚群。本项目据此为每项基因写出显式 gain/cost 表（见 `src/sim/config.ts` `GENE_DEFS`），并把"体型大使目标更大、更易被注意"也列为代价。
4. **繁殖是稀缺资源**：0.5%/帧的繁殖概率意味着繁殖机会由存活时长决定——活得久才有机会当父代，这就是自然选择的传递路径。

**对本项目的结论**

- 采用：**死亡 = 选择**（无 fitness 函数）、**单亲 `copy()` + `mutate()`**、**基因映射到具名参数**（`mapGene`）、**尸体回田**（残骸→食腐/分解→养分）、繁殖概率低且与存活时长挂钩。
- 不采用：**离散世代清空重建**（本项目是连续过程，个体生死交错）；**elitist / top-50%** 选择（会损害变异，与本项目"小种群 + 突变探索"目标冲突）；**神经网络权重当基因**（可解释性底线：玩家必须能读懂每个基因的收益与代价）。

---

### 3. biosim4

| 项 | 内容 |
| --- | --- |
| 来源 | davidrmiller/biosim4（GitHub） |
| URL | <https://github.com/davidrmiller/biosim4> |
| 访问结果 | github.com HTML 被截断，改用 `raw.githubusercontent.com/davidrmiller/biosim4/main/README.md` 成功读取；项目自述为 **maintenance-only**（维护模式，不再活跃开发） |

**关键机制要点**

- **数据结构**：Grid 只存 **16-bit 索引**（指向个体数组，省内存）；`Indiv = genome + 神经网络 + age`。
- **执行结构**：三层循环 `generation → step → individual`，最内层用 **OpenMP** 并行。
- **感知-行动接口**：`sensors-actions.h` 中定义 `enum Sensor` 与 `enum Action`，感知与行动是**封闭枚举集合**。
- **基因的作用方式**：基因在**开局编译成神经网络**，运行时 `getSensor → feedForward → executeActions`，即基因塑造一个"感知→行动"的控制器。
- 空间感知：**八向 Compass**；信息素 `signals` 为**单层 uint8 网格 + 衰减**。
- 关键 ini 参数：`population=3000`、`stepsPerGeneration=300`、`maxGenerations=200000`、`genomeInitialLengthMin/Max=24/300`、`maxNumberNeurons=5`、`pointMutationRate=0.001`、`populationSensorRadius=2.5`、`longProbeDistance=16`。
- 繁殖：`sexualReproduction=false` 即单亲（无性）。
- **环境挑战**：challenge 编号菜单（`0=circle`、`1=right half`、`6=corner`、`7=migrate`、`17=altruism`）；`barrierType` 0-6。
- **实验复现**：`deterministic` + `RNGSeed`；`logs/epoch.txt` 每代记录（代数、幸存数、遗传多样性、平均基因组长）；`displaySampleGenomes` 打印样本基因组；`genomeComparisonMethod` 量化多样性。

**回答设计问题 c：biosim4 如何组织"基因→感知→行动"与实验复现？**

1. **基因→感知→行动的组织方式**：基因不在运行时被逐条解释，而是在开局**编译成一个小型神经网络**（`maxNumberNeurons=5`）；每一步，个体通过 `getSensor` 从局部世界读取一组 `enum Sensor`（含八向 Compass 与 `populationSensorRadius=2.5` 的邻域感知、`longProbeDistance=16` 的远程探测），`feedForward` 后 `executeActions` 输出 `enum Action`。因此"基因"实际是**控制器的编译输入**，行为是学习/演化出来的映射，而非硬编码规则。
2. **实验复现方式**：一切随机由 `RNGSeed` + `deterministic` 锁定；规模由 ini 参数外置（3000 个体 × 20 万代）；结果用 `logs/epoch.txt` 按代留存（幸存数、多样性、平均基因组长），配合 `displaySampleGenomes` 与 `genomeComparisonMethod` 做可追溯的多样性度量；环境差异用 challenge 编号菜单与 `barrierType` 系统化枚举，使不同环境压力可批量对比。
3. **对本项目的取舍**：这套"基因→神经网络编译 + 超长代际 + 离散世代"的组织方式与《微境》的**可解释性**和**连续生态过程**目标冲突，因此本项目只继承其**工程方法论**（参数外置、固定种子、结构化日志、菜单式环境挑战），把基因改为直接映射到具名参数（`mapGene`），感知改为空间哈希局部查询，行动改为效用评分 + 状态机。

**对本项目的结论**

- 采用：**参数全外置**（`src/sim/config.ts`）、**固定种子可复现**（sfc32 + `RNGSeed`）、**每阶段结构化日志**（`logs`/统计环形缓冲 + 事件日志）、**challenge 菜单式环境挑战**（三关挑战 A/B/C，见 `CHALLENGES`）。
- 不采用：**基因→神经网络编译**（可解释性底线）；**3000 个体 × 20 万代**（`LIMITS.maxCreatures = 1600`，世界 128×80）；**离散世代清空重建**（连续过程）；`pointMutationRate=0.001` 的单基因概率量级仅作参考，本项目用 `MUTATION.prob=0.35` + 常规/大幅两档高斯（见 `src/sim/config.ts`）。

---

### 4. SebLague/Ecosystem-2

| 项 | 内容 |
| --- | --- |
| 来源 | Sebastian Lague / Ecosystem-2（GitHub） |
| URL | <https://github.com/SebLague/Ecosystem-2> |
| 访问结果 | github.com HTML 被截断，改用 raw README 成功；README **仅两句话** |

**关键机制要点**

- README 全文仅两句：这是对其 Ecosystem Simulation 视频的 work-in-progress 更新；目前正在为实现更大世界而重写一切（"Currently reimplementing everything to support a larger world"）。
- **无任何机制文档、无参数、无算法说明**。

**对本项目的结论**

- **信息量极低，仅作视觉灵感**（生态场景的观感与生物群聚的视觉节奏参考），不作为机制或工程依据。

---

## 二、工程参考资料

### 1. PixiJS 8 性能建议

| 项 | 内容 |
| --- | --- |
| 来源 | PixiJS 官方指南 8.x |
| URL | <https://pixijs.com/8.x/guides/concepts/performance-tips> |
| 访问结果 | HTTP 200 |

**关键机制要点**

- 总原则：**按需优化**（先测量再优化）。
- **绘制顺序影响批处理**：`sprite/sprite/graphic/graphic` 优于交替穿插。
- 老旧移动端可关闭 `useContextAlpha: false` 与 `antialias: false`。
- **culling 默认关闭**，需手动 `cullable = true`。
- sprite 批处理最多混合 **16 种纹理**。
- **Graphics** 不常改时最快；**≤100 点**参与批处理。
- **Text** 避免每帧修改；动态文本用 **Bitmap Text**。
- **Masks** 成本：`scissor > stencil > filter`。
- **混合模式会打断批处理**。
- `interactiveChildren = false` 可加速事件派发。

**对本项目的应用**：渲染分层按"地形层→植被层→生物层→特效层"分组同类绘制对象，避免交替；生物用 Sprite 池 + 图集（单一纹理）保证 16 纹理上限不被突破；`cullable=true` 做视口剔除；UI 文字不走 Text 逐帧改；特效少用 Mask；叠加层用 `interactiveChildren=false` 的静态层。

### 2. MDN Web Workers API（含 Structured clone algorithm）

| 项 | 内容 |
| --- | --- |
| 来源 | MDN Web Docs |
| URL | <https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API> |
| 访问结果 | HTTP 200；同次调研补充查阅 MDN Structured clone algorithm 文档页 |

**关键机制要点**

- Worker 在**后台线程**运行，**不阻塞 UI**。
- Worker 内**不能直接操作 DOM**。
- 通信靠 `postMessage` / `onmessage`，数据是**复制而非共享**（structured clone）。
- Structured clone 限制：**Function 与 DOM 节点抛 `DataCloneError`**；**不保留原型链、类私有字段、`RegExp.lastIndex`**；支持 `TypedArray` / `Map` / `Set` / `Blob` 等。

**对本项目的应用**：模拟跑在 Dedicated Worker；Worker→UI 只发**纯数据快照**（`SimSnapshot`，其中生物与地块均为 `TypedArray`，见 `src/shared/protocol.ts`）；UI→Worker 只发纯数据请求（`WorkerRequest`）。因为 structured clone 不保留原型链，跨线程数据一律以**接口化的纯对象/TypedArray**传递，不传类实例；大数组用 transferable 列表转移所有权，减少复制。

### 3. MDN IndexedDB API

| 项 | 内容 |
| --- | --- |
| 来源 | MDN Web Docs |
| URL | <https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API> |
| 访问结果 | HTTP 200 |

**关键机制要点**

- 客户端**大量结构化数据**（含 Blob）的存储方案；**Web Workers 中同样可用**。
- **事务型**（transactional）。
- **structured clone 支持的对象都能存**。
- 对象模型：`IDBFactory → IDBDatabase → IDBTransaction → IDBObjectStore / IDBIndex / IDBCursor`。
- 版本升级走 `onupgradeneeded`。

**对本项目的应用**：世界存档（`SaveFile`）与蓝图（`Blueprint`）存 IndexedDB（`SaveFile` 为纯 JSON 结构，天然满足 structured clone 约束）；`localStorage` 仅存偏好（`ecobox.prefs.v1`，见 `src/game/client.ts`）；`onupgradeneeded` 负责 object store 的版本升级。

### 4. Vite static-deploy

| 项 | 内容 |
| --- | --- |
| 来源 | Vite 官方文档 |
| URL | <https://vite.dev/guide/static-deploy> |
| 访问结果 | HTTP 200（页版本 v8.3.6） |

**关键机制要点**

- 默认产物目录 **dist**；命令 `vite build` / `vite preview`。
- `vite preview` 服务 dist，默认 **localhost:4173**。
- 部署到项目页（子路径）需设 `base: '/<REPO>/'`。
- GitHub Pages 建议用 **Actions** 部署。

**对本项目的应用**：本地构建预览命令固定为 `npm run build && npm run preview`（端口 4173，见 `package.json` 与 `vite.config.ts` 的 `preview.port`）；默认 `base: '/'`（本机运行，不部署 Pages）。

### 5. gh repo create

| 项 | 内容 |
| --- | --- |
| 来源 | GitHub CLI 手册 |
| URL | <https://cli.github.com/manual/gh_repo_create> |
| 访问结果 | HTTP 200 |

**关键机制要点**

- 非交互模式必须给出**仓库名**，并三选一：`--public` / `--private` / `--internal`。
- `-s` / `--source`：从**本地仓库**创建（默认远端名 = 目录名）。
- `--push`：创建后推送本地提交。
- `-r` / `--remote`：指定远端名。
- `--add-readme`：创建时带 README。
- **当前手册页无 `--confirm` 参数**（不得凭记忆使用）。

**对本项目的应用**：远端交付命令按手册事实写为 `gh repo create ecobox --private --source=. --remote=origin --push`（本地目录名为 `ecobox`，默认远端名即 `origin`；计划见 `PROGRESS.md`）。

### 6. gh auth status

| 项 | 内容 |
| --- | --- |
| 来源 | GitHub CLI 手册 |
| URL | <https://cli.github.com/manual/gh_auth_status> |
| 访问结果 | HTTP 200 |

**关键机制要点**

- 显示每个 host 的**活动账号**。
- 任一 host 有认证问题时**退出码 1**，信息输出到 **stderr**。
- `--json` 模式下即使无问题也**退出 0**；**脚本化检测应依赖退出码**。

**对本项目的应用**：推送前用 `gh auth status` 的**退出码**（而非解析 stdout）判断 gh 可用性；本机已核实账号 **kiva-9**（scopes 含 `repo`），见 `PROGRESS.md`。

### 7. 版本事实（调研时点）

| 项 | 事实 |
| --- | --- |
| pixi.js | 最新 **8.22.0**，MIT 许可 |
| PixiJS v8 重大变化 | `Application` **异步 init**（`await app.init()`，选项传给 `init()`）；**单一包结构**；`Texture` 重构（`TextureSource` 家族，`new Texture({ source })`）；`Graphics` API 大改（先画形状再 `fill()` / `stroke()`，`drawRect` → `rect` 等） |
| Vite | 最新 **8.3.6**，Node 要求 `^20.19.0 \|\| >=22.12.0` |
| React | **19.3.1** |

**对本项目的应用**：`package.json` 锁定 `pixi.js 8.22.0` / `react 19.3.1` / `vite 8.3.6`；渲染器按 v8 异步 init 与新版 `Graphics` API 编写；`vite.config.ts` 设 `worker.format: 'es'`（Dedicated Worker 以 ES module 加载）。

---

## 三、设计启发汇总

| 来源 | 核心启发 | 在本项目的落点 |
| --- | --- | --- |
| NetLogo Wolf Sheep Predation | 资源（草）有上限与再生周期，种群被资源产量封顶；agent-based 才能表现小种群灭绝；繁殖应由能量触发 | 植物上限/生长条件/恢复周期（`PLANTS`）；繁殖 = 成熟 + 能量门槛 + 冷却（`SpeciesParams.reproThreshold` / `reproCooldown`）；灭绝作为允许结果，用固定种子长测观察 |
| Nature of Code Ch.9 | 无 fitness 函数，死亡即选择；单亲 `copy()` + `mutate()`；基因经 `map()` 落到具名参数；尸体变食物；连续过程无世代边界 | `GENE_DEFS` + `mapGene`；`inheritGenes`（copy + 两档高斯突变）；残骸→食腐/分解→养分；个体生死交错的连续生态 |
| biosim4 | 参数全外置、固定种子可复现、每代结构化日志、菜单式环境挑战；基因编译成神经网络 | 继承工程方法论（`config.ts`、sfc32 种子、统计/事件日志、三关挑战）；不继承基因→神经网络编译与离散世代 |
| SebLague/Ecosystem-2 | README 仅两句话，无机制内容 | 仅视觉灵感 |
| PixiJS 8 性能建议 | 绘制顺序/纹理数/culling/Mask 成本决定批处理效率 | 渲染分层与 Sprite 池、图集、视口剔除、静态叠加层 |
| MDN Web Workers + Structured clone | 后台线程不阻塞 UI；数据复制非共享；Function/DOM 节点不可克隆，原型链不保留 | 纯数据 + TypedArray + transferable 的 Worker 协议（`src/shared/protocol.ts`） |
| MDN IndexedDB | 事务型、structured clone 对象可存、Worker 内可用、`onupgradeneeded` 升级 | `SaveFile` / `Blueprint` 存 IndexedDB；`localStorage` 仅存偏好 |
| Vite static-deploy | dist 产物 / preview :4173 / `base` | 本地 `build` + `preview` 命令与端口 |
| gh repo create / gh auth status | 非交互创建必须 `--private` 等；认证检测看退出码 | 远端交付命令与前置检查 |

**三条设计问题的答案索引**：问题 a 见 §一.1；问题 b 见 §一.2；问题 c 见 §一.3。
