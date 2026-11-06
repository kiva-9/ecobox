# PROGRESS — 《微境：人工生命生态箱》

> 最后更新：2026-11-06 16:55 (Asia/Shanghai)

## 项目位置与启动
- 项目根目录：`/Users/kiva/Desktop/EcoBox/ecobox`（授权工作区 `/Users/kiva/Desktop/EcoBox` 下新建目录，原为空）
- 启动：`npm run dev`（开发）/ `npm run build && npm run preview`（正式构建预览 :4173）
- 测试：`npm test`（Vitest 核心规则）/ `npm run test:long`（10 种子长测）/ `npm run sim:batch` / `npm run sim:bench`

## 环境事实
- Node v24.18.0 / npm 11.16.0 / git 2.50.1 / gh 2.97.0
- gh 已登录账号 **kiva-9**（scopes: gist, read:org, repo），Git 协议 ssh
- 浏览器：Google Chrome.app、ego lite.app（Ego-Browser）
- 依赖锁定：vite 8.3.6 / typescript 7.0.2 / pixi.js 8.22.0 / react 19.3.1 / vitest 5.1.0 / @vitejs/plugin-react 6.2.1

## GitHub 交付（已完成）
- 仓库：**https://github.com/kiva-9/ecobox**（PRIVATE，默认分支 main，属主 kiva-9）
- 创建命令：`gh repo create ecobox --private --source=. --remote=origin --push`
- 最终提交：**2c3c1ec36b9fdfb473c698d2e6d985297f39a1fa**（本地 HEAD = 远端 main = 验收克隆 HEAD）
- 干净克隆验收（/tmp/ecobox-clone）：SHA 一致 → `npm ci` → `npm run typecheck` 通过 → `npm test` 35/35 通过 →
  `npm run build` 通过（sim.worker 产物齐全）→ `vite preview` 服务 → 浏览器冒烟（创建世界、模拟运行、tick 249、220 个体）
- 验收截图：screenshots/26-clean-clone.png

## 已完成
- [x] 环境预检（Node/npm/git/gh/浏览器/网络）
- [x] gh 认证状态核实（kiva-9，repo scope）
- [x] 参考资料研究（两个研究子代理，全部指定 URL 实际访问成功，详见 docs/REFERENCES.md）
- [x] 工程骨架：package.json / tsconfig(严格) / vite.config / vitest.config / index.html / .gitignore

## 正在进行
- [ ] 模拟核心（rng/config/types/world/spatial/plants/creatures/simulation/serialize/challenges/presets）
- [ ] Worker 协议与前后端分离
- [ ] PixiJS 渲染器 + React UI
- [ ] 测试与长测
- [ ] 三关挑战数值冻结
- [ ] E2E 浏览器验收
- [ ] 性能基准
- [ ] 文档（DESIGN/REFERENCES/VALIDATION/README）
- [ ] GitHub 推送与干净克隆验收

## 未完成/失败验收列表
（暂无——随验收发现持续记录）

## 关键设计决策记录
1. 单亲无性繁殖（游戏内说明），基因 copy + 低概率高斯突变（参考 Nature of Code bloop 与 biosim4 pointMutationRate 同量级）。
2. 死亡=选择：无 fitness 函数，寿命决定繁殖机会（Nature of Code 生态示例立场）。
3. 能量经济学：每 tick 基础代谢+移动+感知成本；进食回能；归零死亡。
4. 连续生态过程：不做离散世代清空重建。
5. 基因经 map(gene,0,1,min,max) 落到具名行为参数，不做神经网络编译（可解释性底线）。
6. 植物分块错峰更新（每 tile 每 8 tick 更新一次，8× 速率补偿），保证 10 万步长测可行。
7. 存档用 JSON 精确浮点（Float32→double round-trip 精确），保证存档续推与倍速一致性。
8. 空间哈希 + 确定性排序（距离,ID）保证同种子可复现。
