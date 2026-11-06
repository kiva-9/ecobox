// 底部工具栏：工具选择、笔刷、速度、缩放、叠加层、追踪与音量。

import type { RefObject } from 'react';
import { client } from '../game/client';
import type { PanelData } from '../game/client';
import type { ClientState, OverlayState } from '../shared/protocol';
import { PixelIcon } from './sprites';
import { TOOL_DEFS, TOOL_GROUP_LABELS } from './tools';
import type { ToolGroup } from './tools';
import type { CanvasApi } from './GameCanvas';

const SPEEDS = [1, 2, 5, 10] as const;
const GROUPS: ToolGroup[] = ['select', 'terrain', 'plant', 'climate', 'spawn'];

const OVERLAY_ITEMS: { key: keyof OverlayState; label: string; hint: string }[] = [
  { key: 'vegetation', label: '植被', hint: '叠加显示青草与浆果灌丛的分布（快捷键 G）' },
  { key: 'moisture', label: '水分', hint: '叠加显示土壤水分' },
  { key: 'nutrients', label: '养分', hint: '叠加显示土壤养分' },
  { key: 'activity', label: '活动', hint: '叠加显示生物近期活动热度' },
  { key: 'population', label: '种群', hint: '叠加显示种群密度分布' },
  { key: 'carcass', label: '残骸', hint: '叠加显示尸体与掉落物' },
];

export interface ToolBarProps {
  state: ClientState;
  panel: PanelData;
  canvasApiRef: RefObject<CanvasApi | null>;
  onChooseTool: (tool: number) => void;
}

export function ToolBar({ state, panel, canvasApiRef, onChooseTool }: ToolBarProps): React.ReactElement {
  const toggleTrack = (): void => {
    if (state.trackId != null) {
      client.setTrackId(null);
      client.toast('info', '已停止追踪');
      return;
    }
    if (panel.selected) {
      client.select(panel.selected.id);
      client.toast('info', `开始追踪 #${panel.selected.id}`);
    } else {
      client.toast('warn', '请先在场景中选择一个生物');
    }
  };

  return (
    <footer className="toolbar">
      <div className="toolbar__row">
        {GROUPS.map((group) => (
          <div className={`toolgroup${group === 'select' ? '' : ' toolgroup--sep'}`} key={group}>
            <span className="toolgroup__label">{TOOL_GROUP_LABELS[group]}</span>
            <div className="toolgrid">
              {TOOL_DEFS.filter((t) => t.group === group).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`toolbtn${state.selectedTool === t.id ? ' is-active' : ''}`}
                  title={t.hint}
                  aria-pressed={state.selectedTool === t.id}
                  onClick={() => onChooseTool(t.id)}
                >
                  <span className="toolbtn__icon">
                    <PixelIcon name={t.sprite} size={20} />
                  </span>
                  <span className="toolbtn__label">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="toolbar__row">
        <div className="toolgroup">
          <span className="toolgroup__label">笔刷</span>
          <input
            type="range"
            min={1}
            max={6}
            step={1}
            value={state.brushSize}
            onChange={(e) => client.setBrush(Number(e.target.value))}
            aria-label="笔刷大小"
            title={`笔刷半径：${state.brushSize} 格`}
          />
          <span className="slider__val">{state.brushSize}</span>
        </div>

        <div className="toolgroup toolgroup--sep">
          <span className="toolgroup__label">速度</span>
          <button
            className={`iconbtn${panel.running ? '' : ' is-active'}`}
            onClick={() => client.toggleRun()}
            title={panel.running ? '暂停（空格）' : '继续（空格）'}
            aria-pressed={!panel.running}
          >
            <PixelIcon name={panel.running ? 'pause' : 'play'} size={14} />
            {panel.running ? '暂停' : '继续'}
          </button>
          <button
            className="iconbtn"
            onClick={() => client.stepOnce()}
            title="单步：推进一步（→）"
            aria-label="单步"
            disabled={panel.running}
          >
            <PixelIcon name="step" size={14} />
          </button>
          {SPEEDS.map((s) => (
            <button
              key={s}
              className={`iconbtn iconbtn--wide${panel.speed === s && panel.running ? ' is-active' : ''}`}
              onClick={() => { client.setSpeed(s); if (!panel.running) client.resume(); }}
              title={`${s}× 速度`}
              aria-pressed={panel.speed === s}
            >
              {s}×
            </button>
          ))}
        </div>

        <div className="toolgroup toolgroup--sep">
          <span className="toolgroup__label">视图</span>
          <button
            className="iconbtn"
            onClick={() => canvasApiRef.current?.zoomBy(1.25)}
            title="放大（+）"
            aria-label="放大"
          >
            <PixelIcon name="zoomIn" size={14} />
          </button>
          <button
            className="iconbtn"
            onClick={() => canvasApiRef.current?.zoomBy(0.8)}
            title="缩小（-）"
            aria-label="缩小"
          >
            <PixelIcon name="zoomOut" size={14} />
          </button>
          <button
            className="iconbtn"
            onClick={() => canvasApiRef.current?.centerWorld()}
            title="视图回到世界中心"
            aria-label="回到世界中心"
          >
            <PixelIcon name="globe" size={14} />
          </button>
          <button
            className={`iconbtn${state.trackId != null ? ' is-active' : ''}`}
            onClick={toggleTrack}
            title={
              state.trackId != null
                ? '停止追踪'
                : panel.selected
                  ? '追踪选中的生物（镜头跟随）'
                  : '请先在场景中选择一个生物'
            }
            aria-pressed={state.trackId != null}
            disabled={state.trackId == null && !panel.selected}
          >
            <PixelIcon name="track" size={14} />
            追踪
          </button>
        </div>

        <div className="toolgroup toolgroup--sep">
          <span className="toolgroup__label">叠加层</span>
          {OVERLAY_ITEMS.map((o) => (
            <button
              key={o.key}
              className={`togglebtn${state.overlay[o.key] ? ' is-on' : ''}`}
              onClick={() => client.setOverlay({ [o.key]: !state.overlay[o.key] } as Partial<OverlayState>)}
              title={o.hint}
              aria-pressed={state.overlay[o.key]}
            >
              <span className="togglebtn__mark">{state.overlay[o.key] ? '✓' : '—'}</span>
              {o.label}
            </button>
          ))}
        </div>

        <div className="toolgroup toolgroup--sep">
          <span className="toolgroup__label">声音</span>
          <button
            className={`iconbtn${state.prefs.muted ? ' is-active' : ''}`}
            onClick={() => client.setMuted(!state.prefs.muted)}
            title={state.prefs.muted ? '取消静音' : '静音'}
            aria-pressed={state.prefs.muted}
            aria-label={state.prefs.muted ? '取消静音' : '静音'}
          >
            <PixelIcon name={state.prefs.muted ? 'mute' : 'vol'} size={14} />
          </button>
          <input
            type="range"
            className="slider--narrow"
            min={0}
            max={100}
            value={Math.round(state.prefs.volume * 100)}
            onChange={(e) => client.setVolume(Number(e.target.value) / 100)}
            aria-label="音量"
            title={`音量 ${Math.round(state.prefs.volume * 100)}%`}
          />
          <span className="slider__val">{state.prefs.muted ? '静音' : `${Math.round(state.prefs.volume * 100)}%`}</span>
        </div>
      </div>
    </footer>
  );
}
