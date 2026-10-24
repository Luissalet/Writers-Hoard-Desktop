import {hideEraDocument,resetEraDocument} from '@/services/worldEras/store';
import {buildWorldWiki,type WorldWikiData} from '@/services/worldWikiExport';
import {createToolExecutor,type AuditLine} from '@/services/aiRuntime/executorCore';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import {exportProjectData,importProjectData,deleteProject} from '@/db/operations';
import {previewProjectDuplicate,duplicateProject} from '@/services/projectDuplicate/service';
import {bannerContext,readBannerCatalog,setBannerPreset,writeBannerEvent,undoBannerChange} from '@/engines/timeline/bannerPresets';
import {resolveBannerStyle} from '@/engines/timeline/bannerStyles';
import {saveWorldEra,readWorldDocument} from '@/services/worldEras/store';
import type {TimelineEvent} from '@/types';
import '@/engines/timeline/index';
import {db} from '@/db';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
function assert(v:unknown,m:string):asserts v{if(!v)throw Error(m);}
export async function testCalendarBannerCatalogContract(){
 const p='qa-banner-catalog',tl=p+'-tl';
 try{
  await db.projects.put({id:p,title:'Banner QA',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['timeline'],createdAt:1,updatedAt:1});
  await db.timelines.put({id:tl,projectId:p,title:'Harbour',color:'#aa4400',createdAt:1,updatedAt:1});
  const read=await runBridgeTool('wh_timeline_banner_presets',{projectId:p,timelineId:tl});
  assert(read.ok,'Native catalog read missing: '+JSON.stringify(read));
  const current=read.result as {version:string;presets:unknown[]};assert(current.presets.length===0,'Empty catalog must not materialize defaults');
  const made=await runBridgeTool('wh_timeline_banner_preset_set',{projectId:p,timelineId:tl,expectedVersion:current.version,action:'upsert',presetId:'P',name:'Harbour',style:{shape:'bunting',pattern:'grid',color:'#aa4400',patternParams:{repeatSizePx:24,opacity:.18}}});
  assert(made.ok,'Native catalog set missing: '+JSON.stringify(made));
  return ['Native catalog read/set persists a bitmap-free preset with shared params'];
 }finally{await db.timelines.where('projectId').equals(p).delete();await db.projects.delete(p);}
}

