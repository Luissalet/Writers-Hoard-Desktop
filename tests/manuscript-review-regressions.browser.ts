import { testRevisionsCore } from './revisions-core.browser';
import { testRevisionsUi } from './revisions-ui.browser';
import { testRevisionTools } from './revisions-tools.browser';
import { testRevisionsExport } from './revisions-export.browser';
import { testDocumentTools } from './documents-ui.browser';
import { testDocumentHistory } from './document-history.browser';
import { testCommentThreadReceipts, testCommentOrphanReceipts } from './comment-thread-receipts.browser';
export async function testManuscriptReviewRegressions() {
  const out: string[] = [];
  for (const [label, run] of [['revisions-core', testRevisionsCore], ['revisions-ui', testRevisionsUi], ['revisions-tools', testRevisionTools], ['revisions-export', testRevisionsExport], ['documents-ui', testDocumentTools], ['history', testDocumentHistory], ['receipts', testCommentThreadReceipts], ['orphan-receipts', testCommentOrphanReceipts]] as const) for (const result of await run()) out.push(`${label}: ${result}`);
  return out;
}
/** Existing history matrix needs the new SDK document fixture before it can run. */
export async function testManuscriptReviewStableRegressions() {
  const out: string[] = [];
  for (const [label, run] of [['revisions-core', testRevisionsCore], ['revisions-ui', testRevisionsUi], ['revisions-tools', testRevisionTools], ['revisions-export', testRevisionsExport], ['documents-ui', testDocumentTools], ['receipts', testCommentThreadReceipts], ['orphan-receipts', testCommentOrphanReceipts]] as const) for (const result of await run()) out.push(`${label}: ${result}`);
  return out;
}
