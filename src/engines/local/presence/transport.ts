import type {LocalToolJson} from '../stateTypes';
import type {LocalToolPresenceDocument,LocalToolPresenceProfile,PresenceRoomSnapshot,PresenceWireSnapshot} from './types';
import type {LocalToolConvergenceUpdate} from '../convergence/types';
import type {LocalToolAssets} from '../assets';
import {collectRoomImageAssets} from '../convergence/imageRefs';
import {receiveRoomImage,requestRoomImage,sendRoomImages,type ImageRoomLease} from './imageTransfer';
import {contentPacketFingerprint} from '../convergence/richAdoption';
import {assertConvergenceIdentity,convergenceIdentityOf,convergenceCanonical} from '../convergence/format';
interface Binding extends ImageRoomLease {assets?:LocalToolAssets;document:LocalToolPresenceDocument;current:()=>Promise<boolean>;reconnected:()=>void;content?:boolean;receiveContent?:(update:LocalToolConvergenceUpdate)=>LocalToolPresenceDocument|void;prepareContent?:(update:LocalToolConvergenceUpdate,document:LocalToolPresenceDocument)=>LocalToolPresenceDocument|void;requestedFull?:(requestId:string)=>void}
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
 private imageReads=new WeakMap<Binding,{epoch:number;ready:Map<string,Promise<void>>}>();
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
  const opening=(async()=>{const result=await this.request('connect',{profile},false);if(epoch!==this.epoch||!current()){await this.request('close',{connectionId:result.connectionId,token:result.token},false);throw Error('presence_host_unavailable');}this.connection={connectionId:result.connectionId,token:result.token};const query=new URLSearchParams(this.connection);this.stream=new EventSource(this.origin+'/__wh_presence/events?'+query);this.stream.onmessage=event=>{if(epoch!==this.epoch)return;const data=JSON.parse(event.data) as PresenceWireSnapshot;this.rooms=new Map(data.rooms.map(room=>[room.roomId,room]));this.status='ready';this.error='';this.changed();};this.stream.addEventListener?.('content',event=>{if(epoch!==this.epoch)return;try{const data=JSON.parse((event as MessageEvent).data);if(data.contentSessionId!==data.roomId||data.messageId!=='snapshot:'+contentPacketFingerprint(data.update))throw Error('local_tool_live_message_collision');void this.receiveContent(epoch,data.roomId,data.update).catch(error=>{this.error=String(error);this.changed();});}catch(error){this.error=String(error);this.changed();}});this.stream.addEventListener?.('content-request',event=>{if(epoch!==this.epoch)return;const data=JSON.parse((event as MessageEvent).data);for(const binding of [...this.bindings.values()])if(binding.content&&binding.roomId===data.roomId)void binding.current().then(valid=>{if(valid&&epoch===this.epoch&&this.bindings.get(binding.instanceId)===binding)binding.requestedFull?.(String(data.requestId));});});this.stream.onerror=()=>{if(epoch!==this.epoch)return;this.status='disconnected';this.error='presence_disconnected';this.rooms.clear();this.changed();void this.reconnect(epoch);};this.heartbeat=setInterval(()=>{void this.request('update',{kind:'heartbeat'}).catch(()=>{if(epoch===this.epoch)void this.reconnect(epoch);});},15000);})();
  this.opening=opening;try{await opening;for(const binding of [...this.bindings.values()])if(await binding.current()){if(binding.content){const result=await this.prepareJoin(binding.roomId,binding.instanceId,binding.epoch,binding.document,()=>this.bindings.get(binding.instanceId)===binding);const prepared=binding.prepareContent?.(result.content,result.room.document);if(prepared)binding.document=prepared;if(!await binding.current())throw Error('presence_host_unavailable');}const content=await this.join(binding);if(content)this.acceptContent(binding,content);binding.reconnected();}}catch(error){if(epoch===this.epoch){this.status='disconnected';this.error=String(error);this.changed();}throw error;}finally{if(this.opening===opening)this.opening=undefined;}
 }
 private async reconnect(epoch:number){if(epoch!==this.epoch||this.retry)return;const profile=this.profile;if(!profile)return;await this.shutdown(false);if(!this.bindings.size)return;this.retry=setTimeout(()=>{this.retry=undefined;void(async()=>{try{await this.connect(profile,()=>this.bindings.size>0);}catch(error){this.status='disconnected';this.error=error instanceof Error?error.message:String(error);this.changed();}})();},1000);}
 async create(document:LocalToolPresenceDocument,content?:LocalToolConvergenceUpdate,images?:{instanceId:string;assets?:LocalToolAssets;current:()=>boolean}){
  const connection=this.connection,epoch=this.epoch;
  const result=await this.request('create',{document,...(content?{content}:{})});
  if(result.needsImages!==undefined){
   if(!images||!connection)throw Error('local_asset_image_unavailable');
   const scope={roomId:result.roomId as string,instanceId:images.instanceId,epoch:crypto.randomUUID()};
   await sendRoomImages(result.needsImages,images.assets,async()=>this.epoch===epoch&&images.current(),(asset,blob)=>requestRoomImage(this.origin,connection,scope,asset,blob));
  }
  return result.roomId as string;
 }
 private async hydrateImages(binding:Binding,update:LocalToolConvergenceUpdate,current:()=>Promise<boolean>){
  if(!binding.document.convergence)throw Error('local_tool_live_identity_invalid');
  assertConvergenceIdentity(update,binding.document.convergence as import('../convergence/types').LocalToolConvergenceIdentity);
  const needed=collectRoomImageAssets(update);
  if(!needed.length)return;
  const connection=this.connection,assets=binding.assets;
  if(!connection||!assets)throw Error('local_asset_image_unavailable');
  const epoch=this.epoch;
  let cache=this.imageReads.get(binding);
  if(cache?.epoch!==epoch){cache={epoch,ready:new Map()};this.imageReads.set(binding,cache);}
  const ready=cache.ready,active=async()=>this.epoch===epoch&&await current()&&this.epoch===epoch;
  for(const asset of needed){
   let transfer=ready.get(asset.sha256);
   if(!transfer){
    transfer=receiveRoomImage(asset,assets,active,()=>requestRoomImage(this.origin,connection,binding,asset));
    ready.set(asset.sha256,transfer);
   }
   try{await transfer;}catch(error){if(ready.get(asset.sha256)===transfer)ready.delete(asset.sha256);throw error;}
  }
 }
 async prepareJoin(roomId:string,instanceId:string,epoch:string,document:LocalToolPresenceDocument,current:()=>boolean){
  if(!this.connection||!current())throw Error('presence_host_unavailable');const connectionEpoch=this.epoch,result=await this.request('update',{kind:'join-prepare',roomId,instanceId,epoch,document,content:true});if(!current()||connectionEpoch!==this.epoch)throw Error('presence_host_unavailable');return result as {room:PresenceRoomSnapshot;content:LocalToolConvergenceUpdate};
 }
 async join(binding:Binding){
  if(!this.connection||!await binding.current())throw Error('presence_host_unavailable');let provisional=false;const epoch=this.epoch;
  try{const result=await this.request('update',{kind:'join',roomId:binding.roomId,instanceId:binding.instanceId,epoch:binding.epoch,document:binding.document,...(binding.content?{content:true}:{})});provisional=true;
   if(result.content){const prepared=binding.prepareContent?.(result.content,result.room.document);if(prepared)binding.document=prepared;if(result.content.engine.version==='9')await this.hydrateImages(binding,result.content,binding.current);}if(epoch!==this.epoch||!await binding.current())throw Error('presence_host_unavailable');
   this.bindings.set(binding.instanceId,binding);this.rooms.set(binding.roomId,result.room);this.status='ready';this.changed();return result.content as LocalToolConvergenceUpdate|undefined;
  }catch(error){if(provisional)try{await this.request('update',{kind:'leave',roomId:binding.roomId,instanceId:binding.instanceId,epoch:binding.epoch});}catch{/* Retired provisional membership only. */}throw error;}
 }
 private acceptContent(binding:Binding,update:LocalToolConvergenceUpdate){
  const document=binding.receiveContent?.(update);if(document){if(!document.convergence)throw Error('local_tool_live_identity_invalid');assertConvergenceIdentity(update,document.convergence as import('../convergence/types').LocalToolConvergenceIdentity);binding.document=document;}
 }
 private async receiveContent(epoch:number,roomId:string,update:LocalToolConvergenceUpdate){
  for(const binding of [...this.bindings.values()]){
   if(!binding.content||binding.roomId!==roomId)continue;
   const bound=()=>epoch===this.epoch&&this.bindings.get(binding.instanceId)===binding&&!!binding.content;
   const current=async()=>bound()&&await binding.current()&&bound();
   if(!await current())continue;
   if(update.engine.version==='9'){await this.hydrateImages(binding,update,current);if(!await current())continue;}
   this.acceptContent(binding,update);
  }
 }
 async fullContent(instanceId:string,epoch:string,requestId:string){
  const binding=this.bindings.get(instanceId),connectionEpoch=this.epoch;if(!binding?.content||binding.epoch!==epoch||!await binding.current())throw Error('presence_host_unavailable');
  const bound=()=>connectionEpoch===this.epoch&&this.bindings.get(instanceId)===binding&&!!binding.content;
  const current=async()=>bound()&&await binding.current()&&bound();
  const result=await this.request('update',{kind:'content-full-request',roomId:binding.roomId,instanceId,epoch,requestId});
  if(!await current())return;
  if(result.content?.engine.version==='9'){await this.hydrateImages(binding,result.content,current);if(!await current())return;}
  return result.content as LocalToolConvergenceUpdate|undefined;
 }
 retireContent(instanceId:string,epoch:string){const binding=this.bindings.get(instanceId);if(binding?.epoch===epoch)binding.content=false;}
 async content(instanceId:string,epoch:string,update:LocalToolConvergenceUpdate,messageId:string){
  const binding=this.bindings.get(instanceId),connectionEpoch=this.epoch;if(!binding?.content||binding.epoch!==epoch)throw Error('local_tool_live_not_joined');if(!await binding.current()||connectionEpoch!==this.epoch||this.bindings.get(instanceId)!==binding||!binding.content)throw Error('presence_host_unavailable');
  const changed=convergenceCanonical(convergenceIdentityOf(update))!==convergenceCanonical(binding.document.convergence);if(changed&&!(binding.document.convergence?.engine.version==='3'&&update.engine.version==='4'))throw Error('local_tool_live_identity_invalid');
  const bound=()=>connectionEpoch===this.epoch&&this.bindings.get(instanceId)===binding&&!!binding.content;
  const current=async()=>bound()&&await binding.current()&&bound();
  const payload={kind:changed?'content-adopt':'content',roomId:binding.roomId,instanceId,epoch,update,messageId};
  let result=await this.request('update',payload);
  if(!await current())throw Error('presence_host_unavailable');
  if(result.needsImages!==undefined){
   const connection=this.connection;
   if(!connection||update.engine.version!=='9')throw Error('local_asset_image_unavailable');
   await sendRoomImages(result.needsImages,binding.assets,current,(asset,blob)=>requestRoomImage(this.origin,connection,binding,asset,blob));
   result=await this.request('update',payload);
   if(result.needsImages!==undefined)throw Error('local_asset_image_unavailable');
   if(!await current())throw Error('presence_host_unavailable');
  }
  if(result.content){
   binding.prepareContent?.(result.content,result.room.document);
   if(result.content.engine.version==='9'){await this.hydrateImages(binding,result.content,current);if(!await current())return;}
   this.acceptContent(binding,result.content);this.rooms.set(binding.roomId,result.room);this.changed();
  }
 }
 async update(instanceId:string,epoch:string,seq:number,kind:'state'|'surface',state:LocalToolJson|null,active=false){const binding=this.bindings.get(instanceId),connectionEpoch=this.epoch;if(!binding||binding.epoch!==epoch)return;if(!await binding.current())throw Error('presence_host_unavailable');if(connectionEpoch!==this.epoch||this.bindings.get(instanceId)!==binding)return;await this.request('update',{kind,roomId:binding.roomId,instanceId,epoch,seq,...(kind==='state'?{state}:{surface:state,active})});const valid=await binding.current();if(connectionEpoch!==this.epoch||this.bindings.get(instanceId)!==binding)throw Error('presence_host_unavailable');if(!valid){await this.leave(instanceId,binding.epoch);throw Error('presence_host_unavailable');}}
 async leave(instanceId:string,expectedEpoch?:string){const binding=this.bindings.get(instanceId);if(!binding||expectedEpoch!==undefined&&binding.epoch!==expectedEpoch)return;this.bindings.delete(instanceId);if(binding&&![...this.bindings.values()].some(b=>b.roomId===binding.roomId))this.rooms.delete(binding.roomId);if(binding&&this.connection)try{await this.request('update',{kind:'leave',roomId:binding.roomId,instanceId,epoch:binding.epoch});}catch{/* A departed stream already withdrew this membership. */}if(!this.bindings.size&&!this.operations.size)await this.shutdown(true);this.changed();}
 private async shutdown(clear:boolean){this.epoch++;if(this.heartbeat)clearInterval(this.heartbeat);this.heartbeat=undefined;if(this.retry)clearTimeout(this.retry);this.retry=undefined;this.stream?.close();this.stream=undefined;const connection=this.connection;this.connection=undefined;this.rooms.clear();this.status='disconnected';if(clear)this.bindings.clear();this.changed();if(connection)try{await this.request('close',connection,false);}catch{/* Offline peers expire at the relay. */}}
}
let current:LocalPresenceTransport|undefined;
export function localPresenceTransport(){return current??=new LocalPresenceTransport(window.location.origin);}
