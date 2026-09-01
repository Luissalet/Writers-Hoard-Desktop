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

/**
 * A version WITHOUT its body — the shape every list, count and "which is the
 * newest" question actually needs.
 *
 * `content` is the whole chapter, and a chapter that has been opened three
 * hundred times carries three hundred of them. Everything the history panel
 * renders (when, why, how long) and everything the AI bridge reports back is in
 * the other seven fields, so those callers get this type and never pay for the
 * prose. The one row whose text is genuinely wanted — the version the writer
 * clicked, or the one being restored — is read on its own by id.
 */
export type WritingSnapshotMeta = Omit<WritingSnapshot, 'content'>;
