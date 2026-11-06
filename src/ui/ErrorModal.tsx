// 错误弹窗（组件内状态驱动）：用于导入失败、导出超时、渲染器降级等需要用户确认的场景。
// 注意：ModalKind 中没有 'error'，因此该弹窗不走 client.modal，而由 App 的本地状态承载。

import { useEffect } from 'react';
import { Modal } from './Modal';

export interface ErrorModalProps {
  title: string;
  message: string;
  onClose: () => void;
}

export function ErrorModal({ title, message, onClose }: ErrorModalProps): React.ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Modal title={title} icon="err" onClose={onClose} footer={<Footer onClose={onClose} />}>
      <p style={{ whiteSpace: 'pre-line' }}>{message}</p>
    </Modal>
  );
}

function Footer({ onClose }: { onClose: () => void }): React.ReactElement {
  return (
    <>
      <span className="grow" />
      <button className="btn btn--primary" onClick={onClose}>
        知道了
      </button>
    </>
  );
}
