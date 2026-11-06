// 右侧标签面板：个体 / 谱系 / 数据 / 挑战 / 世界（可折叠）。

import { useEffect, useRef, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { client } from '../game/client';
import type { Blueprint } from '../sim/types';
import { CreaturePanel } from './CreaturePanel';
import { LineagePanel } from './LineagePanel';
import { DataPanel } from './DataPanel';
import { ChallengePanel } from './ChallengePanel';
import { WorldPanel } from './WorldPanel';
import { PixelIcon } from './sprites';
import type { SpriteName } from './sprites';

export type PanelTab = 'creature' | 'lineage' | 'data' | 'challenge' | 'world';

const TABS: { key: PanelTab; label: string; sprite: SpriteName }[] = [
  { key: 'creature', label: '个体', sprite: 'tabCreature' },
  { key: 'lineage', label: '谱系', sprite: 'tabLineage' },
  { key: 'data', label: '数据', sprite: 'tabData' },
  { key: 'challenge', label: '挑战', sprite: 'tabChallenge' },
  { key: 'world', label: '世界', sprite: 'tabWorld' },
];

export interface SidePanelProps {
  open: boolean;
  onToggle: () => void;
  onArmBlueprint: (bp: Blueprint) => void;
  onChooseTool: (tool: number) => void;
  onError: (err: { title: string; message: string }) => void;
}

export function SidePanel(props: SidePanelProps): React.ReactElement {
  const { open, onToggle, onArmBlueprint, onChooseTool, onError } = props;
  const [tab, setTab] = useState<PanelTab>('creature');
  const panel = useSyncExternalStore(client.subscribePanel, client.getPanelSnapshot);
  const lastStatus = useRef<string | null | undefined>(undefined);

  // 挑战开始时自动切到挑战页
  useEffect(() => {
    const status = panel.challenge?.status ?? null;
    if (status === lastStatus.current) return;
    const prev = lastStatus.current;
    lastStatus.current = status;
    if (status === 'running' && prev !== 'running') setTab('challenge');
  }, [panel.challenge?.status]);

  if (!open) {
    return (
      <aside className="sidepanel is-collapsed" aria-label="侧边面板已折叠">
        <div className="sidepanel__tabs">
          <button className="tabbtn" onClick={onToggle} title="展开侧边面板" aria-label="展开侧边面板">
            <PixelIcon name="tabData" size={18} />
            <span>展开</span>
          </button>
        </div>
        <div className="sidepanel__collapsedbar">
          {TABS.map((t) => (
            <button
              key={t.key}
              className="tabbtn"
              onClick={() => {
                setTab(t.key);
                onToggle();
              }}
              title={`${t.label}面板`}
              aria-label={`打开${t.label}面板`}
            >
              <PixelIcon name={t.sprite} size={18} />
            </button>
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidepanel" aria-label="侧边面板">
      <div className="sidepanel__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`tabbtn${tab === t.key ? ' is-active' : ''}`}
            onClick={() => setTab(t.key)}
            title={`${t.label}面板`}
          >
            <PixelIcon name={t.sprite} size={17} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div className="sidepanel__body" role="tabpanel">
        {tab === 'creature' ? <CreaturePanel /> : null}
        {tab === 'lineage' ? <LineagePanel /> : null}
        {tab === 'data' ? <DataPanel /> : null}
        {tab === 'challenge' ? <ChallengePanel /> : null}
        {tab === 'world' ? (
          <WorldPanel onArmBlueprint={onArmBlueprint} onChooseTool={onChooseTool} onError={onError} />
        ) : null}
      </div>
      <button className="sidepanel__collapse" onClick={onToggle} title="折叠侧边面板，扩大场景视野">
        <PixelIcon name="close" size={12} />
        折叠面板
      </button>
    </aside>
  );
}
