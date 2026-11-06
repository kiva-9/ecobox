// 新世界弹窗：种子输入、随机种子、预设选择。

import { useState } from 'react';
import { client } from '../../game/client';
import { PRESETS } from '../../sim/config';
import { Species } from '../../sim/constants';
import { Modal } from '../Modal';
import { PixelIcon } from '../sprites';
import { fmtInt } from '../format';

const SEED_MAX = 2 ** 31 - 1;

function randomSeed(): string {
  return String(Math.floor(Math.random() * SEED_MAX));
}

export interface NewWorldModalProps {
  onClose: () => void;
}

export function NewWorldModal({ onClose }: NewWorldModalProps): React.ReactElement {
  const [seedText, setSeedText] = useState('');
  const [presetId, setPresetId] = useState<string>(PRESETS[0].id);

  const start = (): void => {
    const trimmed = seedText.trim();
    let seed = trimmed === '' ? Math.floor(Math.random() * SEED_MAX) : Number.parseInt(trimmed, 10);
    if (!Number.isFinite(seed)) seed = Math.floor(Math.random() * SEED_MAX);
    seed = Math.abs(Math.trunc(seed)) % SEED_MAX;
    client.newWorld(seed, presetId);
    onClose();
  };

  const seedValid = seedText.trim() === '' || /^\d+$/.test(seedText.trim());

  return (
    <Modal
      title="开始新世界"
      icon="spark"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="muted" style={{ fontSize: 12 }}>
            相同种子 + 相同预设 + 相同干预 = 完全相同的演化
          </span>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn--primary" onClick={start} disabled={!seedValid}>
            <PixelIcon name="play" size={14} />
            开始
          </button>
        </>
      }
    >
      <div className="section-title">
        <PixelIcon name="dice" size={13} /> 世界种子
      </div>
      <div className="row">
        <input
          className="input grow"
          value={seedText}
          onChange={(e) => setSeedText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && seedValid) start();
          }}
          placeholder="留空则随机生成"
          inputMode="numeric"
          aria-label="世界种子"
          title="种子决定地形与初始种群；留空则随机"
        />
        <button className="btn btn--sm" onClick={() => setSeedText(randomSeed())} title="随机生成一个种子">
          <PixelIcon name="dice" size={14} />
          随机种子
        </button>
      </div>
      {!seedValid ? (
        <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>种子只能是数字（0 – {fmtInt(SEED_MAX)}）。</p>
      ) : null}

      <div className="section-title">
        <PixelIcon name="tabWorld" size={13} /> 预设
      </div>
      <div className="menu-grid">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            className={`preset-card${presetId === p.id ? ' is-active' : ''}`}
            onClick={() => setPresetId(p.id)}
            aria-pressed={presetId === p.id}
            title={p.desc}
          >
            <span className="preset-card__name">
              <PixelIcon name={p.id === 'arid' ? 'arid' : p.id === 'meadow' ? 'meadow' : 'woodland'} size={16} />
              {p.name}
            </span>
            <span className="preset-card__desc">{p.desc}</span>
            <span className="preset-card__meta">
              小食草 {p.initialCounts.find((c) => c.species === Species.SmallHerb)?.count ?? 0} · 大食草{' '}
              {p.initialCounts.find((c) => c.species === Species.LargeHerb)?.count ?? 0} · 捕食者{' '}
              {p.initialCounts.find((c) => c.species === Species.Predator)?.count ?? 0} · 食腐者{' '}
              {p.initialCounts.find((c) => c.species === Species.Scavenger)?.count ?? 0}
              {p.randomDrought ? ' · 可能随机干旱' : ''}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
