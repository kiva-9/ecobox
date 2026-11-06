// 弹窗宿主：按 client.state.modal 渲染对应弹窗。

import { useSyncExternalStore } from 'react';
import { client } from '../game/client';
import { Modal } from './Modal';
import { HelpModal } from './modals/HelpModal';
import { SettingsModal } from './modals/SettingsModal';
import { NewWorldModal } from './modals/NewWorldModal';
import { SaveLoadModal } from './modals/SaveLoadModal';
import { ImportExportModal } from './modals/ImportExportModal';
import { ChallengeBriefModal, ChallengeResultModal } from './modals/ChallengeModals';
import { ConfirmResetModal } from './modals/ConfirmResetModal';
import { GuideModal } from './modals/GuideModal';

export interface ModalHostProps {
  onError: (err: { title: string; message: string }) => void;
}

export function ModalHost({ onError }: ModalHostProps): React.ReactElement | null {
  const state = useSyncExternalStore(client.subscribeUi, client.getUiSnapshot);
  const close = (): void => client.closeModal();

  switch (state.modal) {
    case 'help':
      return <HelpModal onClose={close} />;
    case 'settings':
      return <SettingsModal onClose={close} />;
    case 'newWorld':
      return <NewWorldModal onClose={close} />;
    case 'saveLoad':
      return (
        <SaveLoadModal
          onClose={close}
          initialTab={(state.modalData?.tab as 'save' | 'load' | undefined) ?? 'save'}
        />
      );
    case 'importExport':
      return <ImportExportModal onClose={close} onError={onError} />;
    case 'challengeBrief': {
      const id = state.modalData?.challengeId;
      if (typeof id !== 'string') {
        return (
          <Modal title="关卡说明" icon="flag" onClose={close}>
            <p>缺少关卡编号，请返回主菜单重新选择。</p>
          </Modal>
        );
      }
      return <ChallengeBriefModal challengeId={id} onClose={close} />;
    }
    case 'challengeResult':
      return <ChallengeResultModal onClose={close} />;
    case 'confirmReset': {
      const d = state.modalData ?? {};
      return (
        <ConfirmResetModal
          kind={d.kind === 'challenge' ? 'challenge' : 'sandbox'}
          seed={typeof d.seed === 'number' ? d.seed : 0}
          presetId={typeof d.presetId === 'string' ? d.presetId : 'temperate'}
          onClose={close}
        />
      );
    }
    case 'guide':
      return <GuideModal onClose={close} />;
    default:
      return null;
  }
}
