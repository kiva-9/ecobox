// 首次引导弹窗：4-5 步带你认识界面，最后一步调用 client.markGuideDone() 关闭。

import { useState } from 'react';
import { client } from '../../game/client';
import { Modal } from '../Modal';
import { PixelIcon } from '../sprites';
import type { SpriteName } from '../sprites';

interface GuideStep {
  title: string;
  sprite: SpriteName;
  lines: string[];
}

const STEPS: GuideStep[] = [
  {
    title: '欢迎来到微境',
    sprite: 'spark',
    lines: [
      '这是一个活着的小世界：植物生长、动物觅食、捕食者追猎、残骸回归土壤。',
      '顶栏显示世界信息与模拟时间；中间是生态场景；底部是工具栏；右侧是数据面板。',
      '你不需要做任何事——先看一会儿，生命自己会找到出路。',
    ],
  },
  {
    title: '选中一个生物',
    sprite: 'cursor',
    lines: [
      '用底部工具栏的「选择」工具点击场景中的生物。',
      '「个体」面板会显示它的能量、年龄、行为原因与六项基因。',
      '「谱系」面板可以追溯它的三代祖先，看看它继承了什么。',
    ],
  },
  {
    title: '干预环境',
    sprite: 'brush',
    lines: [
      '地形笔可以改变草地 / 林地 / 旱地 / 水域 / 岩石；播种与种植能补充植物。',
      '降雨缓解干旱，触发干旱则考验种群的耐旱性；投放生物可以引入新基因。',
      '每次干预都有代价——挑战模式中还会消耗有限的干预配额。',
    ],
  },
  {
    title: '用数据做判断',
    sprite: 'tabData',
    lines: [
      '「数据」面板绘制种群曲线、死因分布与六项基因的性状分布。',
      '分布整体移动，说明自然选择正在偏好某些基因——这就是演化的痕迹。',
      '「事件日志」记录真实的出生、死亡与环境变化。',
    ],
  },
  {
    title: '保存与挑战',
    sprite: 'save',
    lines: [
      '「世界」面板可以保存 / 载入 / 导出 JSON，也能把喜欢的个体收藏为蓝图重投。',
      '想更有挑战？回主菜单选择关卡：在有限干预下让生态达成目标。',
      '随时按 H 查看帮助与快捷键。开始观察吧！',
    ],
  },
];

export interface GuideModalProps {
  onClose: () => void;
}

export function GuideModal({ onClose }: GuideModalProps): React.ReactElement {
  const [step, setStep] = useState(0);
  const cur = STEPS[step];
  const last = step === STEPS.length - 1;

  const finish = (): void => {
    client.markGuideDone();
    onClose();
  };

  return (
    <Modal
      title={`首次引导 ${step + 1}/${STEPS.length}`}
      icon="help"
      onClose={finish}
      footer={
        <>
          <div className="guide__dots">
            {STEPS.map((s, i) => (
              <span key={s.title} className={`guide__dot${i === step ? ' is-active' : ''}`} />
            ))}
          </div>
          <span className="grow" />
          <button className="btn btn--sm btn--ghost" onClick={finish}>
            跳过
          </button>
          <button className="btn btn--sm" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            上一步
          </button>
          {last ? (
            <button className="btn btn--sm btn--primary" onClick={finish}>
              开始观察
            </button>
          ) : (
            <button className="btn btn--sm btn--primary" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
              下一步
            </button>
          )}
        </>
      }
    >
      <div className="guide__step">
        <div className="row" style={{ marginBottom: 10 }}>
          <PixelIcon name={cur.sprite} size={30} />
          <h3 style={{ fontSize: 17 }}>{cur.title}</h3>
        </div>
        <ul style={{ margin: '0 0 0 18px', padding: 0 }}>
          {cur.lines.map((l) => (
            <li key={l} style={{ marginBottom: 6 }}>
              {l}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