export async function testCalendarBannerLiveMoveAndUndo(){
 const p='qa-banner-live',a=p+'-A',b=p+'-B',eid=p+'-event',scope={projectId:p};
 try{
  await db.projects.put({id:p,title:'Live',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['timeline'],createdAt:1,updatedAt:1});
  for(const id of [a,b])await db.timelines.put({id,projectId:p,title:id,color:'#aa4400',createdAt:1,updatedAt:1});
  for(const [id,color,shape] of [[a,'#aa4400','bunting'],[b,'#0000aa','ribbon']])await setBannerPreset(scope,id,(await readBannerCatalog(scope,id)).version,'upsert','P','Same',{shape,pattern:'grid',color,patternParams:{repeatSizePx:23,opacity:.19}});
  const manual:TimelineEvent={id:eid,projectId:p,timelineId:a,title:'Arrival',description:'Manual prose',date:'Arrival',dateMode:'text',eventType:'point',order:0,lane:'Main',color:'#00aa00',createdAt:1,updatedAt:1,bannerShape:'scallop',bannerPattern:'checks'};
  await db.timelineEvents.put(manual);
  const linked=await writeBannerEvent(scope,{event:manual,baseline:manual,targets:(await bannerContext(scope)).targets,action:{mode:'live',ownerTimelineId:a,presetId:'P',colorMode:'preset'}});
  assert(linked.receiptId,'No link receipt');
  let row=(await db.timelineEvents.get(eid))!;assert(row.bannerShape==='scallop'&&row.color==='#00aa00','Link destroyed manual');
  let context=await bannerContext(scope);assert(resolveBannerStyle(row,context.timelines).style.shape==='bunting','Not live A');
  const move=await writeBannerEvent(scope,{event:{...row,timelineId:b},baseline:row,targets:context.targets});
  row=(await db.timelineEvents.get(eid))!;assert(row.timelineId===b&&row.bannerPreset?.ownerTimelineId===a,'Move adopted destination owner');
  assert(resolveBannerStyle(row,(await bannerContext(scope)).timelines).style.color==='#aa4400','Move adopted homonymous B');
  await setBannerPreset(scope,a,(await readBannerCatalog(scope,a)).version,'upsert','P','A changed',{shape:'ribbon',pattern:'crosshatch',color:'#ff0000'});
  context=await bannerContext(scope);assert(resolveBannerStyle(row,context.timelines).style.color==='#ff0000','Original owner update not live after move');
  await db.timelineEvents.update(eid,{description:'Later unrelated prose'});
  await undoBannerChange(scope,move.receiptId);row=(await db.timelineEvents.get(eid))!;
  assert(row.timelineId===a&&row.description==='Later unrelated prose'&&row.bannerShape==='scallop','Move undo lost later unrelated prose/manual');
  const copy=await writeBannerEvent(scope,{event:row,baseline:row,targets:(await bannerContext(scope)).targets,action:{mode:'copy'}});
  row=(await db.timelineEvents.get(eid))!;assert(!row.bannerPreset&&row.bannerShape==='ribbon'&&row.color==='#ff0000','Copy did not materialize current effective style');
  await undoBannerChange(scope,copy.receiptId);row=(await db.timelineEvents.get(eid))!;
  await writeBannerEvent(scope,{event:row,baseline:row,targets:(await bannerContext(scope)).targets,action:{mode:'manual'}});
  row=(await db.timelineEvents.get(eid))!;assert(!row.bannerPreset&&row.bannerShape==='scallop'&&row.bannerPattern==='checks'&&row.color==='#00aa00','Manual did not recover original layer');
  return ['Live A/P survives move to B/P, changes through A, copy/manual differ and scoped Undo preserves unrelated prose'];
 }finally{for(const table of [db.timelineEvents,db.timelines,db.worldEraVariants,db.worldEraAssets])await table.where('projectId').equals(p).delete();await db.projects.delete(p);}
}
export async function testCalendarBannerEraAndOuterAbort(){
 const p='qa-banner-era',a=p+'-A',b=p+'-B',eid=p+'-E',base={projectId:p};
 try{
  await db.projects.put({id:p,title:'Era',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['timeline'],createdAt:1,updatedAt:1});
  for(const id of [a,b])await db.timelines.put({id,projectId:p,title:id,color:'#aa4400',createdAt:1,updatedAt:1});
  await setBannerPreset(base,a,(await readBannerCatalog(base,a)).version,'upsert','P','A',{shape:'bunting',pattern:'grid',color:'#aa4400'});
  const event:TimelineEvent={id:eid,projectId:p,timelineId:a,title:'Event',description:'',date:'',dateMode:'text',eventType:'point',order:0,lane:'',color:'#00aa00',createdAt:1,updatedAt:1};await db.timelineEvents.put(event);
  await writeBannerEvent(base,{event,baseline:event,targets:(await bannerContext(base)).targets,action:{mode:'live',ownerTimelineId:a,presetId:'P'}});
  await saveWorldEra(p,{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1},null);
  const scope={projectId:p,eraId:'past'},row=(await db.timelineEvents.get(eid))!,before=JSON.stringify(row);
  const move=await writeBannerEvent(scope,{event:{...row,timelineId:b},baseline:row,targets:(await bannerContext(scope)).targets});
  assert(!(await readWorldDocument(scope,'timeline',a))!.document.children.timelineEvents.some(e=>e.id===eid),'Era source still contains moved event');
  assert((await readWorldDocument(scope,'timeline',b))!.document.children.timelineEvents.some(e=>e.id===eid&&e.timelineId===b),'Era destination missing event');
  assert(JSON.stringify(await db.timelineEvents.get(eid))===before,'Era move modified Base');
  await undoBannerChange(scope,move.receiptId);assert((await readWorldDocument(scope,'timeline',a))!.document.children.timelineEvents.some(e=>e.id===eid),'Era move Undo missing source');
  const snapshot=JSON.stringify(await db.timelines.get(a));let abortedId='';
  try{await db.transaction('rw',db.tables,async()=>{const made=await setBannerPreset(base,a,(await readBannerCatalog(base,a)).version,'upsert','ABORT','Abort',{shape:'plain',pattern:'grid',color:'#aa4400'});abortedId=made.receiptId;throw Error('late abort');});}catch{/* intentional */}
  assert(JSON.stringify(await db.timelines.get(a))===snapshot,'Outer abort left catalog');let rejected=false;try{await undoBannerChange(base,abortedId);}catch{rejected=true;}assert(rejected,'Aborted receipt was published');
  const stale=(await bannerContext(base)).targets;await db.timelineEvents.update(eid,{title:'Concurrent'});const prior=JSON.stringify(await db.timelineEvents.get(eid));rejected=false;
  try{await writeBannerEvent(base,{event:{...row,timelineId:b},baseline:row,targets:stale});}catch{rejected=true;}assert(rejected&&JSON.stringify(await db.timelineEvents.get(eid))===prior,'Stale move wrote data');
  return ['Era move/Undo touches two coherent aggregates, Base stays intact, outer abort publishes no receipt and stale move writes nothing'];
 }finally{for(const table of [db.timelineEvents,db.timelines,db.worldEraVariants,db.worldEraAssets])await table.where('projectId').equals(p).delete();await db.projects.delete(p);}
}

