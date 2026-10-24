import {validatePlaceStyle} from '@/engines/worldgen/core/placeStyle';
import {act,StrictMode,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import SpatialEntityInspector from '@/engines/worldgen/components/SpatialEntityInspector';
import {preparePlaceImages,webPlaceImageAdapter} from '@/engines/worldgen/cartography/placeImages';
import {PLACE_IMAGE_MAX_BYTES,normalizePlaceImage,placeImageBytes} from '@/engines/worldgen/core/placeImage';
import {drawPlaceBuilding} from '@/engines/worldgen/cartography/placeSymbol';
import {generateWorld} from '@/engines/worldgen/core/pipeline';
import {DEFAULT_PARAMS} from '@/engines/worldgen/core/types';
import {applyWorldPreset,WORLD_PRESETS} from '@/engines/worldgen/core/presets';
import {getGeography} from '@/engines/worldgen/cartography/texture';
import {buildAtlas} from '@/engines/worldgen/core/atlas';
import {PaintSession} from '@/engines/worldgen/core/paintSession';
import {editKey,serializeEdits,deserializeEdits,lockViolation} from '@/engines/worldgen/core/edits';
import type {WorldSpatialStyleOverride} from '@/engines/worldgen/core/spatialEntities';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {saveSnapshot} from '@/engines/worldgen/snapshots';
import {paramsKey} from '@/engines/worldgen/useWorldGeneration';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {openWorldForReading} from '@/engines/worldgen/bridgeAccess';
import {useLocaleStore} from '@/stores/localeStore';
import {saveWorldEra} from '@/services/worldEras/store';
import {worldgenScopeOperations,worldRuntimeKey} from '@/engines/worldgen/era';
import {buildDocumentImage} from '@/services/documentImage/build';

export function assertPlaceImage(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
export function placeIconPng(){const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#ff0000';ctx.fillRect(0,0,8,8);ctx.fillStyle='#00ff00';ctx.fillRect(8,0,8,8);ctx.fillStyle='#0000ff';ctx.fillRect(0,8,8,8);ctx.fillStyle='rgba(255,255,0,.5)';ctx.fillRect(8,8,8,8);return canvas.toDataURL('image/png');}
export async function testWorldgenPlaceIconsDescriptor(){
 const descriptor={dataUrl:placeIconPng(),mode:'colour'},style=validatePlaceStyle({iconImage:descriptor,model:'cabin',icon:'HQ'});
 assertPlaceImage(JSON.stringify(style.iconImage)===JSON.stringify(descriptor),'Public style boundary discarded copied image');
 assertPlaceImage(style.model==='cabin'&&style.icon==='HQ','Image descriptor replaced saved model/symbol');
 assertPlaceImage(validatePlaceStyle({iconImage:null}).iconImage===null,'Explicit image removal absent');
 assertPlaceImage(!('iconImage'in validatePlaceStyle({model:'cabin'})),'Legacy style materialized image default');
 return ['Public style boundary retains optional raster/mode and explicit null without replacing model/symbol or materializing legacy defaults'];
}

export async function placeIconFixture(suffix:string){
 const projectId='icon-'+suffix+'-'+crypto.randomUUID(),worldId=projectId+'-world',now=Date.now();
 const world=generateWorld(applyWorldPreset({...DEFAULT_PARAMS,width:512,seed:'carto-quality-continents'},WORLD_PRESETS.find(p=>p.id==='continents')!));
 const geography=getGeography(world),town=geography.settlements.find(s=>s.rank==='capital')!;assertPlaceImage(town,'Fixture needs real generated capital');
 const key=editKey('settlement',town.x,town.y);
 await db.projects.add({id:projectId,title:'Own marker QA',mode:'novelist',type:'standalone',color:'#34493e',description:'',status:'draft',enabledEngines:['worldgen','gallery'],engineOrder:['worldgen','gallery'],createdAt:now,updatedAt:now});
 await db.generatedWorlds.add({id:worldId,projectId,title:'Own marker world',params:world.params,createdAt:now,updatedAt:now});
 await saveSnapshot(worldId,paramsKey(world.params),world);
 return{projectId,worldId,world,geography,town,key,cleanup:()=>deleteProject(projectId)};
}
const pause=()=>new Promise(resolve=>setTimeout(resolve,25));
async function waitFor(check:()=>unknown,message:string){const until=Date.now()+15000;while(Date.now()<until){if(await check())return;await act(async()=>{await pause();});}throw new Error(message);}

export async function testWorldgenPlaceIconsRaster(){
 const png=placeIconPng(),style=validatePlaceStyle({iconImage:{dataUrl:png,mode:'colour'}}),adapter=webPlaceImageAdapter();let decodes=0,releases=0;
 const actual={...adapter,decode:async(bytes:Uint8Array,mime:string)=>{decodes++;const value=await adapter.decode(bytes,mime);return{...value,dispose:()=>{releases++;value.dispose?.();}};}};
 const painter=await preparePlaceImages([style,style],actual,{strict:true});
 try{assertPlaceImage(decodes===1,'Same copied content decoded twice in one lease');const c=document.createElement('canvas');c.width=40;c.height=40;const ctx=c.getContext('2d')!;
 ctx.translate(20,20);assertPlaceImage(drawPlaceBuilding(ctx,style,undefined,16,'town',painter),'Prepared image failed marker painter');let data=ctx.getImageData(8,8,24,24).data;
 assertPlaceImage(data.some((v,i)=>i%4===0&&v>240&&data[i+1]<10)&&data.some((v,i)=>i%4===1&&v>240&&data[i-1]<10),'Colour marker lost red/green quadrants');
 ctx.clearRect(-20,-20,40,40);const inked=validatePlaceStyle({iconImage:{dataUrl:png,mode:'inked'},color:'#704020'});assertPlaceImage(painter.draw(ctx,inked,16),'Inked marker absent');data=ctx.getImageData(8,8,24,24).data;assertPlaceImage(data.some((v,i)=>i%4===3&&v>120&&v<140),'Inked marker discarded fractional alpha');assertPlaceImage(data.some((v,i)=>i%4===0&&v===112&&data[i+1]===64&&data[i+2]===32),'Inked marker lost requested ink');
 }finally{painter.dispose();}assertPlaceImage(releases===1&&!painter.has(style),'Disposed lease retains bitmap');
 const bad={iconImage:{dataUrl:'data:image/png;base64,AAAA',mode:'colour' as const}};let rejected=false;try{await preparePlaceImages([bad],adapter,{strict:true});}catch{rejected=true;}assertPlaceImage(rejected,'Strict export accepted unreadable raster');const fallback=await preparePlaceImages([bad],adapter);assertPlaceImage(fallback.errors.length===1&&!fallback.has(bad),'Imported corrupt image has no honest fallback');fallback.dispose();
 const abort=new AbortController();let finish!:(value:Awaited<ReturnType<typeof adapter.decode>>)=>void;const pending=preparePlaceImages([style],{...adapter,decode:async()=>new Promise(resolve=>{finish=resolve;})},{signal:abort.signal,strict:true});abort.abort();const decoded=await adapter.decode(placeImageBytes(style.iconImage!), 'image/png');let lateReleased=false;finish({...decoded,dispose:()=>{lateReleased=true;decoded.dispose?.();}});try{await pending;throw new Error('Cancelled image preparation succeeded');}catch(error){assertPlaceImage((error as Error).name==='AbortError','Cancellation lost its reason');}assertPlaceImage(lateReleased,'Late decode bitmap leaked');
 return ['Real decoder/Canvas marker preserves colour, ink and fractional alpha; duplicate bytes share one lease, cleanup/cancel release late bitmaps, corrupt import falls back and strict export rejects'];
}

export async function testWorldgenPlaceIconsInspector(){
 const f=await placeIconFixture('inspector'),root=createRoot(document.getElementById('root')!),session=new PaintSession(f.world);useLocaleStore.setState({locale:'en',loaded:true});const png=placeIconPng();
 let edits=0;function Host(){const[revision,setRevision]=useState(0);void revision;const entity=buildAtlas(f.world,getGeography(f.world)).byKey.get(f.key)!;const change=(style:WorldSpatialStyleOverride)=>{session.push({kind:'style',target:'settlement',key:f.key,style});edits++;setRevision(n=>n+1);};return <MemoryRouter><SpatialEntityInspector projectId={f.projectId} worldId={f.worldId} entity={entity} locked onRename={()=>{}} onRemove={()=>{}} onRestore={()=>{}} onMove={()=>{}} onStyle={change} onOpenRegion={()=>{}} onReveal2D={()=>{}} onReveal3D={()=>{}}/></MemoryRouter>;}
 try{await act(async()=>{root.render(<StrictMode><Host/></StrictMode>);await pause();});const input=document.querySelector<HTMLInputElement>('[data-testid="place-image-file"]')!;assertPlaceImage(input,'Normal inspector lacks copied image chooser');
 const transfer=new DataTransfer();transfer.items.add(new File([placeImageBytes({dataUrl:png,mode:'colour'})],'own-quadrants.png',{type:'image/png'}));await act(async()=>{input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));await pause();});await waitFor(()=>!!document.querySelector('[data-testid="place-image-controls"] img'),'File picker did not show copied image');assertPlaceImage(edits===1,'File selection was not one edit or position lock blocked style');
 const mode=document.querySelector<HTMLSelectElement>('[data-testid="place-image-mode"]')!;await act(async()=>{mode.value='inked';mode.dispatchEvent(new Event('change',{bubbles:true}));});assertPlaceImage(buildAtlas(f.world,getGeography(f.world)).byKey.get(f.key)?.style.iconImage?.mode==='inked','Mode control did not edit image');
 const model=document.querySelector<HTMLSelectElement>('select[aria-label="Model"]')??[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='cabin'))!;await act(async()=>{model.value='cabin';model.dispatchEvent(new Event('change',{bubbles:true}));});assertPlaceImage(buildAtlas(f.world,getGeography(f.world)).byKey.get(f.key)?.style.iconImage===null,'Explicit model choice did not reveal selected model');const steps=session.edits.length;session.undo();assertPlaceImage(session.edits.length===steps-1,'UI image/model step not undoable');assertPlaceImage(buildAtlas(f.world,getGeography(f.world)).byKey.get(f.key)?.style.iconImage?.mode==='inked','UI Undo did not restore copied image');session.redo();assertPlaceImage(session.edits.length===steps,'UI image/model step not redoable');
 const before=edits,invalid=new DataTransfer();invalid.items.add(new File(['not png'],'bad.png',{type:'image/png'}));await act(async()=>{input.files=invalid.files;input.dispatchEvent(new Event('change',{bubbles:true}));});await waitFor(()=>!!document.querySelector('[data-testid="place-image-controls"] [role="alert"]'),'Unreadable file lacks recoverable error');assertPlaceImage(edits===before,'Failed decoder changed marker');
 return ['Normal locked-place inspector File chooser and mode edit one PaintSession step; explicit model choice removes image and scoped Undo/Redo restore it; invalid file preserves state with visible error'];
 }finally{await act(async()=>root.unmount());await f.cleanup();}
}

