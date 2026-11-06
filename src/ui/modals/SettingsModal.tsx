// 设置弹窗：音量 / 静音 / 叠加层默认 / 引导重置。

import { useSyncExternalStore } from 'react';
import { client } from '../../game/client';
import type { OverlayState } from '../../shared/protocol';
import { Modal } from '../Modal';
import { PixelIcon } from '../sprites';
import { patchPrefs } from '../phase';
import { VERSION } from '../format';

const OVERLAY_ITEMS: { key: keyof OverlayState; label: string; hint: string }[] = [
  { key: 'vegetation', label: '植被', hint: '青草与浆果灌丛分布' },
  { key: 'moisture', label: '水分', hint: '土壤水分' },
  { key: 'nutrients', label: '养分', hint: '土壤养分' },
  { key: 'activity', label: '活动', hint: '生物近期活动热度' },
  { key: 'population', label: '种群', hint: '种群密度分布' },
  { key: 'carcass', label: '残骸', hint: '尸体与掉落物' },
];

export interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps): React.ReactElement {
  const state = useSyncExternalStore(client.subscribeUi, client.getUiSnapshot);
  const prefs = state.prefs;

  return (
    <Modal
      title="设置"
      icon="settings"
      onClose={onClose}
      footer={
        <>
          <span className="muted" style={{ fontSize: 12 }}>
            设置会自动保存在本浏览器中
          </span>
          <span className="grow" />
          <button className="btn btn--primary" onClick={onClose}>
            完成
          </button>
        </>
      }
    >
      <div className="section-title">
        <PixelIcon name="vol" size={13} /> 声音
      </div>
      <div className="row row--wrap">
        <button
          className={`btn btn--sm${prefs.muted ? ' is-active' : ''}`}
          onClick={() => client.setMuted(!prefs.muted)}
          title={prefs.muted ? '取消静音' : '静音'}
          aria-pressed={prefs.muted}
        >
          <PixelIcon name={prefs.muted ? 'mute' : 'vol'} size={14} />
          {prefs.muted ? '已静音' : '静音'}
        </button>
        <span className="slider grow">
          <span className="toolgroup__label">音量</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(prefs.volume * 100)}
            onChange={(e) => client.setVolume(Number(e.target.value) / 100)}
            aria-label="音量"
            title={`音量 ${Math.round(prefs.volume * 100)}%`}
          />
          <span className="slider__val">{prefs.muted ? '静音' : `${Math.round(prefs.volume * 100)}%`}</span>
        </span>
      </div>

      <div className="section-title">
        <PixelIcon name="tabData" size={13} /> 叠加层默认
      </div>
      <div className="row row--wrap">
        {OVERLAY_ITEMS.map((o) => (
          <button
            key={o.key}
            className={`togglebtn${state.overlay[o.key] ? ' is-on' : ''}`}
            onClick={() => client.setOverlay({ [o.key]: !state.overlay[o.key] } as Partial<OverlayState>)}
            title={`默认${state.overlay[o.key] ? '关闭' : '开启'}：${o.hint}`}
            aria-pressed={state.overlay[o.key]}
          >
            <span className="togglebtn__mark">{state.overlay[o.key] ? '✓' : '—'}</span>
            {o.label}
          </button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        叠加层开关会记住你的选择，新世界也会沿用。
      </p>

      <div className="section-title">
        <PixelIcon name="help" size={13} /> 引导
      </div>
      <div className="row row--wrap">
        <button
          className="btn btn--sm"
          onClick={() => {
            patchPrefs({ guideDone: false });
            client.openModal('guide');
            onClose();
          }}
          title="重新观看首次引导（下次进入世界也会自动播放）"
        >
          <PixelIcon name="reset" size={14} />
          重看首次引导
        </button>
        {prefs.guideDone ? (
          <span className="tag tag--ok">引导已完成</span>
        ) : (
          <span className="tag tag--warn">引导尚未完成</span>
        )}
      </div>

      <div className="section-title">
        <PixelIcon name="info" size={13} /> 关于
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        微境 {VERSION} · 单机运行，模拟在 Web Worker 中进行，画面由 PixiJS 渲染。
        存档与蓝图保存在浏览器本地存储中。
      </p>
    </Modal>
  );
}
