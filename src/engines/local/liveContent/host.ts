import {requireLocalImageActions} from '../assetSources';
import {readSourceToolDocument} from '../documents/store';
import type {RichEditorSession,RichSourceExport} from '../collaborativeRich/session';
import type {LocalToolConvergenceUpdate,LocalToolConvergenceIdentity} from '../convergence/types';
import {convergenceIdentityOf,convergenceCanonical} from '../convergence/format';
import {RICH_ADOPTION_MISSING,RICH_LEGACY_MISSING} from '../convergence/richAdoption';
import {convergenceClone,assertConvergenceIdentity} from '../convergence/format';
import type {LocalToolJson} from '../stateTypes';
import type {ContentNetwork,LocalToolDocumentContent,LocalToolSaveMode} from './types';
import {DocumentSavePreference} from './savePreference';
import type {LocalToolClient} from '../sdk';
import type {LocalToolStateAction} from '../stateActions';
import {assertWorldEra} from '@/services/worldEras/store';

const hosts=new WeakMap<LocalToolDocumentContent,LocalDocumentContentHost>();
export const liveDocumentHosts=new Set<LocalDocumentContentHost>();
export function documentContentHost(port:LocalToolDocumentContent|undefined){return port?hosts.get(port):undefined;}
/** A coordinator over the existing field replicas, never a second writer or mirror. */
export class LocalDocumentContentHost {
 readonly port:LocalToolDocumentContent;
 private sessions=new Map<RichEditorSession,{reload:()=>void;off?:()=>void;offState:()=>void;offSaved:()=>void}>();
 private listeners=new Set<()=>void>();
 private network:ContentNetwork|undefined;
 private epoch=0;
 private alive=true;
 private leaving=false;
 private needsCatchup=false;
 private activeProof:LocalToolConvergenceUpdate|undefined;
 private repairRequest:{network:ContentNetwork;epoch:number;id:string}|undefined;
 private requestedFull:string|undefined;
 private answeredFull:string|undefined;
 private error='';
 private sending=Promise.resolve();
 private savePreference:DocumentSavePreference;
 private offPreference:()=>void;
 private saveMode:LocalToolSaveMode;
 private timer:ReturnType<typeof setTimeout>|undefined;
 private scheduleEpoch=0;
 private exitEpoch=0;
 private documentFlight:Promise<boolean>|undefined;
 private waitingFlights:Promise<void>|undefined;
 private autosaveError='';
 private schedulerStopped=false;
 readonly instanceId:string;
 readonly client:LocalToolClient<LocalToolJson>;
 private current:()=>boolean;
 private releaseHash:string|null|undefined;
 constructor(instanceId:string,current:()=>boolean,client:LocalToolClient<LocalToolJson>,releaseHash?:string|null,savePreference=new DocumentSavePreference()){
  this.releaseHash=releaseHash;this.savePreference=savePreference;this.saveMode=savePreference.mode;
  this.offPreference=savePreference.subscribe(()=>{if(this.saveMode!==savePreference.mode){this.saveMode=savePreference.mode;this.scheduleEpoch++;this.cancelTimer();}this.reconcileAutosave();this.changed();});
  this.instanceId=instanceId;this.current=current;this.client=client;
  this.port=Object.freeze({instanceId,getSnapshot:()=>this.snapshot(),subscribe:(changed:()=>void)=>{this.listeners.add(changed);return()=>{this.listeners.delete(changed);};},query:()=>this.query(),capture:((field:string,request:LocalToolJson)=>this.capture(field,request)) as LocalToolDocumentContent['capture'],apply:async(field:string,actions:readonly LocalToolStateAction[])=>{const captured=convergenceClone(actions);if(!Array.isArray(captured)||!captured.length||captured.some(action=>action.field!==field))throw Error('local_tool_live_action_field_mismatch');await this.validate();const session=this.session(field),bytes=requireLocalImageActions(session.assets,captured);if(bytes){await bytes;await this.validate();if(this.session(field)!==session)throw Error('local_tool_live_host_unavailable');}return session.applyBatch(captured);},setSaveMode:(mode:LocalToolSaveMode)=>{this.assert();return this.savePreference.choose(mode,()=>this.validate());},control:(action:'undo'|'redo'|'save'|'leave'|'retry'|'adopt',field?:string)=>this.control(action,field)});
  hosts.set(this.port,this);liveDocumentHosts.add(this);
 }
 private assert(){if(!this.alive||!this.current())throw Error('local_tool_live_host_unavailable');}
 async sourceDescriptor(){
  this.assert();const snapshot=await this.client.read();this.assert();if(!snapshot.document||snapshot.document.id!==this.client.documentId||!snapshot.convergence)throw Error('local_tool_live_identity_invalid');
  const readActual=async()=>{
   const actual=await readSourceToolDocument({projectId:this.client.projectId,eraId:this.client.eraId},snapshot.document!.id,this.client.namespace),project=await assertWorldEra({projectId:this.client.projectId,eraId:this.client.eraId});this.assert();
   if(!project.enabledEngines.includes('local-tool-'+this.client.namespace))throw Error('local_tool_live_engine_disabled');if(this.releaseHash!==undefined&&(project.localToolInstallations?.[this.client.namespace]?.contentHash??null)!==this.releaseHash)throw Error('local_tool_pin_conflict');
   if(!actual||actual.lineage!==snapshot.document!.lineage||!actual.document.convergence)throw Error('source_tool_document_lineage_conflict');for(const session of this.sessions.keys())if(actual.lineage!==session.lineage)throw Error('source_tool_document_lineage_conflict');
   return convergenceIdentityOf(actual.document.convergence.checkpoint);
  };
  let source=await readActual(),identity:LocalToolConvergenceIdentity;
  try{identity=this.documentIdentity(source);}catch(error){
   if(!(error instanceof Error&&error.message===RICH_ADOPTION_MISSING)||source.engine.version!=='4')throw error;const full=await this.client.convergence!.export();this.assert();if(!full.update)throw error;this.prepareRemote(full.update,false);
   // FULL verification awaits real storage. Revalidate scope/pin/lineage after it.
   source=await readActual();identity=this.documentIdentity(source);
  }
  return{snapshot,source,identity};
 }
 private async validate(){await this.sourceDescriptor();}

