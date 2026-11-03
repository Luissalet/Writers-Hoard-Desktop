import type {IncomingMessage,ServerResponse} from 'node:http';
import {randomUUID} from 'node:crypto';
import * as Y from 'yjs';
import type {PresenceJson as LocalToolJson,LocalToolPresenceProfile,LocalToolPresenceDocument,PresenceMember,PresenceRoomSnapshot} from '../../src/engines/local/presence/types';
import type {LocalToolConvergenceUpdate} from '../../src/engines/local/convergence/formatTypes';
import {prepareAdoptedRoomContent,contentPacketFingerprint,richAdoptionOrigin} from '../../src/engines/local/convergence/richAdoption';
import {convergenceIdentityOf,validateLocalToolConvergenceUpdate} from '../../src/engines/local/convergence/format';
interface Membership {epoch:string;seq:number;state:LocalToolJson|null;surface:LocalToolJson|null;activeOrder:number;content?:boolean}
interface Connection {id:string;token:string;profile:LocalToolPresenceProfile;lastSeen:number;stream?:ServerResponse;members:Map<string,Membership>;retired:Set<string>;pending?:string;contentPending?:Map<string,LocalToolConvergenceUpdate>;contentRequests?:Map<string,string>}
interface Room {id:string;document:LocalToolPresenceDocument;members:Map<string,{connection:Connection;instanceId:string}>;owner:string;createdAt:number;content?:LocalToolConvergenceUpdate;adoptedRich?:boolean;messages?:Map<string,string>}
function content(value:unknown,room:Room):LocalToolConvergenceUpdate {if(!object(value)||value.format!=='writers-hoard-local-convergence-update/1'||!room.document.convergence)throw Error('local_tool_live_identity_invalid');const {updateBase64,...identity}=value;delete identity.format;if(!equal(identity,room.document.convergence)||typeof updateBase64!=='string'||!updateBase64.length)throw Error('local_tool_live_identity_invalid');Y.decodeUpdate(Buffer.from(updateBase64,'base64'));return value as unknown as LocalToolConvergenceUpdate;}
function mergeContent(a:LocalToolConvergenceUpdate,b:LocalToolConvergenceUpdate):LocalToolConvergenceUpdate{return{...a,updateBase64:Buffer.from(Y.mergeUpdates([Buffer.from(a.updateBase64,'base64'),Buffer.from(b.updateBase64,'base64')])).toString('base64')};}
// Immutable room-origin classification; admission still checks every incoming packet.
function legacyOrigin(update:LocalToolConvergenceUpdate){if(update.engine.version!=='4')return false;const doc=new Y.Doc({gc:false});try{Y.applyUpdate(doc,Buffer.from(update.updateBase64,'base64'));return richAdoptionOrigin(doc).engine.version==='3';}finally{doc.destroy();}}
const prefix='/__wh_presence/';
function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function text(value:unknown){if(typeof value!=='string'||!value.trim())throw Error('presence_invalid_request');return value;}
function profile(value:unknown):LocalToolPresenceProfile {if(!object(value))throw Error('presence_profile_missing');const result:LocalToolPresenceProfile={userId:text(value.userId),name:text(value.name),color:text(value.color)};if(value.avatarMediaId!==undefined)result.avatarMediaId=text(value.avatarMediaId);return result;}
function document(value:unknown):LocalToolPresenceDocument {if(!object(value))throw Error('presence_document_missing');const result:LocalToolPresenceDocument={projectId:text(value.projectId),eraId:value.eraId===null?null:text(value.eraId),namespace:text(value.namespace),documentId:text(value.documentId),lineage:text(value.lineage)};if(value.convergence!==undefined){if(!object(value.convergence))throw Error('presence_identity_invalid');result.convergence=JSON.parse(JSON.stringify(value.convergence));}return result;}
function equal(a:unknown,b:unknown):boolean{if(a===b)return true;if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>equal(v,b[i]));if(object(a)&&object(b)){const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));}return false;}
async function body(req:IncomingMessage){let input='';for await(const chunk of req)input+=chunk;const value:unknown=JSON.parse(input||'{}');if(!object(value))throw Error('presence_invalid_request');return value;}
function reply(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}).end(JSON.stringify(value));}
/** One in-memory relay attached to the renderer listener; never starts a service or stores awareness. */
export function createPresenceRelay(expectedHosts:()=>readonly string[],options:{now?:()=>number;ttlMs?:number;heartbeatMs?:number}={}){
 const connections=new Map<string,Connection>(),rooms=new Map<string,Room>(),now=options.now??Date.now;let order=0;
 const key=(roomId:string,instanceId:string)=>JSON.stringify([roomId,instanceId]);
 const tombstone=(roomId:string,instanceId:string,epoch:string)=>JSON.stringify([roomId,instanceId,epoch]);
 const flush=(c:Connection)=>{const stream=c.stream;if(!stream||stream.destroyed||stream.writableNeedDrain)return;if(c.pending){const pending=c.pending;c.pending=undefined;stream.write(pending);}for(const [roomId,update]of c.contentPending??[]){if(stream.writableNeedDrain)break;c.contentPending!.delete(roomId);const messageId='snapshot:'+contentPacketFingerprint(update);stream.write('event: content\ndata: '+JSON.stringify({roomId,contentSessionId:roomId,messageId,update})+'\n\n');}for(const[roomId,requestId]of c.contentRequests??[]){if(stream.writableNeedDrain)break;c.contentRequests!.delete(roomId);stream.write('event: content-request\ndata: '+JSON.stringify({roomId,requestId})+'\n\n');}};
 const emitContent=(room:Room)=>{for(const{connection:c,instanceId}of room.members.values())if(c.members.get(key(room.id,instanceId))?.content){c.contentPending??=new Map();c.contentPending.set(room.id,room.content!);flush(c);}};
 const requestContent=(room:Room,requestId:string)=>{for(const{connection:c,instanceId}of room.members.values())if(c.members.get(key(room.id,instanceId))?.content){c.contentRequests??=new Map();c.contentRequests.set(room.id,requestId);flush(c);}};
 const snapshot=(room:Room):PresenceRoomSnapshot=>({roomId:room.id,document:room.document,members:[...room.members.values()].map(({connection:c,instanceId}):PresenceMember=>{const m=c.members.get(key(room.id,instanceId))!;return{profile:c.profile,connectionId:c.id,instanceId,sessionId:m.epoch,state:m.state,surface:m.surface,activeOrder:m.activeOrder};})});
 const emit=()=>{for(const c of connections.values())if(c.stream&&!c.stream.destroyed){const joined=new Set([...c.members.keys()].map(k=>JSON.parse(k)[0] as string));c.pending='data: '+JSON.stringify({rooms:[...joined].flatMap(id=>{const room=rooms.get(id);return room?[snapshot(room)]:[];})})+'\n\n';flush(c);}};
 function removeMember(c:Connection,roomId:string,instanceId:string){const old=c.members.get(key(roomId,instanceId));if(old)c.retired.add(tombstone(roomId,instanceId,old.epoch));c.members.delete(key(roomId,instanceId));const room=rooms.get(roomId);if(room){room.members.delete(key(c.id,instanceId));if(!room.members.size)rooms.delete(roomId);}}
 function disconnect(c:Connection){if(!connections.delete(c.id))return;for(const k of [...c.members.keys()]){const [roomId,instanceId]=JSON.parse(k);removeMember(c,roomId,instanceId);}for(const room of rooms.values())if(room.owner===c.id&&!room.members.size)rooms.delete(room.id);const stream=c.stream;c.stream=undefined;stream?.end();emit();}
 const timer=setInterval(()=>{for(const c of connections.values()){if(now()-c.lastSeen>(options.ttlMs??45000))disconnect(c);else c.stream?.write(': heartbeat\n\n');}for(const room of rooms.values())if(!room.members.size&&now()-room.createdAt>(options.ttlMs??45000))rooms.delete(room.id);},options.heartbeatMs??15000);timer.unref();
 return {
  async handle(req:IncomingMessage,res:ServerResponse):Promise<boolean>{
   const url=new URL(req.url??'/','http://renderer.local');if(!url.pathname.startsWith(prefix))return false;
   const host=req.headers.host,origin=req.headers.origin;if(!host||!expectedHosts().includes(host)||origin!==undefined&&origin!=='http://'+host){reply(res,403,{error:'presence_origin_invalid'});return true;}
   try{
    if(req.method==='GET'&&url.pathname===prefix+'invite'){const room=rooms.get(url.searchParams.get('roomId')??'');reply(res,room?200:404,room?{roomId:room.id,document:room.document}:{error:'presence_session_ended'});return true;}
    if(req.method==='POST'&&url.pathname===prefix+'connect'){const input=await body(req),id=randomUUID(),c:Connection={id,token:randomUUID(),profile:profile(input.profile),lastSeen:now(),members:new Map(),retired:new Set()};connections.set(id,c);reply(res,200,{connectionId:id,token:c.token});return true;}
    const input=req.method==='POST'?await body(req):{},id=url.searchParams.get('connectionId')??input.connectionId,token=url.searchParams.get('token')??input.token,c=typeof id==='string'?connections.get(id):undefined;
    if(!c||token!==c.token){reply(res,401,{error:'presence_connection_expired'});return true;}c.lastSeen=now();
    if(req.method==='GET'&&url.pathname===prefix+'events'){c.stream?.end();c.stream=res;res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive'});res.flushHeaders();res.on('drain',()=>flush(c));res.on('close',()=>{if(c.stream===res)disconnect(c);});emit();return true;}
    if(req.method==='POST'&&url.pathname===prefix+'close'){reply(res,200,{closed:true});disconnect(c);return true;}
    if(req.method==='POST'&&url.pathname===prefix+'profile'){const next=profile(input.profile);if(next.userId!==c.profile.userId)throw Error('presence_profile_reconnect_required');for(const peer of connections.values())if(peer.profile.userId===next.userId)peer.profile=next;emit();reply(res,200,{ok:true});return true;}
    if(req.method==='POST'&&url.pathname===prefix+'create'){const room:Room={id:randomUUID(),document:document(input.document),members:new Map(),owner:c.id,createdAt:now()};if(input.content!==undefined){room.content=content(input.content,room);room.adoptedRich=legacyOrigin(room.content);if(room.adoptedRich)room.content=prepareAdoptedRoomContent(room.content,room.content);}rooms.set(room.id,room);reply(res,200,{roomId:room.id,document:room.document});return true;}
    if(req.method!=='POST'||url.pathname!==prefix+'update'){reply(res,404,{error:'presence_route_missing'});return true;}
    if(input.kind==='heartbeat'){reply(res,200,{ok:true});return true;}
    const roomId=text(input.roomId),instanceId=text(input.instanceId),epoch=text(input.epoch),room=rooms.get(roomId),membership=c.members.get(key(roomId,instanceId));
    if(input.kind==='join-prepare'){
     if(!room)throw Error('presence_session_ended');if(c.retired.has(tombstone(roomId,instanceId,epoch)))throw Error('presence_lease_expired');const requested=document(input.document),{convergence:a,...aBase}=requested,{convergence:b,...bBase}=room.document;if(!equal(aBase,bBase)||a&&b&&a.genesisId!==b.genesisId)throw Error('presence_document_incompatible');if(input.content===true&&!room.content)throw Error('local_tool_live_room_people_only');reply(res,200,{room:snapshot(room),...(input.content===true?{content:room.content}:{})});return true;
    }
    if(input.kind==='join'){if(room&&!equal(document(input.document),room.document))throw Error('presence_document_incompatible');if(room&&membership?.epoch===epoch){reply(res,200,{room:snapshot(room),...(membership.content?{content:room.content}:{})});return true;}if(!room)throw Error('presence_session_ended');if(!equal(document(input.document),room.document))throw Error('presence_document_incompatible');if(input.content===true&&!room.content)throw Error('local_tool_live_room_people_only');if(c.retired.has(tombstone(roomId,instanceId,epoch)))throw Error('presence_lease_expired');if(membership&&membership.epoch!==epoch)c.retired.add(tombstone(roomId,instanceId,membership.epoch));c.members.set(key(roomId,instanceId),{epoch,seq:0,state:null,surface:null,activeOrder:0,...(input.content===true?{content:true}:{})});room.members.set(key(c.id,instanceId),{connection:c,instanceId});emit();reply(res,200,{room:snapshot(room),...(input.content===true?{content:room.content}:{})});return true;}
    if(!room||!membership||membership.epoch!==epoch)throw Error('presence_lease_expired');
    if(input.kind==='leave'){removeMember(c,roomId,instanceId);emit();reply(res,200,{ok:true});return true;}
    if(input.kind==='content-full-request'){
     if(!membership.content||!room.content)throw Error('local_tool_live_not_joined');const requestId=text(input.requestId),id=JSON.stringify([instanceId,epoch,'full-request',requestId]);room.messages??=new Map();if(!room.messages.has(id)){room.messages.set(id,'request');requestContent(room,requestId);}reply(res,200,{content:room.content});return true;
    }
    if(input.kind==='content'||input.kind==='content-adopt'){
     if(!membership.content||!room.content)throw Error('local_tool_live_not_joined');let update:LocalToolConvergenceUpdate,prepared:LocalToolConvergenceUpdate|undefined;
     if(input.kind==='content-adopt'||room.adoptedRich){validateLocalToolConvergenceUpdate(input.update);update=input.update;prepared=prepareAdoptedRoomContent(room.content,update);}else update=content(input.update,room);
     const messageId=JSON.stringify([instanceId,epoch,text(input.messageId)]),hash=contentPacketFingerprint(update);room.messages??=new Map();const prior=room.messages.get(messageId);if(prior!==undefined){if(prior!==hash)throw Error('local_tool_live_message_collision');reply(res,200,{duplicate:true,room:snapshot(room),content:room.content});return true;}
     const promoted=!!prepared&&!room.adoptedRich;if(prepared){room.document={...room.document,convergence:convergenceIdentityOf(prepared)};room.content=prepared;room.adoptedRich=true;}else room.content=mergeContent(room.content,update);room.messages.set(messageId,hash);emitContent(room);if(promoted)emit();reply(res,200,{ok:true,...(prepared?{room:snapshot(room),content:room.content}:{})});return true;
    }
    if(!Number.isSafeInteger(input.seq)||(input.seq as number)<=membership.seq){reply(res,200,{ignored:true});return true;}membership.seq=input.seq as number;
    if(input.kind==='state')membership.state=(input.state??null) as LocalToolJson;
    else if(input.kind==='surface'){membership.surface=(input.surface??null) as LocalToolJson;if(input.active===true)membership.activeOrder=++order;}
    else throw Error('presence_invalid_update');
    emit();reply(res,200,{ok:true});return true;
   }catch(error){if(!res.headersSent)reply(res,400,{error:error instanceof Error?error.message:String(error)});else res.end();return true;}
  },
  close(){clearInterval(timer);for(const c of [...connections.values()])disconnect(c);rooms.clear();},
 };
}
