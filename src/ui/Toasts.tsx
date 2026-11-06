// 右上角通知（toast）。

import { useSyncExternalStore } from 'react';
import { client } from '../game/client';
import type { Toast } from '../shared/protocol';
import { PixelIcon } from './sprites';
import type { SpriteName } from './sprites';

const ICONS: Record<Toast['kind'], SpriteName> = {
  info: 'info',
  success: 'check',
  warn: 'warn',
  error: 'err',
};

export function Toasts(): React.ReactElement {
  const toasts = useSyncExternalStore(client.subscribeUi, client.getUiSnapshot).toasts;
  if (toasts.length === 0) return <></>;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div className={`toast toast--${t.kind}`} key={t.id}>
          <span className="toast__icon">
            <PixelIcon name={ICONS[t.kind]} size={16} />
          </span>
          <span className="toast__text">{t.text}</span>
          <button
            className="toast__close"
            onClick={() => client.dismissToast(t.id)}
            title="关闭此通知"
            aria-label="关闭此通知"
          >
            <PixelIcon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