export async function testCalendarBannerRemapContract(){
 const p='qa-banner-remap',a=p+'-A',b=p+'-B',e=p+'-event',clones:string[]=[],failures:string[]=[];
 try{
  await db.projects.put({id:p,title:'Remap',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['timeline'],createdAt:1,updatedAt:1});
  for(const [id,shape]of [[a,'bunting'],[b,'ribbon']] as const)await db.timelines.put({id,projectId:p,title:id===a?'Origin A':'Destination B',color:'#aa4400',bannerPresets:[{id:a,name:'Local id equals Timeline A',style:{shape,pattern:'grid',color:'#aa4400',patternParams:{repeatSizePx:23,opacity:.19}}}],createdAt:1,updatedAt:1});
  await db.timelineEvents.put({id:e,projectId:p,timelineId:b,title:'Moved',description:'',date:'',dateMode:'text',eventType:'point',order:0,lane:'',color:'#00aa00',createdAt:1,updatedAt:1,bannerPreset:{ownerTimelineId:a,id:a,fallback:{shape:'bunting',pattern:'grid',color:'#aa4400'}}});
  await saveWorldEra(p,{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1},null);
  const {saveEraDocument}=await import('@/services/worldEras/store');
  for(const id of [a,b]){const read=(await readWorldDocument({projectId:p,eraId:'past'},'timeline',id))!;await saveEraDocument({projectId:p,eraId:'past'},'timeline',read.document,read.version);}
  const check=async(target:string,label:string)=>{const tls=await db.timelines.where('projectId').equals(target).toArray(),origin=tls.find(t=>t.title==='Origin A')!,row=(await db.timelineEvents.where('projectId').equals(target).toArray())[0];if(row.bannerPreset?.ownerTimelineId!==origin.id)failures.push(label+' Base owner still old ID');if(origin.bannerPresets?.[0].id!==a||row.bannerPreset?.id!==a)failures.push(label+' changed local preset ID');const project=(await db.projects.get(target))!,era=project.worldEras![0].id,read=(await readWorldDocument({projectId:target,eraId:era},'timeline',origin.id))!;if((read.document.root.bannerPresets as {id:string}[])[0].id!==a)failures.push(label+' era catalog changed local ID');const dest=tls.find(t=>t.title==='Destination B')!,ev=(await readWorldDocument({projectId:target,eraId:era},'timeline',dest.id))!.document.children.timelineEvents[0] as unknown as TimelineEvent;if(ev.bannerPreset?.ownerTimelineId!==origin.id||ev.bannerPreset?.id!==a)failures.push(label+' era link inconsistent');};
  const json=await importProjectData(await exportProjectData(p));clones.push(json);await check(json,'JSON');
  const preview=await previewProjectDuplicate({projectId:p});const duplicate=await duplicateProject({projectId:p,title:'Copy',operationId:crypto.randomUUID(),expectedSourceVersion:preview.sourceVersion});clones.push(duplicate.projectId);await check(duplicate.projectId,'Duplicate');
  assert(!failures.length,failures.join('; '));return ['JSON/Duplicate remap cross-timeline owners in Base/era while preserving deliberately colliding local preset IDs'];
 }finally{for(const id of [...clones,p])await deleteProject(id);}
}

