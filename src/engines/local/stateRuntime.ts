import type {LocalToolAdoptionReceiptSuccessor} from './convergence/clientTypes';
import {assertConvergenceIdentity,convergenceIdentityOf} from './convergence/format';
import type {LocalToolConvergenceIdentity} from './convergence/formatTypes';
import type {LocalToolClient,LocalToolSnapshot} from './sdk';
import type {LocalToolConvergenceReceipt} from './convergence/types';
import type {LocalToolStateCodec} from './stateCodec';
import {cloneLocalToolJson,type LocalToolJson} from './stateTypes';
import {localToolStateEqual,mergeLocalToolActions,type LocalToolStateAction} from './stateActions';
import type {LocalToolOwnedBlockEnvelope} from './blocks/types';
export interface LocalToolActionResult<T extends LocalToolJson>{snapshot:LocalToolSnapshot<T>;receiptId:string|null}
export interface LocalToolStateActions<T extends LocalToolJson>{apply(baseline:LocalToolSnapshot<T>,actions:readonly LocalToolStateAction[]):Promise<LocalToolActionResult<T>>;undo(receiptId:string):Promise<LocalToolActionResult<T>>;redo(receiptId:string):Promise<LocalToolActionResult<T>>}
/** Host-only port. Package clients cannot supply envelopes to this receipt mechanism. */
export interface LocalToolOwnedEvolutionPort<T extends LocalToolJson>{pending():boolean;capture():LocalToolOwnedBlockEnvelope;apply(baseline:LocalToolSnapshot<T>,actions:readonly LocalToolStateAction[]):Promise<{snapshot:LocalToolSnapshot<T>;changed:boolean}>;restore(expectedVersion:string,envelope:LocalToolOwnedBlockEnvelope):Promise<LocalToolSnapshot<T>>}
/** Host-only preparation port. A returned recipe is not usable until outer commit. */
export interface LocalToolConvergenceActionPort<T extends LocalToolJson>{apply(baseline:LocalToolSnapshot<T>,actions:readonly LocalToolStateAction[]):Promise<{snapshot:LocalToolSnapshot<T>;receipt?:LocalToolConvergenceReceipt|null}>;reverse(receipt:LocalToolConvergenceReceipt):Promise<{snapshot:LocalToolSnapshot<T>;receipt?:LocalToolConvergenceReceipt|null}>}
export interface LocalToolActionTransaction<T extends LocalToolJson>{/** Stable outer transaction identity, shared by all prepared calls. */receiptTransaction?:object;convergence?:LocalToolConvergenceActionPort<T>;client:LocalToolClient<T>;identity?:string;ownedEvolution?:LocalToolOwnedEvolutionPort<T>;onCommit(callback:()=>void):void;onAbort(callback:()=>void):void}
interface ReceiptBase {identity:string;mode:'undo'|'redo';claimed:boolean;owner?:object;successorIdentity?:LocalToolConvergenceIdentity}
type Receipt=(ReceiptBase&{kind:'convergence';recipe:LocalToolConvergenceReceipt})|(ReceiptBase&{kind:'actions';baseline:LocalToolSnapshot<LocalToolJson>;actions:LocalToolStateAction[]})|(ReceiptBase&{kind:'owned-evolution';before:LocalToolOwnedBlockEnvelope;after:LocalToolOwnedBlockEnvelope});
const receipts=new Map<string,Receipt>();let nextReceipt=0;
const liveReceiptOwners=new WeakMap<object,{key:object;owned:Set<string>}>();
type ReceiptStacks={undo:string[];redo:string[];branch:number};
const convergenceStacks=new Map<string,ReceiptStacks>();
const pendingStacks=new WeakMap<object,Map<string,ReceiptStacks>>();
type ReceiptTransactionHooks=Pick<LocalToolActionTransaction<LocalToolJson>,'receiptTransaction'|'onCommit'|'onAbort'>;
const scopedReceiptIdentity=(identity:string,current:LocalToolSnapshot<LocalToolJson>)=>JSON.stringify([identity,current.document?.lineage??current.block?.lineage??null,current.convergence?.genesisId??null]);
function transactionStacks(transaction:ReceiptTransactionHooks,identity:string):ReceiptStacks{
 const owner=transaction.receiptTransaction??transaction;let pending=pendingStacks.get(owner);
 if(!pending){pending=new Map();pendingStacks.set(owner,pending);const prepared=pending;
  transaction.onAbort(()=>pendingStacks.delete(owner));
  transaction.onCommit(()=>{for(const[key,stack]of prepared){if(stack.undo.length||stack.redo.length)convergenceStacks.set(key,stack);else convergenceStacks.delete(key);}pendingStacks.delete(owner);});
 }
 let stack=pending.get(identity);if(!stack){const committed=convergenceStacks.get(identity);stack={undo:[...(committed?.undo??[])],redo:[...(committed?.redo??[])],branch:committed?.branch??0};pending.set(identity,stack);}return stack;
}
/** Host-only author branch notification; the discarded receipts survive an abort. */
export function prepareLocalToolConvergenceBranch(identity:string,current:LocalToolSnapshot<LocalToolJson>,transaction:ReceiptTransactionHooks):void{
 if(!current.convergence)return;const stack=transactionStacks(transaction,scopedReceiptIdentity(identity,current)),discarded=[...stack.redo];stack.redo.length=0;stack.branch++;
 transaction.onCommit(()=>{for(const id of discarded)receipts.delete(id);});
}
/** Host-only continuation: no JSON token can manufacture this live port's owned set. */
export function prepareLocalToolStateAdoption(state:object|undefined,origin:LocalToolConvergenceIdentity,active:LocalToolConvergenceIdentity,transaction:ReceiptTransactionHooks,current:()=>boolean):LocalToolAdoptionReceiptSuccessor[]{
 const owner=state?liveReceiptOwners.get(state):undefined;if(!owner||origin.engine.version!=='3'||active.engine.version!=='4')return[];const result:LocalToolAdoptionReceiptSuccessor[]=[];
 for(const previous of [...owner.owned]){
  const receipt=receipts.get(previous);if(!receipt||receipt.kind!=='convergence'||receipt.claimed||receipt.successorIdentity||receipt.recipe.identity.engine.version!=='3')continue;
  try{assertConvergenceIdentity(receipt.recipe.identity,origin);}catch{continue;}
  const stack=transactionStacks(transaction,receipt.identity)[receipt.mode],at=stack.indexOf(previous);if(at<0)continue;
  const successor='local-state-'+(++nextReceipt)+'-'+Math.random().toString(36).slice(2),next:Receipt={...receipt,recipe:structuredClone(receipt.recipe),owner:owner.key,successorIdentity:convergenceIdentityOf(active),claimed:false};stack[at]=successor;result.push({previous,successor});
  transaction.onCommit(()=>{
   receipts.delete(previous);owner.owned.delete(previous);let live=false;try{live=current();}catch{/* A revoked owner cannot receive a successor. */}
   if(live){receipts.set(successor,next);owner.owned.add(successor);}else{const committed=convergenceStacks.get(receipt.identity);if(committed)committed[receipt.mode]=committed[receipt.mode].filter(id=>id!==previous&&id!==successor);}
  });
 }
 return result;
}
/** Session receipts become available/consumed only with the outer transaction. */
export function createLocalToolStateActions<T extends LocalToolJson>(codec:LocalToolStateCodec,identity:string,atomic:<R>(run:(transaction:LocalToolActionTransaction<T>)=>Promise<R>)=>Promise<R>):LocalToolStateActions<T>{
 const ownerKey={},ownedReceipts=new Set<string>();
 const receiptIdentity=(transaction:LocalToolActionTransaction<T>,current:LocalToolSnapshot<T>)=>scopedReceiptIdentity(transaction.identity??identity,current);
 const recordConvergence=(transaction:LocalToolActionTransaction<T>,snapshot:LocalToolSnapshot<T>,recipe:LocalToolConvergenceReceipt|null|undefined,mode:'undo'|'redo',newBranch=false,owner?:object)=>{
  if(!recipe)return null;
  if(recipe.mode!==mode||recipe.identity.genesisId!==snapshot.convergence?.genesisId)throw Error('local_tool_state_receipt_unavailable');
  const receiptId='local-state-'+(++nextReceipt)+'-'+Math.random().toString(36).slice(2),record:Receipt={kind:'convergence',identity:receiptIdentity(transaction,snapshot),mode,recipe:structuredClone(recipe),claimed:false,...(owner?{owner}:{})};
  const stacks=transactionStacks(transaction,record.identity);
  if(newBranch){const discarded=[...stacks.redo];stacks.redo.length=0;stacks.branch++;transaction.onCommit(()=>{for(const id of discarded)receipts.delete(id);});}
  stacks[mode].push(receiptId);transaction.onCommit(()=>{receipts.set(receiptId,record);ownedReceipts.add(receiptId);});return receiptId;
 };
 const recordEvolution=(transaction:LocalToolActionTransaction<T>,current:LocalToolSnapshot<T>,before:LocalToolOwnedBlockEnvelope,after:LocalToolOwnedBlockEnvelope,mode:'undo'|'redo')=>{
  const receiptId='local-state-'+(++nextReceipt)+'-'+Math.random().toString(36).slice(2),record:Receipt={kind:'owned-evolution',identity:receiptIdentity(transaction,current),mode,before:structuredClone(before),after:structuredClone(after),claimed:false};
  transaction.onCommit(()=>receipts.set(receiptId,record));return receiptId;
 };
 const applyIn=async(transaction:LocalToolActionTransaction<T>,baseline:LocalToolSnapshot<T>,actions:readonly LocalToolStateAction[],mode:'undo'|'redo'):Promise<LocalToolActionResult<T>>=>{
  if(!baseline||baseline.revision!==null&&(!Number.isSafeInteger(baseline.revision)||baseline.revision<0))throw Error('local_tool_actions_baseline_invalid');
  const current=await transaction.client.read();
  if(current.block&&(!baseline.block||baseline.block.id!==current.block.id||baseline.block.lineage!==current.block.lineage))throw Error('local_tool_block_lineage_conflict');
  if(current.document&&(!baseline.document||baseline.document.id!==current.document.id||baseline.document.lineage!==current.document.lineage))throw Error('source_tool_document_lineage_conflict');
  if((current.convergence?.genesisId??null)!==(baseline.convergence?.genesisId??null))throw Error('source_tool_document_lineage_conflict');
  if(baseline.revision!==null&&(current.revision===null||baseline.revision>current.revision))throw Error('local_tool_actions_baseline_invalid');
  const owned=transaction.ownedEvolution;
  if(owned?.pending()){
   const before=owned.capture(),result=await owned.apply(baseline,actions);
   if(!result.changed)return{snapshot:result.snapshot,receiptId:null};
   return{snapshot:result.snapshot,receiptId:recordEvolution(transaction,current,before,owned.capture(),mode)};
  }
  const hasRichIntent=actions.some(action=>action.type.startsWith('rich-')||codec.fields[action.field]?.kind==='rich');
  if(hasRichIntent&&!current.convergence)throw Error('local_tool_rich_convergence_required');
  const hasPlainIntent=hasRichIntent||actions.some(action=>action.type==='text-splice');
  if(hasPlainIntent&&!current.convergence)throw Error('local_tool_plain_convergence_required');
  const merged=hasPlainIntent?undefined:mergeLocalToolActions(codec,baseline.data,current.data,actions);
  if(current.convergence){
   if(!transaction.convergence)throw Error('local_tool_convergence_host_unavailable');
   const result=await transaction.convergence.apply(baseline,actions);
   return{snapshot:result.snapshot,receiptId:recordConvergence(transaction,result.snapshot,result.receipt,mode,true)};
  }
  if(!merged!.inverse.length)return{snapshot:current,receiptId:null};
  const snapshot=await transaction.client.save(merged!.data,current.revision,current.document?.version??current.block?.version),receiptId='local-state-'+(++nextReceipt)+'-'+Math.random().toString(36).slice(2);
  transaction.onCommit(()=>receipts.set(receiptId,{kind:'actions',identity:receiptIdentity(transaction,current),mode,baseline:structuredClone(snapshot),actions:cloneLocalToolJson(merged!.inverse as unknown as LocalToolJson) as unknown as LocalToolStateAction[],claimed:false}));return{snapshot,receiptId};
 };
 const reverse=(mode:'undo'|'redo',receiptId:string)=>atomic(async transaction=>{
  const receipt=receipts.get(receiptId),current=await transaction.client.read();
  if(!receipt||receipt.identity!==receiptIdentity(transaction,current)||receipt.mode!==mode||receipt.claimed||receipt.owner!==undefined&&receipt.owner!==ownerKey)throw Error('local_tool_state_receipt_unavailable');
  if(receipt.kind==='convergence'&&transactionStacks(transaction,receipt.identity)[mode].at(-1)!==receiptId)throw Error('local_tool_state_receipt_unavailable');
  receipt.claimed=true;transaction.onAbort(()=>{receipt.claimed=false;});
  try{
  if(receipt.kind==='convergence'){
   if(!transaction.convergence||!current.convergence)throw Error('local_tool_state_receipt_unavailable');
   const authorBranch=transactionStacks(transaction,receipt.identity).branch;
   let recipe=receipt.recipe;if(receipt.successorIdentity){assertConvergenceIdentity(current.convergence,receipt.successorIdentity);recipe={...structuredClone(recipe),identity:convergenceIdentityOf(receipt.successorIdentity)};}const result=await transaction.convergence.reverse(recipe);
   const stacks=transactionStacks(transaction,receipt.identity),stack=stacks[mode];
   if(stack.at(-1)!==receiptId||stacks.branch!==authorBranch||receiptIdentity(transaction,result.snapshot)!==receipt.identity)throw Error('local_tool_state_receipt_unavailable');
   stack.pop();
   const inverseId=recordConvergence(transaction,result.snapshot,result.receipt,mode==='undo'?'redo':'undo',false,receipt.owner);transaction.onCommit(()=>{receipts.delete(receiptId);ownedReceipts.delete(receiptId);});
   return{snapshot:result.snapshot,receiptId:inverseId};
  }
  if(receipt.kind==='owned-evolution'){
   const owned=transaction.ownedEvolution;if(!owned||!current.block)throw Error('local_tool_state_receipt_unavailable');
   const before=owned.capture(),{revision:actualRevision,...actualBody}=before,{revision:storedRevision,...storedBody}=receipt.after;void actualRevision;void storedRevision;
   if(!localToolStateEqual(actualBody,storedBody))throw Error('local_tool_block_conflict');
   const snapshot=await owned.restore(current.block.version,receipt.before);
   const inverseId=recordEvolution(transaction,current,before,owned.capture(),mode==='undo'?'redo':'undo');transaction.onCommit(()=>receipts.delete(receiptId));return{snapshot,receiptId:inverseId};
  }
  const result=await applyIn(transaction,receipt.baseline as LocalToolSnapshot<T>,receipt.actions,mode==='undo'?'redo':'undo');transaction.onCommit(()=>receipts.delete(receiptId));return result;
  }catch(error){receipt.claimed=false;throw error;}
 });
 const port=Object.freeze({apply:(baseline:LocalToolSnapshot<T>,actions:readonly LocalToolStateAction[])=>atomic(transaction=>applyIn(transaction,baseline,actions,'undo')),undo:(receiptId:string)=>reverse('undo',receiptId),redo:(receiptId:string)=>reverse('redo',receiptId)});liveReceiptOwners.set(port,{key:ownerKey,owned:ownedReceipts});return port;
}
