// ============================================
// AnnotationsSidebarBadge — pills on the engine tab
// ============================================
//
// Rendered by the Sidebar via the engine definition's `SidebarBadge` slot
// (see `EngineDefinition.SidebarBadge`). Two small counts, each only when it
// is above zero:
//   - gold: threads the writer has not read yet (made or answered through the
//     AI bridge);
//   - red: orphaned annotations — a text-range anchor whose fuzzy reanchor
//     failed — so the writer can triage relinks.

import { useOrphanCount, useUnreadCount } from '../hooks';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';

export default function AnnotationsSidebarBadge({ projectId }: EngineComponentProps) {
  const { count } = useOrphanCount(projectId);
  const { count: unread } = useUnreadCount(projectId);
  const { locale } = useTranslation();
  if (count <= 0 && unread <= 0) return null;
  const es = locale === 'es';
  const pill = 'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-semibold';

  return (
    <span className="ml-auto inline-flex items-center gap-1">
      {unread > 0 && (
        <span
          data-testid="annotations-unread-badge"
          className={`${pill} bg-accent-gold/20 text-accent-gold`}
          title={es ? `${unread} ${unread === 1 ? 'comentario sin leer' : 'comentarios sin leer'}` : `${unread} unread ${unread === 1 ? 'comment' : 'comments'}`}
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
      {count > 0 && (
        <span
          data-testid="annotations-orphan-badge"
          className={`${pill} bg-danger/15 text-danger`}
          title={`${count} orphaned annotation${count === 1 ? '' : 's'}`}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </span>
  );
}
