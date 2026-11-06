// 顶栏：世界信息、模拟时间、实际速度、FPS、种群徽章、干预剩余与全局动作。

import { useRef } from 'react';
import { client } from '../game/client';
import { challengeById, presetById } from '../sim/config';
import { speciesShort } from '../sim/constants';
import type { PanelData } from '../game/client';
import { PALETTE } from '../shared/protocol';
import { PixelIcon } from './sprites';
import { dayOf, exportFilename, fmtInt, isDaytimeLight } from './format';

export interface TopBarProps {
  panel: PanelData;
  onError: (err: { title: string; message: string }) => void;
}

export function TopBar({ panel, onError }: TopBarProps): React.ReactElement {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const preset = presetById(panel.world.presetId);
  const ch = panel.challenge;
  const chCfg = ch ? challengeById(ch.id) : undefined;
  const day = dayOf(panel.tick);
  const daytime = isDaytimeLight(panel.light);
  const interventionsLeft = panel.interventionLeft ?? ch?.interventionsLeft ?? null;

  const onExport = async (): Promise<void> => {
    const json = await client.exportWorld();
    if (!json) {
      onError({
        title: '导出失败',
        message: '导出请求在 5 秒内没有返回数据。模拟线程可能正忙，请稍后重试；也可以先用存档槽保存。',
      });
      return;
    }
    client.downloadJson(exportFilename(panel.world.presetId, panel.world.seed, panel.tick), json);
    client.toast('success', '世界 JSON 已导出');
  };

  return (
    <header className="topbar">
      <div className="topbar__group">
        <button
          className="iconbtn"
          onClick={() => client.backToMenu()}
          title="返回主菜单（世界在后台继续运行）"
          aria-label="返回主菜单"
        >
          <PixelIcon name="menu" size={16} />
        </button>
      </div>

      <div className="topbar__group topbar__info">
        <div>
          <b>{preset?.name ?? panel.world.presetId}</b>
          <span className="muted"> · 种子 </span>
          <span className="mono">{panel.world.seed}</span>
        </div>
        <div className="muted">
          {panel.world.mode === 'challenge' ? `挑战模式 · ${ch?.name ?? panel.world.challengeId ?? ''}` : '沙盒模式'}
        </div>
      </div>

      <div className="topbar__group topbar__group--sep">
        <span className="chip chip--num" title="模拟步数（tick）">
          <PixelIcon name="clock" size={13} />
          {fmtInt(panel.tick)}
        </span>
        <span className="chip" title={`模拟时间：一天 = 2400 tick · 当前光照 ${Math.round(panel.light * 100)}%`}>
          <PixelIcon name={daytime ? 'sun' : 'moon'} size={13} />
          第 {day} 天 · {daytime ? '昼' : '夜'}
        </span>
        <span className="chip chip--num" title="实际模拟速度（每秒完成的 tick 数）">
          {panel.tick < 30 ? '—' : Math.round(panel.actualTps)} tick/s
        </span>
        <span className="chip chip--num" title="画面帧率">
          {Math.round(panel.fps)} FPS
        </span>
      </div>

      <div className="topbar__group topbar__group--sep" title="种群计数（四种动物）">
        {panel.counts.map((n, i) => (
          <span className="badge" key={i} title={`${speciesShort(i)}存活数`}>
            <span className="badge__dot" style={{ background: PALETTE.species[i] }} />
            {speciesShort(i)} {fmtInt(n)}
          </span>
        ))}
      </div>

      {ch ? (
        <span
          className={`chip chip--num${interventionsLeft === 0 ? '' : ''}`}
          title="挑战剩余干预配额（每次干预消耗 1 点）"
          style={interventionsLeft === 0 ? { borderColor: 'var(--danger)', color: 'var(--danger)' } : undefined}
        >
          <PixelIcon name="spark" size={13} />
          干预 {interventionsLeft ?? '—'}/{chCfg?.interventions ?? '—'}
        </span>
      ) : null}

      <span className="topbar__spacer" />

      <div className="topbar__group">
        <button
          className="iconbtn"
          onClick={() => client.openModal('saveLoad', { tab: 'save' })}
          title="保存世界（H 查看快捷键）"
          aria-label="保存世界"
        >
          <PixelIcon name="save" size={16} />
        </button>
        <button
          className="iconbtn"
          onClick={() => client.openModal('saveLoad', { tab: 'load' })}
          title="读取存档"
          aria-label="读取存档"
        >
          <PixelIcon name="load" size={16} />
        </button>
        <button className="iconbtn" onClick={() => void onExport()} title="导出世界 JSON" aria-label="导出世界 JSON">
          <PixelIcon name="export" size={16} />
        </button>
        <button
          className="iconbtn"
          onClick={() => fileRef.current?.click()}
          title="导入世界 JSON"
          aria-label="导入世界 JSON"
        >
          <PixelIcon name="import" size={16} />
        </button>
        <button className="iconbtn" onClick={() => client.openModal('help')} title="帮助与快捷键（H）" aria-label="帮助">
          <PixelIcon name="help" size={16} />
        </button>
        <button className="iconbtn" onClick={() => client.openModal('settings')} title="设置" aria-label="设置">
          <PixelIcon name="settings" size={16} />
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          void client.importWorldFile(file).then((res) => {
            if (!res.ok) {
              onError({
                title: '导入失败',
                message: `${res.error ?? '文件无法解析'}\n请确认这是本游戏导出的世界 JSON（格式 ecobox-world）。当前世界未受影响。`,
              });
            }
          });
        }}
      />
    </header>
  );
}
