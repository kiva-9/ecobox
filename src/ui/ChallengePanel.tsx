// 挑战面板：目标进度、干预配额、剩余时间、共存进度与结算状态。

import { useSyncExternalStore } from 'react';
import { client } from '../game/client';
import { CHALLENGES, challengeById } from '../sim/config';
import type { ChallengePublicState } from '../shared/protocol';
import { PixelIcon } from './sprites';
import { retryChallengeConfirmed } from './phase';
import { fmtInt, fmtSeconds, pct, ticksToSeconds } from './format';

function statusTag(status: ChallengePublicState['status']): React.ReactElement {
  switch (status) {
    case 'briefing':
      return <span className="tag tag--muted">简报中</span>;
    case 'running':
      return <span className="tag tag--ok">进行中</span>;
    case 'success':
      return <span className="tag tag--ok">成功</span>;
    case 'fail':
      return <span className="tag tag--danger">失败</span>;
    default:
      return <span className="tag tag--muted">未知</span>;
  }
}

function SandboxChallengeList(): React.ReactElement {
  return (
    <div>
      <div className="empty" style={{ paddingTop: 8, paddingBottom: 12 }}>
        <PixelIcon name="tabChallenge" size={32} />
        <div>当前是沙盒模式</div>
        <div className="muted">在沙盒中可自由观察与干预；想要目标与限制，可以开始下面的挑战关卡。</div>
      </div>
      {CHALLENGES.map((c) => (
        <div className="challenge-card" key={c.id} style={{ marginBottom: 10 }}>
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
            查看关卡说明
          </button>
        </div>
      ))}
    </div>
  );
}

export function ChallengePanel(): React.ReactElement {
  const panel = useSyncExternalStore(client.subscribePanel, client.getPanelSnapshot);
  const ch = panel.challenge;

  if (!ch) return <SandboxChallengeList />;

  const cfg = challengeById(ch.id);
  const totalInterventions = cfg?.interventions ?? Math.max(ch.interventionsLeft, 1);
  const interventionRatio = pct(totalInterventions - ch.interventionsLeft, totalInterventions);
  const secondsLeft = ticksToSeconds(ch.ticksLeft);
  const finished = ch.status === 'success' || ch.status === 'fail';

  return (
    <div>
      <div className="panel panel--tight">
        <div className="panel__head">
          <PixelIcon name="flag" size={18} />
          <span className="panel__title">{ch.name}</span>
          <span className="grow" />
          {statusTag(ch.status)}
        </div>
        <div className="panel__body">
          <p style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{ch.brief}</p>

          <div className="section-title">
            <PixelIcon name="spark" size={13} /> 目标进度
          </div>
          {ch.goals.length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>
              本关没有种群数量目标，请查看「谱系延续」条件。
            </div>
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
                <div className="bar" style={{ height: 12 }}>
                  <span
                    className={`bar__fill${g.ok ? '' : pct(g.current, g.target) < 40 ? ' bar__fill--danger' : ' bar__fill--warn'}`}
                    style={{ width: `${pct(g.current, g.target)}%` }}
                  />
                  <span className="bar__label">{g.ok ? '已达成' : `${Math.round(pct(g.current, g.target))}%`}</span>
                </div>
              </div>
            ))
          )}
          {cfg?.coexistTicks ? (
            <>
              <div className="section-title">
                <PixelIcon name="clock" size={13} /> 共存进度
              </div>
              <div className="goal">
                <div className="goal__head">
                  <span>关键种群持续共存</span>
                  <span className="goal__val">{Math.round(ch.coexistProgress * 100)}%</span>
                </div>
                <div className="bar" style={{ height: 12 }}>
                  <span className="bar__fill" style={{ width: `${Math.round(ch.coexistProgress * 100)}%` }} />
                  <span className="bar__label">
                    需连续 {fmtInt(cfg.coexistTicks)} tick
                  </span>
                </div>
              </div>
            </>
          ) : null}

          <div className="section-title">
            <PixelIcon name="drought" size={13} /> 限制
          </div>
          <div className="stat-grid">
            <div className="stat-cell">
              <div className="stat-cell__k">干预剩余</div>
              <div className="stat-cell__v">
                {fmtInt(ch.interventionsLeft)} / {fmtInt(totalInterventions)}
              </div>
            </div>
            <div className="stat-cell">
              <div className="stat-cell__k">剩余时间</div>
              <div className="stat-cell__v">{fmtSeconds(secondsLeft)}</div>
            </div>
          </div>
          <div className="bar" style={{ marginTop: 8, height: 10 }} title="干预配额消耗">
            <span
              className={`bar__fill${ch.interventionsLeft === 0 ? ' bar__fill--danger' : ' bar__fill--accent'}`}
              style={{ width: `${100 - interventionRatio}%` }}
            />
            <span className="bar__label">剩余干预 {Math.round(100 - interventionRatio)}%</span>
          </div>

          {finished ? (
            <>
              <div className="section-title">
                <PixelIcon name={ch.status === 'success' ? 'check' : 'err'} size={13} /> 结算
              </div>
              <div
                className="reason-box"
                style={
                  ch.status === 'success'
                    ? { background: 'var(--ok-bg)', borderColor: 'var(--ok)', color: '#2f5129' }
                    : { background: 'var(--danger-bg)', borderColor: 'var(--danger)', color: 'var(--danger)' }
                }
              >
                <PixelIcon name={ch.status === 'success' ? 'check' : 'err'} size={14} />
                <span>{ch.note || (ch.status === 'success' ? '挑战成功！' : '挑战失败。')}</span>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn btn--sm btn--go" onClick={() => client.openModal('challengeResult')}>
                  查看完整结算
                </button>
                <button className="btn btn--sm" onClick={() => retryChallengeConfirmed()}>
                  重试挑战
                </button>
                <button className="btn btn--sm btn--ghost" onClick={() => client.exitChallenge()}>
                  退出挑战
                </button>
              </div>
            </>
          ) : (
            <p className="muted" style={{ fontSize: 11, marginTop: 10, marginBottom: 0 }}>
              提示：暂停不计时；每次干预（地形、植被、气候、投放）消耗 1 点配额。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