export async function testWorldgenPlaceIconsGalleryRetarget(){
 const f=await placeIconFixture('gallery'),foreign=f.projectId+'-other',root=createRoot(document.getElementById('root')!),png=placeIconPng(),Reader=window.FileReader;useLocaleStore.setState({locale:'en',loaded:true});
 const project=(await db.projects.get(f.projectId))!;await db.projects.add({...project,id:foreign,title:'Other marker project'});await db.generatedWorlds.add({...(await db.generatedWorlds.get(f.worldId))!,id:foreign+'-world',projectId:foreign});
 await db.inspirationImages.bulkAdd([{id:f.projectId+'-image',projectId:f.projectId,imageData:png,imageDataOriginal:png,tags:[],notes:'Own copied quadrants',createdAt:1},{id:foreign+'-image',projectId:foreign,imageData:png,tags:[],notes:'Foreign gallery choice',createdAt:1}]);
 const changes:{projectId:string;style:WorldSpatialStyleOverride}[]=[];const base=buildAtlas(f.world,f.geography).byKey.get(f.key)!;
 function Host({owner}:{owner:string}){const[styles,setStyles]=useState<Record<string,WorldSpatialStyleOverride>>({});return <SpatialEntityInspector projectId={owner} worldId={owner===f.projectId?f.worldId:foreign+'-world'} entity={{...base,style:styles[owner]??{}}} onRename={()=>{}} onRemove={()=>{}} onRestore={()=>{}} onMove={()=>{}} onStyle={style=>{changes.push({projectId:owner,style});setStyles(previous=>({...previous,[owner]:{...previous[owner],...style}}));}} onOpenRegion={()=>{}} onReveal2D={()=>{}} onReveal3D={()=>{}}/>;}
 const render=async(owner:string)=>{await act(async()=>{root.render(<StrictMode><MemoryRouter><Host owner={owner}/></MemoryRouter></StrictMode>);await pause();});};
 const find=(text:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()===text);
 try{await render(f.projectId);await act(async()=>find('From Gallery')!.click());await waitFor(()=>find('Own copied quadrants'),'Own Gallery row absent');await act(async()=>find('Own copied quadrants')!.click());await waitFor(()=>changes.length===1,'Gallery did not commit copied raster');assertPlaceImage(changes[0].style.iconImage?.dataUrl===png,'Gallery did not copy original raster bytes');await db.inspirationImages.delete(f.projectId+'-image');assertPlaceImage(document.querySelector('[data-testid="place-image-controls"] img')?.getAttribute('src')===png,'Deleting gallery source broke place-owned copy');
 await act(async()=>find('From Gallery')!.click());await render(foreign);assertPlaceImage(!find('Own copied quadrants'),'Retarget retained previous project Gallery row');await act(async()=>find('From Gallery')!.click());await waitFor(()=>find('Foreign gallery choice'),'Retarget Gallery did not show own scope');await act(async()=>find('Foreign gallery choice')!.click());await waitFor(()=>changes.length===2,'Foreign scoped gallery did not apply');assertPlaceImage(changes[1].projectId===foreign,'Retarget Gallery wrote previous owner');
 let release:(()=>void)|undefined;window.FileReader=class extends Reader{override readAsDataURL(blob:Blob){release=()=>super.readAsDataURL(blob);}};
 const input=document.querySelector<HTMLInputElement>('[data-testid="place-image-file"]')!,transfer=new DataTransfer();transfer.items.add(new File([placeImageBytes({dataUrl:png,mode:'colour'})],'slow.png',{type:'image/png'}));await act(async()=>{input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));});await render(f.projectId);await act(async()=>{release?.();await pause();await pause();});assertPlaceImage(changes.length===2,'Late file callback crossed project/world binding');assertPlaceImage(!document.querySelector('[data-testid="place-image-controls"] [role="status"]'),'Old owner left new inspector busy');
 return ['Actual Gallery copies original bytes and survives deletion; owner-keyed retarget removes stale project rows and late FileReader completion cannot write another inspector or leave it busy'];
 }finally{window.FileReader=Reader;await act(async()=>root.unmount());await deleteProject(foreign);await f.cleanup();}
}

