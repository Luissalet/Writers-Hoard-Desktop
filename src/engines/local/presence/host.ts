import {presenceHosts,notifyPresenceHosts} from './registry';
import {assertWorldEra} from '@/services/worldEras/store';
import {readSourceToolDocument} from '../documents/store';
import type {LocalToolClient,LocalToolJson} from '../sdk';
import {cloneLocalToolJson} from '../stateTypes';
import type {LocalToolDocumentPresence,LocalToolPresenceDocument,LocalToolPresenceProfile,LocalToolPresenceSnapshot,LocalToolPresencePeer} from './types';
import {localPresenceTransport} from './transport';
import type {LocalDocumentContentHost} from '../liveContent/host';
const portHosts=new WeakMap<LocalToolDocumentPresence,LocalDocumentPresenceHost>();
export function presenceHostForPort(port:LocalToolDocumentPresence|undefined){return port?portHosts.get(port):undefined;}
const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
const identity=(value:LocalToolPresenceDocument)=>JSON.stringify(value);
/** The host owns bindings; a tool receives only its leased JSON publication port. */
export class LocalDocumentPresenceHost {
 readonly port:LocalToolDocumentPresence;
 readonly client:LocalToolClient<LocalToolJson>;
 readonly instanceId:string;
 roomId:string|undefined;
 private document:LocalToolPresenceDocument|undefined;
 private epoch=crypto.randomUUID();
 private live=true;
 private sequence=0;
 private queued=new Map<'state'|'surface',{epoch:string;seq:number;state:LocalToolJson|null;active:boolean}>();
 private sending=false;
 private operation=0;
 private publications=new Map<object,LocalToolJson>();
 private rawProducer={};
 private state:LocalToolJson|null=null;
 private surfaceState:Record<string,LocalToolJson>={};
 private listeners=new Set<()=>void>();
 private error='';
 private contentConnecting=false;
 private transport=localPresenceTransport();
 private offTransport:()=>void;
 private offClient:(()=>void)|undefined;
 private current:()=>boolean;
 readonly content:LocalDocumentContentHost|undefined;
 constructor(client:LocalToolClient<LocalToolJson>,instanceId:string,current:()=>boolean,content?:LocalDocumentContentHost){
  this.content=content;
  this.current=current;
  this.client=client;this.instanceId=instanceId;
  this.port=Object.freeze({instanceId,getSnapshot:()=>this.snapshot(),subscribe:(changed:()=>void)=>this.subscribe(changed),setLocal:(state:LocalToolJson|null)=>this.setLocal(state),publish:(state:LocalToolJson)=>this.publish(state),clear:()=>this.setLocal(null)});
  this.offTransport=this.transport.subscribe(()=>this.changed());
  this.offClient=client.subscribe?.(()=>{if(this.roomId)void this.valid().catch(()=>{/* valid already withdraws the failed binding. */});});
  portHosts.set(this.port,this);presenceHosts.add(this);notifyPresenceHosts();
 }
 subscribe(changed:()=>void){this.listeners.add(changed);return()=>{this.listeners.delete(changed);};}
 private changed(){for(const changed of this.listeners)changed();notifyPresenceHosts();}
 async descriptor():Promise<LocalToolPresenceDocument>{
  if(!this.live||!this.current())throw Error('presence_host_unavailable');const snapshot=await this.client.read(),scope={projectId:this.client.projectId,eraId:this.client.eraId};const actual=this.client.documentId?await readSourceToolDocument(scope,this.client.documentId,this.client.namespace):undefined;await assertWorldEra(scope);if(!this.live||!this.current()||!snapshot.document||!actual||actual.lineage!==snapshot.document.lineage)throw Error('presence_host_unavailable');
  const result:LocalToolPresenceDocument={projectId:this.client.projectId,eraId:this.client.eraId??null,namespace:this.client.namespace,documentId:snapshot.document.id,lineage:snapshot.document.lineage};
  if(snapshot.convergence){const {namespace,genesisId,codecHash,validationId,schemaEpoch,engine}=snapshot.convergence;result.convergence={namespace,genesisId,codecHash,validationId,schemaEpoch,engine};}return result;
 }
 async valid(){
  const epoch=this.epoch,document=this.document;
  if(!this.live||!this.current()||!document){if(this.roomId)await this.leave();return false;}
  try{const actual=await this.descriptor();if(epoch!==this.epoch||document!==this.document)return false;if(identity(actual)===identity(document))return true;await this.leave();return false;}
  catch(error){if(epoch===this.epoch&&document===this.document)await this.leave();throw error;}
 }
 private owns(operation:number){return this.live&&this.current()&&operation===this.operation;}
 private async adoptProfile(selected:()=>LocalToolPresenceProfile,current:()=>boolean){if(!current())throw Error('presence_host_unavailable');const profile=selected();if(this.transport.getProfile()?.userId&&this.transport.getProfile()?.userId!==profile.userId)await Promise.all([...presenceHosts].filter((host):host is LocalDocumentPresenceHost=>host instanceof LocalDocumentPresenceHost&&host!==this).map(host=>host.leave()));if(!current())throw Error('presence_host_unavailable');await this.transport.connect(profile,current);if(!current())throw Error('presence_host_unavailable');if(JSON.stringify(selected())!==JSON.stringify(this.transport.getProfile()))await this.adoptProfile(selected,current);}
 async create(profile:LocalToolPresenceProfile,shareDocumentContent=false){
  const operation=++this.operation,end=this.transport.beginOperation(),selected=this.transport.selectProfile(profile),current=()=>this.owns(operation);
  try{if(this.roomId)await this.detach();if(!current())throw Error('presence_host_unavailable');const document=await this.descriptor();if(!current())throw Error('presence_host_unavailable');await this.adoptProfile(selected,current);if(!current()||identity(await this.descriptor())!==identity(document))throw Error('presence_document_changed');if(!current())throw Error('presence_host_unavailable');const roomId=await this.transport.create(document,shareDocumentContent?this.content?.seed():undefined);if(!current())throw Error('presence_host_unavailable');await this.joinAttempt(roomId,selected,document,operation,true,shareDocumentContent);return roomId;}finally{await end();}
 }
 async join(roomId:string,profile:LocalToolPresenceProfile,document?:LocalToolPresenceDocument,shareDocumentContent=false){const operation=++this.operation,end=this.transport.beginOperation(),selected=this.transport.selectProfile(profile);try{await this.joinAttempt(roomId,selected,document,operation,false,shareDocumentContent);}finally{await end();}}
 private async joinAttempt(roomId:string,selectedProfile:()=>LocalToolPresenceProfile,document:LocalToolPresenceDocument|undefined,operation:number,connected=false,shareDocumentContent=false){
  const current=()=>this.owns(operation);if(!current())throw Error('presence_host_unavailable');const selected=document??await this.descriptor();if(!current())throw Error('presence_host_unavailable');if(this.roomId)await this.detach();if(!current())throw Error('presence_host_unavailable');if(!connected)await this.adoptProfile(selectedProfile,current);else selectedProfile();if(!current()||identity(await this.descriptor())!==identity(selected))throw Error('presence_document_changed');if(!current())throw Error('presence_host_unavailable');
  let contentActive=shareDocumentContent;const epoch=crypto.randomUUID();const network={roomId,send:(update:import('../convergence/types').LocalToolConvergenceUpdate,messageId:string)=>this.transport.content(this.instanceId,epoch,update,messageId),retire:()=>{contentActive=false;this.transport.retireContent(this.instanceId,epoch);},leave:()=>this.leave()};this.document=selected;this.roomId=roomId;this.epoch=epoch;this.sequence=0;this.error='';this.contentConnecting=shareDocumentContent;
  try{if(shareDocumentContent&&!this.content)throw Error('local_tool_live_host_unavailable');const content=await this.transport.join({roomId,instanceId:this.instanceId,epoch,document:selected,...(shareDocumentContent?{content:true,receiveContent:(update:import('../convergence/types').LocalToolConvergenceUpdate)=>{if(contentActive)this.content?.receive(update);}}:{}),current:async()=>{if(!current()||epoch!==this.epoch)return false;const valid=await this.valid();return current()&&epoch===this.epoch&&valid;},reconnected:()=>{if(!current()||epoch!==this.epoch)return;this.sequence=0;this.queued.clear();this.send('state',this.state);this.send('surface',this.surfaceState);if(contentActive)this.content?.reconnect(network);}});if(shareDocumentContent){if(!current()||epoch!==this.epoch)throw Error('presence_host_unavailable');await this.content!.start(network,content);}this.contentConnecting=false;this.changed();}
  catch(error){if(current()&&epoch===this.epoch){this.contentConnecting=false;this.roomId=undefined;this.document=undefined;this.error=error instanceof Error?error.message:String(error);this.changed();}throw error;}
 }
 async leave(){this.operation++;await this.detach();}
 private async detach(){this.contentConnecting=false;this.content?.detach();const joined=this.roomId;this.roomId=undefined;this.document=undefined;this.queued.clear();this.surfaceState={};this.state=null;this.publications.clear();this.epoch=crypto.randomUUID();if(joined)await this.transport.leave(this.instanceId);this.changed();}
 private send(kind:'state'|'surface',state:LocalToolJson|null,active=false){if(!this.live||!this.current()||!this.roomId)return;this.queued.set(kind,{epoch:this.epoch,seq:++this.sequence,state,active});if(!this.sending)void this.drain();}
 private async drain(){this.sending=true;try{while(this.queued.size&&this.live){const jobs=[...this.queued.entries()].sort((a,b)=>a[1].seq-b[1].seq);this.queued.clear();for(const[kind,job]of jobs){if(job.epoch!==this.epoch)continue;try{await this.transport.update(this.instanceId,job.epoch,job.seq,kind,job.state,job.active);this.error='';}catch(error){if(this.live&&job.epoch===this.epoch&&job.seq===this.sequence){this.error=error instanceof Error?error.message:String(error);this.changed();}}}}}finally{this.sending=false;}}
 private refreshState(){const state=[...this.publications.values()].at(-1)??null;if(state===this.state)return;this.state=state;this.send('state',state);}
 private setLocal(value:LocalToolJson|null){const state=value===null?null:cloneLocalToolJson(value);if(!this.live||!this.current())return;this.publications.delete(this.rawProducer);if(state!==null)this.publications.set(this.rawProducer,state);this.refreshState();}
 private publish(value:LocalToolJson){const state=cloneLocalToolJson(value);if(!this.live||!this.current())return()=>{};const token={};this.publications.set(token,state);this.refreshState();return()=>{if(this.publications.delete(token))this.refreshState();};}
 surface(value:Record<string,LocalToolJson>|null,active=false){this.surfaceState=value===null?{}:{...this.surfaceState,...cloneLocalToolJson(value)};this.send('surface',value===null?null:this.surfaceState,active);}
 snapshot():LocalToolPresenceSnapshot {
  if(!this.live||!this.current())return{status:'unavailable',peers:[]};if(!this.roomId)return{status:this.error?'disconnected':'unavailable',peers:[],...(this.error?{error:this.error}:{})};
  const room=this.transport.room(this.roomId),me=this.transport.getProfile()?.userId,grouped=new Map<string,LocalToolPresencePeer>();
  for(const member of room?.members??[]){let peer=grouped.get(member.profile.userId);if(!peer){peer={...member.profile,isSelf:member.profile.userId===me,state:null,connections:[]};grouped.set(peer.userId,peer);}peer.connections.push({connectionId:member.connectionId,instanceId:member.instanceId,sessionId:member.sessionId,state:member.state,surface:member.surface,active:false});}
  for(const peer of grouped.values()){
   peer.connections.sort((a,b)=>a.connectionId.localeCompare(b.connectionId)||a.instanceId.localeCompare(b.instanceId));const members=(room?.members??[]).filter(m=>m.profile.userId===peer.userId),active=members.reduce<typeof members[number]|undefined>((best,m)=>m.activeOrder>(best?.activeOrder??0)?m:best,undefined)??(members.length===1?members[0]:undefined);
   if(active){const selected=peer.connections.find(c=>c.connectionId===active.connectionId&&c.instanceId===active.instanceId)!;selected.active=true;peer.state=selected.state;}
  }
  return clone({status:this.contentConnecting?'connecting':this.transport.status,peers:[...grouped.values()].sort((a,b)=>a.userId.localeCompare(b.userId)),...(this.error||this.transport.error?{error:this.error||this.transport.error}:{})});
 }
 dispose(){if(!this.live)return;this.live=false;this.offClient?.();this.offTransport();presenceHosts.delete(this);notifyPresenceHosts();void this.leave();this.listeners.clear();}
}

