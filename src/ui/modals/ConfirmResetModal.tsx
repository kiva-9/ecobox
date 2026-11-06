// 重置确认弹窗：沙盒 = 用相同种子重开世界；挑战 = 重试关卡。

import { client } from '../../game/client';
import { presetById } from '../../sim/config';
import { Modal } from '../Modal';
import { PixelIcon } from '../sprites';
import { retryChallengeConfirmed } from '../phase';
import { fmtInt } from '../format';

export interface ConfirmResetModalProps {
  kind: 'sandbox' | 'challenge';
  seed: number;
  presetId: string;
  onClose: () => void;
}

export function ConfirmResetModal({ kind, seed, presetId, onClose }: ConfirmResetModalProps): React.ReactElement {
  const preset = presetById(presetId);
  const isChallenge = kind === 'challenge';

  return (
    <Modal
      title={isChallenge ? '重试挑战？' : '重置世界？'}
      icon="warn"
      onClose={onClose}
      footer={
        <>
          <span className="muted" style={{ fontSize: 12 }}>
            当前世界的个体、谱系与统计都会消失
          </span>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn--danger"
            onClick={() => {
              if (isChallenge) {
                retryChallengeConfirmed();
              } else {
                client.newWorld(seed, presetId);
              }
              onClose();
            }}
          >
            <PixelIcon name="reset" size={14} />
            {isChallenge ? '确认重试' : '确认重置'}
          </button>
        </>
      }
    >
      {isChallenge ? (
        <p>
          重试会用<b>相同的种子与关卡设置</b>重新开始本挑战，干预配额与时限也会重置。
          你已经积累的对局经验仍然有效——换一种干预时机试试。
        </p>
      ) : (
        <p>
          将用相同的种子（<span className="mono">{fmtInt(seed)}</span>）与预设（
          <b>{preset?.name ?? presetId}</b>）重新生成世界。
          地形会完全一样，但这一次的演化由你重新引导。
        </p>
      )}
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        如果想保留当前世界，请先保存到槽位或导出 JSON。
      </p>
    </Modal>
  );
}
