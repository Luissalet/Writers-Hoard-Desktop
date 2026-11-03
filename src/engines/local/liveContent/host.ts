import type {RichEditorSession,RichSourceExport} from '../collaborativeRich/session';
import type {LocalToolConvergenceUpdate} from '../convergence/types';
import {convergenceClone,assertConvergenceIdentity} from '../convergence/format';
import type {LocalToolJson} from '../stateTypes';
import type {ContentNetwork,LocalToolDocumentContent} from './types';
import type {LocalToolClient} from '../sdk';
import type {LocalToolStateAction} from '../stateActions';
import {assertWorldEra} from '@/services/worldEras/store';

const hosts=new WeakMap<LocalToolDocumentContent,LocalDocumentContentHost>();
export const liveDocumentHosts=new Set<LocalDocumentContentHost>();
export function documentContentHost(port:LocalToolDocumentContent|undefined){return port?hosts.get(port):undefined;}
/** A coordinator over the existing field replicas, never a second writer or mirror. */
export class LocalDocumentContentHost {
 readonly port:LocalToolDocumentContent;
 private sessions=new Map<RichEditorSession,{reload:()=>void;off?:()=>void;offState:()=>void}>();
 private listeners=new Set<()=>void>();
 private network:ContentNetwork|undefined;
 private epoch=0;
 private alive=true;
 private leaving=false;
 private needsCatchup=false;
 private error='';
 private sending=Promise.resolve();
 readonly instanceId:string;
 readonly client:LocalToolClient<LocalToolJson>;
 private current:()=>boolean;
 private releaseHash:string|null|undefined;
 constructor(instanceId:string,current:()=>boolean,client:LocalToolClient<LocalToolJson>,releaseHash?:string|null){
  this.releaseHash=releaseHash;
  this.instanceId=instanceId;this.current=current;this.client=client;
  this.port=Object.freeze({instanceId,getSnapshot:()=>this.snapshot(),subscribe:(changed:()=>void)=>{this.listeners.add(changed);return()=>{this.listeners.delete(changed);};},query:()=>this.query(),capture:((field:string,request:LocalToolJson)=>this.capture(field,request)) as LocalToolDocumentContent['capture'],apply:async(field:string,actions:readonly LocalToolStateAction[])=>{const captured=convergenceClone(actions);if(!Array.isArray(captured)||!captured.length||captured.some(action=>action.field!==field))throw Error('local_tool_live_action_field_mismatch');await this.validate();return this.session(field).applyBatch(captured);},control:(action:'undo'|'redo'|'save'|'leave',field?:string)=>this.control(action,field)});
  hosts.set(this.port,this);liveDocumentHosts.add(this);
 }
 private assert(){if(!this.alive||!this.current())throw Error('local_tool_live_host_unavailable');}
 private async validate(){this.assert();const snapshot=await this.client.read(),project=await assertWorldEra({projectId:this.client.projectId,eraId:this.client.eraId});this.assert();if(!project.enabledEngines.includes('local-tool-'+this.client.namespace))throw Error('local_tool_live_engine_disabled');if(this.releaseHash!==undefined&&(project.localToolInstallations?.[this.client.namespace]?.contentHash??null)!==this.releaseHash)throw Error('local_tool_pin_conflict');if(!snapshot.document||snapshot.document.id!==this.client.documentId||!snapshot.convergence)throw Error('local_tool_live_identity_invalid');for(const session of this.sessions.keys()){if(snapshot.document.lineage!==session.lineage)throw Error('source_tool_document_lineage_conflict');assertConvergenceIdentity(snapshot.convergence,session.convergenceIdentity);}}
 private changed(){for(const changed of this.listeners)changed();}
 snapshot(){const first=this.sessions.keys().next().value;return convergenceClone({source:'live' as const,instanceId:this.instanceId,networkEpoch:this.epoch,roomId:this.network?.roomId??null,scope:{projectId:this.client.projectId,eraId:this.client.eraId??null},documentId:this.client.documentId??null,namespace:this.client.namespace,lineage:first?.lineage??null,identity:first?.convergenceIdentity??null,sharing:!!this.network,saveReady:this.saveReady(),fields:[...new Set([...this.sessions.keys()].map(s=>s.field))],draftRevision:[...this.sessions.keys()].reduce((n,s)=>n+s.revision,0),pending:[...this.sessions.keys()].some(s=>s.pending),...(this.error?{error:this.error}:{})});}
 register(session:RichEditorSession,reload:()=>void){this.assert();const entry={reload,off:undefined as (()=>void)|undefined,offState:session.subscribeState(()=>{this.changed();this.resumeCatchup();})};this.sessions.set(session,entry);if(this.network){entry.off=session.onDraft((update,saved)=>this.local(session,update,saved));void this.publishFull().catch(error=>{this.error=String(error);this.detach();});}this.changed();return()=>{entry.off?.();entry.offState();this.sessions.delete(session);this.changed();};}
 private session(field?:string){this.assert();if(this.leaving)throw Error('local_tool_live_leaving');const values=[...this.sessions.keys()].filter(s=>!field||s.field===field);if(values.length!==1)throw Error('local_tool_live_field_ambiguous');return values[0];}
 async query():Promise<LocalToolJson> {await this.validate();return convergenceClone({...this.snapshot(),documents:[...this.sessions.keys()].map(s=>({field:s.field,data:s.replica.read(),dirty:s.dirty,editable:s.editable}))}) as unknown as LocalToolJson;}
 async capture(field:string,request:LocalToolJson):Promise<LocalToolJson>{
  request=convergenceClone(request);await this.validate();
  const s=this.session(field);if(!request||typeof request!=='object'||Array.isArray(request))throw Error('local_tool_live_capture_invalid');const r=request as Record<string,LocalToolJson>,node=String(r.nodeId??'');
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
 reconnect(network:ContentNetwork){if(!this.alive||!this.current()||!this.network)return;this.network=network;this.needsCatchup=true;this.resumeCatchup();this.changed();}
 private resumeCatchup(){if(!this.needsCatchup||!this.network||!this.saveReady())return;this.needsCatchup=false;const network=this.network,epoch=this.epoch;queueMicrotask(()=>{if(network!==this.network||epoch!==this.epoch)return;void this.publishFull().catch(error=>{if(epoch===this.epoch){this.error=String(error);this.changed();}});});}
 /** Merge every admitted field into each existing replica before taking a document cut. */
 seed(){this.healthy();const sessions=[...this.sessions.keys()],updates=sessions.map(s=>s.exportDraft());for(let i=0;i<sessions.length;i++)for(let j=0;j<updates.length;j++)if(i!==j)sessions[i].receiveDraft(updates[j]);this.healthy();return sessions[0].exportDraft();}
 async start(network:ContentNetwork,remote?:LocalToolConvergenceUpdate){this.healthy();this.detach();this.network=network;const epoch=this.epoch;for(const[s,e]of this.sessions)e.off=s.onDraft((update,saved)=>this.local(s,update,saved));if(remote)this.receive(remote);await this.publishFull();if(epoch===this.epoch)this.changed();}
 receive(update:LocalToolConvergenceUpdate){this.assert();if(!this.network)return;for(const s of this.sessions.keys())s.receiveDraft(update);this.changed();}
 private local(source:RichEditorSession,update:LocalToolConvergenceUpdate,saved?:RichSourceExport){if(!this.network)return;try{for(const s of this.sessions.keys())if(s!==source){if(saved)s.receiveSaved(saved);else s.receiveDraft(update);}this.enqueue(update);}catch(error){this.error=String(error);this.detach();}this.changed();}
 private enqueue(update:LocalToolConvergenceUpdate){const epoch=this.epoch,network=this.network,messageId=crypto.randomUUID();if(!network)return;this.sending=this.sending.catch(()=>{}).then(async()=>{if(epoch!==this.epoch||network!==this.network)return;this.assert();await network.send(update,messageId);if(epoch===this.epoch&&this.error){this.error='';this.changed();}}).catch(error=>{if(epoch===this.epoch){this.error=String(error);this.changed();}});}
 private async publishFull(){if(!this.network)return;this.enqueue(this.seed());await this.sending;}
 detach(){this.epoch++;this.needsCatchup=false;this.network=undefined;for(const entry of this.sessions.values()){entry.off?.();entry.off=undefined;}this.changed();}
 async leave(){this.assert();if(this.leaving||!this.network)return false;this.leaving=true;const network=this.network;network?.retire?.();this.detach();const sessions=[...this.sessions];for(const[s]of sessions)s.stopEditingForExit();const settled=await Promise.all(sessions.map(([s])=>s.settleSave()));await network?.leave();this.assert();if(settled.some(ok=>!ok)){this.error='local_tool_live_save_reconciliation_failed';this.leaving=false;this.changed();return false;}for(const[s,e]of sessions)if(this.sessions.get(s)===e)e.reload();this.leaving=false;return true;}
 async control(action:'undo'|'redo'|'save'|'leave',field?:string){this.assert();if(action==='leave')return this.leave();await this.validate();if(action==='save'){if(this.network)this.seed();return this.session(field).save();}return this.session(field).reverse(action==='redo');}
 dispose(){this.detach();this.alive=false;liveDocumentHosts.delete(this);for(const entry of this.sessions.values())entry.offState();this.listeners.clear();this.sessions.clear();}
}
