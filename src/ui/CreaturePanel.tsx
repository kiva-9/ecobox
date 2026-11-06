// 个体面板：选中个体的全字段档案。

import { useSyncExternalStore } from 'react';
import { client } from '../game/client';
import { GENE_DEFS, speciesParams } from '../sim/config';
import { behaviorName, speciesName } from '../sim/constants';
import type { Genes } from '../sim/types';
import { PixelIcon } from './sprites';
import type { SpriteName } from './sprites';
import { fmtGene, fmtInt } from './format';

export function speciesSprite(species: number): SpriteName {
  switch (species) {
    case 0:
      return 'herbS';
    case 1:
      return 'herbL';
    case 2:
      return 'pred';
    case 3:
      return 'scav';
    default:
      return 'tabCreature';
  }
}

function energyClass(ratio: number): string {
  if (ratio > 0.5) return 'bar__fill';
  if (ratio > 0.2) return 'bar__fill bar__fill--warn';
  return 'bar__fill bar__fill--danger';
}

function GeneRows({ genes }: { genes: Genes }): React.ReactElement {
  return (
    <div>
      {GENE_DEFS.map((def) => {
        const v = genes[def.key as keyof Genes];
        return (
          <div className="gene-row" key={def.key} title={`${def.gain}\n代价：${def.cost}`}>
            <div className="gene-row__head">
              <span className="gene-row__name">{def.name}</span>
              <span className="gene-row__val">{fmtGene(v)}</span>
            </div>
            <div className="gene-row__bar">
              <span className="gene-row__fill" style={{ left: 0, width: `${v * 100}%` }} />
            </div>
          </div>
        );
      })}
      <details className="details">
        <summary>六项基因的收益与代价</summary>
        <div className="details__body">
          {GENE_DEFS.map((def) => (
            <p key={def.key} style={{ margin: '0 0 6px' }}>
              <b>{def.name}</b>（{genes[def.key as keyof Genes].toFixed(2)}）
              <br />
              <span className="gain">收益：{def.gain}</span>
              <br />
              <span className="cost">代价：{def.cost}</span>
            </p>
          ))}
        </div>
      </details>
    </div>
  );
}

