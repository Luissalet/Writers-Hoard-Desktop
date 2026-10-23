import { db } from '@/db';
import type { WorldEraScope } from '@/services/worldEras/types';
import { isThreadUnread } from './readState';
import { annotationInScope } from './scope';
import { mutateAnnotationThread } from './threads';

/** Mark one thread read, quietly: a thread that changed or vanished meanwhile is simply left as it is. */
export async function markThreadRead(scope: WorldEraScope, id: string): Promise<boolean> {
  try {
    const row = await db.annotations.get(id);
    if (!row || !annotationInScope(row, scope) || !isThreadUnread(row)) return false;
    await mutateAnnotationThread(scope, id, row.revision ?? 0, { kind: 'read', read: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Bring a thread into view and count it as read. Used by every pin on a
 * canvas (maps, boards), so "click the pin, open its thread" behaves the same.
 */
export function openCommentThread(scope: WorldEraScope, id: string): void {
  const thread = document.querySelector<HTMLElement>(`[data-comment-thread="${CSS.escape(id)}"]`);
  if (thread) {
    thread.scrollIntoView({ block: 'center', behavior: 'smooth' });
    thread.classList.add('ring-2', 'ring-accent-gold');
    window.setTimeout(() => thread.classList.remove('ring-2', 'ring-accent-gold'), 1600);
  }
  void markThreadRead(scope, id);
}
