/** Persisted metadata only: also consumed by Electron and backup schemas. */
export interface ManuscriptSourceReceipt { id: string; eraId?: string; writingIds: string[]; planDigest: string; createdAt: number }
export interface ManuscriptSourceRow { id: string; projectId: string; sha256: string; name: string; format: string; original: Blob; revision: number; receipts: ManuscriptSourceReceipt[]; createdAt: number }
export interface ManuscriptWritingSource { sourceId: string; commitId: string; chapterKey: string; contentHash: string }
export interface ImportedCommentOrigin { sourceId: string; commentId: string; author: string; date: string }