 private changed(){for(const changed of this.listeners)changed();}
 snapshot(){const first=this.sessions.keys().next().value;return convergenceClone({source:'live' as const,saveMode:this.savePreference.mode,modeReady:this.savePreference.ready,...(this.savePreference.error?{preferenceError:this.savePreference.error}:{}),autosaveState:this.autosaveState(),...(this.autosaveError?{autosaveError:this.autosaveError}:{}),instanceId:this.instanceId,networkEpoch:this.epoch,roomId:this.network?.roomId??null,scope:{projectId:this.client.projectId,eraId:this.client.eraId??null},documentId:this.client.documentId??null,namespace:this.client.namespace,lineage:first?.lineage??null,identity:first?.convergenceIdentity??null,sharing:!!this.network,saveReady:this.saveReady(),fields:[...new Set([...this.sessions.keys()].map(s=>s.field))],draftRevision:[...this.sessions.keys()].reduce((n,s)=>n+s.revision,0),pending:[...this.sessions.keys()].some(s=>s.pending),...(this.error?{error:this.error}:{})});}
 register(session:RichEditorSession,reload:()=>void){this.assert();const entry={reload,off:undefined as (()=>void)|undefined,offSaved:session.onSaved(saved=>{for(const other of this.sessions.keys())if(other!==session)other.receiveSaved(saved);}),offState:session.subscribeState(()=>{this.reconcileAutosave();this.changed();this.resumeCatchup();this.reconcileRecovery();})};this.sessions.set(session,entry);if(this.network){entry.off=session.onDraft((update,saved)=>this.local(session,update,saved));void this.publishFull().catch(error=>{this.error=String(error);this.detach();});}this.reconcileAutosave();this.changed();return()=>{entry.off?.();entry.offState();entry.offSaved();this.sessions.delete(session);this.reconcileAutosave();this.changed();};}
 private session(field?:string){this.assert();if(this.leaving)throw Error('local_tool_live_leaving');const values=[...this.sessions.keys()].filter(s=>!field||s.field===field);if(values.length!==1)throw Error('local_tool_live_field_ambiguous');return values[0];}
 async query():Promise<LocalToolJson> {await this.validate();return convergenceClone({...this.snapshot(),documents:[...this.sessions.keys()].map(s=>({field:s.field,data:s.replica.read(),dirty:s.dirty,editable:s.editable}))}) as unknown as LocalToolJson;}
 async capture(field:string,request:LocalToolJson):Promise<LocalToolJson>{
  request=convergenceClone(request);await this.validate();
  const s=this.session(field);if(!request||typeof request!=='object'||Array.isArray(request))throw Error('local_tool_live_capture_invalid');const r=request as Record<string,LocalToolJson>,node=String(r.nodeId??'');
  if(r.kind==='image'){if(r.channel!=='source'&&r.channel!=='size')throw Error('local_tool_live_capture_invalid');return convergenceClone(s.replica.richImageCapture(field,node,r.channel)) as unknown as LocalToolJson;}
  if(r.kind==='table-column-width')return convergenceClone(s.replica.richTableColumnWidthCapture(field,String(r.tableId),String(r.columnId))) as unknown as LocalToolJson;
  if(r.kind==='table-axis')return convergenceClone(s.replica.richTableAxisCapture(field,String(r.tableId),r.axis as import('../convergence/tableAxesFormat').RichTableAxis,(r.afterId??null) as string|null)) as unknown as LocalToolJson;
  if(r.kind==='table-cell')return convergenceClone(s.replica.richTableCellCapture(field,String(r.tableId),String(r.rowId),String(r.columnId),(r.afterId??null) as string|null)) as unknown as LocalToolJson;
  if(r.kind==='range')return convergenceClone(s.replica.richRange(field,node,Number(r.from),Number(r.to))) as unknown as LocalToolJson;
  if(r.kind==='split')return convergenceClone(s.replica.richSplitCapture(field,node,Number(r.at))) as unknown as LocalToolJson;
  if(r.kind==='join')return convergenceClone(s.replica.richJoinCapture(field,String(r.leftNodeId),String(r.rightNodeId))) as unknown as LocalToolJson;
  if(r.kind==='block-edit')return convergenceClone(s.replica.richBlockEditCapture(field,r.nodeIds as string[],r.destination as unknown as import('../convergence/blocks').RichBlockPlacement|undefined)) as unknown as LocalToolJson;
  if(r.kind==='block-wrap')return convergenceClone(s.replica.richBlockCapture(field,{nodeIds:r.nodeIds as string[]})) as unknown as LocalToolJson;
  if(r.kind==='block-move')return convergenceClone(s.replica.richBlockMoveCapture(field,node,r.destination as unknown as import('../convergence/blocks').RichBlockPlacement)) as unknown as LocalToolJson;
  if(r.kind==='block-split')return convergenceClone(s.replica.richBlockSplitCapture(field,node,Number(r.at))) as unknown as LocalToolJson;
  if(r.kind==='block-join')return convergenceClone(s.replica.richBlockJoinCapture(field,String(r.leftNodeId),String(r.rightNodeId))) as unknown as LocalToolJson;
  if(r.kind==='empty-item')return convergenceClone(s.replica.richBlockEmptyItemCapture(field,node)) as unknown as LocalToolJson;
  throw Error('local_tool_live_capture_invalid');
 }
 private healthy(){this.assert();if(!this.sessions.size||[...this.sessions.keys()].some(s=>!s.shareable))throw Error('local_tool_live_recovery_not_shareable');}
 private saveReady(){return!this.leaving&&this.sessions.size>0&&[...this.sessions.keys()].every(s=>s.shareable);}
 /** A reconnect keeps the author and network binding; deferred composition is not a failure. */
 reconnect(network:ContentNetwork){if(!this.alive||!this.current()||!this.network)return;this.network=network;this.repairRequest=undefined;this.needsCatchup=true;this.resumeCatchup();this.reconcileRecovery();this.changed();}
 private resumeCatchup(){if(!this.needsCatchup||!this.network||!this.saveReady())return;this.needsCatchup=false;const network=this.network,epoch=this.epoch;queueMicrotask(()=>{if(network!==this.network||epoch!==this.epoch)return;void this.publishFull().catch(error=>{if(epoch===this.epoch){this.error=String(error);this.changed();}});});}
 /** Merge every admitted field into each existing replica before taking a document cut. */
 seed(){this.healthy();const sessions=[...this.sessions.keys()],updates=sessions.map(s=>s.exportDraft());for(let i=0;i<sessions.length;i++)for(let j=0;j<updates.length;j++)if(i!==j)sessions[i].receiveDraft(updates[j]);this.healthy();return sessions[0].exportDraft();}
 async start(network:ContentNetwork,remote?:LocalToolConvergenceUpdate){this.healthy();this.detach();this.network=network;const epoch=this.epoch;for(const[s,e]of this.sessions)e.off=s.onDraft((update,saved)=>this.local(s,update,saved));if(remote)this.receive(remote);await this.publishFull();if(epoch===this.epoch)this.changed();}
 prepareRemote(update:LocalToolConvergenceUpdate,requireComplete=true){
  this.assert();let prepared:LocalToolConvergenceUpdate|undefined;for(const session of this.sessions.keys()){const candidate=session.prepareRemote(update,requireComplete);if(prepared)assertConvergenceIdentity(candidate,convergenceIdentityOf(prepared));else prepared=candidate;}if(!prepared)throw Error('local_tool_live_host_unavailable');if(prepared.engine.version==='4')this.activeProof=convergenceClone(prepared);return convergenceIdentityOf(prepared);
 }
 documentIdentity(source:LocalToolConvergenceIdentity){
  this.assert();const live=[...this.sessions.keys()].find(s=>s.convergenceIdentity.engine.version==='4'),proof=live?.replica.export()??this.activeProof;let result:LocalToolConvergenceIdentity|undefined;
  for(const session of this.sessions.keys()){const identity=session.identityForSource(source,proof);if(result)assertConvergenceIdentity(identity,result);else result=identity;}return result??source;
 }
 receive(update:LocalToolConvergenceUpdate){
  this.assert();if(!this.network)return;
  if(update.engine.version==='4'&&[...this.sessions.keys()].some(s=>s.convergenceIdentity.engine.version==='3'))try{this.prepareRemote(update,false);}catch(error){if(!(error instanceof Error&&(error.message===RICH_ADOPTION_MISSING||error.message===RICH_LEGACY_MISSING)))throw error;}
  for(const s of this.sessions.keys())s.receiveDraft(update);this.changed();this.reconcileRecovery();
 }
 requestedFullContent(requestId:string){if(!this.network||!this.alive||!this.current()||requestId===this.answeredFull)return;this.requestedFull=requestId;this.reconcileRecovery();}
 private reconcileRecovery(){
  if(!this.network||!this.alive||!this.current()||this.leaving)return;
  if(this.requestedFull&&this.saveReady()){const request=this.requestedFull;this.requestedFull=undefined;this.answeredFull=request;void this.publishFull().catch(error=>{if(this.network){this.error=String(error);this.changed();}});}
  if(![...this.sessions.keys()].some(s=>s.needsFull)){if(![...this.sessions.keys()].some(s=>s.needsCompletion))this.repairRequest=undefined;return;}
  const network=this.network,epoch=this.epoch;if(!network.requestFull||this.repairRequest)return;
  const request={network,epoch,id:crypto.randomUUID()};this.repairRequest=request;
  void network.requestFull(request.id).then(full=>{if(this.alive&&this.current()&&this.network===network&&this.epoch===epoch&&this.repairRequest===request&&full)this.receive(full);}).catch(error=>{if(this.alive&&this.network===network&&epoch===this.epoch){this.error=String(error);this.changed();}});
 }

