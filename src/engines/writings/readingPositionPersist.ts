// ============================================
// Where reading stopped — the single row
// ============================================
//
// The counterpart of the resume logic in `readingWindow.ts`, and the only
// place a reading position touches Dexie.
//
// It lives in the existing `settings` key/value table, one row per project,
// for the same reason the proofreader's dismissals do: this is a fact about
// the writer's session rather than about the manuscript, and it must not
// become a table that every backup, export, delete and restore path has to
// learn about. The prefix is declared in `PROJECT_SETTING_PREFIXES`, which is
// what makes `deleteProject` and the ZIP restore's `clearProjectForRestore`
// carry the bookmark off with the project it belongs to — without that one
// line, a project re-imported onto an id it had used before would inherit the
// previous book's place in it.
//
// `setSetting` rather than `updateSetting`: the dismissals are a collection
// changed one member at a time and genuinely need the read and the write in
// one transaction, whereas a reading position is a whole value replaced
// outright. Two overlapping saves are two answers to "where am I now", and the
// later one is the one worth keeping.

import { getSetting, PROJECT_SETTING_PREFIXES, setSetting } from '@/db/operations';
import {
  parseReadingPosition,
  serializeReadingPosition,
  type SavedReadingPosition,
} from './readingWindow';

function positionKey(projectId: string): string {
  return `${PROJECT_SETTING_PREFIXES.readingPosition}${projectId}`;
}

/** The place this project was left at, or `null` if it has none this app trusts. */
export async function loadReadingPosition(projectId: string): Promise<SavedReadingPosition | null> {
  return parseReadingPosition(await getSetting(positionKey(projectId)));
}

/**
 * Remember the place.
 *
 * A failure is swallowed rather than reported. The caller is a throttled timer
 * inside the scroll path with nowhere to put an error, the cost of one lost
 * write is a chapter to scroll back to, and the next tick writes again anyway
 * — none of which is worth an unhandled rejection thrown out of a reader.
 */
export async function saveReadingPosition(position: SavedReadingPosition): Promise<void> {
  try {
    await setSetting(positionKey(position.projectId), serializeReadingPosition(position));
  } catch {
    // Nothing to retry: the position this dropped is already superseded.
  }
}
