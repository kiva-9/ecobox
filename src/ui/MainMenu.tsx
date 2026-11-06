// 主菜单：标题插画、开始新世界、继续游戏、导入、挑战关卡、生命档案、帮助/设置。

import { useRef, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { client } from '../game/client';
import { CHALLENGES } from '../sim/config';
import { speciesName } from '../sim/constants';
import type { Blueprint } from '../sim/types';
import type { SaveSlotInfo } from '../shared/protocol';
import { PixelCritter, PixelIcon, PixelScene } from './sprites';
import { speciesSprite } from './CreaturePanel';
import { enterPlayingPhase } from './phase';
import { fmtClock, fmtInt, fmtSeconds, geneSummary, ticksToSeconds, VERSION } from './format';

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

export interface MainMenuProps {
  onArmBlueprint: (bp: Blueprint) => void;
  onError: (err: { title: string; message: string }) => void;
}

export function MainMenu({ onArmBlueprint, onError }: MainMenuProps): React.ReactElement {
  const state = useSyncExternalStore(client.subscribeUi, client.getUiSnapshot);
  const importRef = useRef<HTMLInputElement | null>(null);
  const [showChallenges, setShowChallenges] = useState(true);
  const [showArchive, setShowArchive] = useState(false);

  const saves = state.saves;
  const saveOf = (id: string): SaveSlotInfo | undefined => saves.find((s) => s.id === id);

  const loadFromMenu = (slot: SaveSlotInfo): void => {
    enterPlayingPhase();
    client.loadSlot(slot.id);
    // 从菜单载入时原本没有快照：若 3 秒内仍无快照说明载入失败，回退菜单
    if (!client.latest) {
      window.setTimeout(() => {
        if (!client.latest) {
          client.backToMenu();
          onError({
            title: '载入失败',
            message: `「${slot.label || slotName(slot.id)}」未能在预期时间内载入。存档可能已损坏，请尝试其它存档或导入 JSON 备份。`,
          });
        }
      }, 3000);
    }
  };

  const onImport = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const res = await client.importWorldFile(file);
    if (!res.ok) {
      onError({
        title: '导入失败',
        message: `${res.error ?? '文件无法解析'}\n请确认这是本游戏导出的世界 JSON（格式 ecobox-world）。`,
      });
    }
  };

  return (
    <div className="menu-screen">
      <div className="menu-wrap">
        {/* ------------------------------------------------ 标题与主操作 */}
        <section className="menu-card">
          <div className="menu-hero">
            <div className="menu-hero__art">
              <PixelScene width={480} />
            </div>
            <div className="menu-hero__text">
              <h1 className="menu-title">
                <PixelCritter size={40} species={0} />
                微境：人工生命生态箱
              </h1>
              <p className="menu-sub">
                在一只小小的生态箱里，植物依靠光、水与养分生长，食草者觅食，捕食者追猎，食腐者清理残骸。
                观察它们如何演化，干预环境、保护谱系、收藏基因蓝图——你的每一次选择都会写进后代的基因里。
              </p>
              <div className="menu-tags">
                <span className="tag">人工生命模拟</span>
                <span className="tag">六项可遗传基因</span>
                <span className="tag">三个挑战关卡</span>
                <span className="tag">本地存档 / 导入导出</span>
              </div>
              <div className="menu-actions">
                <button className="btn btn--primary" onClick={() => client.openModal('newWorld')}>
                  <PixelIcon name="spark" size={18} />
                  开始新世界
                  <small>选择种子与预设</small>
                </button>
                <button className="btn" onClick={() => client.openModal('saveLoad', { tab: 'load' })}>
                  <PixelIcon name="load" size={18} />
                  继续游戏
                  <small>自动存档 + 3 个手动槽</small>
                </button>
                <button className="btn" onClick={() => importRef.current?.click()}>
                  <PixelIcon name="import" size={18} />
                  导入世界 JSON
                  <small>读取导出的存档文件</small>
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setShowChallenges(true);
                    document.getElementById('menu-challenges')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  <PixelIcon name="tabChallenge" size={18} />
                  挑战
                  <small>三张关卡卡</small>
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setShowArchive(true);
                    document.getElementById('menu-archive')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  <PixelIcon name="dna" size={18} />
                  生命档案
                  <small>蓝图收藏与重投</small>
                </button>
                <button className="btn" onClick={() => client.openModal('help')}>
                  <PixelIcon name="help" size={18} />
                  帮助
                  <small>玩法与快捷键</small>
                </button>
                <button className="btn" onClick={() => client.openModal('settings')}>
                  <PixelIcon name="settings" size={18} />
                  设置
                  <small>音量 / 叠加层 / 引导</small>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ 继续游戏 */}
        <section className="panel">
          <div className="panel__head">
            <PixelIcon name="clock" size={16} />
            <span className="panel__title">继续游戏</span>
            <span className="grow" />
            <button className="btn btn--sm btn--ghost" onClick={() => client.openModal('saveLoad', { tab: 'load' })}>
              存档管理
            </button>
          </div>
          <div className="panel__body">
            <div className="menu-grid">
              {SLOT_IDS.map((id) => {
                const s = saveOf(id);
                return (
                  <button
                    key={id}
                    className="save-item"
                    disabled={!s}
                    onClick={() => s && loadFromMenu(s)}
                    title={s ? `载入「${s.label || slotName(id)}」（tick ${fmtInt(s.tick)}）` : '空槽位'}
                  >
                    <span className="save-item__icon">
                      <PixelIcon name={id === 'auto' ? 'clock' : 'save'} size={22} />
                    </span>
                    <span className="save-item__info">
                      <span className="save-item__name">{slotName(id)}</span>
                      <span className="save-item__meta">
                        {s ? `tick ${fmtInt(s.tick)} · ${fmtClock(s.savedAt)} · 人口 ${fmtInt(s.population)}` : '暂无存档'}
                      </span>
                    </span>
                    {s ? (
                      <span className="tag tag--muted">{s.mode === 'challenge' ? '挑战' : '沙盒'}</span>
                    ) : (
                      <span className="tag tag--muted">空</span>
                    )}
                  </button>
                );
              })}
            </div>
            {saves.length === 0 ? (
              <p className="muted" style={{ fontSize: 11, margin: '8px 0 0' }}>
                还没有检测到存档。开始一个世界后，系统会自动存档，你也可以随时手动保存。
              </p>
            ) : null}
          </div>
        </section>

        {/* ------------------------------------------------ 挑战关卡 */}
        {showChallenges ? (
          <section className="panel" id="menu-challenges">
            <div className="panel__head">
              <PixelIcon name="tabChallenge" size={16} />
              <span className="panel__title">挑战关卡</span>
              <span className="grow" />
              <button className="btn btn--sm btn--ghost" onClick={() => setShowChallenges(false)}>
                收起
              </button>
            </div>
            <div className="panel__body">
              <div className="menu-grid">
                {CHALLENGES.map((c) => (
                  <div className="challenge-card" key={c.id}>
                    <div className="challenge-card__head">
                      <PixelIcon name="flag" size={16} />
                      {c.name}
                    </div>
                    <p className="challenge-card__desc">{c.brief}</p>
                    <div className="row row--wrap" style={{ fontSize: 11, marginBottom: 8 }}>
                      <span className="tag tag--muted">干预 {c.interventions} 次</span>
                      <span className="tag tag--muted">时限 {fmtSeconds(ticksToSeconds(c.timeLimit))}</span>
                      {c.coexistTicks ? <span className="tag tag--muted">需持续共存</span> : null}
                      {c.lineageGenerations ? <span className="tag tag--muted">谱系第 {c.lineageGenerations} 代</span> : null}
                    </div>
                    <button
                      className="btn btn--sm btn--go btn--block"
                      onClick={() => client.openModal('challengeBrief', { challengeId: c.id })}
                    >
                      查看说明并开始
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {/* ------------------------------------------------ 生命档案 */}
        {showArchive ? (
          <section className="panel" id="menu-archive">
            <div className="panel__head">
              <PixelIcon name="dna" size={16} />
              <span className="panel__title">生命档案（蓝图收藏）</span>
              <span className="grow" />
              <button className="btn btn--sm btn--ghost" onClick={() => setShowArchive(false)}>
                收起
              </button>
            </div>
            <div className="panel__body">
              {state.blueprints.length === 0 ? (
                <div className="chart__empty">
                  还没有蓝图。进入世界后选中一个个体，在「世界」面板里命名并收藏它的基因。
                </div>
              ) : (
                <div className="bp-list">
                  {state.blueprints.map((bp) => (
                    <div className="bp-item" key={bp.id}>
                      <div className="bp-item__head">
                        <PixelIcon name={speciesSprite(bp.species)} size={16} />
                        <span className="grow">{bp.name}</span>
                        <span className="tag tag--muted">{speciesName(bp.species)}</span>
                      </div>
                      <div className="bp-item__genes">{geneSummary(bp.genes)}</div>
                      <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>
                        采集于 tick {fmtInt(bp.capturedTick)} · 来源种子 {bp.sourceWorldSeed}
                      </div>
                      <div className="bp-item__actions">
                        <button
                          className="btn btn--sm btn--go"
                          onClick={() => onArmBlueprint(bp)}
                          title="切换到对应物种的投放工具，并带上这份基因"
                        >
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
          </section>
        ) : null}

        {/* ------------------------------------------------ 底部状态 */}
        <div className="menu-footer">
          <span className="row">
            <PixelIcon name="spark" size={13} />
            微境 {VERSION} · 本地运行 · 存档与蓝图保存在本浏览器中
          </span>
          {state.storageError ? (
            <div className="storage-warn">
              <PixelIcon name="warn" size={14} />
              <span>
                本地存储不可用：{state.storageError}。
                存档与蓝图无法写入，建议立即用「导出世界 JSON」备份；可尝试关闭隐私模式或清理浏览器存储空间。
              </span>
            </div>
          ) : (
            <span className="row" style={{ color: 'var(--ok)' }}>
              <PixelIcon name="check" size={13} />
              本地存储正常
            </span>
          )}
        </div>
      </div>

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
    </div>
  );
}
