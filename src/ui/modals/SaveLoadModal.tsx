// 存档管理弹窗：保存（自动 + 3 槽，覆盖需确认）与载入（含删除确认）。

import { useState } from 'react';
import { useSyncExternalStore } from 'react';
import { client } from '../../game/client';
import type { SaveSlotInfo } from '../../shared/protocol';
import { Modal } from '../Modal';
import { PixelIcon } from '../sprites';
import { enterPlayingPhase } from '../phase';
import { fmtClock, fmtInt } from '../format';

const SLOT_IDS = ['auto', 'slot1', 'slot2', 'slot3'] as const;

function slotName(id: string): string {
  switch (id) {
    case 'auto':
      return '自动存档';
    case 'slot1':
      return '槽位 1';
    case 'slot2':
      return '槽位 2';
    case 'slot3':
      return '槽位 3';
    default:
      return id;
  }
}

function meta(s: SaveSlotInfo): string {
  return `tick ${fmtInt(s.tick)} · ${fmtClock(s.savedAt)} · 人口 ${fmtInt(s.population)} · ${s.mode === 'challenge' ? '挑战' : '沙盒'}${s.challengeId ? `（${s.challengeId}）` : ''}`;
}

export interface SaveLoadModalProps {
  onClose: () => void;
  initialTab?: 'save' | 'load';
}

export function SaveLoadModal({ onClose, initialTab = 'save' }: SaveLoadModalProps): React.ReactElement {
  const state = useSyncExternalStore(client.subscribeUi, client.getUiSnapshot);
  const [tab, setTab] = useState<'save' | 'load'>(initialTab);
  const [pendingSlot, setPendingSlot] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const saves = state.saves;

  return (
    <Modal
      title="存档管理"
      icon="save"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="muted" style={{ fontSize: 12 }}>
            自动存档由模拟线程周期性写入；导入 / 导出见「世界」面板
          </span>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      <div className="row" style={{ marginBottom: 12 }}>
        <button className={`btn btn--sm${tab === 'save' ? ' is-active' : ''}`} onClick={() => setTab('save')} aria-pressed={tab === 'save'}>
          <PixelIcon name="save" size={14} />
          保存
        </button>
        <button className={`btn btn--sm${tab === 'load' ? ' is-active' : ''}`} onClick={() => setTab('load')} aria-pressed={tab === 'load'}>
          <PixelIcon name="load" size={14} />
          载入
        </button>
      </div>

      {state.storageError ? (
        <div className="storage-warn" style={{ marginBottom: 12, maxWidth: 'none' }}>
          <PixelIcon name="warn" size={14} />
          <span>
            本地存储不可用：{state.storageError}。此时无法保存，请改用「导出世界 JSON」备份。
          </span>
        </div>
      ) : null}

      {tab === 'save' ? (
        <div className="save-list">
          {SLOT_IDS.map((id) => {
            const existing = saves.find((s) => s.id === id);
            const confirming = pendingSlot === id;
            return (
              <div className="save-row" key={id}>
                <span className="save-item__icon">
                  <PixelIcon name={id === 'auto' ? 'clock' : 'save'} size={20} />
                </span>
                <span className="save-row__info">
                  <span className="save-row__name">{slotName(id)}</span>
                  <span className="save-row__meta">{existing ? meta(existing) : '空槽位'}</span>
                </span>
                {confirming ? (
                  <span className="save-row__actions">
                    <button
                      className="btn btn--sm btn--danger"
                      onClick={() => {
                        setPendingSlot(null);
                        client.saveSlot(id);
                      }}
                      >
                      确认覆盖
                    </button>
                    <button className="btn btn--sm btn--ghost" onClick={() => setPendingSlot(null)}>
                      取消
                    </button>
                  </span>
                ) : (
                  <button className="btn btn--sm" onClick={() => (existing ? setPendingSlot(id) : client.saveSlot(id))}>
                    {existing ? '覆盖保存' : '保存'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="save-list">
          {saves.length === 0 ? (
            <div className="chart__empty">暂无存档。先在「保存」标签页保存一个世界吧。</div>
          ) : (
            saves.map((s) => (
              <div className="save-row" key={s.id}>
                <span className="save-row__info">
                  <span className="save-row__name">{s.label || slotName(s.id)}</span>
                  <span className="save-row__meta">{meta(s)}</span>
                </span>
                {pendingDelete === s.id ? (
                  <span className="save-row__actions">
                    <button
                      className="btn btn--sm btn--danger"
                      onClick={() => {
                        setPendingDelete(null);
                        client.deleteSlot(s.id);
                      }}
                    >
                      确认删除
                    </button>
                    <button className="btn btn--sm btn--ghost" onClick={() => setPendingDelete(null)}>
                      取消
                    </button>
                  </span>
                ) : (
                  <span className="save-row__actions">
                    <button
                      className="btn btn--sm"
                      onClick={() => {
                        enterPlayingPhase();
                        client.loadSlot(s.id);
                        onClose();
                      }}
                    >
                      载入
                    </button>
                    <button
                      className="btn btn--sm btn--ghost"
                      onClick={() => setPendingDelete(s.id)}
                      title={`删除 ${s.label || slotName(s.id)}`}
                      aria-label={`删除 ${s.label || slotName(s.id)}`}
                    >
                      <PixelIcon name="close" size={12} />
                    </button>
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </Modal>
  );
}