export async function testWorldgenPlaceIconsBridge(){
 const f=await placeIconFixture('bridge'),image={dataUrl:placeIconPng(),mode:'colour'};
 try{const call=(style:unknown,key=f.key)=>runBridgeTool('wh_style_place',{worldId:f.worldId,key,style});let result=await call({model:'cabin',iconImage:image});assertPlaceImage(result.ok,'Native copied image dispatcher failed '+JSON.stringify(result));
 const saved=(await db.generatedWorlds.get(f.worldId))!,opened=await openWorldForReading(saved);assertPlaceImage(opened.ok&&opened.world.atlas.byKey.get(f.key)?.style.iconImage?.dataUrl===image.dataUrl,'Normal reopen lost copied bytes');const before=saved.edits;
 for(const key of ['realm:0','road:0,0','label:0,0','stamp:0,0']){result=await call({iconImage:null},key);assertPlaceImage(!result.ok,'Image removal allowed on target outside contract '+key);}
 for(const value of [{dataUrl:'https://example.org/image.png',mode:'colour'},{dataUrl:'data:image/svg+xml;base64,PHN2Zy8+',mode:'colour'},{dataUrl:'data:image/png;base64,AAAA',mode:'colour'},{...image,unexpected:true}]){result=await call({iconImage:value});assertPlaceImage(!result.ok,'Invalid raster changed native world');}assertPlaceImage((await db.generatedWorlds.get(f.worldId))?.edits===before,'Rejected image wrote stored edits');
 result=await call({model:'tower'});assertPlaceImage(result.ok,'Existing sparse model patch failed');const updated=await openWorldForReading((await db.generatedWorlds.get(f.worldId))!);assertPlaceImage(updated.ok&&updated.world.atlas.byKey.get(f.key)?.style.iconImage?.dataUrl===image.dataUrl,'MCP omitted image erased copied raster');
 const exported=await runBridgeTool('wh_render_world_map',{worldId:f.worldId,theme:'relief',width:512,view:{x:f.town.x-12,y:f.town.y-8,w:24,h:16}});assertPlaceImage(exported.ok,'Normal PNG dispatcher failed with copied image');const out=exported.result as{dataUrl:string};const decoded=await webPlaceImageAdapter().decode(placeImageBytes({dataUrl:out.dataUrl,mode:'colour'}),'image/png');try{const c=document.createElement('canvas');c.width=decoded.width;c.height=decoded.height;const ctx=c.getContext('2d')!;ctx.drawImage(decoded.image,0,0);const data=ctx.getImageData(0,0,c.width,c.height).data;assertPlaceImage(data.some((v,i)=>i%4===0&&v>245&&data[i+1]<10)&&data.some((v,i)=>i%4===1&&v>245&&data[i-1]<10),'Native PNG omitted marker colour quadrants');}finally{decoded.dispose?.();}
 const list=deserializeEdits((await db.generatedWorlds.get(f.worldId))!.edits!);list.push({kind:'lock',key:f.key,locked:true});assertPlaceImage(lockViolation(list,[{kind:'move',target:'settlement',key:f.key,x:1,y:1}])===f.key&&lockViolation(list,[{kind:'remove',target:'settlement',key:f.key}])===f.key,'Real position lock contract changed');assertPlaceImage(lockViolation(list,[{kind:'style',target:'settlement',key:f.key,style:{iconImage:null}}])===null,'Position lock incorrectly blocks style');const locked=await runBridgeTool('wh_lock_place',{worldId:f.worldId,key:f.key,locked:true});assertPlaceImage(locked.ok,'Normal lock tool failed');for(const tool of ['wh_move_place','wh_remove_place']){const refusal=await runBridgeTool(tool,{worldId:f.worldId,key:f.key,x:1,y:1});assertPlaceImage(!refusal.ok&&refusal.code==='locked','Normal position lock failed '+tool);}result=await call({iconImage:null});assertPlaceImage(result.ok,'Native style rejected position-locked place');
 return ['Real dispatcher copies validated bytes, reopens natively, preserves sparse model patches, exports actual colour quadrants, refuses unsupported targets/invalid raster without writes and permits style under position lock'];
 }finally{await f.cleanup();}
}

