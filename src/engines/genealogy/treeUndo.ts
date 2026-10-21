import type {Transaction} from 'dexie';
import {db} from '@/db';
import {announceEraChange,readWorldDocument,resetEraDocument} from '@/services/worldEras/store';
import type {EraDocumentRead,WorldEraScope} from '@/services/worldEras/types';
import {saveRelationTree} from './relationTreeStore';
import type {RelationTreeDocument} from './relationTrees';
interface Receipt{scope:WorldEraScope;before:EraDocumentRead;afterVersion:string;claimed?:Transaction}
const receipts=new Map<string,Receipt>();
const outer=(tx:Transaction):Transaction=>tx.parent?outer(tx.parent):tx;
export function issueTreeReceipt(tx:Transaction,scope:WorldEraScope,before:EraDocumentRead,afterVersion:string){const id=crypto.randomUUID();receipts.set(id,{scope:{...scope},before:structuredClone(before),afterVersion});outer(tx).on('abort',()=>{receipts.delete(id);});return id;}
export async function undoTreeAction(scope:WorldEraScope,receiptId:string){
 const receipt=receipts.get(receiptId);if(!receipt||receipt.scope.projectId!==scope.projectId||receipt.scope.eraId!==scope.eraId)throw Error('tree_undo_receipt_missing');const treeId=receipt.before.document.root.id;
 await db.transaction('rw',db.tables,async tx=>{
  if(receipt.claimed||receipts.get(receiptId)!==receipt)throw Error('tree_undo_receipt_missing');const owner=outer(tx);receipt.claimed=owner;owner.on('complete',()=>{receipts.delete(receiptId);});owner.on('abort',()=>{if(receipts.get(receiptId)===receipt)receipt.claimed=undefined;});
  const current=await readWorldDocument(scope,'genealogy',treeId);if(!current||current.version!==receipt.afterVersion)throw Error('tree_undo_conflict');
  if(scope.eraId&&receipt.before.provenance==='base')await resetEraDocument(scope,'genealogy',treeId,current.variantRevision!);
  else await saveRelationTree(scope.projectId,receipt.before.document.root as unknown as RelationTreeDocument,Number(current.document.root.revision),scope.eraId);
 });announceEraChange(scope.projectId);return treeId;
}