export async function testCalendarBannerNativeMcp(){
 const p='qa-banner-mcp',a=p+'-A',b=p+'-B',audit:AuditLine[]=[],scope={projectId:p};
 const execute=createToolExecutor({writesEnabled:async()=>true,relay:runBridgeTool,audit:async line=>{audit.push(line);return audit.length-1;}});
 const call=(tool:string,args:Record<string,unknown>)=>execute({tool,args:{projectId:p,...args}},{origin:'bridge',projectId:p});
 try{
  await db.projects.put({id:p,title:'MCP banners',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['timeline'],createdAt:1,updatedAt:1});for(const id of [a,b])await db.timelines.put({id,projectId:p,title:id,color:'#aa4400',createdAt:1,updatedAt:1});
  const before=JSON.stringify(await db.timelines.get(a));const catalog=await call('wh_timeline_banner_presets',{timelineId:a});assert(catalog.ok&&JSON.stringify(await db.timelines.get(a))===before,'Catalog read wrote defaults');
  const set=await call('wh_timeline_banner_preset_set',{timelineId:a,expectedVersion:(catalog.result as {version:string}).version,action:'upsert',presetId:'P',name:'Cloth',style:{shape:'bunting',pattern:'grid',color:'#aa0000',patternParams:{repeatSizePx:23,opacity:.19}}});assert(set.ok,'Catalog MCP set failed '+JSON.stringify(set));
  const targets=(await bannerContext(scope)).targets;
  const created=await call('wh_create_event',{timelineId:a,title:'Legacy manual',banner:{mode:'live',ownerTimelineId:a,presetId:'P',colorMode:'preset'},expectedTargets:targets});assert(created.ok,'Native live create '+JSON.stringify(created));const id=(created.result as {id:string}).id;
  const raw=(await db.timelineEvents.get(id))!,without=await call('wh_list_events',{timelineId:a});assert(without.ok&&!Object.hasOwn((without.result as {events:object[]}).events[0],'effectiveBanner'),'Legacy list changed response');
  const read=await call('wh_list_events',{timelineId:a,includeBannerStyle:true});assert(read.ok&&(read.result as {events:{effectiveBanner:{style:{pattern:string}}}[]}).events[0].effectiveBanner.style.pattern==='grid','Opt-in projection missing');assert(JSON.stringify(await db.timelineEvents.get(id))===JSON.stringify(raw),'Projection wrote event');
  const copy=await call('wh_update_event',{id,banner:{mode:'copy'},expectedTargets:(await bannerContext(scope)).targets,bannerShape:'scallop',color:'#00aa00'});assert(copy.ok,'Copy override MCP '+JSON.stringify(copy));let row=(await db.timelineEvents.get(id))!;assert(!row.bannerPreset&&row.bannerShape==='scallop'&&row.bannerPattern==='grid'&&row.color==='#00aa00','Explicit manual overrides lost after copy');
  const copyAudit=audit.at(-1)!;assert((await runBridgeTool('__undo',{entry:copyAudit})).ok,'Copy audit Undo');row=(await db.timelineEvents.get(id))!;assert(row.bannerPreset?.ownerTimelineId===a&&row.bannerShape===undefined,'Copy Undo did not recover raw absence/link');
  const moved=await call('wh_update_event',{id,destinationTimelineId:b,expectedTargets:(await bannerContext(scope)).targets});assert(moved.ok,'Native move '+JSON.stringify(moved));assert((await db.timelineEvents.get(id))?.bannerPreset?.ownerTimelineId===a&&(await db.timelineEvents.get(id))?.timelineId===b,'Native move changed owner');
  assert((await runBridgeTool('__undo',{entry:audit.at(-1)})).ok&&(await db.timelineEvents.get(id))?.timelineId===a,'Native move Undo');
  const old=JSON.stringify(await db.timelineEvents.get(id));const invalid=await call('wh_update_event',{id,bannerPatternParams:{repeatSizePx:0,opacity:.2}});assert(!invalid.ok&&JSON.stringify(await db.timelineEvents.get(id))===old,'Invalid params wrote event');
  const changed=await call('wh_update_event',{id,bannerPatternParams:{repeatSizePx:37}});assert(changed.ok,'Manual params update');assert((await runBridgeTool('__undo',{entry:audit.at(-1)})).ok&&!Object.hasOwn((await db.timelineEvents.get(id))!,'bannerPatternParams'),'Manual parameter Undo did not restore absence');
  const legacy=await call('wh_create_event',{timelineId:a,title:'Old dots',bannerPattern:'dots'});assert(legacy.ok,'Legacy dots create');const legacyId=(legacy.result as {id:string}).id;assert((await call('wh_update_event',{id:legacyId,title:'Old dots renamed'})).ok,'Legacy title update');assert(!Object.hasOwn((await db.timelineEvents.get(legacyId))!,'bannerPatternParams'),'Title-only update materialized defaults');
  return ['Registered executor/catalog/live create/copy override/move/list and audit Undo agree; default list and raw absences remain legacy; invalid parameters write nothing'];
 }finally{await deleteProject(p);}
}
export async function testCalendarBannerZipImages(){
 const p='qa-banner-zip',a=p+'-A',b=p+'-B',scope={projectId:p},png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6mWQAAAAASUVORK5CYII=';
 try{
  await db.projects.put({id:p,title:'ZIP banners',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['timeline'],createdAt:1,updatedAt:1});for(const id of [a,b])await db.timelines.put({id,projectId:p,title:id,color:'#aa4400',createdAt:1,updatedAt:1});
  await setBannerPreset(scope,a,(await readBannerCatalog(scope,a)).version,'upsert',a,'Cloth',{shape:'bunting',pattern:'image',color:'#aa0000',patternParams:{repeatSizePx:61,opacity:.42},image:{dataUrl:png}});
  const e:TimelineEvent={id:p+'-E',projectId:p,timelineId:b,title:'Moved cloth',description:'',date:'',dateMode:'text',eventType:'point',order:0,lane:'',color:'#00aa00',createdAt:1,updatedAt:1,bannerImage:{dataUrl:png},bannerPatternParams:{repeatSizePx:31},bannerPreset:{ownerTimelineId:a,id:a,fallback:{shape:'bunting',pattern:'image',color:'#aa0000',image:{dataUrl:png},patternParams:{repeatSizePx:61,opacity:.42}}}};await db.timelineEvents.put(e);
  const zip=await createProjectZipArchive(p);await db.timelineEvents.delete(e.id);await db.timelines.delete(a);await importProjectZip(new File([zip.blob],zip.fileName,{type:'application/zip'}),{replaceProjectIds:[p]});
  const restored=(await db.timelineEvents.get(e.id))!;assert(restored.bannerPreset?.ownerTimelineId===a&&restored.bannerPreset.id===a&&restored.bannerPreset.fallback.image?.dataUrl===png,'ZIP lost same-ID owner/localID/fallback raster');assert(restored.bannerImage?.dataUrl===png&&restored.bannerPatternParams?.repeatSizePx===31&&restored.bannerPatternParams.opacity===undefined,'ZIP changed manual bytes or filled opacity');
  const catalog=(await readBannerCatalog(scope,a)).presets[0];assert(catalog.style.image?.dataUrl===png&&catalog.style.patternParams?.opacity===.42,'ZIP lost catalog image/params');
  return ['Real project ZIP restores original owner and local IDs, preset/fallback/manual raster bytes and partial parameter absence'];
 }finally{await deleteProject(p);}
}

