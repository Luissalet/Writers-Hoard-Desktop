// Version history for writings (v18). Kept in its own file so db/index.ts
// can import the type without pulling the whole writings engine.

/** 'pre-ai' is taken by the AI bridge before an external model overwrites a body. */
export type SnapshotReason = 'auto' | 'manual' | 'pre-restore' | 'pre-ai';

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
