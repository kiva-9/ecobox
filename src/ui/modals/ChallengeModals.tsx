// 挑战弹窗：关卡说明（brief）与结算（result）。

import { useSyncExternalStore } from 'react';
import { client } from '../../game/client';
import { CHALLENGES, challengeById, presetById } from '../../sim/config';
import { speciesName } from '../../sim/constants';import { Modal } from '../Modal';
import { PixelIcon } from '../sprites';
import { retryChallengeConfirmed, startChallengeConfirmed } from '../phase';
import { dayOf, fmtInt, fmtSeconds, isDaytimeLight, ticksToSeconds } from '../format';

export interface ChallengeBriefModalProps {
  challengeId: string;
  onClose: () => void;
}

export function ChallengeBriefModal({ challengeId, onClose }: ChallengeBriefModalProps): React.ReactElement {
  const cfg = challengeById(challengeId) ?? CHALLENGES.find((c) => c.id === challengeId);
  if (!cfg) {
    return (
      <Modal title="关卡不存在" icon="err" onClose={onClose}>
        <p>找不到编号为 {challengeId} 的关卡，请返回主菜单重新选择。</p>
      </Modal>
    );
  }
  const preset = presetById(cfg.preset);

  return (
    <Modal
      title={`关卡说明 · ${cfg.name}`}
      icon="flag"
      onClose={onClose}
      footer={
        <>
          <span className="muted" style={{ fontSize: 12 }}>
            挑战中的暂停不计时，但不能使用沙盒存档绕过限制
          </span>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn--go"
            onClick={() => {
              startChallengeConfirmed(cfg.id);
              onClose();
            }}
          >
            <PixelIcon name="play" size={14} />
            开始挑战
          </button>
        </>
      }
    >
      <p style={{ fontSize: 13 }}>{cfg.brief}</p>

      <div className="section-title">
        <PixelIcon name="tabWorld" size={13} /> 起始条件
      </div>
      <div className="kv">
        <span className="kv__k">预设</span>
        <span className="kv__v">{preset?.name ?? cfg.preset}</span>
        <span className="kv__k">种子</span>
        <span className="kv__v mono">{cfg.seed}</span>
        <span className="kv__k">干预配额</span>
        <span className="kv__v">{cfg.interventions} 次</span>
        <span className="kv__k">时限</span>
        <span className="kv__v">{fmtSeconds(ticksToSeconds(cfg.timeLimit))}</span>
      </div>

      <div className="section-title">
        <PixelIcon name="tabChallenge" size={13} /> 目标
      </div>
      {cfg.goals.length > 0 ? (
        <ul style={{ margin: '0 0 0 18px', padding: 0 }}>
          {cfg.goals.map((g) => (
            <li key={g.species}>
              {speciesName(g.species)} 存活数 ≥ {g.min}
            </li>
          ))}
          {cfg.plantGoal > 0 ? <li>植物生物量 ≥ {fmtInt(cfg.plantGoal)}</li> : null}
          {cfg.coexistTicks ? <li>上述条件需连续保持 {fmtInt(cfg.coexistTicks)} tick</li> : null}
        </ul>
      ) : (
        <ul style={{ margin: '0 0 0 18px', padding: 0 }}>
          <li>
            谱系自然繁殖到第 {cfg.lineageGenerations ?? '—'} 代，且同谱系存活 ≥ {cfg.lineageAlive ?? '—'} 个
          </li>
          <li>人工投放不计入繁殖目标</li>
        </ul>
      )}

      {cfg.droughtStart ? (
        <>
          <div className="section-title">
            <PixelIcon name="drought" size={13} /> 环境事件
          </div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            开局后 {fmtSeconds(ticksToSeconds(cfg.droughtStart))} 将迎来干旱，持续约{' '}
            {fmtSeconds(ticksToSeconds(cfg.droughtLength ?? 0))}。提前储备水分与耐旱个体。
          </p>
        </>
      ) : null}

      <div className="section-title">
        <PixelIcon name="info" size={13} /> 限制
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        每次干预（地形笔、播种 / 种植、降雨 / 干旱、投放生物）消耗 1 点配额；配额用尽后只能观察。
        失败或成功后都可以重试，重试会用相同种子重新开始。
      </p>
    </Modal>
  );
}

