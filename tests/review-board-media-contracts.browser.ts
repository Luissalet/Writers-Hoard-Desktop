// Independent Board media contracts: dispatcher, Dexie and session receipts.
// Native executor, filesystem audit and IPC are covered by board-media.node.cjs.
import '@/engines';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {makeNode,makeEdge} from '@/engines/board/graph/mutations';
import {resolveBoardTile} from '@/engines/board/entityTiles';
import {readWorldDocument,listWorldDocuments,saveWorldEra,saveEraDocument,hideEraDocument} from '@/services/worldEras/store';
import type {WorldEraScope} from '@/services/worldEras/types';
import type {LocalMediaAsset} from '@/engines/media/types';

function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
// Preserve undefined, keys and actual Blob bytes. JSON.stringify(Blob) alone is not evidence.
async function encode(value:unknown):Promise<unknown>{
 if(value instanceof Blob){const bytes=await value.arrayBuffer(),hash=await crypto.subtle.digest('SHA-256',bytes);return['Blob',value.type,value.size,[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('')];}
 if(value===undefined)return['undefined'];
 if(value===null||typeof value!=='object')return typeof value==='number'&&Object.is(value,-0)?['number','-0']:value;
 if(Array.isArray(value))return['array',await Promise.all(value.map(encode))];
 return['object',await Promise.all(Object.keys(value).sort().map(async key=>[key,await encode((value as Record<string,unknown>)[key])]))];
}
const exact=async(value:unknown)=>JSON.stringify(await encode(value));
async function snapshot(scope:WorldEraScope,boardId:string){
 const read=await readWorldDocument(scope,'board',boardId);assert(read,'Owned board missing');
 const media=await db.localMediaAssets.where('projectId').equals(scope.projectId).toArray();
 const effectiveMedia=(await listWorldDocuments(scope,'media')).sort((a,b)=>a.document.root.id.localeCompare(b.document.root.id));
 // Existing mergeBoardRows/saveEraDocument advance these write clocks on successful Undo.
 // Retain RAW in logical; project only these documented paths for successful-Undo comparison.
 const authored=structuredClone(read.document),clocks:Record<string,number>={root:Number(authored.root.updatedAt??0)};delete authored.root.updatedAt;
 for(const table of ['boardNodes','boardEdges'])for(const row of authored.children[table]??[]){clocks[table+':'+row.id]=Number(row.updatedAt??0);delete row.updatedAt;}
 return{version:read.version,variantRevision:read.variantRevision,provenance:read.provenance,logical:await exact(read.document),authored:await exact(authored),clocks,baseNodes:await exact(await db.boardNodes.where('projectId').equals(scope.projectId).sortBy('id')),baseEdges:await exact(await db.boardEdges.where('projectId').equals(scope.projectId).sortBy('id')),media:await exact(media.sort((a,b)=>a.id.localeCompare(b.id))),effectiveMedia:await exact(effectiveMedia)};
}
function restoredLogical(after:Awaited<ReturnType<typeof snapshot>>,before:Awaited<ReturnType<typeof snapshot>>,era:boolean,message:string){
 assert(after.authored===before.authored&&after.media===before.media&&after.effectiveMedia===before.effectiveMedia,message);
 for(const key of Object.keys(before.clocks))assert(after.clocks[key]>=before.clocks[key],'Undo regressed existing write clock '+key);
 if(era)assert(after.variantRevision!==null&&after.variantRevision>(before.variantRevision??0),'Committed era Undo did not advance revision');
}
function equal(a:unknown,b:unknown,message:string){assert(JSON.stringify(a)===JSON.stringify(b),message);}
async function abortExactly(run:()=>Promise<unknown>,sentinel:string){let seen=false;try{await run();}catch(error){assert(error instanceof Error&&error.message.includes(sentinel),'Unexpected error instead of deliberate outer abort: '+String(error));seen=true;}assert(seen,'Expected outer transaction abort');}
async function createFixture(label:string,era=false){
 const projectId='review-board-media-'+label+'-'+crypto.randomUUID(),foreign=projectId+'-foreign',boardId=projectId+'-board',foreignBoard=foreign+'-board';
 const scope:WorldEraScope={projectId,...(era?{eraId:'past'}:{})},base:WorldEraScope={projectId};
 const asset=(id:string,changes:Record<string,unknown>={}):LocalMediaAsset=>({id,projectId,title:'Own '+id,kind:'audio',mime:'audio/wav',blob:new Blob([new Uint8Array([11,23,37,41])],{type:'audio/wav'}),size:4,notes:'',tags:[],linkedEntryIds:[],createdAt:1,updatedAt:1,...changes} as unknown as LocalMediaAsset);
 // Deliberately structural, nonempty Blob: no playback/codec claim or regenerated WAV fixture.
 const valid=asset(projectId+'-valid'),bad=asset(projectId+'-bad-object',{blob:{},size:4}),empty=asset(projectId+'-empty',{blob:new Blob([]),size:0}),wrongKind=asset(projectId+'-wrong-kind',{kind:'image'}),other=asset(foreign+'-asset',{projectId:foreign});
 const close=async()=>{await deleteProject(projectId);await deleteProject(foreign);};
 try{
  for(const id of [projectId,foreign])await db.projects.add({id,title:id,description:'',mode:'custom',type:'standalone',status:'draft',color:'#776655',enabledEngines:['board','media','codex'],engineOrder:[],createdAt:1,updatedAt:1});
  await db.boards.bulkAdd([{id:boardId,projectId,title:'Own canvas',surface:'slate',createdAt:1,updatedAt:1},{id:foreignBoard,projectId:foreign,title:'Foreign canvas',surface:'slate',createdAt:1,updatedAt:1}]);
  await db.localMediaAssets.bulkAdd([valid,bad,empty,wrongKind,other]);
  const card={...makeNode({projectId,boardId,kind:'card',title:'Unrelated title',position:{x:10,y:10}}),content:'Unrelated caption'},legacy={...makeNode({projectId,boardId,kind:'entity',title:'Legacy title',position:{x:220,y:40},ref:{engineId:'media',entityType:'local-media',entityId:bad.id,title:'Cached legacy media'}}),content:'Legacy caption'};
  await db.boardNodes.bulkAdd([card,legacy]);await db.boardEdges.add(makeEdge({projectId,boardId,sources:[{id:card.id,on:'node'}],targets:[{id:legacy.id,on:'node'}],label:'Preserve this relation'}));
  const codexId=projectId+'-codex';await db.codexEntries.add({id:codexId,projectId,type:'location',title:'Existing Codex control',content:'<p>Own record</p>',fields:{},tags:[],relations:[],createdAt:1,updatedAt:1});
  await saveWorldEra(projectId,{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1},null);
  const action=async(refId=valid.id,extra:Record<string,unknown>={})=>runBridgeTool('wh_board_canvas_action',{...scope,boardId,action:'reference',ref:{engineId:'media',entityType:'local-media',entityId:refId},...extra});
  const undo=(receiptId:string,override:WorldEraScope=scope)=>runBridgeTool('wh_board_canvas_undo',{...override,receiptId});
  const okAction=async(extra:Record<string,unknown>={})=>{const reply=await action(valid.id,extra);assert(reply.ok,'Own Blob reference failed: '+JSON.stringify(reply));const result=reply.result as {receiptId:string;version:string;addedOrUpdated:string[]};assert(typeof result.receiptId==='string'&&result.receiptId.length>0,'Successful reference lacks actual receipt');return result;};
  return{scope,base,projectId,foreign,boardId,foreignBoard,valid,bad,empty,wrongKind,other,legacy,codexId,asset,action,undo,okAction,close};
 }catch(error){await close();throw error;}
}

async function invalidVersusLegacy(){
 const f=await createFixture('invalid');try{
  const before=await snapshot(f.scope,f.boardId),legacyRef=f.legacy.ref!;
  await resolveBoardTile(f.scope,legacyRef);
  const opened=await runBridgeTool('wh_board_canvas_get',{...f.scope,boardId:f.boardId});assert(opened.ok,'Legacy board became unreadable');equal(await snapshot(f.scope,f.boardId),before,'Reading legacy invalid media rewrote graph/version/bytes');
  for(const id of [f.bad.id,f.empty.id,f.wrongKind.id,f.projectId+'-missing','',f.other.id])for(const nodeId of [undefined,f.legacy.id]){
   const reply=await f.action(id,{...(nodeId?{nodeId}:{})});assert(!reply.ok,'New/reassigned invalid media accepted: '+id);assert(!(reply.result as {receiptId?:unknown}|undefined)?.receiptId,'Rejected reference exposed a success receipt');equal(await snapshot(f.scope,f.boardId),before,'Rejected media changed title/caption/nodes/edges/version/bytes: '+id);
  }
  const legacy=(await db.boardNodes.get(f.legacy.id))!;equal(legacy.ref,legacyRef,'Legacy ref was normalized');
  const control=await runBridgeTool('wh_board_canvas_action',{...f.scope,boardId:f.boardId,action:'reference',ref:{engineId:'codex',entityType:'codex-entry',entityId:f.codexId}});assert(control.ok,'Media-only guard rejected existing other-engine reference');const receiptId=(control.result as {receiptId:string}).receiptId;assert((await f.undo(receiptId)).ok,'Existing other-engine control did not Undo');restoredLogical(await snapshot(f.scope,f.boardId),before,false,'Other-engine control/Undo changed original authored graph or media');
 }finally{await f.close();}
 return 'Strict new/reassigned media rejects Blob-object/empty/kind/missing/empty-ID/foreign without graph/version/receipt writes; legacy read and other-engine control remain intact';
}

function assertMetadata(value:unknown){
 if(value instanceof Blob||value instanceof ArrayBuffer||ArrayBuffer.isView(value))throw Error('Media metadata API leaked binary object');
 if(Array.isArray(value)){for(const item of value)assertMetadata(item);return;}
 if(value&&typeof value==='object')for(const item of Object.values(value))assertMetadata(item);
 if(typeof value==='string')assert(!/^blob:|^data:/i.test(value),'Media metadata API leaked an object/data URL');
}
async function ownerAndEra(){
 const f=await createFixture('scope',true);try{
  const read=await readWorldDocument(f.scope,'media',f.valid.id);assert(read,'Base medium should initially inherit');await hideEraDocument(f.scope,'media',f.valid.id,read.version);
  const eraOnly=f.asset(f.projectId+'-era-only',{title:'Only past'});await saveEraDocument(f.scope,'media',{root:eraOnly as unknown as Record<string,unknown>&{id:string},children:{}},null);
  const baseBefore=await snapshot(f.base,f.boardId),eraBefore=await snapshot(f.scope,f.boardId),foreignScope={projectId:f.foreign},foreignBefore=await snapshot(foreignScope,f.foreignBoard);
  for(const id of [f.valid.id,f.other.id,'',f.projectId+'-absent']){const reply=await f.action(id);assert(!reply.ok,'Unavailable effective media fell back to Base/another owner');equal(await snapshot(f.scope,f.boardId),eraBefore,'Rejected scoped reference changed era graph');equal(await snapshot(f.base,f.boardId),baseBefore,'Era rejection changed Base');equal(await snapshot(foreignScope,f.foreignBoard),foreignBefore,'Owner rejection changed foreign board/media');}
  const ordinary=await runBridgeTool('wh_board_canvas_get',{...f.scope,boardId:f.boardId});assert(ordinary.ok&&!('mediaAssets'in(ordinary.result as Record<string,unknown>)),'Omitted includeMedia changed previous response shape');
  const listed=await runBridgeTool('wh_board_canvas_get',{...f.scope,boardId:f.boardId,includeMedia:true});assert(listed.ok,'Scoped metadata listing failed');const rows=(listed.result as {mediaAssets?:Array<Record<string,unknown>>}).mediaAssets;assert(Array.isArray(rows),'includeMedia lacks additive metadata');assert(rows.some(row=>row.id===eraOnly.id)&&!rows.some(row=>row.id===f.valid.id||row.id===f.other.id),'Metadata listing used Base/foreign instead of effective era');assertMetadata(rows);
  const positive=await f.action(eraOnly.id);assert(positive.ok,'Owned era-only reference failed');const receiptId=(positive.result as {receiptId:string}).receiptId;assert((await f.undo(receiptId)).ok,'Era-only reference could not Undo');restoredLogical(await snapshot(f.scope,f.boardId),eraBefore,true,'Era Undo failed to restore authored graph/bytes');equal(await snapshot(f.base,f.boardId),baseBefore,'Era-only action/Undo wrote Base');
 }finally{await f.close();}
 return 'Owned effective media listing/reference honors hidden and era-only resources without Base/foreign/empty-ID fallback; omitted listing shape, logical Undo and Base bytes remain intact';
}

async function outerCreateAbort(){
 for(const era of [false,true]){const f=await createFixture('create-abort',era);try{
  const before=await snapshot(f.scope,f.boardId),base=await snapshot(f.base,f.boardId);let receiptId='';
  await abortExactly(()=>db.transaction('rw',db.tables,async()=>{receiptId=(await f.okAction({expectedVersion:before.version})).receiptId;throw Error('review_media_outer_create_abort');}),'review_media_outer_create_abort');
  equal(await snapshot(f.scope,f.boardId),before,'Outer abort kept media node/reference/version');equal(await snapshot(f.base,f.boardId),base,'Outer abort changed Base/media');assert(receiptId,'No real receipt reached the enclosing transaction');const dead=await f.undo(receiptId);assert(!dead.ok&&dead.code==='cannot-undo','Outer-aborted action left a usable session receipt');equal(await snapshot(f.scope,f.boardId),before,'Rejected aborted receipt changed graph');
 }finally{await f.close();}}
 return 'Actual enclosing Dexie abort rolls back media-reference action in Base/era and removes its actual session receipt; source bytes are unchanged (dispatcher, not Native audit)';
}

async function undoClaimAbortAndStale(){
 for(const era of [false,true]){const f=await createFixture('undo-claim',era);try{
  const before=await snapshot(f.scope,f.boardId),baseBefore=await snapshot(f.base,f.boardId),created=await f.okAction({nodeId:f.legacy.id,expectedVersion:before.version}),after=await snapshot(f.scope,f.boardId);
  for(const wrong of [{projectId:f.foreign},era?f.base:{projectId:f.projectId,eraId:'past'}]){const refused=await f.undo(created.receiptId,wrong);assert(!refused.ok,'Receipt accepted another project/era');equal(await snapshot(f.scope,f.boardId),after,'Wrong-scope Undo wrote source graph');}
  await abortExactly(()=>db.transaction('rw',db.tables,async()=>{assert((await f.undo(created.receiptId)).ok,'First actual Undo failed');throw Error('review_media_outer_undo_abort');}),'review_media_outer_undo_abort');equal(await snapshot(f.scope,f.boardId),after,'Outer Undo abort committed rows/version');
  assert((await f.undo(created.receiptId)).ok,'Aborted Undo consumed receipt; retry failed');const restored=await snapshot(f.scope,f.boardId);restoredLogical(restored,before,era,'Committed Undo failed to restore legacy-invalid ref/caption/relations/source bytes');if(era)equal(await snapshot(f.base,f.boardId),baseBefore,'Era Undo touched Base');
  assert(!(await f.undo(created.receiptId)).ok,'Committed Undo receipt was reusable');equal(await snapshot(f.scope,f.boardId),restored,'Double Undo changed data');
  const stale=await f.okAction({nodeId:f.legacy.id}),later=await runBridgeTool('wh_board_canvas_action',{...f.scope,boardId:f.boardId,action:'shape',shape:'star',title:'Later winner',x:500,y:50});assert(later.ok,'Later legitimate edit failed');const winner=await snapshot(f.scope,f.boardId),blocked=await f.undo(stale.receiptId);assert(!blocked.ok&&blocked.code==='conflict','Stale media receipt rewrote later board');equal(await snapshot(f.scope,f.boardId),winner,'Stale Undo destroyed later node/caption/version');
 }finally{await f.close();}}
 return 'Actual media reassignment receipt rejects wrong scope/stale/double use, survives outer Undo abort for retry, and restores legacy invalid ref plus graph/Blob bytes without applying strict-create validation to Undo';
}

export async function testReviewBoardMediaContracts(){
 const groups:string[]=[];groups.push(await invalidVersusLegacy());groups.push(await ownerAndEra());groups.push(await outerCreateAbort());groups.push(await undoClaimAbortAndStale());return groups;
}
