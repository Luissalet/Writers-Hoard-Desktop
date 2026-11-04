import {localToolRichLinks,localToolRichTables,localToolRichTableAxes,localToolRichTableWidths,isLocalToolRichBlockField} from '../stateCodec';
import {localToolRichImageAlignment,localToolRichImageCells,localToolRichTableRowHeights,localToolRichTableCellHeaders,localToolRichTableCellSpans,localToolRichImageRaster,localToolRichImages} from '../stateCodecFormat';
import {isRichImageEngine} from '../convergence/imageFormat';
import {sameTableCellBindings,type RichTableCellCapture} from '../convergence/tableAxesEditing';
import type {LocalToolClient,LocalToolJson,LocalToolSnapshot} from '../sdk';
import {createLocalToolReplica} from '../convergence/replica';
import {assertConvergenceIdentity,convergenceIdentityOf,convergenceIdentity,convergenceClone,convergenceCanonical} from '../convergence/format';
import {effectiveRichAdoptionContract,RICH_ADOPTION_MISSING,RICH_LEGACY_MISSING} from '../convergence/richAdoption';
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
 contract:LocalToolConvergenceContract;
 private readonly targetContract:LocalToolConvergenceContract;
 convergenceIdentity:LocalToolConvergenceIdentity;
 private confirmedIdentity:LocalToolConvergenceIdentity;
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
 private deferredDrafts:{update:LocalToolConvergenceUpdate;attempt:string;needsFull:boolean}[]=[];
 private admissionProgress=0;
 private compositionEpoch=0;
 private drainingDrafts=false;
 beforeViewChange:(()=>void)|undefined;
 afterViewChange:(()=>void)|undefined;
 error='';
 busy=false;
 revision=0;
 constructor(client:LocalToolClient<LocalToolJson>,checkpoint:LocalToolConvergenceCheckpoint,snapshot:LocalToolSnapshot<LocalToolJson>,contract:LocalToolConvergenceContract,field:string,notify:()=>void,nextStep:()=>number){
  const version=checkpoint.engine.version,supported=['3','4','5','6','7'].includes(version)||isRichImageEngine(version);
  if(!snapshot.document||!supported||contract.codec.fields[field]?.kind!=='rich')throw Error('local_tool_rich_editor_identity_invalid');
  this.targetContract=contract;this.contract=effectiveRichAdoptionContract(checkpoint,contract);this.convergenceIdentity=convergenceIdentityOf(checkpoint);this.confirmedIdentity=convergenceIdentityOf(checkpoint);this.notify=notify;this.nextStep=nextStep;this.client=client;this.field=field;this.lineage=snapshot.document.lineage;this.confirmedVector=checkpoint.stateVectorBase64;
  this.replica=createLocalToolReplica(checkpoint,{authorId:'writer-editor:'+crypto.randomUUID(),contract});this.document();
 }
 get tables(){return localToolRichTables(this.contract.codec.fields[this.field]);}
 get axes(){return localToolRichTableAxes(this.contract.codec.fields[this.field]);}
 get widths(){return localToolRichTableWidths(this.contract.codec.fields[this.field]);}
 get links(){return localToolRichLinks(this.contract.codec.fields[this.field]);}
 get images(){return localToolRichImages(this.contract.codec.fields[this.field]);}
 get cellSpans(){return localToolRichTableCellSpans(this.contract.codec.fields[this.field]);}
 get cellHeaders(){return localToolRichTableCellHeaders(this.contract.codec.fields[this.field]);}
 get rowHeights(){return localToolRichTableRowHeights(this.contract.codec.fields[this.field]);}
 get imageCells(){return localToolRichImageCells(this.contract.codec.fields[this.field]);}
 get imageRaster(){return localToolRichImageRaster(this.contract.codec.fields[this.field]);}
 get imageAlignment(){return localToolRichImageAlignment(this.contract.codec.fields[this.field]);}
 get assets(){return this.client.assets;}
 blockDocument():RichBlockDocument {const data=this.replica.read();if(!data||typeof data!=='object'||Array.isArray(data))throw Error('local_tool_rich_editor_state_invalid');const value=data[this.field];validateRichBlockDocument(value,this.links,this.tables,this.axes,this.widths,this.images,this.imageAlignment,this.imageRaster,this.imageCells,this.rowHeights,this.cellHeaders,this.cellSpans);return value;}
 document():RichDocument {const data=this.replica.read();if(!data||typeof data!=='object'||Array.isArray(data))throw Error('local_tool_rich_editor_state_invalid');const value=data[this.field],descriptor=this.contract.codec.fields[this.field];if(isLocalToolRichBlockField(descriptor))return richBlockLeaves(value as unknown as RichBlockDocument,this.links,this.tables);validateRichDocument(value,this.links);return value;}
 acceptedThrough(epoch:object){return this.accepted.get(epoch)??0;}
 hasAcceptedRecord(token:object){return this.acceptedRecords.has(token);}
 consumeAccepted(epoch:object,sequence:number,tokens:readonly object[]=[]){this.accepted.set(epoch,Math.max(this.acceptedThrough(epoch),sequence));for(const token of tokens)this.acceptedRecords.add(token);}
 /** A view may first mount only after a validated receive; later rebinds keep that view. */
 get hasBoundOnce(){return this.boundOnce;}
 get needsCompletion(){return this.incomplete||this.deferredDrafts.length>0;}
 get needsFull(){return this.deferredDrafts.some(entry=>entry.needsFull);}
 get receiveProgress(){return this.admissionProgress+':'+this.compositionEpoch;}
 get canAdopt(){return this.editable&&this.shareable&&!this.busy&&this.convergenceIdentity.engine.version==='3'&&!!this.targetContract.richAdoption&&localToolRichLinks(this.targetContract.codec.fields[this.field]);}
 get definitionContract(){return this.targetContract;}
 /** Transient SDK verification. New joins require completeness; live identity/recovery retain ordinary pending. */
 prepareRemote(update:LocalToolConvergenceUpdate,requireComplete=true){
  const candidate=createLocalToolReplica(this.replica.checkpoint(),{authorId:'adoption-verify',contract:this.targetContract});
  try{const result=candidate.receive(update);if(requireComplete&&(result.pending||result.conflict))throw Error('local_tool_live_recovery_not_shareable');return candidate.export();}finally{candidate.destroy();}
 }
 identityForSource(source:LocalToolConvergenceIdentity,proof?:LocalToolConvergenceUpdate){
  const own=convergenceIdentityOf(this.replica.checkpoint());
  if(convergenceCanonical(source)===convergenceCanonical(own)&&!(source.engine.version==='3'&&proof?.engine.version==='4'&&this.targetContract.richAdoption)){this.replica.inspect();return own;}
  if(!this.targetContract.richAdoption)throw Error('local_tool_convergence_identity_mismatch');
  if(source.engine.version==='3')effectiveRichAdoptionContract(source,this.targetContract);
  else assertConvergenceIdentity(source,convergenceIdentity(this.targetContract,own.genesisId));
  const active=own.engine.version==='4'?own:proof?convergenceIdentityOf(this.prepareRemote(proof,false)):undefined;
  if(!active)throw Error('local_tool_rich_adoption_dependency_missing');assertConvergenceIdentity(active,convergenceIdentity(this.targetContract,source.genesisId));this.replica.inspect();return active;
 }
 get canRetry(){return this.alive&&(this.failedWrite||this.failedRead)&&!this.recovery&&!this.readOnly;}
 get dirty(){return this.sequence>this.acknowledged||this.contributions.length>0;}
 get shareable(){return this.alive&&this.permitted&&!this.recovery&&!this.composing&&!this.grouping&&!this.incomplete&&!this.error&&!this.exiting&&!this.deferredDrafts.length;}
 onDraft(listener:(update:LocalToolConvergenceUpdate,saved?:RichSourceExport)=>void){this.draftListeners.add(listener);return()=>{this.draftListeners.delete(listener);};}
 onSaved(listener:(saved:RichSourceExport)=>void){this.savedListeners.add(listener);return()=>{this.savedListeners.delete(listener);};}
 subscribeState(listener:()=>void){this.stateListeners.add(listener);return()=>{this.stateListeners.delete(listener);};}
 /** Track the admitted engine delta independently of transport; Source ACK can cover another field. */
 private admitted(update:LocalToolConvergenceUpdate){this.sequence++;this.ownContributions.push({cut:this.sequence,update:{...update}});}
 private publishDraft(){if(!this.outgoing.length||!this.draftListeners.size||!this.shareable)return;const update=mergeDraftUpdates(this.outgoing);this.outgoing=[];for(const listener of this.draftListeners)listener(update);}
 exportDraft(){if(!this.shareable)throw Error('local_tool_live_recovery_not_shareable');return this.replica.export();}
 private syncContract(){
  const identity=convergenceIdentityOf(this.replica.checkpoint());
  if(convergenceCanonical(identity)!==convergenceCanonical(this.convergenceIdentity)){assertConvergenceIdentity(identity,convergenceIdentity(this.targetContract,identity.genesisId));this.contract=this.targetContract;this.convergenceIdentity=identity;}
 }
 private applyDraft(update:LocalToolConvergenceUpdate){
  this.beforeViewChange?.();const result=this.replica.receive(update);if(result.causalChanged){this.contributions.push(convergenceClone(update));this.admissionProgress++;}this.syncContract();this.incomplete=result.pending||!!result.conflict;this.afterViewChange?.();this.changed();
 }
 private needsFullError(error:unknown){return error instanceof Error&&(error.message===RICH_ADOPTION_MISSING||error.message===RICH_LEGACY_MISSING);}
 private retainDraft(update:LocalToolConvergenceUpdate,needsFull:boolean){
  const key=convergenceCanonical(update),entry=this.deferredDrafts.find(entry=>convergenceCanonical(entry.update)===key);
  if(entry){if(needsFull&&!entry.needsFull){entry.needsFull=true;this.changed();}return;}
  this.deferredDrafts.push({update:convergenceClone(update),attempt:this.receiveProgress,needsFull});this.changed();
 }
 private drainDrafts(){
  if(this.drainingDrafts||this.composing||this.recovery||this.error)return;this.drainingDrafts=true;
  try{let progressed=true;while(progressed&&!this.composing&&!this.recovery&&!this.error){progressed=false;for(const entry of [...this.deferredDrafts]){
   if(entry.attempt===this.receiveProgress)continue;entry.attempt=this.receiveProgress;
   try{this.applyDraft(entry.update);this.deferredDrafts.splice(this.deferredDrafts.indexOf(entry),1);progressed=true;}
   catch(error){if(this.needsFullError(error)){entry.needsFull=true;continue;}this.fail(error,true);throw error;}
  }}}finally{this.drainingDrafts=false;this.changed();this.publishDraft();}
 }
 receiveDraft(update:LocalToolConvergenceUpdate):'integrated'|'deferred'|'needs-full'{
  if(!this.alive||this.recovery||this.error)throw Error('local_tool_live_recovery_not_shareable');const original=convergenceClone(update);
  if(this.composing){this.retainDraft(original,false);return'deferred';}
  try{this.applyDraft(original);}catch(error){if(this.needsFullError(error)){this.retainDraft(original,true);return'needs-full';}this.fail(error,true);throw error;}
  this.drainDrafts();return'integrated';
 }
 adopt(){
  if(!this.canAdopt)return false;this.beforeViewChange?.();const result=this.replica.adopt(this.targetContract);this.syncContract();if(result.causalChanged){this.admitted(result.update);this.admissionProgress++;this.outgoing.push(result.update);}this.afterViewChange?.();this.changed();this.publishDraft();return true;
 }
 /** Wait only for an already-started Source write. This never initiates a flush. */
 settleSave(){return this.flight??Promise.resolve(true);}
 get pending(){return this.dirty||this.busy||this.ownUnresolved||this.composing||this.recovery||!!this.grouping||this.deferredDrafts.length>0;}
 retireDraftReceives(){this.deferredDrafts=[];this.compositionEpoch++;this.changed();}
 get editable(){return this.alive&&this.permitted&&!this.readOnly&&!this.error&&!this.exiting;}
 stopEditingForExit(){this.exiting=true;this.changed();}
 get undoStep(){return this.editable&&!this.composing?this.owned.at(-1)?.step:undefined;}
 get redoStep(){return this.editable&&!this.composing?this.reverted.at(-1)?.step:undefined;}
 private changed(){this.revision++;this.notify();for(const listener of this.stateListeners)listener();}
 fail(error:unknown,recoverDraft=false){if(!this.alive)return;this.recovery ||= recoverDraft||this.composing;this.error=error instanceof Error?error.message:String(error);this.permitted=false;this.changed();}
 rebind(client:LocalToolClient<LocalToolJson>,readOnly:boolean){this.client=client;this.readOnly=readOnly;this.permitted=false;this.request++;this.changed();void this.refresh();}
 private identity(result:Exported){
  if(result.snapshot.document?.lineage!==this.lineage||result.snapshot.document?.id!==this.client.documentId)throw Error('source_tool_document_lineage_conflict');
  if(!result.checkpoint||!result.update)throw Error('local_tool_convergence_not_started');if(result.checkpoint.engine.version==='3'&&this.convergenceIdentity.engine.version==='4'&&this.targetContract.richAdoption){effectiveRichAdoptionContract(result.checkpoint,this.targetContract);return;}if(result.checkpoint.engine.version==='4'&&this.convergenceIdentity.engine.version==='3'&&this.targetContract.richAdoption){assertConvergenceIdentity(result.checkpoint,convergenceIdentity(this.targetContract,this.convergenceIdentity.genesisId));return;}assertConvergenceIdentity(result.checkpoint,convergenceIdentityOf(this.replica.checkpoint()));
 }
 receiveSaved(result:RichSourceExport){if(!this.alive)return;this.identity(result);if(this.composing||this.flight){this.deferred=[result];return;}this.receive(result,false);}
 private receive(result:Exported,propagate=true){
  this.identity(result);this.beforeViewChange?.();const received=this.replica.receive(result.update!);if(received.causalChanged)this.admissionProgress++;this.syncContract();this.confirmedVector=result.checkpoint!.stateVectorBase64;this.confirmedIdentity=convergenceIdentityOf(result.checkpoint!);
  if(this.contributions.length||this.ownContributions.length){const covered=sourceCoverage(result.checkpoint!);this.contributions=this.contributions.filter(update=>!covered(update));while(this.ownContributions[0]&&covered(this.ownContributions[0].update))this.acknowledged=Math.max(this.acknowledged,this.ownContributions.shift()!.cut);}
  this.incomplete=received.pending||result.pending||!!received.conflict;if(!this.incomplete)this.ownUnresolved=false;this.permitted=true;this.boundOnce=true;this.afterViewChange?.();this.changed();this.drainDrafts();
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
 /** A provisional empty-cell IME gesture must see any already received axis withdrawal. */
 assertTableCellCommit(capture:RichTableCellCapture){
  if(!this.composing)return;if(this.compositionReadFailure)throw this.compositionReadFailure.reason;
  const updates=[...this.deferred.map(read=>read.update!),...this.deferredDrafts.map(entry=>entry.update)];if(!updates.length)return;
  const view=createLocalToolReplica(this.replica.checkpoint(),{authorId:'table-cell-composition',contract:this.contract});
  try{
   let pending=false;for(const update of updates)pending=view.receive(update).pending;if(pending)throw Error('local_tool_table_cell_composition_stale');
   const current=view.richTableCellCapture(capture.field,capture.tableId,capture.rowId,capture.columnId,capture.afterId);
   if(!sameTableCellBindings(current.bindings,capture.bindings,this.widths?[capture.rowId,capture.columnId]:[capture.rowId])||view.inspect().conflict)throw Error('local_tool_table_cell_composition_stale');
  }finally{view.destroy();}
 }
 endComposition(){
  const readFailure=this.compositionReadFailure;this.compositionReadFailure=undefined;this.composing=false;const deferred=this.deferred;this.deferred=[];
  // Close the accepted local gesture first. Before callbacks can publish, require a fresh
  // validated read after a deferred read failure; never clear an existing recovery barrier.
  if(!this.recovery&&!this.error&&readFailure?.client===this.client){this.failedRead=true;this.fail(readFailure.reason);}
  if(!this.recovery&&!this.error)try{for(const update of deferred)this.receive(update);}catch(error){this.fail(error,true);}
  this.compositionEpoch++;if(!this.recovery&&!this.error)try{this.drainDrafts();}catch(error){this.fail(error,true);}this.publishDraft();
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
  const cut=this.sequence,remoteCut=this.contributions.length,client=this.client,update:LocalToolConvergenceUpdate=this.replica.export(this.convergenceIdentity.engine.version==='4'&&this.confirmedIdentity.engine.version==='3'?undefined:this.confirmedVector);this.busy=true;this.changed();
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
