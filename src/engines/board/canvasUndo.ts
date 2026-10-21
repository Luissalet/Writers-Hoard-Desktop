import type {Transaction} from 'dexie';
import {db} from '@/db';
import {listWorldDocuments,readWorldDocument,announceEraChange} from '@/services/worldEras/store';
import type {WorldEraScope} from '@/services/worldEras/types';
import {commitEraBoardBatch} from '@/services/worldEras/board';
import {commitBoardBatch} from './operations';
import type {BoardBaseline} from './graph/merge';
interface Receipt {scope:WorldEraScope;boardId:string;before:BoardBaseline;afterVersion:string;claimed?:Transaction}
const receipts=new Map<string,Receipt>();
const outerTransaction=(tx:Transaction):Transaction=>{while(tx.parent)tx=tx.parent;return tx;};
/** Session-only Undo payload: audit carries its opaque ID, never image/prose snapshots. */
export function issueCanvasReceipt(tx:Transaction,scope:WorldEraScope,boardId:string,before:BoardBaseline,afterVersion:string):string{const id=crypto.randomUUID();receipts.set(id,{scope:{...scope},boardId,before:structuredClone(before),afterVersion});outerTransaction(tx).on('abort',()=>{receipts.delete(id);});return id;}
export async function undoCanvasAction(scope:WorldEraScope,receiptId:string):Promise<{restored:true;boardId:string;version:string}>{
 const receipt=receipts.get(receiptId);if(!receipt||receipt.scope.projectId!==scope.projectId||receipt.scope.eraId!==scope.eraId)throw Error('canvas_undo_receipt_missing');
 await db.transaction('rw',db.tables,async tx=>{
  if(receipt.claimed||receipts.get(receiptId)!==receipt)throw Error('canvas_undo_receipt_missing');const outer=outerTransaction(tx);receipt.claimed=outer;outer.on('complete',()=>{receipts.delete(receiptId);});outer.on('abort',()=>{if(receipts.get(receiptId)===receipt)receipt.claimed=undefined;});
  const current=await readWorldDocument(scope,'board',receipt.boardId);if(!current||current.version!==receipt.afterVersion)throw Error('canvas_undo_conflict');
  const nodes=current.document.children.boardNodes as unknown as BoardBaseline['nodes'],edges=current.document.children.boardEdges as unknown as BoardBaseline['edges'];
  for(const [table,rows] of [['boardNodes',receipt.before.nodes],['boardEdges',receipt.before.edges]] as const){const existing=await db[table].bulkGet(rows.map(row=>row.id));if(existing.some(row=>row&&(row.projectId!==scope.projectId||row.boardId!==receipt.boardId)))throw Error('canvas_undo_identity_conflict');}
  if(scope.eraId){const documents=await listWorldDocuments(scope,'board');for(const [table,rows] of [['boardNodes',receipt.before.nodes],['boardEdges',receipt.before.edges]] as const){const ids=new Set(rows.map(row=>row.id));if(documents.some(item=>item.document.root.id!==receipt.boardId&&item.document.children[table]?.some(row=>ids.has(row.id))))throw Error('canvas_undo_identity_conflict');}}
  const nodeIds=new Set(receipt.before.nodes.map(row=>row.id)),edgeIds=new Set(receipt.before.edges.map(row=>row.id)),batch={nodePuts:structuredClone(receipt.before.nodes),edgePuts:structuredClone(receipt.before.edges),nodeDeletes:nodes.filter(row=>!nodeIds.has(row.id)).map(row=>row.id),edgeDeletes:edges.filter(row=>!edgeIds.has(row.id)).map(row=>row.id)};
  if(scope.eraId)await commitEraBoardBatch(scope,receipt.boardId,batch,{nodes,edges});else await commitBoardBatch(batch,{nodes,edges});
 });announceEraChange(scope.projectId);return{restored:true,boardId:receipt.boardId,version:(await readWorldDocument(scope,'board',receipt.boardId))!.version};
}