export function CreaturePanel(): React.ReactElement {
  const panel = useSyncExternalStore(client.subscribePanel, client.getPanelSnapshot);
  const sel = panel.selected;

  if (!sel) {
    return (
      <div className="empty">
        <PixelIcon name="cursor" size={36} />
        <div>尚未选择个体</div>
        <div className="muted">点击场景中的生物，即可查看它的基因、行为原因与谱系。</div>
        <button
          className="btn btn--sm"
          onClick={() => {
            const c = client.latest?.creatures;
            if (c && c.count > 0) {
              const i = Math.floor(Math.random() * c.count);
              client.select(c.id[i]);
            } else {
              client.toast('info', '场景中还没有生物，先播种或等待繁殖');
            }
          }}
          title="随机选择一个存活个体进行观察"
        >
          <PixelIcon name="dice" size={14} />
          随机观察一个
        </button>
      </div>
    );
  }

  const energyRatio = sel.maxEnergy > 0 ? sel.energy / sel.maxEnergy : 0;
  const maturity = speciesParams(sel.species).maturity;
  const matureRatio = Math.min(1, sel.age / Math.max(1, maturity));
  const ageRatio = sel.maxAge > 0 ? Math.min(1, sel.age / sel.maxAge) : 0;

  return (
    <div className="panel panel--tight">
      <div className="panel__head">
        <PixelIcon name={speciesSprite(sel.species)} size={18} />
        <span className="panel__title">{speciesName(sel.species)}</span>
        <span className="mono" style={{ fontSize: 12 }}>
          #{sel.id}
        </span>
        <span className="grow" />
        {sel.artificial ? (
          <span className="tag tag--artificial" title="该个体由玩家人工投放产生，不来自自然繁殖">
            人工干预
          </span>
        ) : null}
      </div>
      <div className="panel__body">
        <div className="section-title">
          <PixelIcon name="eye" size={13} /> 状态
        </div>
        <div className="reason-box">
          <PixelIcon name="info" size={14} />
          <span>
            {behaviorName(sel.state)}：{sel.reason || '（暂无行为说明）'}
          </span>
        </div>
        <div className="kv">
          <span className="kv__k">位置</span>
          <span className="kv__v mono">
            {sel.x.toFixed(1)}, {sel.y.toFixed(1)}
          </span>
          <span className="kv__k">状态</span>
          <span className="kv__v">{behaviorName(sel.state)}</span>
          <span className="kv__k">年龄</span>
          <span className="kv__v mono">
            {fmtInt(sel.age)} / {fmtInt(sel.maxAge)} tick
          </span>
          <span className="kv__k">成熟度</span>
          <span className="kv__v">{sel.mature ? '已成年' : `成长中 ${Math.round(matureRatio * 100)}%`}</span>
          <span className="kv__k">繁殖冷却</span>
          <span className="kv__v mono">{fmtInt(sel.reproCooldown)} tick</span>
          <span className="kv__k">上次进食</span>
          <span className="kv__v mono">{sel.lastMealTick > 0 ? `tick ${fmtInt(sel.lastMealTick)}` : '尚未进食'}</span>
        </div>

        <div className="section-title">
          <PixelIcon name="spark" size={13} /> 能量
        </div>
        <div className="bar" title={`能量 ${sel.energy.toFixed(1)} / ${sel.maxEnergy.toFixed(1)} EU`}>
          <span className={energyClass(energyRatio)} style={{ width: `${Math.max(0, Math.min(100, energyRatio * 100))}%` }} />
          <span className="bar__label">
            {sel.energy.toFixed(0)} / {sel.maxEnergy.toFixed(0)} EU · {Math.round(energyRatio * 100)}%
          </span>
        </div>
        <div className="bar" style={{ marginTop: 6, height: 10 }} title={`寿命进度 ${Math.round(ageRatio * 100)}%`}>
          <span className="bar__fill bar__fill--accent" style={{ width: `${ageRatio * 100}%` }} />
          <span className="bar__label">寿命 {Math.round(ageRatio * 100)}%</span>
        </div>

        <div className="section-title">
          <PixelIcon name="dna" size={13} /> 基因（出生时确定，终身不变）
        </div>
        <GeneRows genes={sel.genes} />

        <div className="section-title">
          <PixelIcon name="tabData" size={13} /> 表现型（由基因与物种决定）
        </div>
        <div className="kv">
          <span className="kv__k">最大速度</span>
          <span className="kv__v mono">{sel.maxSpeed.toFixed(3)} tile/tick</span>
          <span className="kv__k">成年体型</span>
          <span className="kv__v mono">{sel.adultSize.toFixed(2)} tile</span>
          <span className="kv__k">感知半径</span>
          <span className="kv__v mono">{sel.senseRadius.toFixed(2)} tile</span>
          <span className="kv__k">当前体型</span>
          <span className="kv__v mono">{sel.currentSize.toFixed(2)} tile</span>
        </div>

        <div className="section-title">
          <PixelIcon name="tabLineage" size={13} /> 亲代与谱系
        </div>
        <div className="kv">
          <span className="kv__k">亲代</span>
          <span className="kv__v">{sel.parentId >= 0 ? `#${sel.parentId}` : '初代（无亲代）'}</span>
          <span className="kv__k">谱系</span>
          <span className="kv__v">#{sel.lineageId}</span>
          <span className="kv__k">代数</span>
          <span className="kv__v">第 {sel.generation} 代</span>
          <span className="kv__k">出生 tick</span>
          <span className="kv__v mono">{fmtInt(sel.birthTick)}</span>
          <span className="kv__k">后代数</span>
          <span className="kv__v">{fmtInt(sel.kids)}</span>
          {sel.deathTick > 0 ? (
            <>
              <span className="kv__k">死亡</span>
              <span className="kv__v mono">tick {fmtInt(sel.deathTick)}</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