export interface ChallengeResultModalProps {
  onClose: () => void;
}

export function ChallengeResultModal({ onClose }: ChallengeResultModalProps): React.ReactElement {
  const panel = useSyncExternalStore(client.subscribePanel, client.getPanelSnapshot);
  const ch = panel.challenge;
  const success = ch?.status === 'success';

  if (!ch) {
    return (
      <Modal title="挑战结算" icon="flag" onClose={onClose}>
        <p>当前没有进行中的挑战。</p>
      </Modal>
    );
  }

  return (
    <Modal
      title={success ? '挑战成功' : '挑战失败'}
      icon={success ? 'check' : 'err'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--sm btn--ghost" onClick={onClose}>
            关闭
          </button>
          <span className="grow" />
          <button
            className="btn btn--sm btn--danger"
            onClick={() => {
              client.exitChallenge();
              onClose();
            }}
          >
            退出挑战
          </button>
          <button
            className="btn btn--sm btn--go"
            onClick={() => {
              retryChallengeConfirmed();
              onClose();
            }}
          >
            <PixelIcon name="reset" size={14} />
            重试挑战
          </button>
        </>
      }
    >
      <div
        className="reason-box"
        style={
          success
            ? { background: 'var(--ok-bg)', borderColor: 'var(--ok)', color: '#2f5129' }
            : { background: 'var(--danger-bg)', borderColor: 'var(--danger)', color: 'var(--danger)' }
        }
      >
        <PixelIcon name={success ? 'check' : 'err'} size={14} />
        <span>{ch.note || (success ? '所有目标达成，生态在你的干预下延续了下来。' : '目标未能达成。')}</span>
      </div>

      <div className="section-title">
        <PixelIcon name="tabChallenge" size={13} /> 目标回顾
      </div>
      {ch.goals.length === 0 ? (
        <p className="muted" style={{ fontSize: 12 }}>
          本关目标为谱系延续，详见右侧「挑战」面板。
        </p>
      ) : (
        ch.goals.map((g, i) => (
          <div className="goal" key={`${g.label}-${i}`}>
            <div className="goal__head">
              {g.ok ? <PixelIcon name="check" size={13} /> : <PixelIcon name="close" size={13} />}
              <span>{g.label}</span>
              <span className="goal__val">
                {fmtInt(g.current)} / {fmtInt(g.target)}
              </span>
            </div>
          </div>
        ))
      )}

      <div className="section-title">
        <PixelIcon name="tabData" size={13} /> 统计数据
      </div>
      <div className="stat-grid">
        <div className="stat-cell">
          <div className="stat-cell__k">持续时间</div>
          <div className="stat-cell__v">{fmtInt(panel.tick)} tick</div>
        </div>
        <div className="stat-cell">
          <div className="stat-cell__k">结束于</div>
          <div className="stat-cell__v" style={{ fontSize: 13 }}>
            第 {dayOf(panel.tick)} 天 {isDaytimeLight(panel.light) ? '昼' : '夜'}
          </div>
        </div>
        {panel.counts.map((n, i) => (
          <div className="stat-cell" key={i}>
            <div className="stat-cell__k">{speciesName(i)}</div>
            <div className="stat-cell__v">{fmtInt(n)}</div>
          </div>
        ))}
        <div className="stat-cell">
          <div className="stat-cell__k">植物生物量</div>
          <div className="stat-cell__v">{fmtInt(panel.totals.grass + panel.totals.shrub)}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-cell__k">干预剩余</div>
          <div className="stat-cell__v">{fmtInt(ch.interventionsLeft)}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-cell__k">共存进度</div>
          <div className="stat-cell__v">{Math.round(ch.coexistProgress * 100)}%</div>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 11, marginTop: 10, marginBottom: 0 }}>
        提示：重试会使用相同种子与设置，你可以尝试不同的干预时机与策略。
      </p>
    </Modal>
  );
}