export async function testCalendarBannerReadOnlyOutput(){
 const p='qa-banner-output',project={id:p,title:'Public history',description:'',mode:'custom' as const,type:'standalone' as const,status:'draft' as const,color:'#777777',enabledEngines:['timeline'],createdAt:1,updatedAt:1};
 const timeline={id:p+'-tl',projectId:p,title:'Public timeline',color:'#aa4400',createdAt:1,updatedAt:1};const event:TimelineEvent={id:p+'-E',projectId:p,timelineId:timeline.id,title:'Public arrival',description:'Only public prose',date:'January10',dateMode:'text',eventType:'point',order:0,lane:'',color:'#00aa00',createdAt:1,updatedAt:1};
 const data:WorldWikiData={project,entries:[],maps:[],pins:[],images:[],timelines:[timeline],timelineEvents:[event]};
 const plain=(html:string)=>html.replace(/nonce="[a-f0-9]+"/g,'nonce="N"').replace(/nonce-[a-f0-9]+/g,'nonce-N');
 const before=plain(buildWorldWiki(data,{includeTimelines:true,locale:'en'}).html),decorated=structuredClone(data),png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6mWQAAAAASUVORK5CYII=';
 decorated.timelines![0].bannerPresets=[{id:'P',name:'PRIVATE_UNUSED_BANNER',style:{shape:'bunting',pattern:'image',color:'#aa0000',image:{dataUrl:png}}}];decorated.timelineEvents![0].bannerPreset={ownerTimelineId:timeline.id,id:'P',fallback:decorated.timelines![0].bannerPresets![0].style};decorated.timelineEvents![0].bannerImage={dataUrl:png};
 const source=JSON.stringify(decorated),after=plain(buildWorldWiki(decorated,{includeTimelines:true,locale:'en'}).html);assert(after===before,'Unrendered banners changed legacy HTML/CSP');assert(!after.includes(png)&&!after.includes('PRIVATE_UNUSED_BANNER')&&JSON.stringify(decorated)===source,'Readonly output leaked catalog bitmap or wrote captured data');
 return ['Wiki timeline output and CSP stay byte-identical when unused banner metadata/images are present; captured inputs remain untouched'];
}

