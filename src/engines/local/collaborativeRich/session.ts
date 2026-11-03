import type {LocalToolClient,LocalToolJson,LocalToolSnapshot} from '../sdk';
import {createLocalToolReplica} from '../convergence/replica';
import {assertConvergenceIdentity,convergenceIdentityOf} from '../convergence/format';
import type {LocalToolConvergenceContract,LocalToolConvergenceCheckpoint,LocalToolConvergenceUpdate,LocalToolConvergenceIdentity,LocalToolReplica} from '../convergence/types';
import {validateRichBlockDocument,richBlockLeaves,type RichBlockDocument,type RichBlockAction} from '../convergence/blocks';
import {validateRichDocument,type RichDocument,type RichAction} from '../convergence/richTypes';
import type {LocalToolStateAction} from '../stateActions';
import {sourceCoverage,mergeDraftUpdates} from '../liveContent/coverage';

export type RichSourceExport=Awaited<ReturnType<NonNullable<LocalToolClient<LocalToolJson>['convergence']>['export']>>;
type Exported=RichSourceExport;
type Gesture={receipts:string[];step:number};
/** In-memory draft of the public engine. Source import is the only durable writer. */
export class RichEditorSession {
 readonly replica:LocalToolReplica;
 readonly lineage:string;
 readonly field:string;
 readonly contract:LocalToolConvergenceContract;
 readonly convergenceIdentity:LocalToolConvergenceIdentity;
 private notify:()=>void;
 private nextStep:()=>number;
 private recovery=false;
 private failedWrite=false;
 private failedRead=false;
 private compositionReadFailure:{client:LocalToolClient<LocalToolJson>;reason:unknown}|undefined;
 private client:LocalToolClient<LocalToolJson>;
 private alive=true;
 private request=0;
 private sequence=0;
 private acknowledged=0;
 private confirmedVector:string;
 private flight:Promise<boolean>|undefined;
 private composing=false;
 private deferred:Exported[]=[];
 private owned:Gesture[]=[];
 private reverted:Gesture[]=[];
 private grouping:string[]|undefined;
 private accepted=new WeakMap<object,number>();
 private acceptedRecords=new WeakSet<object>();
 private readOnly=false;
 private permitted=true;
 private boundOnce=false;
 private incomplete=false;
 private ownUnresolved=false;
 private exiting=false;
 private contributions:LocalToolConvergenceUpdate[]=[];
 private ownContributions:{cut:number;update:LocalToolConvergenceUpdate}[]=[];
 private draftListeners=new Set<(update:LocalToolConvergenceUpdate,saved?:RichSourceExport)=>void>();
 private stateListeners=new Set<()=>void>();
 private savedListeners=new Set<(saved:RichSourceExport)=>void>();
 private outgoing:LocalToolConvergenceUpdate[]=[];
 private deferredDrafts:LocalToolConvergenceUpdate[]=[];
 beforeViewChange:(()=>void)|undefined;
 afterViewChange:(()=>void)|undefined;
 error='';
 busy=false;
 revision=0;
 constructor(client:LocalToolClient<LocalToolJson>,checkpoint:LocalToolConvergenceCheckpoint,snapshot:LocalToolSnapshot<LocalToolJson>,contract:LocalToolConvergenceContract,field:string,notify:()=>void,nextStep:()=>number){
  if(!snapshot.document||checkpoint.engine.version!=='3'||contract.codec.fields[field]?.kind!=='rich')throw Error('local_tool_rich_editor_identity_invalid');
  this.contract=contract;this.convergenceIdentity=convergenceIdentityOf(checkpoint);this.notify=notify;this.nextStep=nextStep;this.client=client;this.field=field;this.lineage=snapshot.document.lineage;this.confirmedVector=checkpoint.stateVectorBase64;
  this.replica=createLocalToolReplica(checkpoint,{authorId:'writer-editor:'+crypto.randomUUID(),contract});this.document();
 }
 blockDocument():RichBlockDocument {const data=this.replica.read();if(!data||typeof data!=='object'||Array.isArray(data))throw Error('local_tool_rich_editor_state_invalid');const value=data[this.field];validateRichBlockDocument(value);return value;}
 document():RichDocument {const data=this.replica.read();if(!data||typeof data!=='object'||Array.isArray(data))throw Error('local_tool_rich_editor_state_invalid');const value=data[this.field],descriptor=this.contract.codec.fields[this.field];if(descriptor?.kind==='rich'&&descriptor.profile==='blocks-tree/1')return richBlockLeaves(value as unknown as RichBlockDocument);validateRichDocument(value);return value;}
 acceptedThrough(epoch:object){return this.accepted.get(epoch)??0;}
 hasAcceptedRecord(token:object){return this.acceptedRecords.has(token);}
 consumeAccepted(epoch:object,sequence:number,tokens:readonly object[]=[]){this.accepted.set(epoch,Math.max(this.acceptedThrough(epoch),sequence));for(const token of tokens)this.acceptedRecords.add(token);}
 /** A view may first mount only after a validated receive; later rebinds keep that view. */
 get hasBoundOnce(){return this.boundOnce;}
 get needsCompletion(){return this.incomplete;}
 get canRetry(){return this.alive&&(this.failedWrite||this.failedRead)&&!this.recovery&&!this.readOnly;}
 get dirty(){return this.sequence>this.acknowledged||this.contributions.length>0;}
 get shareable(){return this.alive&&this.permitted&&!this.recovery&&!this.composing&&!this.grouping&&!this.incomplete&&!this.error&&!this.exiting;}
 onDraft(listener:(update:LocalToolConvergenceUpdate,saved?:RichSourceExport)=>void){this.draftListeners.add(listener);return()=>{this.draftListeners.delete(listener);};}
 onSaved(listener:(saved:RichSourceExport)=>void){this.savedListeners.add(listener);return()=>{this.savedListeners.delete(listener);};}
 subscribeState(listener:()=>void){this.stateListeners.add(listener);return()=>{this.stateListeners.delete(listener);};}
 /** Track the admitted engine delta independently of transport; Source ACK can cover another field. */
 private admitted(update:LocalToolConvergenceUpdate){this.sequence++;this.ownContributions.push({cut:this.sequence,update:{...update}});}
 private publishDraft(){if(!this.outgoing.length||!this.draftListeners.size||!this.shareable)return;const update=mergeDraftUpdates(this.outgoing);this.outgoing=[];for(const listener of this.draftListeners)listener(update);}
 exportDraft(){if(!this.shareable)throw Error('local_tool_live_recovery_not_shareable');return this.replica.export();}
 receiveDraft(update:LocalToolConvergenceUpdate){
  if(!this.alive||this.recovery||this.error)throw Error('local_tool_live_recovery_not_shareable');
  if(this.composing){this.deferredDrafts.push(update);return;}
  try{this.beforeViewChange?.();const result=this.replica.receive(update);
   if(result.causalChanged)this.contributions.push(update);
   this.incomplete=result.pending||!!result.conflict;
   this.afterViewChange?.();this.changed();
  }catch(error){this.fail(error,true);throw error;}
 }
 /** Wait only for an already-started Source write. This never initiates a flush. */
 settleSave(){return this.flight??Promise.resolve(true);}
 get pending(){return this.dirty||this.busy||this.ownUnresolved||this.composing||this.recovery||!!this.grouping;}
 get editable(){return this.alive&&this.permitted&&!this.readOnly&&!this.error&&!this.exiting;}
 stopEditingForExit(){this.exiting=true;this.changed();}
 get undoStep(){return this.editable&&!this.composing?this.owned.at(-1)?.step:undefined;}
 get redoStep(){return this.editable&&!this.composing?this.reverted.at(-1)?.step:undefined;}
 private changed(){this.revision++;this.notify();for(const listener of this.stateListeners)listener();}
 fail(error:unknown,recoverDraft=false){if(!this.alive)return;this.recovery ||= recoverDraft||this.composing;this.error=error instanceof Error?error.message:String(error);this.permitted=false;this.changed();}
 rebind(client:LocalToolClient<LocalToolJson>,readOnly:boolean){this.client=client;this.readOnly=readOnly;this.permitted=false;this.request++;this.changed();void this.refresh();}
 private identity(result:Exported){
  if(result.snapshot.document?.lineage!==this.lineage||result.snapshot.document?.id!==this.client.documentId)throw Error('source_tool_document_lineage_conflict');
  if(!result.checkpoint||!result.update)throw Error('local_tool_convergence_not_started');assertConvergenceIdentity(result.checkpoint,convergenceIdentityOf(this.replica.checkpoint()));
 }
 receiveSaved(result:RichSourceExport){if(!this.alive)return;this.identity(result);if(this.composing||this.flight){this.deferred=[result];return;}this.receive(result,false);}
 private receive(result:Exported,propagate=true){
  this.identity(result);this.beforeViewChange?.();const received=this.replica.receive(result.update!);this.confirmedVector=result.checkpoint!.stateVectorBase64;
  if(this.contributions.length||this.ownContributions.length){const covered=sourceCoverage(result.checkpoint!);this.contributions=this.contributions.filter(update=>!covered(update));while(this.ownContributions[0]&&covered(this.ownContributions[0].update))this.acknowledged=Math.max(this.acknowledged,this.ownContributions.shift()!.cut);}
  this.incomplete=received.pending||result.pending||!!received.conflict;if(!this.incomplete)this.ownUnresolved=false;this.permitted=true;this.boundOnce=true;this.afterViewChange?.();this.changed();
  // Forward this already-produced, validated Source cut, not a fresh export of the
  // draft. Same-instance fields may use its local proof; the wire carries bytes only.
  if(propagate)for(const listener of this.savedListeners)listener(result);
  if(propagate&&received.causalChanged&&this.shareable)for(const listener of this.draftListeners)listener(result.update!,result);
 }
 async refresh():Promise<void>{
  if(!this.alive)return;const request=++this.request,client=this.client;let readFailed=false;
  try{const convergence=client.convergence;if(!convergence)throw Error('local_tool_convergence_unavailable');let result:Exported;try{result=await convergence.export();}catch(error){readFailed=true;throw error;}
   if(!this.alive||client!==this.client||request!==this.request)return;this.identity(result);if(this.compositionReadFailure?.client===client)this.compositionReadFailure=undefined;
   if(this.composing){this.deferred=[result];return;}if(this.flight){this.deferred=[result];return;}this.receive(result);
  }catch(error){if(this.alive&&client===this.client&&request===this.request){
    if(this.recovery)return;
    if(readFailed&&this.composing&&!this.error){const first=this.compositionReadFailure;this.compositionReadFailure={client,reason:first?.client===client?first.reason:error};this.changed();return;}
    this.failedRead ||= readFailed;this.fail(error,!readFailed);
   }}
 }
 beginComposition(){if(!this.editable)return false;this.composing=true;this.changed();return true;}
 endComposition(){
  const readFailure=this.compositionReadFailure;this.compositionReadFailure=undefined;this.composing=false;const deferred=this.deferred;this.deferred=[];
  // Close the accepted local gesture first. Before callbacks can publish, require a fresh
  // validated read after a deferred read failure; never clear an existing recovery barrier.
  if(!this.recovery&&!this.error&&readFailure?.client===this.client){this.failedRead=true;this.fail(readFailure.reason);}
  if(!this.recovery&&!this.error)try{for(const update of deferred)this.receive(update);}catch(error){this.fail(error,true);}
  const drafts=this.deferredDrafts;this.deferredDrafts=[];if(!this.recovery&&!this.error)try{for(const update of drafts)this.receiveDraft(update);}catch(error){this.fail(error,true);}this.publishDraft();
  this.changed();
 }
 gesture(run:()=>void):boolean{
  if(!this.editable||this.grouping)return false;this.grouping=[];
  try{run();if(this.grouping.length){this.owned.push({receipts:this.grouping,step:this.nextStep()});this.reverted=[];}this.changed();return true;}
  catch(error){this.fail(error,true);return false;}finally{this.grouping=undefined;this.publishDraft();for(const listener of this.stateListeners)listener();}
 }
 /** One public engine transaction, one receipt. A rejected batch leaves no partial gesture. */
 applyBatch(actions:readonly LocalToolStateAction[]):boolean{
  if(!this.editable||this.composing||this.grouping)return false;
  this.beforeViewChange?.();
  const result=this.replica.apply(actions);
  if(result.receiptId){this.owned.push({receipts:[result.receiptId],step:this.nextStep()});this.reverted=[];}
  if(result.causalChanged)this.admitted(result.update);
  if(result.pending||result.conflict){this.fail(Error('local_tool_rich_editor_unresolved'),true);return false;}
  try{this.afterViewChange?.();}catch(error){this.fail(error,true);return false;}if(result.causalChanged&&this.draftListeners.size)this.outgoing.push(result.update);this.changed();this.publishDraft();return true;
 }
 apply(action:RichAction|RichBlockAction){
  if(!this.grouping)throw Error('local_tool_rich_editor_gesture_required');const result=this.replica.apply([action]);
  if(result.receiptId)this.grouping.push(result.receiptId);if(result.causalChanged)this.admitted(result.update);
  if(result.pending||result.conflict)throw Error('local_tool_rich_editor_unresolved');if(result.causalChanged&&this.draftListeners.size)this.outgoing.push(result.update);
 }
 reverse(redo=false):boolean{
  if(!this.editable||this.composing)return false;const from=redo?this.reverted:this.owned,to=redo?this.owned:this.reverted,gesture=from.at(-1);if(!gesture)return false;
  try{this.beforeViewChange?.();const receipts:string[]=[];for(const receipt of [...gesture.receipts].reverse()){
    const result=redo?this.replica.redo(receipt):this.replica.undo(receipt);if(result.receiptId)receipts.push(result.receiptId);if(result.causalChanged)this.admitted(result.update);
    if(result.pending||result.conflict)throw Error('local_tool_rich_editor_unresolved');if(result.causalChanged&&this.draftListeners.size)this.outgoing.push(result.update);
   }from.pop();to.push({receipts,step:this.nextStep()});this.afterViewChange?.();this.changed();this.publishDraft();return true;
  }catch(error){this.fail(error,true);return false;}
 }
 save():Promise<boolean>{
  if(this.grouping)return Promise.resolve(false);if(this.flight)return this.flight;if(!this.editable||this.composing)return Promise.resolve(false);if(!this.dirty)return Promise.resolve(!this.ownUnresolved);
  const cut=this.sequence,remoteCut=this.contributions.length,client=this.client,update:LocalToolConvergenceUpdate=this.replica.export(this.confirmedVector);this.busy=true;this.changed();
  const write=Promise.resolve().then(async()=>{
   try{const result=await client.convergence!.import(update,{expectedLineage:this.lineage});
    if(!this.alive||client!==this.client)return false;if(result.snapshot.document?.lineage!==this.lineage)throw Error('source_tool_document_lineage_conflict');
    this.acknowledged=Math.max(this.acknowledged,cut);this.ownContributions=this.ownContributions.filter(own=>own.cut>cut);this.contributions.splice(0,remoteCut);this.incomplete=result.pending||!!result.snapshot.convergence?.conflict;this.ownUnresolved=this.incomplete;const saved=await client.convergence!.export();if(this.alive&&client===this.client){if(this.composing)this.deferred.push(saved);else this.receive(saved);}return !this.error&&!this.ownUnresolved;
   }catch(error){if(this.alive&&client===this.client){this.failedWrite=true;this.fail(error);}return false;}
   finally{this.busy=false;this.flight=undefined;const deferred=this.deferred;this.deferred=[];if(this.alive&&!this.composing&&!this.recovery){for(const read of deferred)try{this.receive(read);}catch(error){this.fail(error,true);}}else if(this.composing)this.deferred=deferred;if(this.alive)this.changed();}
  });this.flight=write;return write;
 }
 async retry(save=()=>this.save()){if((!this.failedWrite&&!this.failedRead)||this.recovery||this.readOnly)return false;this.error='';await this.refresh();if(this.error)return false;this.failedWrite=false;this.failedRead=false;return save();}
 async flush(){do{if(!await this.save())return false;}while(this.dirty);return !this.pending;}
 destroy(){if(!this.alive)return;this.alive=false;this.request++;this.deferred=[];this.deferredDrafts=[];this.draftListeners.clear();this.savedListeners.clear();this.stateListeners.clear();this.compositionReadFailure=undefined;this.replica.destroy();}
}
