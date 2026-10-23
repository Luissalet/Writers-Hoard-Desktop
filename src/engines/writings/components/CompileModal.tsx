import PublishingProfileModal from '@/components/project/PublishingProfileModal';
import type { Writing } from '@/types';

interface CompileModalProps {
  writingScope?:import('../manuscripts').WritingSelection;
  eraId?:string;
  open: boolean;
  onClose: () => void;
  writings: Writing[];
  projectId: string;
  projectTitle: string;
}

/** The Writings shortcut is a quick, unsaved instance of the shared studio. */
export default function CompileModal({
  writingScope,eraId,
  open,
  onClose,
  writings,
  projectId,
  projectTitle,
}: CompileModalProps) {
  if (!open) return null;
  return (
    <PublishingProfileModal
      key={`${projectId}:${writings.map(writing => writing.id).join(',')}`}
      open
      onClose={onClose}
      project={{ id: projectId, title: projectTitle }}
      writings={writings}
      variant="quick"
      writingScope={writingScope}
      eraId={eraId}
      titleOverride={projectTitle}
    />
  );
}