export async function testCalendarBannerEraCatalogAndArchive(){
 const p='qa-banner-scope',a=p+'-A',b=p+'-B',scope={projectId:p};
 try{
  await db.projects.put({id:p,title:'Scopes',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['timeline'],createdAt:1,updatedAt:1});for(const id of [a,b])await db.timelines.put({id,projectId:p,title:id,color:'#aa4400',createdAt:1,updatedAt:1});
  await setBannerPreset(scope,a,(await readBannerCatalog(scope,a)).version,'upsert','P','A',{shape:'bunting',pattern:'grid',color:'#aa0000'});
  const event:TimelineEvent={id:p+'-E',projectId:p,timelineId:b,title:'Moved before era',description:'',date:'',dateMode:'text',eventType:'point',order:0,lane:'',color:'#00aa00',createdAt:1,updatedAt:1,bannerPreset:{ownerTimelineId:a,id:'P',fallback:{shape:'bunting',pattern:'grid',color:'#aa0000'}}};await db.timelineEvents.put(event);
  for(const id of ['own','sibling'])await saveWorldEra(p,{id,name:id,description:'',revision:0,createdAt:1,updatedAt:1},null);
  const own={projectId:p,eraId:'own'},sibling={projectId:p,eraId:'sibling'};await setBannerPreset(own,a,(await readBannerCatalog(own,a)).version,'upsert','P','Own',{shape:'ribbon',pattern:'crosshatch',color:'#ff0000'});
  await setBannerPreset(scope,a,(await readBannerCatalog(scope,a)).version,'upsert','P','Base newer',{shape:'scallop',pattern:'dots',color:'#aa0000'});
  assert(resolveBannerStyle(event,(await bannerContext(own)).timelines).style.shape==='ribbon'&&resolveBannerStyle(event,(await bannerContext(sibling)).timelines).style.shape==='scallop','Own era merged Base or sibling did not inherit');
  const before=JSON.stringify(await db.timelineEvents.get(event.id));await setBannerPreset(own,a,(await readBannerCatalog(own,a)).version,'archive','P');assert(resolveBannerStyle(event,(await bannerContext(own)).timelines).style.shape==='ribbon','Archive broke live link');await setBannerPreset(own,a,(await readBannerCatalog(own,a)).version,'restore','P');assert((await readBannerCatalog(own,a)).presets.length===1&&!(await readBannerCatalog(own,a)).presets[0].archivedAt,'Restore duplicated preset');
  await hideEraDocument(own,'timeline',a,(await readWorldDocument(own,'timeline',a))!.version);const missing=resolveBannerStyle(event,(await bannerContext(own)).timelines);assert(missing.unavailable&&missing.style.shape==='bunting','Hidden owner did not use original fallback');
  const hidden=(await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([p,'own','timeline',a]).first())!;await resetEraDocument(own,'timeline',a,hidden.revision);assert(resolveBannerStyle(event,(await bannerContext(own)).timelines).style.shape==='scallop','Reinherit owner did not restore live Base projection');assert(JSON.stringify(await db.timelineEvents.get(event.id))===before,'Era catalog reads/archive/hide changed event');
  return ['Own era catalog is an aggregate snapshot; sibling inherits Base, archive stays live, hidden owner uses fallback and reinherit reads Base without event writes'];
 }finally{await deleteProject(p);}
}