export async function testWorldgenPlaceIconsLease(){
 const f=await placeIconFixture('lease'),bitmap=window.createImageBitmap;let release:(()=>void)|undefined,started=false;
 try{const before=(await db.generatedWorlds.get(f.worldId))!.edits;
 const foreign=await runBridgeTool('wh_style_place',{worldId:f.worldId,key:f.key,__scopeProjectId:'another-project',style:{iconImage:{dataUrl:placeIconPng(),mode:'colour'}}});assertPlaceImage(!foreign.ok&&foreign.code==='scope','Native image scope pin ignored');
 window.createImageBitmap=(async(...args:Parameters<typeof createImageBitmap>)=>{started=true;await new Promise<void>(resolve=>{release=resolve;});return Reflect.apply(bitmap,window,args);}) as typeof createImageBitmap;
 const pending=runBridgeTool('wh_style_place',{worldId:f.worldId,key:f.key,style:{iconImage:{dataUrl:placeIconPng(),mode:'colour'}}});await waitFor(()=>started,'MCP preflight did not reach real decoder');await db.projects.update(f.projectId,{enabledEngines:[]});release!();const result=await pending;assertPlaceImage(!result.ok&&result.code==='engine-disabled','Engine revoked during decode still allowed image write');assertPlaceImage((await db.generatedWorlds.get(f.worldId))!.edits===before,'Revoked decode mutated authoritative edits');
 return ['Actual native handler revalidates scope before decoding and engine lease after delayed real image decode; revocation preserves authoritative edits'];
 }finally{window.createImageBitmap=bitmap;release?.();await f.cleanup();}
}

export async function testWorldgenPlaceIconsFeature(){
 const f=await placeIconFixture('feature');try{const feature=buildAtlas(f.world,f.geography).places.find(place=>place.kind==='feature');assertPlaceImage(feature,'Fixture needs real named natural feature');const result=await runBridgeTool('wh_style_place',{worldId:f.worldId,key:feature.key,style:{iconImage:{dataUrl:placeIconPng(),mode:'colour'}}});assertPlaceImage(result.ok,'Native image-only natural feature failed '+JSON.stringify(result));const opened=await openWorldForReading((await db.generatedWorlds.get(f.worldId))!,'full');assertPlaceImage(opened.ok&&opened.world.atlas.byKey.get(feature.key)?.style.iconImage?.mode==='colour','Native natural-feature marker did not survive normal read');return ['Native image-only style applies to an actual full-depth named natural feature without changing its semantic kind or geometry'];}
 finally{await f.cleanup();}
}

