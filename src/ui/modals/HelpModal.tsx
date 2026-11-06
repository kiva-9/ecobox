// 帮助弹窗：玩法说明、快捷键表、因果链图解与单位说明。

import { Modal } from '../Modal';

const SHORTCUTS: { keys: string[]; desc: string }[] = [
  { keys: ['空格'], desc: '暂停 / 继续' },
  { keys: ['→'], desc: '单步（暂停时前进一步）' },
  { keys: ['1', '2', '3', '4'], desc: '速度切换到 1× / 2× / 5× / 10×' },
  { keys: ['+', '-'], desc: '放大 / 缩小场景' },
  { keys: ['G'], desc: '切换植被叠加层' },
  { keys: ['H'], desc: '打开本帮助' },
  { keys: ['Esc'], desc: '关闭弹窗；再次按下取消选择与追踪' },
];

const CHAIN: { title: string; text: string }[] = [
  { title: '光 · 水 · 养分 → 植物', text: '青草生长快、能量低，喜湿润草地；浆果灌丛生长慢、能量高，喜林地遮阴。干旱时植物会枯死。' },
  { title: '植物 → 食草动物', text: '小型与大型食草者啃食植物获得能量；进食有冷却，消化效率受耐旱性影响。' },
  { title: '食草动物 → 捕食者', text: '捕食只转移约 60% 能量，其余变成残骸；胆量低的个体更容易逃脱。' },
  { title: '残骸 → 食腐者 / 土壤', text: '食腐者清理残骸获取能量；残骸分解后返还养分，重新进入循环。' },
  { title: '代谢 → 持续耗能', text: '基础代谢、移动（按速度平方）、感知维持、繁殖投入都在消耗能量——没有免费资源。' },
  { title: '基因 → 自然选择', text: '六项基因决定收益与代价。适应环境的个体留下更多后代，种群的性状分布随之移动。' },
];

export interface HelpModalProps {
  onClose: () => void;
}

export function HelpModal({ onClose }: HelpModalProps): React.ReactElement {
  return (
    <Modal
      title="帮助"
      icon="help"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="muted" style={{ fontSize: 12 }}>
            提示：把鼠标悬停在任何按钮上，都会显示它的作用。
          </span>
          <span className="grow" />
          <button className="btn btn--primary" onClick={onClose}>
            开始观察
          </button>
        </>
      }
    >
      <h3 style={{ fontSize: 14, marginBottom: 6 }}>这是什么</h3>
      <p>
        《微境：人工生命生态箱》是一个本地运行的人工生命模拟。世界由种子决定：相同种子加相同干预，会得到完全相同的演化过程。
        你可以只是观察，也可以改变地形、播种植被、呼风唤雨，或者把某只个体的基因收藏成蓝图重新投放。
      </p>

      <h3 style={{ fontSize: 14, margin: '14px 0 6px' }}>怎么玩</h3>
      <ol style={{ margin: '0 0 0 18px', padding: 0 }}>
        <li>用「选择」工具点击生物，查看它的基因、行为原因与三代祖先。</li>
        <li>用底部工具栏切换地形笔 / 播种 / 降雨 / 干旱 / 投放，在场景中拖动涂抹。</li>
        <li>在「数据」面板观察种群曲线、死因分布与性状分布的变化。</li>
        <li>在「世界」面板保存、导出，或把喜欢的个体收藏为蓝图。</li>
        <li>想挑战自己？回主菜单选择三张关卡卡之一，在有限干预下达成目标。</li>
      </ol>

      <h3 style={{ fontSize: 14, margin: '14px 0 6px' }}>快捷键</h3>
      <table className="kbd-table">
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.desc}>
              <td>
                {s.keys.map((k) => (
                  <span className="kbd" key={k}>
                    {k}
                  </span>
                ))}
              </td>
              <td>{s.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ fontSize: 14, margin: '14px 0 6px' }}>因果链</h3>
      <div className="chain">
        {CHAIN.map((c, i) => (
          <div key={c.title}>
            <div className="chain__step">
              <b>{c.title}</b>
            </div>
            <div style={{ padding: '2px 0 2px 12px', color: 'var(--ink-soft)', fontSize: 12 }}>{c.text}</div>
            {i < CHAIN.length - 1 ? <div className="chain__arrow">▼</div> : null}
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 14, margin: '14px 0 6px' }}>单位</h3>
      <ul style={{ margin: '0 0 0 18px', padding: 0, color: 'var(--ink-soft)' }}>
        <li>1 tick = 一个固定模拟步；1× 速度 ≈ 60 tick/秒。</li>
        <li>一天 = 2400 tick（1× 下约 40 秒），有昼 / 夜光照变化。</li>
        <li>距离单位是 tile（格）；能量单位是 EU；基因取值 0..1。</li>
      </ul>
    </Modal>
  );
}