 private local(source:RichEditorSession,update:LocalToolConvergenceUpdate,saved?:RichSourceExport){if(!this.network)return;try{for(const s of this.sessions.keys())if(s!==source){if(saved)s.receiveSaved(saved);else s.receiveDraft(update);}this.enqueue(update);}catch(error){this.error=String(error);this.detach();}this.changed();}
 private enqueue(update:LocalToolConvergenceUpdate){if(this.network?.identity&&convergenceCanonical(this.network.identity)!==convergenceCanonical(convergenceIdentityOf(update)))update=this.seed();const epoch=this.epoch,network=this.network,messageId=crypto.randomUUID();if(!network)return;this.sending=this.sending.catch(()=>{}).then(async()=>{if(epoch!==this.epoch||network!==this.network)return;this.assert();await network.send(update,messageId);if(epoch===this.epoch&&this.error){this.error='';this.changed();}}).catch(error=>{if(epoch===this.epoch){this.error=String(error);this.changed();}});}
 private async publishFull(){if(!this.network)return;this.enqueue(this.seed());await this.sending;}
 detach(){this.epoch++;this.needsCatchup=false;this.network=undefined;this.repairRequest=undefined;this.requestedFull=undefined;this.answeredFull=undefined;this.activeProof=undefined;for(const session of this.sessions.keys())session.retireDraftReceives();for(const entry of this.sessions.values()){entry.off?.();entry.off=undefined;}this.changed();}
 async leave(){this.assert();if(this.leaving||!this.network)return false;this.leaving=true;this.schedulerStopped=true;this.scheduleEpoch++;this.exitEpoch++;this.cancelTimer();const network=this.network;network?.retire?.();this.detach();const sessions=[...this.sessions];for(const[s]of sessions)s.stopEditingForExit();const settled=await Promise.all(sessions.map(([s])=>s.settleSave()));await network?.leave();this.assert();if(settled.some(ok=>!ok)){this.error='local_tool_live_save_reconciliation_failed';this.leaving=false;this.changed();return false;}for(const[s,e]of sessions)if(this.sessions.get(s)===e)e.reload();this.leaving=false;this.schedulerStopped=false;this.reconcileAutosave();this.changed();return true;}
 private cancelTimer(){if(this.timer!==undefined){clearTimeout(this.timer);this.timer=undefined;}}
 private dirty(){return[...this.sessions.keys()].some(s=>s.dirty);}
 private documentSave(){return!!this.network||this.savePreference.mode==='automatic';}
 private autosaveState():'manual'|'idle'|'waiting'|'saving'|'blocked'{if(this.savePreference.mode==='manual')return'manual';if(this.documentFlight||[...this.sessions.keys()].some(s=>s.busy))return'saving';if(this.autosaveError)return'blocked';return this.dirty()?'waiting':'idle';}
 private reconcileAutosave(){
  if(!this.alive||!this.current()||this.leaving||this.schedulerStopped||!this.savePreference.ready||this.savePreference.mode!=='automatic'||this.autosaveError||!this.dirty()){this.cancelTimer();return;}
  if(this.documentFlight||this.waitingFlights){this.cancelTimer();return;}
  const sessions=[...this.sessions.keys()];
  if(sessions.some(s=>s.busy)){
   this.cancelTimer();const waiting=Promise.all(sessions.map(s=>s.settleSave())).then(()=>{}).finally(()=>{if(this.waitingFlights===waiting)this.waitingFlights=undefined;this.reconcileAutosave();this.changed();});this.waitingFlights=waiting;return;
  }
  if(!this.saveReady()||sessions.some(s=>!s.editable)){this.cancelTimer();return;}
  if(this.timer!==undefined)return;
  const epoch=this.scheduleEpoch;this.timer=setTimeout(()=>{this.timer=undefined;if(epoch!==this.scheduleEpoch||!this.alive||!this.current()||this.schedulerStopped||this.autosaveError||this.savePreference.mode!=='automatic')return;void this.requestSave(undefined,true).catch(error=>{if(this.alive&&epoch===this.scheduleEpoch){this.autosaveError=String(error);this.cancelTimer();this.changed();}});},500);
 }
 private async requestSave(field?:string,automatic=false):Promise<boolean>{
  this.assert();if(this.leaving||this.schedulerStopped)return false;
  if(!automatic&&!this.documentSave()){await this.validate();if(this.leaving||this.schedulerStopped)return false;const ok=await this.session(field).save();if(ok&&this.autosaveError){this.autosaveError='';this.changed();}return ok;}
  const exitEpoch=this.exitEpoch,scheduleEpoch=this.scheduleEpoch;
  if(this.documentFlight){await this.documentFlight;if(!this.alive||!this.current()||this.leaving||exitEpoch!==this.exitEpoch)return false;if(automatic&&(scheduleEpoch!==this.scheduleEpoch||this.savePreference.mode!=='automatic'))return false;return this.requestSave(field,automatic);}
  const flight=Promise.resolve().then(async()=>{await this.validate();if(this.leaving||this.schedulerStopped||exitEpoch!==this.exitEpoch)return false;if(automatic&&(scheduleEpoch!==this.scheduleEpoch||this.savePreference.mode!=='automatic'))return false;
   if(automatic&&(!this.saveReady()||[...this.sessions.keys()].some(s=>!s.editable)))return false;
   this.seed();const selected=field?this.session(field):[...this.sessions.keys()].find(s=>s.dirty)??this.sessions.keys().next().value;if(!selected)return true;
   const ok=await selected.save();if(ok)this.autosaveError='';else if(automatic&&[...this.sessions.keys()].some(s=>!!s.error))this.autosaveError=selected.error||'local_tool_autosave_failed';return ok;
  });this.documentFlight=flight;
  try{return await flight;}catch(error){if(this.alive&&this.current()&&(!automatic||scheduleEpoch===this.scheduleEpoch)&&!(error instanceof Error&&error.message==='local_tool_live_recovery_not_shareable')){this.autosaveError=String(error);this.cancelTimer();}throw error;}finally{if(this.documentFlight===flight)this.documentFlight=undefined;this.reconcileAutosave();this.changed();}
 }
 async retry(field?:string){this.assert();const session=this.session(field);if(this.autosaveError&&[...this.sessions.keys()].every(s=>!s.error))return this.requestSave(field);if(!this.documentSave()){const ok=await session.retry();if(ok){this.autosaveError='';this.changed();}return ok;}if([...this.sessions.keys()].some(s=>s!==session&&!s.shareable))return false;return session.retry(()=>this.requestSave(field));}
 async flush(field?:string){this.assert();if(!this.documentSave())return this.session(field).flush();do{if(!this.saveReady())return false;if(!await this.requestSave(field))return false;}while(this.dirty());return[...this.sessions.keys()].every(s=>!s.pending);}
 async control(action:'undo'|'redo'|'save'|'leave'|'retry'|'adopt',field?:string){this.assert();if(action==='leave')return this.leave();if(action==='save'){this.session(field);return this.requestSave(field);}if(action==='retry')return this.retry(field);await this.validate();if(action==='adopt'){this.healthy();this.seed();const adopted=this.session(field).adopt();if(adopted)this.seed();return adopted;}return this.session(field).reverse(action==='redo');}
 dispose(){this.schedulerStopped=true;this.scheduleEpoch++;this.exitEpoch++;this.cancelTimer();this.offPreference();this.detach();this.alive=false;liveDocumentHosts.delete(this);for(const entry of this.sessions.values()){entry.offState();entry.offSaved();}this.listeners.clear();this.sessions.clear();}
}
