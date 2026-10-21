import { db } from '@/db';
import type { BoardBatch } from '@/engines/board/operations';
import type { BoardNode, BoardEdge } from '@/engines/board/types';
import {mergeBoardRows,BoardBatchConflict,type BoardBaseline} from '@/engines/board/graph/merge';
import { readWorldDocument, saveEraDocument } from './store';
import { WorldEraConflict, type EraRow, type WorldEraScope } from './types';
export type EraBoardBaseline=BoardBaseline;
/** Merge independently changed row fields; overlapping edits remain in the canvas journal. */
export async function commitEraBoardBatch(scope: WorldEraScope, boardId: string, batch: BoardBatch, baseline: EraBoardBaseline): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    const read = await readWorldDocument(scope, 'board', boardId); if (!read) throw new WorldEraConflict();
    const document = structuredClone(read.document);
    try{document.children.boardNodes=mergeBoardRows((document.children.boardNodes??[]) as unknown as BoardNode[],batch.nodePuts,batch.nodeDeletes,baseline.nodes) as unknown as EraRow[];document.children.boardEdges=mergeBoardRows((document.children.boardEdges??[]) as unknown as BoardEdge[],batch.edgePuts,batch.edgeDeletes,baseline.edges) as unknown as EraRow[];}catch(error){if(error instanceof BoardBatchConflict)throw new WorldEraConflict();throw error;}
    await saveEraDocument(scope, 'board', document, read.version);
  });
}
