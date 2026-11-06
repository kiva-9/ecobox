// client.ts 契约缺口的 UI 侧补偿（不修改 client.ts）：
//  1) client.loadSlot 不切换 phase：读取存档后由 UI 进入游戏阶段；
//  2) client 只提供 markGuideDone()（置 true），没有通用偏好写入：
//     设置里的「引导重置」需要把 guideDone 置回 false。
// 两者都通过替换 client.state 对象并借用 setTrackId() 触发一次 UI 通知完成
// （setTrackId 会写入同名trackId 值并 notifyUi，是 client 上唯一的公开通知入口）。

import { client } from '../game/client';
import type { Prefs, WorkerRequest } from '../shared/protocol';

const PREFS_KEY = 'ecobox.prefs.v1';

/** 进入游戏阶段（读取存档后调用；随后 client.loadSlot 的 busy patch 会保留该阶段） */
export function enterPlayingPhase(): void {
  if (client.state.phase === 'playing') return;
  client.state = { ...client.state, phase: 'playing', modal: null, modalData: null };
  client.setTrackId(client.state.trackId);
}

/** 写入偏好（localStorage + client.state），并触发 UI 刷新 */
export function patchPrefs(patch: Partial<Prefs>): void {
  const next: Prefs = { ...client.state.prefs, ...patch };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式等场景下忽略 */
  }
  client.state = { ...client.state, prefs: next };
  client.setTrackId(client.state.trackId);
}

/**
 * client.ts 未暴露 confirmChallengeBrief（briefing → running）。
 * worker 的 confirmChallengeBrief 消息是挑战从"简报"进入"进行中"的唯一途径，
 * 否则干预会被模拟以「挑战未在进行中」拒绝。
 * GameClient.worker 是 TS private（仅编译期约束），运行时是普通实例属性，这里直接投递。
 * 集成时若 client.ts 增加公开方法（如 confirmChallengeBrief()），应改调该方法。
 */
export function confirmChallengeBrief(): void {
  const w = (client as unknown as { worker?: Worker | null }).worker;
  if (!w) return;
  w.postMessage({ type: 'confirmChallengeBrief' } satisfies WorkerRequest);
}

/** 开始挑战并立即确认简报（进入进行中） */
export function startChallengeConfirmed(challengeId: string): void {
  client.startChallenge(challengeId);
  confirmChallengeBrief();
}

/** 重试挑战并立即确认简报（重试后状态同样回到 briefing） */
export function retryChallengeConfirmed(): void {
  client.retryChallenge();
  confirmChallengeBrief();
}
