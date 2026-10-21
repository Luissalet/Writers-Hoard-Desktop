import type {Transaction} from 'dexie';
import {db} from '@/db';
import {announceEraChange,readWorldDocument,resetEraDocument} from '@/services/worldEras/store';
import type {EraDocumentRead,WorldEraScope} from '@/services/worldEras/types';
import type {CharacterSheet} from './types';
import {saveSheet} from './operations';
interface Receipt{scope:WorldEraScope;before:EraDocumentRead;afterVersion:string;claimed?:Transaction}
const receipts=new Map<string,Receipt>();
const outer=(tx:Transaction):Transaction=>tx.parent?outer(tx.parent):tx;
/** Only an opaque session receipt enters the native audit; authored sheet data stays local. */
export function issueSheetReceipt(tx:Transaction,scope:WorldEraScope,before:EraDocumentRead,afterVersion:string){const id=crypto.randomUUID();receipts.set(id,{scope:{...scope},before:structuredClone(before),afterVersion});outer(tx).on('abort',()=>{receipts.delete(id);});return id;}
export async function undoSheetChange(scope:WorldEraScope,receiptId:string){
 const receipt=receipts.get(receiptId);if(!receipt||receipt.scope.projectId!==scope.projectId||receipt.scope.eraId!==scope.eraId)throw Error('sheet_undo_receipt_missing');
 const sheetId=receipt.before.document.root.id;
 await db.transaction('rw',db.tables,async tx=>{
  if(receipt.claimed||receipts.get(receiptId)!==receipt)throw Error('sheet_undo_receipt_missing');const owner=outer(tx);receipt.claimed=owner;owner.on('complete',()=>{receipts.delete(receiptId);});owner.on('abort',()=>{if(receipts.get(receiptId)===receipt)receipt.claimed=undefined;});
  const current=await readWorldDocument(scope,'character-sheets',sheetId);if(!current||current.version!==receipt.afterVersion)throw Error('sheet_undo_conflict');
  if(scope.eraId&&receipt.before.provenance==='base')await resetEraDocument(scope,'character-sheets',sheetId,current.variantRevision!);
  else await saveSheet(scope.projectId,receipt.before.document.root as unknown as CharacterSheet,Number(current.document.root.revision),scope.eraId);
 });announceEraChange(scope.projectId);return sheetId;
}
