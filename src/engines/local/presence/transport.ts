import type {LocalToolJson} from '../stateTypes';
import type {LocalToolPresenceDocument,LocalToolPresenceProfile,PresenceRoomSnapshot,PresenceWireSnapshot} from './types';
import type {LocalToolConvergenceUpdate} from '../convergence/types';
import {sha256Hex} from '@/services/aiRuntime/recipe';
interface Binding {roomId:string;instanceId:string;epoch:string;document:LocalToolPresenceDocument;current:()=>Promise<boolean>;reconnected:()=>void;content?:boolean;receiveContent?:(update:LocalToolConvergenceUpdate)=>void}
/** One lazily opened stream per renderer, independent of MCP or document storage. */
export class LocalPresenceTransport {
 private connection:{connectionId:string;token:string}|undefined;
 private profile:LocalToolPresenceProfile|undefined;
 private opening:Promise<void>|undefined;
 private profileUpdating:Promise<void>|undefined;
 private selectedProfile:LocalToolPresenceProfile|undefined;
 private operations=new Set<object>();
 private stream:EventSource|undefined;
 private heartbeat:ReturnType<typeof setInterval>|undefined;
 private retry:ReturnType<typeof setTimeout>|undefined;
 private listeners=new Set<()=>void>();
 private bindings=new Map<string,Binding>();
 private rooms=new Map<string,PresenceRoomSnapshot>();
 private epoch=0;
 status:'connecting'|'ready'|'disconnected'='disconnected';
 error='';
 private origin:string;
 constructor(origin:string){this.origin=origin;}
 subscribe(changed:()=>void){this.listeners.add(changed);return()=>{this.listeners.delete(changed);};}
 private changed(){for(const changed of this.listeners)changed();}
 getProfile(){return this.profile;}
 selectProfile(profile:LocalToolPresenceProfile){this.selectedProfile={...profile};return()=>{const selected=this.selectedProfile;if(!selected||selected.userId!==profile.userId)throw Error('presence_profile_changed');return selected;};}
 beginOperation(){const token={};this.operations.add(token);let ended=false;return async()=>{if(ended)return;ended=true;this.operations.delete(token);if(!this.operations.size&&!this.bindings.size)await this.shutdown(true);};}
 room(id:string){return this.rooms.get(id);}
 private async request(route:string,input:Record<string,unknown>,auth=true){const response=await fetch(this.origin+'/__wh_presence/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,...(auth?this.connection:{})})});const result=await response.json();if(!response.ok)throw Error(result.error??'presence_transport_failed');return result;}
 async connect(profile:LocalToolPresenceProfile,current:()=>boolean=()=>true):Promise<void>{
  const active=()=>{if(!current())throw Error('presence_host_unavailable');};active();if(this.retry)clearTimeout(this.retry);this.retry=undefined;
  if(this.profile?.userId===profile.userId&&this.connection){if(this.profileUpdating){await this.profileUpdating;active();return this.connect(profile,current);}if(JSON.stringify(this.profile)!==JSON.stringify(profile)){const connection=this.connection;const updating=(async()=>{await this.request('profile',{profile});active();if(this.connection!==connection)throw Error('presence_host_unavailable');this.profile={...profile};})();this.profileUpdating=updating;try{await updating;}finally{if(this.profileUpdating===updating)this.profileUpdating=undefined;}}return;}
  if(this.opening){try{await this.opening;}catch{/* Another retired opener does not own this explicit connection attempt. */}active();if(this.profile?.userId===profile.userId&&this.connection)return this.connect(profile,current);}
  if(this.connection)await this.shutdown(false);active();
  this.profile={...profile};const epoch=++this.epoch;this.status='connecting';this.error='';this.changed();
  const opening=(async()=>{const result=await this.request('connect',{profile},false);if(epoch!==this.epoch||!current()){await this.request('close',{connectionId:result.connectionId,token:result.token},false);throw Error('presence_host_unavailable');}this.connection={connectionId:result.connectionId,token:result.token};const query=new URLSearchParams(this.connection);this.stream=new EventSource(this.origin+'/__wh_presence/events?'+query);this.stream.onmessage=event=>{if(epoch!==this.epoch)return;const data=JSON.parse(event.data) as PresenceWireSnapshot;this.rooms=new Map(data.rooms.map(room=>[room.roomId,room]));this.status='ready';this.error='';this.changed();};this.stream.addEventListener?.('content',event=>{if(epoch!==this.epoch)return;try{const data=JSON.parse((event as MessageEvent).data);if(data.contentSessionId!==data.roomId||data.messageId!=='snapshot:'+sha256Hex(data.update.updateBase64))throw Error('local_tool_live_message_collision');void this.receiveContent(epoch,data.roomId,data.update).catch(error=>{this.error=String(error);this.changed();});}catch(error){this.error=String(error);this.changed();}});this.stream.onerror=()=>{if(epoch!==this.epoch)return;this.status='disconnected';this.error='presence_disconnected';this.rooms.clear();this.changed();void this.reconnect(epoch);};this.heartbeat=setInterval(()=>{void this.request('update',{kind:'heartbeat'}).catch(()=>{if(epoch===this.epoch)void this.reconnect(epoch);});},15000);})();
  this.opening=opening;try{await opening;for(const binding of [...this.bindings.values()])if(await binding.current()){const content=await this.join(binding);if(content)binding.receiveContent?.(content);binding.reconnected();}}catch(error){if(epoch===this.epoch){this.status='disconnected';this.error=String(error);this.changed();}throw error;}finally{if(this.opening===opening)this.opening=undefined;}
 }
 private async reconnect(epoch:number){if(epoch!==this.epoch||this.retry)return;const profile=this.profile;if(!profile)return;await this.shutdown(false);if(!this.bindings.size)return;this.retry=setTimeout(()=>{this.retry=undefined;void(async()=>{try{await this.connect(profile,()=>this.bindings.size>0);}catch(error){this.status='disconnected';this.error=error instanceof Error?error.message:String(error);this.changed();}})();},1000);}
 async create(document:LocalToolPresenceDocument,content?:LocalToolConvergenceUpdate){const result=await this.request('create',{document,...(content?{content}:{})});return result.roomId as string;}
 async join(binding:Binding){if(!this.connection||!await binding.current())throw Error('presence_host_unavailable');const result=await this.request('update',{kind:'join',roomId:binding.roomId,instanceId:binding.instanceId,epoch:binding.epoch,document:binding.document,...(binding.content?{content:true}:{})});if(!await binding.current()){await this.request('update',{kind:'leave',roomId:binding.roomId,instanceId:binding.instanceId,epoch:binding.epoch});throw Error('presence_host_unavailable');}this.bindings.set(binding.instanceId,binding);this.rooms.set(binding.roomId,result.room);this.status='ready';this.changed();return result.content as LocalToolConvergenceUpdate|undefined;}
 private async receiveContent(epoch:number,roomId:string,update:LocalToolConvergenceUpdate){for(const binding of [...this.bindings.values()])if(binding.content&&binding.roomId===roomId&&await binding.current()&&epoch===this.epoch&&this.bindings.get(binding.instanceId)===binding)binding.receiveContent?.(update);}
 retireContent(instanceId:string,epoch:string){const binding=this.bindings.get(instanceId);if(binding?.epoch===epoch)binding.content=false;}
 async content(instanceId:string,epoch:string,update:LocalToolConvergenceUpdate,messageId:string){const binding=this.bindings.get(instanceId),connectionEpoch=this.epoch;if(!this.connection||!binding?.content||binding.epoch!==epoch)throw Error('local_tool_live_not_joined');if(!await binding.current()||connectionEpoch!==this.epoch||this.bindings.get(instanceId)!==binding||!binding.content)throw Error('presence_host_unavailable');await this.request('update',{kind:'content',roomId:binding.roomId,instanceId,epoch,update,messageId});}
 async update(instanceId:string,epoch:string,seq:number,kind:'state'|'surface',state:LocalToolJson|null,active=false){const binding=this.bindings.get(instanceId),connectionEpoch=this.epoch;if(!binding||binding.epoch!==epoch)return;if(!await binding.current())throw Error('presence_host_unavailable');if(connectionEpoch!==this.epoch||this.bindings.get(instanceId)!==binding)return;await this.request('update',{kind,roomId:binding.roomId,instanceId,epoch,seq,...(kind==='state'?{state}:{surface:state,active})});if(connectionEpoch===this.epoch&&!await binding.current()){await this.leave(instanceId);throw Error('presence_host_unavailable');}}
 async leave(instanceId:string){const binding=this.bindings.get(instanceId);if(!binding)return;this.bindings.delete(instanceId);if(binding&&![...this.bindings.values()].some(b=>b.roomId===binding.roomId))this.rooms.delete(binding.roomId);if(binding&&this.connection)try{await this.request('update',{kind:'leave',roomId:binding.roomId,instanceId,epoch:binding.epoch});}catch{/* A departed stream already withdrew this membership. */}if(!this.bindings.size&&!this.operations.size)await this.shutdown(true);this.changed();}
 private async shutdown(clear:boolean){this.epoch++;if(this.heartbeat)clearInterval(this.heartbeat);this.heartbeat=undefined;if(this.retry)clearTimeout(this.retry);this.retry=undefined;this.stream?.close();this.stream=undefined;const connection=this.connection;this.connection=undefined;this.rooms.clear();this.status='disconnected';if(clear)this.bindings.clear();this.changed();if(connection)try{await this.request('close',connection,false);}catch{/* Offline peers expire at the relay. */}}
}
let current:LocalPresenceTransport|undefined;
export function localPresenceTransport(){return current??=new LocalPresenceTransport(window.location.origin);}
