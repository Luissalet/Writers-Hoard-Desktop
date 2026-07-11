// Version history for writings (v18). Kept in its own file so db/index.ts
// can import the type without pulling the whole writings engine.

export type SnapshotReason = 'auto' | 'manual' | 'pre-restore';

export interface WritingSnapshot {
  id: string;
  writingId: string;
  projectId: string;
  /** Title at snapshot time (the writing may be renamed later). */
  title: string;
  content: string;
  wordCount: number;
  reason: SnapshotReason;
  createdAt: number;
}
