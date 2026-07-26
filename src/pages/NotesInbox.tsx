// ============================================
// Notes Inbox — standalone page (no project required)
// ============================================
//
// The same Notes board the project tab renders, scoped to GLOBAL_NOTES_SCOPE:
// the drawer for thoughts that arrive before you know which project they
// belong to. Cards here (and only here) offer "move to project".
//
// Routed at `/notes` from App.tsx; also the landing spot of the global
// Ctrl+Shift+N capture.

import TopBar from '@/components/layout/TopBar';
import NotesEngine from '@/engines/notes/components/NotesEngine';
import { GLOBAL_NOTES_SCOPE } from '@/engines/notes/types';
import { useTranslation } from '@/i18n/useTranslation';

export default function NotesInbox() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col h-full bg-deep">
      <TopBar title={t('notes.inbox')} subtitle={t('notes.inboxSubtitle')} />
      <div className="flex-1 min-h-0">
        <NotesEngine projectId={GLOBAL_NOTES_SCOPE} />
      </div>
    </div>
  );
}
