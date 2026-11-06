// 谱系面板：三代追溯 + 所属谱系汇总。

import { useSyncExternalStore } from 'react';
import { client } from '../game/client';
import { deathCauseName, speciesName } from '../sim/constants';
import type { SelectedDetail } from '../shared/protocol';
import { PixelIcon } from './sprites';
import { speciesSprite } from './CreaturePanel';
import { fmtInt } from './format';

function geneLine(genes: SelectedDetail['ancestors'][number]['genes']): string {
  return `速${genes.speed.toFixed(2)} 体${genes.size.toFixed(2)} 感${genes.sense.toFixed(2)} 旱${genes.droughtTol.toFixed(2)} 繁${genes.reproInvest.toFixed(2)} 胆${genes.boldness.toFixed(2)}`;
}

export function LineagePanel(): React.ReactElement {
  const panel = useSyncExternalStore(client.subscribePanel, client.getPanelSnapshot);
  const sel = panel.selected;

  if (!sel) {
    return (
      <div className="empty">
        <PixelIcon name="tabLineage" size={36} />
        <div>尚未选择个体</div>
        <div className="muted">选择一个生物后，这里会展示它的三代祖先与所属谱系的兴衰。</div>
      </div>
    );
  }

  const ancestors = sel.ancestors ?? [];
  const relLabels = ['亲代', '祖代', '曾祖代'];

  return (
    <div>
      <div className="section-title">
        <PixelIcon name="tabLineage" size={13} /> 三代追溯
      </div>
      {ancestors.length === 0 ? (
        <div className="ancestor ancestor--missing">
          <span className="ancestor__rel">初代</span>
          <span>该个体没有祖先记录——它是世界初始投放的第一代。</span>
        </div>
      ) : (
        ancestors.map((a, i) => (
          <div className="ancestor" key={`${a.id}-${i}`} title={`基因：${geneLine(a.genes)}`}>
            <span className="ancestor__rel">{relLabels[i] ?? `上${i + 1}代`}</span>
            <span className="grow">
              <div>
                <PixelIcon name={speciesSprite(a.species)} size={14} /> {speciesName(a.species)}
                <span className="mono"> #{a.id}</span>
                <span className="muted"> · 第 {a.generation} 代</span>
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                出生 tick {fmtInt(a.birthTick)}
                {a.deathTick > 0 ? ` · 死亡 tick ${fmtInt(a.deathTick)}（${deathCauseName(a.cause)}）` : ' · 存活中'}
              </div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>
                {geneLine(a.genes)}
              </div>
            </span>
          </div>
        ))
      )}
      {ancestors.length > 0 && ancestors.length < 3 ? (
        <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
          更早的祖先记录已归档缺失（档案库仅保留有限条记录）。
        </div>
      ) : null}

      <div className="section-title">
        <PixelIcon name="dna" size={13} /> 所属谱系
      </div>
      {sel.lineage ? (
        <div className="lineage-box">
          <div className="kv">
            <span className="kv__k">谱系编号</span>
            <span className="kv__v">#{sel.lineage.id}</span>
            <span className="kv__k">创始人</span>
            <span className="kv__v">
              <PixelIcon name={speciesSprite(sel.lineage.species)} size={13} /> {speciesName(sel.lineage.species)}
              <span className="mono"> #{sel.lineage.founderId}</span>
              {sel.lineage.artificial ? <span className="tag tag--artificial">人工建立</span> : null}
            </span>
            <span className="kv__k">起始 tick</span>
            <span className="kv__v mono">{fmtInt(sel.lineage.startTick)}</span>
            <span className="kv__k">最高世代</span>
            <span className="kv__v">第 {sel.lineage.maxGeneration} 代</span>
            <span className="kv__k">总出生</span>
            <span className="kv__v">{fmtInt(sel.lineage.totalBirths)}</span>
            <span className="kv__k">总死亡</span>
            <span className="kv__v">{fmtInt(sel.lineage.totalDeaths)}</span>
            <span className="kv__k">当前存活</span>
            <span className="kv__v">{fmtInt(sel.lineage.aliveCount)}</span>
            <span className="kv__k">状态</span>
            <span className="kv__v">
              {sel.lineage.extinct ? (
                <span className="tag tag--danger">已灭绝（tick {fmtInt(sel.lineage.extinctTick)}）</span>
              ) : (
                <span className="tag tag--ok">延续中</span>
              )}
            </span>
          </div>
        </div>
      ) : (
        <div className="ancestor ancestor--missing">
          <span className="ancestor__rel">缺失</span>
          <span>该个体的谱系汇总信息暂不可用。</span>
        </div>
      )}

      <div className="section-title">
        <PixelIcon name="tabData" size={13} /> 同谱系存活
      </div>
      <div className="stat-grid">
        <div className="stat-cell">
          <div className="stat-cell__k">同谱系存活个体</div>
          <div className="stat-cell__v">{fmtInt(sel.sameLineageAlive)}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-cell__k">本代序号</div>
          <div className="stat-cell__v">第 {sel.generation} 代</div>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 11, marginTop: 10, marginBottom: 0 }}>
        提示：在场景中点击同谱系的其它个体，可以对比它们的基因差异——自然选择就写在这些数字里。
      </p>
    </div>
  );
}