export async function testWorldgenPlaceIconsImageDocument(){
 const f=await placeIconFixture('image-document');try{const result=await runBridgeTool('wh_style_place',{worldId:f.worldId,key:f.key,style:{iconImage:{dataUrl:placeIconPng(),mode:'colour'}}});assertPlaceImage(result.ok,'Could not save document-image fixture');const before=(await db.generatedWorlds.get(f.worldId))!.edits,view={x:f.town.x-12,y:f.town.y-8,w:24,h:16};
 const exported=await buildDocumentImage({projectId:f.projectId,kind:'worldgen',entityId:f.worldId,width:576,view,locale:'en'}),doc=new DOMParser().parseFromString(exported.html,'text/html'),src=doc.querySelector('img')?.getAttribute('src');assertPlaceImage(src?.startsWith('data:image/png;base64,'),'Document image did not use native PNG projection');const bitmap=await webPlaceImageAdapter().decode(placeImageBytes({dataUrl:src!,mode:'colour'}),'image/png');try{const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d')!;ctx.drawImage(bitmap.image,0,0);const bytes=ctx.getImageData(0,0,c.width,c.height).data;assertPlaceImage(bytes.some((v,i)=>i%4===0&&v>245&&bytes[i+1]<10),'Document image omitted actual marker pixels');}finally{bitmap.dispose?.();}assertPlaceImage((await db.generatedWorlds.get(f.worldId))!.edits===before,'Document image wrote recipe');
 return ['Normal document-image builder delegates to the same native PNG renderer and captures actual copied marker pixels with stable framing and no recipe write'];
 }finally{await f.cleanup();}
}

/** Runs only through the existing UI harness's native setup hooks, never a new listener. */
export async function testWorldgenPlaceIconsAudit(){
 const native=(window as unknown as{__iconsAudit?:{invoke:(op:string,payload?:unknown)=>Promise<unknown>}}).__iconsAudit;assertPlaceImage(native,'Run this oracle with the node test --audit mode and existing native harness');
 const f=await placeIconFixture('audit');type Outcome={ok:boolean;error?:string;auditIndex?:number;result?:Record<string,unknown>};
 const execute=async(args:Record<string,unknown>)=>await native.invoke('execute',{tool:'wh_style_place',args:{projectId:f.projectId,worldId:f.worldId,key:f.key,...args}}) as Outcome;
 try{const c=document.createElement('canvas');c.width=512;c.height=512;const ctx=c.getContext('2d')!,pixels=ctx.createImageData(512,512);let random=1234567;for(let i=0;i<pixels.data.length;i++){random^=random<<13;random^=random>>>17;random^=random<<5;pixels.data[i]=i%4===3?255:random&255;}ctx.putImageData(pixels,0,0);const image={dataUrl:c.toDataURL('image/png'),mode:'colour'};
 assertPlaceImage(placeImageBytes(normalizePlaceImage(image)!).length<PLACE_IMAGE_MAX_BYTES,'Audit raster exceeds per-image allowance');
 const checkScope=async(eraId?:string)=>{
   const scope={projectId:f.projectId,eraId},worlds=worldgenScopeOperations(scope).worlds;let count=0;
   while(new TextEncoder().encode(JSON.stringify({edits:(await worlds.getOne(f.worldId))?.edits??''})).length<=5*1024*1024){const outcome=await execute({...(eraId?{eraId}:{}),style:{iconImage:image}});assertPlaceImage(outcome.ok,'Executor seed image failed '+outcome.error);assertPlaceImage(++count<16,'Could not construct real aggregate before');}
   const before=(await worlds.getOne(f.worldId))!.edits??'',baseBefore=(await db.generatedWorlds.get(f.worldId))!.edits;
   const outcome=await execute({...(eraId?{eraId}:{}),style:{iconImage:{dataUrl:placeIconPng(),mode:'inked'}}});assertPlaceImage(outcome.ok&&outcome.result?.pending!==true&&Number.isInteger(outcome.auditIndex),'Real executor did not return usable audit index '+JSON.stringify({eraId,ok:outcome.ok,error:outcome.error,auditIndex:outcome.auditIndex}));assertPlaceImage(outcome.result&&!('__audit'in outcome.result),'Executor leaked private audit envelope');
   const record=await native.invoke('record',outcome.auditIndex) as{before:{edits:string};index:number;eraId?:string};assertPlaceImage(record?.index===outcome.auditIndex&&record.before.edits===before,'Filesystem audit truncated or replaced aggregate before');assertPlaceImage(new TextEncoder().encode(JSON.stringify(record.before)).length>5*1024*1024,'Before did not cross rotation threshold');assertPlaceImage(record.eraId===eraId,'Audit scope lost named era');
   const undo=await native.invoke('undo',outcome.auditIndex) as Outcome;assertPlaceImage(undo.ok&&undo.result?.undone,'Actual audit-index Undo failed '+undo.error);assertPlaceImage((await worlds.getOne(f.worldId))!.edits===before,'Real Undo did not restore complete before');if(eraId)assertPlaceImage((await db.generatedWorlds.get(f.worldId))!.edits===baseBefore,'Era Undo changed Base');
   const duplicate=await native.invoke('undo',outcome.auditIndex) as Outcome&{code?:string};assertPlaceImage(!duplicate.ok&&duplicate.code==='already-undone','Audit allowed double Undo');const records=await native.invoke('records') as{undoOf?:number;ok:boolean}[];assertPlaceImage(records.some(row=>row.undoOf===outcome.auditIndex&&row.ok),'Undo did not append its own actual audit record');
   const stats=await native.invoke('files') as{live:number;previous:number};assertPlaceImage(stats.previous>5*1024*1024,'Large before did not traverse real rotation');console.log('AUDIT_SCOPE '+JSON.stringify({eraId:eraId??'Base',beforeBytes:new TextEncoder().encode(JSON.stringify(record.before)).length,auditIndex:outcome.auditIndex,exactBefore:true,files:stats}));
   // More actual style calls rotate the old entry out, rather than promising unlimited history.
   for(let n=0;n<3;n++){const result=await execute({...(eraId?{eraId}:{}),style:{color:n%2?'#654321':'#123456'}});assertPlaceImage(result.ok,'Retention exercise failed');}
   assertPlaceImage(await native.invoke('record',outcome.auditIndex)===null,'Expected old receipt to leave live+predecessor after successive large rotations');
   return count;
 };
 const baseCalls=await checkScope();await saveWorldEra(f.projectId,{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1},null);await saveSnapshot(worldRuntimeKey(f.worldId,'past'),paramsKey(f.world.params),generateWorld(f.world.params));const eraCalls=await checkScope('past');
 return [`Real executor→handler→filesystem audit/rotation→audit-index RPC Undo preserves aggregate before above 5 MiB in Base (${baseCalls} image calls) and era (${eraCalls}), rejects repeated Undo and exposes finite retention; no fabricated entry or network listener`];
 }finally{await f.cleanup();}
}

// Append to tests/worldgen-place-icons.browser.tsx after its existing imports.
// Uses its existing placeIconFixture/placeIconPng/assertPlaceImage helpers.
// Run these component exports with scripts/run-codex-properties-ui.cjs: real CSS.
// BrowserWindow GPU may be software; this does not claim hardware or worker transport.
import { createElement as vxElement } from 'react';
import Map2DForIcons from '@/engines/worldgen/components/Map2D';
import CartoMapForIcons from '@/engines/worldgen/components/CartoMap';
import World3DForIcons from '@/engines/worldgen/components/World3D';
import { DEFAULT_PAINT_TOOL as vxPaintTool } from '@/engines/worldgen/components/PaintPanel';
import { THEME_RELIEF as vxTheme } from '@/engines/worldgen/cartography/theme';
import { getCartoTexture as vxTexture } from '@/engines/worldgen/cartography/texture';
import type { PlaceImagePainter as VxPainter } from '@/engines/worldgen/cartography/placeImages';
import type { WorldSpatialStyle as VxStyle } from '@/engines/worldgen/core/spatialEntities';
import * as vxThree from 'three';

interface VxImageDraw { canvas: HTMLCanvasElement; x: number; y: number; radius: number; mode: string }
function vxTracked(painter: VxPainter) {
  const draws: VxImageDraw[] = [];
  const tracked: VxPainter = {
    errors: painter.errors, has: style => painter.has(style), dispose() {},
    draw(ctx, style, radius, ink) {
      const drawn = painter.draw(ctx, style, radius, ink);
      if (drawn && ctx.canvas instanceof HTMLCanvasElement) {
        const transform = ctx.getTransform();
        draws.push({ canvas: ctx.canvas, x: transform.e, y: transform.f,
          radius: radius * Math.max(Math.hypot(transform.a, transform.b), Math.hypot(transform.c, transform.d)),
          mode: style.iconImage?.mode ?? '' });
      }
      return drawn;
    },
  };
  return { tracked, draws };
}
function vxPixels(draw: VxImageDraw) {
  const radius = Math.max(2, Math.ceil(draw.radius));
  const x = Math.max(0, Math.floor(draw.x) - radius), y = Math.max(0, Math.floor(draw.y) - radius);
  const width = Math.min(draw.canvas.width - x, radius * 2), height = Math.min(draw.canvas.height - y, radius * 2);
  if (width <= 0 || height <= 0) return new Uint8ClampedArray();
  return draw.canvas.getContext('2d')!.getImageData(x, y, width, height).data;
}
function vxHasQuads(draw: VxImageDraw | undefined): boolean {
  if (!draw) return false;
  const data = vxPixels(draw);
  return [[255, 0, 0], [0, 255, 0], [0, 0, 255]].every(rgb => {
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 250
      && rgb.every((value, channel) => Math.abs(value - data[i + channel]) <= 3)) count++;
    return count >= 2;
  });
}
function vxHasInk(draw: VxImageDraw | undefined): boolean {
  if (!draw) return false;
  const data = vxPixels(draw);
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 250
    && Math.abs(data[i] - 112) <= 3 && Math.abs(data[i + 1] - 64) <= 3 && Math.abs(data[i + 2] - 32) <= 3) return true;
  return false;
}
function vxLast(draws: VxImageDraw[], host: HTMLElement): VxImageDraw | undefined {
  return draws.filter(draw => draw.canvas.isConnected && host.contains(draw.canvas)).at(-1);
}
async function vxUntil(check: () => boolean, message: string, ms = 60_000) {
  const end = performance.now() + ms;
  while (!check() && performance.now() < end) await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  assertPlaceImage(check(), message);
}
function vxHost() {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:960px;height:640px;background:#111820';
  document.body.append(host);
  return host;
}

