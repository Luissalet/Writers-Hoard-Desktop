import type {LocalToolClient,LocalToolJson,LocalToolSnapshot} from '../sdk';
import {createLocalToolReplica} from '../convergence/replica';
import {assertConvergenceIdentity,convergenceIdentityOf} from '../convergence/format';
import type {LocalToolConvergenceContract,LocalToolConvergenceCheckpoint,LocalToolConvergenceUpdate,LocalToolReplica} from '../convergence/types';
import {validateRichBlockDocument,richBlockLeaves,type RichBlockDocument,type RichBlockAction} from '../convergence/blocks';
import {validateRichDocument,type RichDocument,type RichAction} from '../convergence/richTypes';

type Exported=Awaited<ReturnType<NonNullable<LocalToolClient<LocalToolJson>['convergence']>['export']>>;
type Gesture={receipts:string[];step:number};
/** In-memory draft of the public engine. Source import is the only durable writer. */
export class RichEditorSession {
 readonly replica:LocalToolReplica;
 readonly lineage:string;
 readonly field:string;
 readonly contract:LocalToolConvergenceContract;
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
 beforeViewChange:(()=>void)|undefined;
 afterViewChange:(()=>void)|undefined;
 error='';
 busy=false;
 revision=0;
 constructor(client:LocalToolClient<LocalToolJson>,checkpoint:LocalToolConvergenceCheckpoint,snapshot:LocalToolSnapshot<LocalToolJson>,contract:LocalToolConvergenceContract,field:string,notify:()=>void,nextStep:()=>number){
  if(!snapshot.document||checkpoint.engine.version!=='3'||contract.codec.fields[field]?.kind!=='rich')throw Error('local_tool_rich_editor_identity_invalid');
  this.contract=contract;this.notify=notify;this.nextStep=nextStep;this.client=client;this.field=field;this.lineage=snapshot.document.lineage;this.confirmedVector=checkpoint.stateVectorBase64;
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
 get dirty(){return this.sequence>this.acknowledged;}
 get pending(){return this.dirty||this.busy||this.ownUnresolved||this.composing||this.recovery||!!this.grouping;}
 get editable(){return this.alive&&this.permitted&&!this.readOnly&&!this.error;}
 get undoStep(){return this.editable&&!this.composing?this.owned.at(-1)?.step:undefined;}
 get redoStep(){return this.editable&&!this.composing?this.reverted.at(-1)?.step:undefined;}
 private changed(){this.revision++;this.notify();}
 fail(error:unknown,recoverDraft=false){if(!this.alive)return;this.recovery ||= recoverDraft||this.composing;this.error=error instanceof Error?error.message:String(error);this.permitted=false;this.changed();}
 rebind(client:LocalToolClient<LocalToolJson>,readOnly:boolean){this.client=client;this.readOnly=readOnly;this.permitted=false;this.request++;this.changed();void this.refresh();}
 private identity(result:Exported){
  if(result.snapshot.document?.lineage!==this.lineage||result.snapshot.document?.id!==this.client.documentId)throw Error('source_tool_document_lineage_conflict');
  if(!result.checkpoint||!result.update)throw Error('local_tool_convergence_not_started');assertConvergenceIdentity(result.checkpoint,convergenceIdentityOf(this.replica.checkpoint()));
 }
 private receive(result:Exported){
  this.identity(result);this.beforeViewChange?.();const received=this.replica.receive(result.update!);this.confirmedVector=result.checkpoint!.stateVectorBase64;
  this.incomplete=received.pending||result.pending||!!received.conflict;if(!this.incomplete)this.ownUnresolved=false;this.permitted=true;this.boundOnce=true;this.afterViewChange?.();this.changed();
 }
 async refresh():Promise<void>{
  if(!this.alive)return;const request=++this.request,client=this.client;let readFailed=false;
  try{const convergence=client.convergence;if(!convergence)throw Error('local_tool_convergence_unavailable');let result:Exported;try{result=await convergence.export();}catch(error){readFailed=true;throw error;}
   if(!this.alive||client!==this.client||request!==this.request)return;this.identity(result);if(this.compositionReadFailure?.client===client)this.compositionReadFailure=undefined;
   if(this.composing){this.deferred=[result];return;}this.receive(result);
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
  this.changed();
 }
 gesture(run:()=>void):boolean{
  if(!this.editable||this.grouping)return false;this.grouping=[];
  try{run();if(this.grouping.length){this.owned.push({receipts:this.grouping,step:this.nextStep()});this.reverted=[];}this.changed();return true;}
  catch(error){this.fail(error,true);return false;}finally{this.grouping=undefined;}
 }
 apply(action:RichAction|RichBlockAction){
  if(!this.grouping)throw Error('local_tool_rich_editor_gesture_required');const result=this.replica.apply([action]);
  if(result.receiptId)this.grouping.push(result.receiptId);if(result.causalChanged)this.sequence++;
  if(result.pending||result.conflict)throw Error('local_tool_rich_editor_unresolved');
 }
 reverse(redo=false):boolean{
  if(!this.editable||this.composing)return false;const from=redo?this.reverted:this.owned,to=redo?this.owned:this.reverted,gesture=from.at(-1);if(!gesture)return false;
  try{this.beforeViewChange?.();const receipts:string[]=[];for(const receipt of [...gesture.receipts].reverse()){
    const result=redo?this.replica.redo(receipt):this.replica.undo(receipt);if(result.receiptId)receipts.push(result.receiptId);if(result.causalChanged)this.sequence++;
    if(result.pending||result.conflict)throw Error('local_tool_rich_editor_unresolved');
   }from.pop();to.push({receipts,step:this.nextStep()});this.afterViewChange?.();this.changed();return true;
  }catch(error){this.fail(error,true);return false;}
 }
 save():Promise<boolean>{
  if(this.grouping)return Promise.resolve(false);if(this.flight)return this.flight;if(!this.editable||this.composing)return Promise.resolve(false);if(!this.dirty)return Promise.resolve(!this.ownUnresolved);
  const cut=this.sequence,client=this.client,update:LocalToolConvergenceUpdate=this.replica.export(this.confirmedVector);this.busy=true;this.changed();
  const write=Promise.resolve().then(async()=>{
   try{const result=await client.convergence!.import(update,{expectedLineage:this.lineage});
    if(!this.alive||client!==this.client)return false;if(result.snapshot.document?.lineage!==this.lineage)throw Error('source_tool_document_lineage_conflict');
    this.acknowledged=Math.max(this.acknowledged,cut);this.incomplete=result.pending||!!result.snapshot.convergence?.conflict;this.ownUnresolved=this.incomplete;await this.refresh();return !this.error&&!this.ownUnresolved;
   }catch(error){if(this.alive&&client===this.client){this.failedWrite=true;this.fail(error);}return false;}
   finally{this.busy=false;this.flight=undefined;if(this.alive)this.changed();}
  });this.flight=write;return write;
 }
 async retry(){if((!this.failedWrite&&!this.failedRead)||this.recovery||this.readOnly)return false;this.error='';await this.refresh();if(this.error)return false;this.failedWrite=false;this.failedRead=false;return this.save();}
 async flush(){do{if(!await this.save())return false;}while(this.dirty);return !this.pending;}
 destroy(){if(!this.alive)return;this.alive=false;this.request++;this.deferred=[];this.compositionReadFailure=undefined;this.replica.destroy();}
}
