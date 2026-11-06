// 导入 / 导出弹窗。

import { useRef } from 'react';
import { useSyncExternalStore } from 'react';
import { client } from '../../game/client';
import { Modal } from '../Modal';
import { PixelIcon } from '../sprites';
import { exportFilename } from '../format';

export interface ImportExportModalProps {
  onClose: () => void;
  onError: (err: { title: string; message: string }) => void;
}

export function ImportExportModal({ onClose, onError }: ImportExportModalProps): React.ReactElement {
  const state = useSyncExternalStore(client.subscribeUi, client.getUiSnapshot);
  const panel = useSyncExternalStore(client.subscribePanel, client.getPanelSnapshot);
  const fileRef = useRef<HTMLInputElement | null>(null);

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
    } else {
      onClose();
    }
  };

  return (
    <Modal
      title="导入 / 导出世界"
      icon="export"
      onClose={onClose}
      footer={
        <>
          <span className="muted" style={{ fontSize: 12 }}>
            文件格式：ecobox-world（JSON，含地形 / 个体 / 谱系 / 统计）
          </span>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      <div className="section-title">
        <PixelIcon name="export" size={13} /> 导出
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        把当前世界完整导出为 JSON 文件：地形、资源、全部个体、谱系记录与统计数据都会一并保存，
        可以在另一台设备上导入继续，也可以作为备份。
      </p>
      <button className="btn" onClick={() => void onExport()}>
        <PixelIcon name="export" size={14} />
        导出当前世界（tick {panel.tick}）
      </button>

      <div className="section-title">
        <PixelIcon name="import" size={13} /> 导入
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        从 JSON 文件导入世界。导入会替换当前世界；如果文件无效，当前世界不会受到影响。
      </p>
      <button className="btn" onClick={() => fileRef.current?.click()}>
        <PixelIcon name="import" size={14} />
        选择世界 JSON 文件
      </button>

      {state.storageError ? (
        <div className="storage-warn" style={{ marginTop: 12, maxWidth: 'none' }}>
          <PixelIcon name="warn" size={14} />
          <span>
            本地存储不可用：{state.storageError}。导出功能不受影响，建议尽快把世界备份到本地文件。
          </span>
        </div>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={(e) => {
          void onImport(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </Modal>
  );
}
