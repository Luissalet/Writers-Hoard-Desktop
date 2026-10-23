// ============================================
// Annotations — read state (pure)
// ============================================
//
// `Annotation.readAt` is optional on purpose. A thread with no `readAt` is
// read: that is every thread written before read state existed and every
// thread the writer made. A thread is unread when `readAt` is 0 (made through
// the AI bridge, or marked unread by hand) or when the bridge has replied
// after the time it was last read.

import type { Annotation } from './types';

type ReadFields = Pick<Annotation, 'readAt' | 'replies'>;

export function isThreadUnread(row: ReadFields): boolean {
  if (row.readAt === 0) return true;
  const readAt = row.readAt ?? 0;
  return (row.replies ?? []).some(reply => reply.fromBridge === true && reply.createdAt > readAt);
}

export function countUnread(rows: readonly ReadFields[]): number {
  return rows.reduce((total, row) => total + (isThreadUnread(row) ? 1 : 0), 0);
}

/** Unread threads first; everything else keeps the order it came in. */
export function unreadFirst<T extends ReadFields>(rows: readonly T[]): T[] {
  const unread: T[] = [], read: T[] = [];
  for (const row of rows) (isThreadUnread(row) ? unread : read).push(row);
  return [...unread, ...read];
}

/** The time a thread counts as read at: now, but never before its newest reply. */
export function readTime(row: Pick<Annotation, 'replies'>, now = Date.now()): number {
  return (row.replies ?? []).reduce((latest, reply) => Math.max(latest, reply.createdAt, reply.updatedAt), now);
}
