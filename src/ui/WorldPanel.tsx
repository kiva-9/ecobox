// 世界面板：世界信息、保存/载入、导入导出、重置与蓝图收藏。

import { useRef, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { client } from '../game/client';
import { presetById } from '../sim/config';
import { speciesName } from '../sim/constants';
import type { Blueprint } from '../sim/types';
import type { SaveSlotInfo } from '../shared/protocol';
import { PixelIcon } from './sprites';
import { speciesSprite } from './CreaturePanel';
import { exportFilename, fmtClock, fmtInt } from './format';
import { spawnToolForSpecies } from './tools';
import { enterPlayingPhase } from './phase';

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

function saveMeta(s: SaveSlotInfo): string {
  return `tick ${fmtInt(s.tick)} · ${fmtClock(s.savedAt)} · 人口 ${fmtInt(s.population)} · ${s.mode === 'challenge' ? '挑战' : '沙盒'}`;
}

export interface WorldPanelProps {
  onArmBlueprint: (bp: Blueprint) => void;
  onChooseTool: (tool: number) => void;
  onError: (err: { title: string; message: string }) => void;
}

export function WorldPanel({ onArmBlueprint, onChooseTool, onError }: WorldPanelProps): React.ReactElement {
  const state = useSyncExternalStore(client.subscribeUi, client.getUiSnapshot);
  const panel = useSyncExternalStore(client.subscribePanel, client.getPanelSnapshot);
  const [pendingSlot, setPendingSlot] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [bpName, setBpName] = useState('');
  const importRef = useRef<HTMLInputElement | null>(null);

  const preset = presetById(panel.world.presetId);
  const isChallenge = panel.world.mode === 'challenge';
  const saves = state.saves;
  const sel = panel.selected;

  const saveOf = (id: string): SaveSlotInfo | undefined => saves.find((s) => s.id === id);

  const onSave = (id: string): void => {
    if (saveOf(id)) {
      setPendingSlot(id);
      return;
    }
    client.saveSlot(id);
  };

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

  const onImport = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const res = await client.importWorldFile(file);
    if (!res.ok) {
      onError({
        title: '导入失败',
        message: `${res.error ?? '文件无法解析'}\n请确认这是本游戏导出的世界 JSON（格式 ecobox-world）。当前世界未受影响。`,
      });
    }
  };

  const collectBlueprint = (): void => {
    if (!sel) {
      client.toast('warn', '请先在场景中选择一个个体，再收藏它的蓝图');
      return;
    }
    const name = bpName.trim() || `${speciesName(sel.species)} #${sel.id}`;
    client.collectBlueprint(sel.id, name);
    setBpName('');
  };

  const release = (bp: Blueprint): void => {
    const tool = spawnToolForSpecies(bp.species);
    if (tool == null) {
      client.toast('warn', `蓝图「${bp.name}」的物种无法投放`);
      return;
    }
    onArmBlueprint(bp);
    onChooseTool(tool);
  };

  return (
    <div>
      {/* -------------------------------------------------- 世界信息 */}
      <div className="section-title">
        <PixelIcon name="tabWorld" size={13} /> 世界信息
      </div>
      <div className="kv">
        <span className="kv__k">预设</span>
        <span className="kv__v">{preset?.name ?? panel.world.presetId}</span>
        <span className="kv__k">种子</span>
        <span className="kv__v mono">{panel.world.seed}</span>
        <span className="kv__k">模式</span>
        <span className="kv__v">{isChallenge ? `挑战 · ${panel.challenge?.name ?? panel.world.challengeId ?? ''}` : '沙盒'}</span>
        <span className="kv__k">当前 tick</span>
        <span className="kv__v mono">{fmtInt(panel.tick)}</span>
      </div>
      <button
        className="btn btn--sm btn--danger btn--block"
        style={{ marginTop: 10 }}
        onClick={() =>
          client.openModal('confirmReset', {
            kind: isChallenge ? 'challenge' : 'sandbox',
            seed: panel.world.seed,
            presetId: panel.world.presetId,
          })
        }
        title={isChallenge ? '放弃当前进度，用相同设置重试挑战' : '用相同种子与预设重新生成世界（不可撤销）'}
      >
        <PixelIcon name="reset" size={14} />
        {isChallenge ? '重试挑战（重置世界）' : '重置世界'}
      </button>

      {/* -------------------------------------------------- 保存 */}
      <div className="section-title">
        <PixelIcon name="save" size={13} /> 保存
      </div>
      <div className="save-list">
        {SLOT_IDS.map((id) => {
          const existing = saveOf(id);
          const confirming = pendingSlot === id;
          return (
            <div className="save-row" key={id}>
              <span className="save-item__icon">
                <PixelIcon name={id === 'auto' ? 'clock' : 'save'} size={20} />
              </span>
              <span className="save-row__info">
                <span className="save-row__name">{slotName(id)}</span>
                <span className="save-row__meta">{existing ? saveMeta(existing) : '空槽位'}</span>
              </span>
              {confirming ? (
                <span className="save-row__actions">
                  <button
                    className="btn btn--sm btn--danger"
                    onClick={() => {
                      setPendingSlot(null);
                      client.saveSlot(id);
                    }}
                    title="确认覆盖此存档"
                  >
                    确认覆盖
                  </button>
                  <button className="btn btn--sm btn--ghost" onClick={() => setPendingSlot(null)}>
                    取消
                  </button>
                </span>
              ) : (
                <button className="btn btn--sm" onClick={() => onSave(id)} title={existing ? '覆盖此存档' : '保存到空槽位'}>
                  {existing ? '覆盖保存' : '保存'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {state.storageError ? (
        <div className="storage-warn" style={{ marginTop: 8 }}>
          <PixelIcon name="warn" size={14} />
          <span>本地存储不可用：{state.storageError}。请改用「导出 JSON」备份世界。</span>
        </div>
      ) : null}

      {/* -------------------------------------------------- 载入 */}
      <div className="section-title">
        <PixelIcon name="load" size={13} /> 载入
      </div>
      {saves.length === 0 ? (
        <div className="chart__empty">暂无存档。保存后即可在这里或主菜单「继续游戏」中载入。</div>
      ) : (
        <div className="save-list">
          {saves.map((s) => (
            <div className="save-row" key={s.id}>
              <span className="save-row__info">
                <span className="save-row__name">{s.label || slotName(s.id)}</span>
                <span className="save-row__meta">{saveMeta(s)}</span>
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
                    }}
                    title="载入此存档"
                  >
                    载入
                  </button>
                  <button
                    className="btn btn--sm btn--ghost"
                    onClick={() => setPendingDelete(s.id)}
                    title="删除此存档"
                    aria-label={`删除 ${s.label || slotName(s.id)}`}
                  >
                    <PixelIcon name="close" size={12} />
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* -------------------------------------------------- 导入导出 */}
      <div className="section-title">
        <PixelIcon name="export" size={13} /> 导入 / 导出
      </div>
      <div className="row row--wrap">
        <button className="btn btn--sm" onClick={() => void onExport()} title="把当前世界完整导出为 JSON 文件">
          <PixelIcon name="export" size={14} />
          导出世界 JSON
        </button>
        <button className="btn btn--sm" onClick={() => importRef.current?.click()} title="从 JSON 文件导入世界（会替换当前世界）">
          <PixelIcon name="import" size={14} />
          导入世界 JSON
        </button>
      </div>
      <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        导出的文件包含地形、全部个体与谱系记录，可在另一台设备上导入继续。
      </p>
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={(e) => {
          void onImport(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {/* -------------------------------------------------- 蓝图收藏 */}
      <div className="section-title">
        <PixelIcon name="dna" size={13} /> 生命档案（蓝图收藏）
      </div>
      <div className="field">
        <label className="field__label" htmlFor="bp-name">
          蓝图名称
        </label>
        <div className="row">
          <input
            id="bp-name"
            className="input grow"
            placeholder={sel ? `默认：${speciesName(sel.species)} #${sel.id}` : '请先在场景中选择个体'}
            value={bpName}
            maxLength={24}
            onChange={(e) => setBpName(e.target.value)}
            disabled={!sel}
          />
          <button className="btn btn--sm" onClick={collectBlueprint} disabled={!sel} title="把选中个体的六项基因收藏为蓝图">
            <PixelIcon name="spark" size={14} />
            收藏
          </button>
        </div>
      </div>
      {state.blueprints.length === 0 ? (
        <div className="chart__empty" style={{ marginTop: 8 }}>
          还没有蓝图。选中一个个体并命名后收藏，之后可以随时把它的基因重新投放回世界。
        </div>
      ) : (
        <div className="bp-list" style={{ marginTop: 8 }}>
          {state.blueprints.map((bp) => (
            <div className="bp-item" key={bp.id}>
              <div className="bp-item__head">
                <PixelIcon name={speciesSprite(bp.species)} size={16} />
                <span className="grow">{bp.name}</span>
                <span className="tag tag--muted">{speciesName(bp.species)}</span>
              </div>
              <div className="bp-item__genes">
                速{bp.genes.speed.toFixed(2)} 体{bp.genes.size.toFixed(2)} 感{bp.genes.sense.toFixed(2)} 旱
                {bp.genes.droughtTol.toFixed(2)} 繁{bp.genes.reproInvest.toFixed(2)} 胆{bp.genes.boldness.toFixed(2)}
              </div>
              <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>
                采集于 tick {fmtInt(bp.capturedTick)} · 来源种子 {bp.sourceWorldSeed}
              </div>
              <div className="bp-item__actions">
                <button className="btn btn--sm btn--go" onClick={() => release(bp)} title="切换到对应投放工具并带上这份基因">
                  在沙盒投放
                </button>
                <button
                  className="btn btn--sm btn--ghost"
                  onClick={() => client.deleteBlueprint(bp.id)}
                  title="删除此蓝图"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
