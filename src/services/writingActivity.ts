// ============================================
// Writing activity — feed the editor's real typing into writing-stats
// ============================================
//
// Before this existed, daily goals/streaks were fed ONLY by the sprint
// timer: hours of actual prose typed in the Writings editor counted for
// nothing. The editor's autosave flush now reports word deltas here; we
// accumulate them into one session row per (project, day).

import { db } from '@/db/index';
import { generateId } from '@/utils/idGenerator';
import type { WritingSession } from '@/engines/writing-stats/types';
import { toLocalDateKey } from '@/engines/writing-stats/date';

const EDITOR_NOTE = 'editor';

/**
 * Accumulate words typed in the prose editor into today's auto session.
 * Fire-and-forget: never throws.
 *
 * @param wordsDelta   Net new words since the last flush (negatives ignored —
 *                     deleting a paragraph shouldn't erase today's progress).
 * @param secondsDelta Active seconds since the last flush (caller caps idle).
 */
export async function recordEditorActivity(
  projectId: string,
  wordsDelta: number,
  secondsDelta: number,
): Promise<void> {
  if (!projectId || (wordsDelta <= 0 && secondsDelta <= 0)) return;
  const date = toLocalDateKey();
  try {
    await db.transaction('rw', db.writingSessions, async () => {
      // The transaction serializes concurrent editor flushes. Consolidating
      // any legacy duplicates also restores the intended one-row-per-day shape.
      const existing = await db.writingSessions
        .where('projectId')
        .equals(projectId)
        .and((s) => s.date === date && s.type === 'freewrite' && s.notes === EDITOR_NOTE)
        .toArray();
      const words = Math.max(0, wordsDelta);
      const duration = Math.max(0, Math.round(secondsDelta));
      const now = Date.now();

      if (existing.length > 0) {
        const [primary, ...duplicates] = existing;
        await db.writingSessions.update(primary.id, {
          wordCount:
            existing.reduce((sum, session) => sum + session.wordCount, 0) + words,
          duration:
            existing.reduce((sum, session) => sum + session.duration, 0) + duration,
          updatedAt: now,
        });
        if (duplicates.length > 0) {
          await db.writingSessions.bulkDelete(duplicates.map((session) => session.id));
        }
        return;
      }

      const session: WritingSession = {
        id: generateId('ws'),
        projectId,
        date,
        wordCount: words,
        duration,
        type: 'freewrite',
        notes: EDITOR_NOTE,
        createdAt: now,
        updatedAt: now,
      };
      await db.writingSessions.add(session);
    });
  } catch (err) {
    console.error('[writingActivity] failed to record session', err);
  }
}