export async function testWorldgenPlaceIconsView2D() {
  const f = await placeIconFixture('view2d'), host = vxHost(), root = createRoot(host);
  const village=f.geography.settlements.find(s=>s.rank==='village');assertPlaceImage(village,'Real default-size view fixture requires a village');f.town=village;f.key=editKey('settlement',village.x,village.y);
  const session = new PaintSession(f.world), iconImage = { dataUrl: placeIconPng(), mode: 'colour' as const };
  session.push({ kind: 'style', target: 'settlement', key: f.key,
    style: { model: 'cabin', size: 1, labelVisible: true, iconImage, color: '#704020' } });
  const painter = await preparePlaceImages([worldStyle()], webPlaceImageAdapter(), { strict: true });
  const { tracked, draws } = vxTracked(painter);
  const viewport = { u: (f.town.x + .5) / f.world.width, v: (f.town.y + .5) / f.world.height, spanKm: 600 };
  const exportRef = { current: null as ((scale: number) => Promise<Blob | null>) | null };
  const noop = () => {};
  function worldStyle() { return f.world.painted!.styles[f.key]; }
  try {
    await act(async () => root.render(vxElement(Map2DForIcons, {
      world: f.world, geography: getGeography(f.world), placeImages: tracked, viewport,
      viewMode: 'elevation', projection: 'equirect', showRivers: false, showLandmarks: false,
      showWaypoints: false, showGrid: false, showSettlements: true, showFeatures: false,
      showRoads: false, showBorders: false, waypoints: [], selectedWaypointId: null,
      onSelectWaypoint: noop, revision: f.world.revision, exportRef,
    })));
    await vxUntil(() => !!vxLast(draws, host), 'Shipping Map2D did not draw the default-size village image');const frame=vxLast(draws,host)!;const cssWidth=frame.radius*2*frame.canvas.getBoundingClientRect().width/frame.canvas.width;assertPlaceImage(cssWidth>=15.9,'Default-size village image is not legible: '+cssWidth+' CSSpx');assertPlaceImage(cssWidth<=16.1,'Default-size village frame was scaled twice: '+cssWidth+' CSSpx');console.log('PREPARED_FRAME '+JSON.stringify({cssWidth,dpr:window.devicePixelRatio,logicalSize:1}));await vxUntil(() => vxHasQuads(vxLast(draws, host)), 'Shipping Map2D did not paint prepared colour quadrants on its visible canvas');
    const blob = await exportRef.current?.(1);
    assertPlaceImage(blob, 'Shipping Map2D view export returned no PNG');
    const exported = await createImageBitmap(blob);
    try {
      const canvas = document.createElement('canvas'); canvas.width = exported.width; canvas.height = exported.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(exported, 0, 0);
      assertPlaceImage(vxHasQuads({ canvas, x: canvas.width / 2, y: canvas.height / 2,
        radius: Math.max(canvas.width, canvas.height), mode: 'colour' }), 'Map2D view PNG omitted actual marker quadrants');
    } finally { exported.close(); }
    draws.length = 0;
    await act(async () => root.render(vxElement(CartoMapForIcons, {
      world: f.world, geography: getGeography(f.world), placeImages: tracked, viewport,
      theme: vxTheme, density: 1, reliefAmount: 0,
      layers: { forests:false,relief:false,roads: false, borders: false, labels: false, frame: false, compass: false, scaleBar: false },
    })));
    await vxUntil(() => vxHasQuads(vxLast(draws, host)), 'Shipping CartoMap live overlay did not paint prepared colour quadrants');
    return ['Shipping Map2D visible canvas and view PNG, plus shipping CartoMap live overlay, paint actual copied colour quadrants'];
  } finally { await act(async () => root.unmount()); host.remove(); painter.dispose(); await f.cleanup(); }
}

