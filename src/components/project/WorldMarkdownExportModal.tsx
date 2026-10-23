import Modal from '@/components/common/Modal';
import { useTranslation } from '@/i18n/useTranslation';
import { vaultCopy } from '@/services/worldMarkdownExport/copy';
import WorldMarkdownExportPanel from './WorldMarkdownExportPanel';

export default function WorldMarkdownExportModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { locale } = useTranslation();
  return <Modal open onClose={onClose} title={vaultCopy(locale === 'es' ? 'es' : 'en').ui.title}>
    <div data-testid="world-md-modal"><WorldMarkdownExportPanel projectId={projectId} /></div>
  </Modal>;
}
