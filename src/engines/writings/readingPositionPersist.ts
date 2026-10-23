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
// The principal position keeps its legacy root shape. Additional books share
// this session row under `manuscripts`; updateSetting merges one position
// atomically so saving one pane cannot erase another book's bookmark.

import { getSetting, PROJECT_SETTING_PREFIXES, updateSetting } from '@/db/operations';
import {
  parseReadingPosition,
  serializeReadingPosition,
  type SavedReadingPosition,
} from './readingWindow';

function positionKey(projectId: string): string {
  return `${PROJECT_SETTING_PREFIXES.readingPosition}${projectId}`;
}

/** The place this project was left at, or `null` if it has none this app trusts. */
export async function loadReadingPosition(projectId: string,manuscriptId='main'): Promise<SavedReadingPosition | null> {
  const raw=await getSetting(positionKey(projectId));if(manuscriptId==='main')return parseReadingPosition(raw);
  try{return parseReadingPosition(JSON.stringify(JSON.parse(raw??'{}').manuscripts?.[manuscriptId]));}catch{return null;}
}

/**
 * Remember the place.
 *
 * A failure is swallowed rather than reported. The caller is a throttled timer
 * inside the scroll path with nowhere to put an error, the cost of one lost
 * write is a chapter to scroll back to, and the next tick writes again anyway
 * — none of which is worth an unhandled rejection thrown out of a reader.
 */
export async function saveReadingPosition(position: SavedReadingPosition,manuscriptId='main'): Promise<void> {
  try {
    await updateSetting(positionKey(position.projectId),raw=>{let current:Record<string,unknown>={};try{current=JSON.parse(raw??'{}');}catch{/* A malformed old bookmark has no position to retain. */}const value=JSON.parse(serializeReadingPosition(position));return JSON.stringify(manuscriptId==='main'?{...value,...(current.manuscripts?{manuscripts:current.manuscripts}:{})}:{...current,manuscripts:{...(current.manuscripts as Record<string,unknown>??{}),[manuscriptId]:value}});});
  } catch {
    // Nothing to retry: the position this dropped is already superseded.
  }
}