export async function testWorldgenPlaceIconsTexture() {
  const f = await placeIconFixture('texture'), session = new PaintSession(f.world);
  session.push({ kind: 'style', target: 'settlement', key: f.key,
    style: { model: 'keep', size: 2, iconImage: { dataUrl: placeIconPng(), mode: 'colour' } } });
  const style = f.world.painted!.styles[f.key];
  const painter = await preparePlaceImages([style], webPlaceImageAdapter(), { strict: true });
  try {
    const geo = { ...getGeography(f.world), settlements: [f.town], ruins: [], features: [], roads: [], realms: [] };
    const visibility = { rivers: false, roads: false, borders: false };
    const legacy = vxTexture(f.world, vxTheme, geo, 512, visibility);
    const ready = vxTexture(f.world, vxTheme, geo, 512, visibility, painter);
    assertPlaceImage(ready !== legacy, 'Prepared lease reused fallback texture generation');
    assertPlaceImage(vxTexture(f.world, vxTheme, geo, 512, visibility, painter) === ready, 'Same prepared lease rebuilt its texture');
    const expectedGround = vxTexture(f.world, vxTheme, { ...geo, settlements: [] }, 512, visibility);
    const pixels = (canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const a = pixels(ready), b = pixels(expectedGround), c = pixels(legacy);
    assertPlaceImage(a.every((value, i) => value === b[i]), '3D texture burned the image or old construction beneath its transparent screen overlay');
    assertPlaceImage(c.some((value, i) => value !== a[i]), 'Legacy construction control had no actual marker pixels');
    const otherLease = await preparePlaceImages([style], webPlaceImageAdapter(), { strict: true });
    try { assertPlaceImage(vxTexture(f.world, vxTheme, geo, 512, visibility, otherLease) !== ready, 'New prepared lease did not invalidate texture generation'); }
    finally { otherLease.dispose(); }
    return ['3D cartographic texture reserves prepared image places without baking their raster or old model, preserves legacy control and keys cache by prepared lease'];
  } finally { painter.dispose(); await f.cleanup(); }
}

export async function testWorldgenPlaceIconsViewDpr2(){
 const previous=Object.getOwnPropertyDescriptor(window,'devicePixelRatio');Object.defineProperty(window,'devicePixelRatio',{configurable:true,value:2});
 try{await testWorldgenPlaceIconsView2D();return ['Real Map2D default village remains at least16 CSSpx on DPR2 and its PNG/Carto retain actual colour quadrants'];}
 finally{if(previous)Object.defineProperty(window,'devicePixelRatio',previous);else delete(window as unknown as{devicePixelRatio?:number}).devicePixelRatio;}
}

export async function testWorldgenPlaceIconsFrameHit(){
 const f=await placeIconFixture('frame-hit'),host=vxHost(),root=createRoot(host),session=new PaintSession(f.world);const village=f.geography.settlements.find(s=>s.rank==='village')!;assertPlaceImage(village,'Frame hit needs real village');const key=editKey('settlement',village.x,village.y);session.push({kind:'style',target:'settlement',key,style:{iconImage:{dataUrl:placeIconPng(),mode:'colour'},size:2.4,labelVisible:true}});const painter=await preparePlaceImages([f.world.painted!.styles[key]],webPlaceImageAdapter(),{strict:true}),{tracked,draws}=vxTracked(painter);let picked='';
 try{await act(async()=>root.render(<Map2DForIcons world={f.world} geography={{...getGeography(f.world),settlements:[village]}} placeImages={tracked} viewport={{u:(village.x+.5)/f.world.width,v:(village.y+.5)/f.world.height,spanKm:600}} viewMode="elevation" projection="equirect" showRivers={false} showLandmarks={false} showWaypoints={false} showGrid={false} showSettlements showFeatures={false} showRoads={false} showBorders={false} waypoints={[]} selectedWaypointId={null} onSelectWaypoint={()=>{}} onPickSettlement={town=>{picked=town.id;}} revision={f.world.revision}/>));await vxUntil(()=>!!vxLast(draws,host),'Large copied image did not draw');const frame=vxLast(draws,host)!,rect=frame.canvas.getBoundingClientRect(),ratio=rect.width/frame.canvas.width;assertPlaceImage(Math.abs(frame.radius*2*ratio-38.4)<.2,'Size2.4 image has inconsistent screen frame');
 const x=rect.left+frame.x*ratio+17,y=rect.top+frame.y*ratio;const target=window as unknown as{__native:unknown;__nativeAck?:number};target.__native={n:1,events:[{type:'mouseDown',x,y,button:'left',clickCount:1},{type:'mouseUp',x,y,button:'left',clickCount:1}]};await vxUntil(()=>target.__nativeAck===1,'Native pointer input not delivered');await vxUntil(()=>picked===village.id,'Visible image edge lies outside its real settlement hit area');
 return ['Actual native pointer selects the default-style village at its enlarged size2.4 image edge, with coherent38.4px frame and hit reach'];
 }finally{await act(async()=>root.unmount());host.remove();painter.dispose();await f.cleanup();}
}

export async function testWorldgenPlaceIconsView3D() {
  const f = await placeIconFixture('view3d'), session = new PaintSession(f.world), host = vxHost(), root = createRoot(host);
  const iconImage = { dataUrl: placeIconPng(), mode: 'colour' as const };
  const painter = await preparePlaceImages([{ iconImage }], webPlaceImageAdapter(), { strict: true });
  const { tracked, draws } = vxTracked(painter);
  let models: vxThree.Object3D | undefined;
  const originalAdd = vxThree.Object3D.prototype.add;
  vxThree.Object3D.prototype.add = function(...objects: vxThree.Object3D[]) {
    for (const object of objects) if (object.name === 'World place models') models = object;
    return originalAdd.apply(this, objects);
  };
  const modelCount = () => { let count = 0; models?.traverse(child => { if (child instanceof vxThree.Mesh) count++; }); return count; };
  const noop = () => {}, viewport = { u: (f.town.x + .5) / f.world.width, v: (f.town.y + .5) / f.world.height, spanKm: 600 };
  const show = async (ready: boolean) => {
    draws.length = 0;
    const geo = { ...getGeography(f.world), settlements: [f.town], ruins: [], features: [], roads: [], realms: [] };
    await act(async () => root.render(vxElement(World3DForIcons, {
      world: f.world, geography: geo, placeImages: ready ? tracked : undefined,
      theme: vxTheme, viewport, waypoints: [], showWaypoints: false, showSettlements: true,
      showLandmarks: false, showRivers: false, showRoads: false, showBorders: false,
      skin: 'arcilla', shape: 'plane', onShape: noop, exaggeration: 30,
      tool: vxPaintTool, onEdit: noop, revision: f.world.revision ?? 0,
    })));
  };
  try {
    session.push({ kind: 'style', target: 'settlement', key: f.key, style: { model: 'keep', size: 2, color: '#704020', labelVisible: true } });
    await show(false);
    await vxUntil(() => !!models?.visible && modelCount() > 0, 'Shipping World3D scene did not draw the saved place model', 90_000);
    session.push({ kind: 'style', target: 'settlement', key: f.key, style: { iconImage } });
    await show(true);
    await vxUntil(() => modelCount() === 0 && vxHasQuads(vxLast(draws, host)), 'Prepared World3D image did not replace the actual mesh with a projected colour overlay', 90_000);
    const draw = vxLast(draws, host)!;
    assertPlaceImage(!draw.canvas.closest('[data-testid="world3d-host"]'), 'The copied image was drawn into the WebGL host instead of its plane overlay');
    session.push({ kind: 'style', target: 'settlement', key: f.key, style: { iconImage: { ...iconImage, mode: 'inked' } } });
    await show(true);
    await vxUntil(() => modelCount() === 0 && vxHasInk(vxLast(draws, host)), 'Shipping World3D overlay failed to recolour the prepared image using effective ink');
    session.push({ kind: 'style', target: 'settlement', key: f.key, style: { iconImage: null } });
    await show(true);
    await vxUntil(() => modelCount() > 0, 'Removing image did not restore actual saved construction geometry');
    assertPlaceImage(f.world.painted!.styles[f.key].model === 'keep', 'Prepared image changed the saved model');
    return ['Shipping World3D projected overlay paints colour/ink, suppresses actual saved construction meshes only while ready and restores them on Remove'];
  } finally {
    vxThree.Object3D.prototype.add = originalAdd;
    await act(async () => root.unmount()); host.remove(); painter.dispose(); await f.cleanup();
  }
}

import { setRenderedTilePersistence as vxSetTilePersistence } from '@/engines/worldgen/region/tileService';
import type { RenderedTile as VxTile } from '@/engines/worldgen/region/client';
import { tileGeometry as vxTileGeometry, tileKey as vxTileKey } from '@/engines/worldgen/region/tiles';
import { Cover as VxCover, DEFAULT_REGION_PARAMS as vxRegionParams, type RegionData as VxRegion } from '@/engines/worldgen/region/types';
import { CANON_CACHE_BYTES as VX_CACHE_BYTES, CANON_CACHE_CAP as VX_CACHE_CAP, installCanon as vxInstallCanon, makeCanonCache as vxCanonCache } from '@/engines/worldgen/region/deepTile';
import { renderSatelliteDeepTile as vxRenderSatellite } from '@/engines/worldgen/region/satelliteTile';
import type { HumanGeography as VxGeography } from '@/engines/worldgen/core/settlements';
// Own seeded canon + production satellite rendering. The persistence seam below
// delivers that actual tile to shipping Map2D; no fabricated TilePlace array and
// no claim about a Worker/Forge entry or whole-view ground completion.
function vxSatelliteFixture(world: ReturnType<typeof generateWorld>, geography: VxGeography) {
  assertPlaceImage(world.width === 64, 'Bounded satellite fixture expects width64');
  const key = { z: 10, tx: 100, ty: 100 }, geometry = vxTileGeometry(world, { tx: 1, ty: 1 });
  const point = { x: 6.28125, y: 6.28125 }, sourceKey = 'region:habitation:16,16';
  const n = geometry.width * geometry.height;
  const region: VxRegion = {
    ...geometry, window: { cx: 6, cy: 6, spanKm: 30 }, params: vxRegionParams,
    elevation: new Float32Array(n).fill(1), water: new Uint8Array(n), flow: new Float32Array(n),
    slope: new Float32Array(n), wet: new Float32Array(n), biome: new Uint8Array(n).fill(6),
    cover: new Uint8Array(n).fill(VxCover.Grass), streams: [], tracks: [], fields: [], hedges: [], dykes: [],
    title: 'Own countryside', subtitle: '',
    places: [{ id: 1, sourceKey, kind: 'farm', x: (point.x - geometry.originX) * 512,
      y: (point.y - geometry.originY) * 512, worldX: point.x, worldY: point.y,
      name: 'Own regional icon', importance: 1 }],
  };
  const cache = vxCanonCache(); vxInstallCanon(cache, vxTileKey({ tx: 1, ty: 1 }), region);
  return {
    key, point, sourceKey,
    render(style: VxStyle): VxTile {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
      const result = vxRenderSatellite(world, geography, cache, canvas.getContext('2d')!, key, {
        layers: { roads: false, rivers: false, fields: false }, density: 1,
        edits: [{ kind: 'style', key: sourceKey, style }],
      }, { cap: VX_CACHE_CAP, bytes: VX_CACHE_BYTES });
      assertPlaceImage(result.generated === 0 && result.places.length === 1
        && result.places[0].sourceKey === sourceKey, 'Satellite production render missed its own seeded canon or lost TilePlace');
      return { bitmap: canvas, places: result.places };
    },
    dispose() { cache.map.clear(); cache.order.length = 0; cache.bytes = 0; },
  };
}

export async function testWorldgenPlaceIconsSatelliteOverlay() {
  const world = generateWorld({ ...DEFAULT_PARAMS, width: 64, erosion: 0, seed: 'place-icon-final-satellite' });
  const geography = { ...getGeography(world), settlements: [], ruins: [], features: [], roads: [], realms: [] };
  assertPlaceImage(geography.depth === 'full', 'Satellite fixture did not use complete generated geography');
  const satellite = vxSatelliteFixture(world, geography), session = new PaintSession(world);
  const iconImage = { dataUrl: placeIconPng(), mode: 'colour' as const };
  const painter = await preparePlaceImages([{ iconImage }], webPlaceImageAdapter(), { strict: true });
  const { tracked, draws } = vxTracked(painter), host = vxHost(), root = createRoot(host);
  const pending: ((value: VxTile | null) => void)[] = [];
  let delivered = 0, activeStyle: VxStyle = { size: 2, color: '#704020', iconImage };
  vxSetTilePersistence({
    async load(_world, _geo, key) {
      if (key.z === satellite.key.z && key.tx === satellite.key.tx && key.ty === satellite.key.ty) {
        delivered++; return satellite.render(activeStyle);
      }
      // Keep unrelated ground pending, then resolve after component cancellation.
      // No fabricated ground tile and no extra worker/host is started for it.
      return new Promise<VxTile | null>(resolve => pending.push(resolve));
    },
    save() {},
  });
  const noop = () => {}, viewport = { u: satellite.point.x / world.width, v: satellite.point.y / world.height, spanKm: 200 };
  const exportRef = { current: null as ((scale: number) => Promise<Blob | null>) | null };
  const show = async () => {
    session.push({ kind: 'style', target: 'region', key: satellite.sourceKey, style: activeStyle });
    draws.length = 0;
    await act(async () => root.render(vxElement(Map2DForIcons, {
      world, canonWorld: world, canonEdits: serializeEdits(session.edits), geography, placeImages: tracked,
      viewport, viewMode: 'atlas', projection: 'equirect', showRivers: false, showLandmarks: false,
      showWaypoints: false, showGrid: false, showSettlements: true, showFeatures: true, showRoads: false,
      showBorders: false, waypoints: [], selectedWaypointId: null, onSelectWaypoint: noop,
      revision: world.revision, exportRef,
    })));
  };
  try {
    await show();
    await vxUntil(() => delivered > 0 && vxHasQuads(vxLast(draws, host)), 'Production satellite TilePlace never reached the actual Map2D visible icon pass');
    assertPlaceImage(!geography.settlements.length, 'Principal settlement path accidentally supplied the tested satellite image');
    activeStyle = { ...activeStyle, iconImage: { ...iconImage, mode: 'inked' } };
    const oldDelivered = delivered;
    await show();
    await vxUntil(() => delivered > oldDelivered && vxHasInk(vxLast(draws, host)), 'Changing regional image mode kept stale satellite TilePlace/overlay');
    const png = await exportRef.current?.(1); assertPlaceImage(png, 'Satellite Map2D view export returned no PNG');
    return ['Production satellite tile and its real TilePlace reach shipping Map2D final colour/ink overlay and view export through its existing persistence seam; unrelated ground remains pending, no worker-transport claim'];
  } finally {
    await act(async () => root.unmount()); host.remove();
    for (const resolve of pending) resolve(null);
    await Promise.resolve(); vxSetTilePersistence(null); painter.dispose(); satellite.dispose();
  }
}
