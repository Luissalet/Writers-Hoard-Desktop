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
  const date = new Date().toISOString().slice(0, 10);
  try {
    const existing = await db.writingSessions
      .where('projectId')
      .equals(projectId)
      .and((s) => s.date === date && s.type === 'freewrite' && s.notes === EDITOR_NOTE)
      .first();

    if (existing) {
      await db.writingSessions.update(existing.id, {
        wordCount: existing.wordCount + Math.max(0, wordsDelta),
        duration: existing.duration + Math.max(0, Math.round(secondsDelta)),
        updatedAt: Date.now(),
      });
    } else {
      const session: WritingSession = {
        id: generateId('ws'),
        projectId,
        date,
        wordCount: Math.max(0, wordsDelta),
        duration: Math.max(0, Math.round(secondsDelta)),
        type: 'freewrite',
        notes: EDITOR_NOTE,
        createdAt: Date.now(),
      };
      await db.writingSessions.add(session);
    }
  } catch (err) {
    console.error('[writingActivity] failed to record session', err);
  }
}
