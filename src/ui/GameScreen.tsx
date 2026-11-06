// 游戏界面骨架：顶栏 + 画布 + 右侧标签面板 + 底部工具栏。

import { useState } from 'react';
import type { RefObject } from 'react';
import { useSyncExternalStore } from 'react';
import { client } from '../game/client';
import type { Blueprint } from '../sim/types';
import { GameCanvas } from './GameCanvas';
import type { CanvasApi } from './GameCanvas';
import { TopBar } from './TopBar';
import { ToolBar } from './ToolBar';
import { SidePanel } from './SidePanel';
import { PixelIcon } from './sprites';

export interface GameScreenProps {
  canvasApiRef: RefObject<CanvasApi | null>;
  armedBlueprint: Blueprint | null;
  onArmBlueprint: (bp: Blueprint) => void;
  onChooseTool: (tool: number) => void;
  onError: (err: { title: string; message: string }) => void;
}

export function GameScreen(props: GameScreenProps): React.ReactElement {
  const { canvasApiRef, armedBlueprint, onArmBlueprint, onChooseTool, onError } = props;
  const state = useSyncExternalStore(client.subscribeUi, client.getUiSnapshot);
  const panel = useSyncExternalStore(client.subscribePanel, client.getPanelSnapshot);
  const [panelOpen, setPanelOpen] = useState(true);

  return (
    <div className="game-shell">
      <TopBar panel={panel} onError={onError} />

      {panel.capacityWarning ? (
        <div className="capacity-banner" role="status">
          <PixelIcon name="warn" size={14} />
          <span className="grow">{panel.capacityWarning}</span>
        </div>
      ) : null}

      <div className="game-main">
        <GameCanvas
          tool={state.selectedTool}
          brushSize={state.brushSize}
          overlay={state.overlay}
          trackId={state.trackId}
          genes={armedBlueprint?.genes ?? null}
          onApi={(api) => {
            canvasApiRef.current = api;
          }}
        />
        <SidePanel
          open={panelOpen}
          onToggle={() => setPanelOpen((v) => !v)}
          onArmBlueprint={onArmBlueprint}
          onChooseTool={onChooseTool}
          onError={onError}
        />
      </div>

      <ToolBar
        state={state}
        panel={panel}
        canvasApiRef={canvasApiRef}
        onChooseTool={onChooseTool}
      />

      {state.busy ? (
        <div className="stage-overlay stage-overlay--soft" style={{ position: 'fixed', zIndex: 30 }}>
          <span className="stage-overlay__text">世界切换中…</span>
        </div>
      ) : null}
    </div>
  );
}
