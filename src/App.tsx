// App 根组件：阶段路由（菜单/游戏）、全局快捷键、弹窗与 Toast 宿主、蓝图装备。

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { client } from './game/client';
import type { Blueprint } from './sim/types';
import { GameScreen } from './ui/GameScreen';
import type { CanvasApi } from './ui/GameCanvas';
import { MainMenu } from './ui/MainMenu';
import { ModalHost } from './ui/ModalHost';
import { ErrorModal } from './ui/ErrorModal';
import { Toasts } from './ui/Toasts';
import { spawnToolForSpecies } from './ui/tools';
import { peekStoredLists } from './ui/storagePeek';

export interface ErrorInfo {
  title: string;
  message: string;
}

export function App(): React.ReactElement {
  const state = useSyncExternalStore(client.subscribeUi, client.getUiSnapshot);
  const canvasApiRef = useRef<CanvasApi | null>(null);
  const [armedBlueprint, setArmedBlueprint] = useState<Blueprint | null>(null);
  const [errorModal, setErrorModal] = useState<ErrorInfo | null>(null);
  const pendingArmRef = useRef<Blueprint | null>(null);

  // 供事件处理器读取最新结构状态（避免重复绑定监听）
  const stateRef = useRef(state);
  stateRef.current = state;
  const errorModalRef = useRef(errorModal);
  errorModalRef.current = errorModal;

  // ---------------------------------------------------------- 蓝图装备

  const armBlueprint = useCallback((bp: Blueprint): void => {
    const tool = spawnToolForSpecies(bp.species);
    if (tool == null) {
      client.toast('warn', `蓝图「${bp.name}」的物种无法投放`);
      return;
    }
    setArmedBlueprint(bp);
    client.setTool(tool);
    if (stateRef.current.phase !== 'playing') {
      // 菜单中：先记录，进入世界后自动装备
      pendingArmRef.current = bp;
      client.toast('info', `蓝图「${bp.name}」已准备，开始或继续一个世界后即可投放`);
    } else {
      client.toast('info', `已装备蓝图「${bp.name}」，点击场景投放`);
    }
  }, []);

  const chooseTool = useCallback((tool: number): void => {
    client.setTool(tool);
    setArmedBlueprint((prev) => (prev && tool !== spawnToolForSpecies(prev.species) ? null : prev));
  }, []);

  useEffect(() => {
    if (state.phase === 'playing' && pendingArmRef.current) {
      const bp = pendingArmRef.current;
      pendingArmRef.current = null;
      armBlueprint(bp);
    }
  }, [state.phase, armBlueprint]);

  // ---------------------------------------------------------- 首次引导

  const guidePromptedRef = useRef(false);
  useEffect(() => {
    if (state.phase === 'playing' && !state.prefs.guideDone && !guidePromptedRef.current) {
      guidePromptedRef.current = true;
      client.openModal('guide');
    }
  }, [state.phase, state.prefs.guideDone]);

  // ---------------------------------------------------------- 启动时补齐本地列表

  const peekedRef = useRef(false);
  useEffect(() => {
    if (peekedRef.current) return;
    peekedRef.current = true;
    // client 只在进入世界后才拉取存档/蓝图列表；菜单阶段直接只读 IndexedDB 补齐
    void peekStoredLists();
  }, []);

  // ---------------------------------------------------------- 标签页可见性 → worker

  useEffect(() => {
    const postVisibility = (): void => client.setVisibility(!document.hidden);
    const onVisibility = (): void => postVisibility();
    const onFocus = (): void => postVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // ---------------------------------------------------------- 全局快捷键

  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      const target = ev.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      const st = stateRef.current;

      if (ev.key === 'Escape') {
        if (typing) {
          target?.blur();
          return;
        }
        // 错误弹窗自带 Esc 处理，避免重复触发取消选择
        if (errorModalRef.current) return;
        if (st.modal === 'guide') {
          client.markGuideDone();
          return;
        }
        if (st.modal) {
          client.closeModal();
          return;
        }
        if (st.trackId != null) {
          client.setTrackId(null);
          return;
        }
        if (client.latest?.selected) {
          client.select(null);
          return;
        }
        return;
      }

      if (typing || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (st.phase !== 'playing' || st.modal) return;

      switch (ev.key) {
        case ' ':
          ev.preventDefault();
          client.toggleRun();
          break;
        case 'ArrowRight':
          ev.preventDefault();
          client.stepOnce();
          break;
        case '1':
          client.setSpeed(1);
          break;
        case '2':
          client.setSpeed(2);
          break;
        case '3':
          client.setSpeed(5);
          break;
        case '4':
          client.setSpeed(10);
          break;
        case '+':
        case '=':
          canvasApiRef.current?.zoomBy(1.25);
          break;
        case '-':
        case '_':
          canvasApiRef.current?.zoomBy(0.8);
          break;
        case 'g':
        case 'G':
          client.setOverlay({ vegetation: !st.overlay.vegetation });
          break;
        case 'h':
        case 'H':
          client.openModal('help');
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---------------------------------------------------------- 挑战结算弹窗

  const panel = useSyncExternalStore(client.subscribePanel, client.getPanelSnapshot);
  const lastChallengeStatus = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const status = panel.challenge?.status ?? null;
    if (status === lastChallengeStatus.current) return;
    const prev = lastChallengeStatus.current;
    lastChallengeStatus.current = status;
    if ((status === 'success' || status === 'fail') && prev !== status) {
      client.openModal('challengeResult');
    }
  }, [panel.challenge?.status]);

  // ---------------------------------------------------------- 渲染

  return (
    <div className="app">
      {state.phase === 'menu' ? (
        <MainMenu onArmBlueprint={armBlueprint} onError={setErrorModal} />
      ) : (
        <GameScreen
          canvasApiRef={canvasApiRef}
          armedBlueprint={armedBlueprint}
          onArmBlueprint={armBlueprint}
          onChooseTool={chooseTool}
          onError={setErrorModal}
        />
      )}
      <ModalHost onError={setErrorModal} />
      {errorModal ? (
        <ErrorModal
          title={errorModal.title}
          message={errorModal.message}
          onClose={() => setErrorModal(null)}
        />
      ) : null}
      <Toasts />
    </div>
  );
}
