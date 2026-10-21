import type { ManuscriptSourceRow, ManuscriptWritingSource, ImportedCommentOrigin } from './sourceTypes';
/** Metadata cloning has no document reader, database or renderer dependency. */
export function cloneManuscriptSource(row: ManuscriptSourceRow, projectId: string, remap: (id: string, prefix: string) => string): ManuscriptSourceRow {
  return { ...row, id: remap(row.id, 'msource'), projectId, receipts: row.receipts.map(receipt => ({ ...receipt, id: remap(receipt.id, 'mcommit'), eraId: receipt.eraId ? remap(receipt.eraId, 'era') : undefined, writingIds: receipt.writingIds.map(id => remap(id, 'wr')) })) };
}
export function cloneManuscriptWritingSource(row: ManuscriptWritingSource | undefined, remap: (id: string, prefix: string) => string) { return row ? { ...row, sourceId: remap(row.sourceId, 'msource'), commitId: remap(row.commitId, 'mcommit') } : undefined; }
export function cloneImportedCommentOrigin(row: ImportedCommentOrigin | undefined, remap: (id: string, prefix: string) => string) { return row ? { ...row, sourceId: remap(row.sourceId, 'msource') } : undefined; }
export function validateImportedCommentOrigin(value: unknown) {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || ['sourceId', 'commentId', 'author', 'date'].some(key => typeof (value as Record<string, unknown>)[key] !== 'string')) throw Error('manuscript_comment_origin_invalid');
}
