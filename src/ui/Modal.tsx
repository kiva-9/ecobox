// 通用弹窗外壳：纸面板 + 硬阴影，标题栏带关闭按钮，Esc 由 App 统一处理。

import type { ReactElement, ReactNode } from 'react';
import { PixelIcon } from './sprites';
import type { SpriteName } from './sprites';

export interface ModalProps {
  title: string;
  icon?: SpriteName;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function Modal({ title, icon = 'info', onClose, children, footer, wide = false }: ModalProps): ReactElement {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal${wide ? ' modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__head">
          <PixelIcon name={icon} size={18} />
          <h2 className="modal__title">{title}</h2>
          <button className="iconbtn modal__close" onClick={onClose} title="关闭（Esc）" aria-label="关闭">
            <PixelIcon name="close" size={14} />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__foot">{footer}</div> : null}
      </div>
    </div>
  );
}
