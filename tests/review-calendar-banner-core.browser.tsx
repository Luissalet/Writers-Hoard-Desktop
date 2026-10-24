import {db} from '@/db';
import type {Project,Timeline,TimelineEvent} from '@/types';
import {bannerContext,readBannerCatalog,setBannerPreset,undoBannerChange} from '@/engines/timeline/bannerPresets';
import {resolveBannerStyle,remapBannerLink,type BannerPresetLink} from '@/engines/timeline/bannerStyles';
import {onDataChanged} from '@/engines/_shared/dataChanged';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {getBridgeTool} from '@/services/aiBridge/manifest';
import {exportProjectData,importProjectData} from '@/db/operations';
import {createDuplicateRemapper} from '@/services/projectDuplicate/remap';
import {validateEraDocument} from '@/services/worldEras/adapters';
import {worldDocumentCloner} from '@/services/worldEras/portability';
import '@/engines/timeline/index';
import {act,StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import TimelineEngine from '@/engines/timeline/TimelineEngine';
import {EnginePaneContext} from '@/engines/_shared/EnginePaneContext';
import {useLocaleStore} from '@/stores/localeStore';
import {saveWorldEra,readWorldDocument} from '@/services/worldEras/store';

function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const style={shape:'bunting' as const,pattern:'grid' as const,color:'#aa2200',patternParams:{repeatSizePx:23,opacity:.19}};
const plain=(value:unknown)=>JSON.stringify(value);
async function fixture(suffix:string,catalog:'absent'|'empty'='absent'){
 const projectId='review-banner-'+suffix+'-'+crypto.randomUUID(),timelineId=projectId+'-A';
 const project={id:projectId,title:'Independent banner review',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['timeline'],createdAt:1,updatedAt:1} as Project;
 const timeline:Timeline={id:timelineId,projectId,title:'A',color:'#112233',createdAt:1,updatedAt:1,...(catalog==='empty'?{bannerPresets:[]}:{})};
 await db.projects.put(project);await db.timelines.put(timeline);
 return{projectId,timelineId,scope:{projectId},project,timeline};
}
async function cleanup(projectId:string){
 for(const table of [db.timelineEvents,db.timelineConnections,db.timelines,db.worldEraVariants,db.worldEraAssets,db.documentHistory,db.documentArchives])await table.where('projectId').equals(projectId).delete();
 await db.projects.delete(projectId);
}
async function refused(run:()=>Promise<unknown>,pattern:RegExp){let error='';try{await run();}catch(reason){error=String(reason);}assert(pattern.test(error),'Expected refusal '+pattern+', received '+error);}

export async function reviewBannerCatalogAbsenceAndScopedUndo(){
 for(const initial of ['absent','empty'] as const){
  const f=await fixture('catalog-'+initial,initial);
  try{
   const first=await setBannerPreset(f.scope,f.timelineId,(await readBannerCatalog(f.scope,f.timelineId)).version,'upsert','P','Preset P',style);
   await undoBannerChange(f.scope,first.receiptId);
   let row=(await db.timelines.get(f.timelineId))!;
   assert(Object.hasOwn(row,'bannerPresets')===(initial==='empty'),'UndoCreate changed catalog presence for '+initial+': '+plain(row));
   if(initial==='empty')assert(Array.isArray(row.bannerPresets)&&row.bannerPresets.length===0,'UndoCreate must restore explicit []');
   await refused(()=>undoBannerChange(f.scope,first.receiptId),/banner_receipt_missing/);
   const made=await setBannerPreset(f.scope,f.timelineId,(await readBannerCatalog(f.scope,f.timelineId)).version,'upsert','P','Preset P',style);
   await setBannerPreset(f.scope,f.timelineId,(await readBannerCatalog(f.scope,f.timelineId)).version,'upsert','Q','Later neighbour',{...style,color:'#0022aa'});
   await undoBannerChange(f.scope,made.receiptId);row=(await db.timelines.get(f.timelineId))!;
   assert(row.bannerPresets?.length===1&&row.bannerPresets[0].id==='Q','UndoCreate removed a later neighbouring catalog entry');
   const edited=await setBannerPreset(f.scope,f.timelineId,(await readBannerCatalog(f.scope,f.timelineId)).version,'upsert','Q','Changed Q',{...style,color:'#0033bb'});
   await setBannerPreset(f.scope,f.timelineId,(await readBannerCatalog(f.scope,f.timelineId)).version,'upsert','Q','Later Q',{...style,color:'#0044cc'});
   const before=plain(await db.timelines.get(f.timelineId));
   await refused(()=>undoBannerChange(f.scope,edited.receiptId),/banner_undo_stale/);
   assert(plain(await db.timelines.get(f.timelineId))===before,'Stale entry Undo mutated catalogue');
  }finally{await cleanup(f.projectId);}
 }
 return ['Independent actual-store Undo restores absent vs explicit empty catalogue, preserves later neighbour and refuses a later edit of the same entry'];
}

export async function reviewBannerOuterAbortAndReceiptScope(){
 const f=await fixture('outer'),other=await fixture('foreign');let notices=0;
 const unsubscribe=onDataChanged(detail=>{if(detail.projectId===f.projectId)notices++;});
 try{
  const original=plain(await db.timelines.get(f.timelineId));let abortedReceipt='';
  await refused(()=>db.transaction('rw',db.tables,async()=>{
   const result=await setBannerPreset(f.scope,f.timelineId,(await readBannerCatalog(f.scope,f.timelineId)).version,'upsert','P','Abort P',style);abortedReceipt=result.receiptId;
   assert(notices===0,'Notification escaped before outer commit');
   await refused(()=>undoBannerChange(f.scope,result.receiptId),/banner_receipt_missing/);
   throw Error('review_outer_abort');
  }),/review_outer_abort/);
  assert(plain(await db.timelines.get(f.timelineId))===original&&notices===0,'Outer abort left a catalogue or announcement');
  await refused(()=>undoBannerChange(f.scope,abortedReceipt),/banner_receipt_missing/);
  const made=await setBannerPreset(f.scope,f.timelineId,(await readBannerCatalog(f.scope,f.timelineId)).version,'upsert','P','Committed P',style);
  assert(notices===1,'Committed catalogue did not announce once');
  const committed=plain(await db.timelines.get(f.timelineId));notices=0;
  await refused(()=>undoBannerChange(other.scope,made.receiptId),/banner_receipt_missing/);
  assert(plain(await db.timelines.get(f.timelineId))===committed,'Foreign receipt scope mutated original owner');
  await refused(()=>db.transaction('rw',db.tables,async()=>{await undoBannerChange(f.scope,made.receiptId);assert(notices===0,'Undo announced before outer commit');throw Error('review_undo_abort');}),/review_undo_abort/);
  assert(plain(await db.timelines.get(f.timelineId))===committed&&notices===0,'Aborted Undo left data or announcement');
  await undoBannerChange(f.scope,made.receiptId);
  assert(!(await db.timelines.get(f.timelineId))!.bannerPresets&&notices===1,'Undo receipt was lost on abort or did not announce on committed retry');
 }finally{unsubscribe();await cleanup(f.projectId);await cleanup(other.projectId);}
 return ['Independent outer transactions publish no premature receipt/notification; abort rolls back catalogue and Undo receipt can retry in its original scope'];
}

export async function reviewBannerBridgeParentGuards(){
 const f=await fixture('bridge'),foreign=await fixture('bridge-foreign');
 try{
  for(const name of ['wh_timeline_banner_presets','wh_timeline_banner_preset_set']){
   const tool=getBridgeTool(name);assert(tool?.group==='story'&&tool.engineId==='timeline',name+' lost native group/engine metadata');
  }
  const read=await runBridgeTool('wh_timeline_banner_presets',{timelineId:f.timelineId});
  assert(read.ok,'Parent-based read without redundant projectId failed: '+plain(read));
  const version=(read.result as {version:string}).version;
  const made=await runBridgeTool('wh_timeline_banner_preset_set',{timelineId:f.timelineId,expectedVersion:version,action:'upsert',presetId:'P',name:'Native P',style});
  assert(made.ok,'Native parent-based set failed: '+plain(made));
  await db.projects.update(f.projectId,{enabledEngines:[]});
  const snapshot=plain(await db.timelines.get(f.timelineId));
  const disabled=await runBridgeTool('wh_timeline_banner_preset_set',{timelineId:f.timelineId,expectedVersion:'stale-on-purpose',action:'upsert',presetId:'P',name:'Must refuse',style});
  assert(!disabled.ok&&disabled.code==='engine-disabled','Parent engine guard must precede stale CAS: '+plain(disabled));
  const scope=await runBridgeTool('wh_timeline_banner_presets',{projectId:foreign.projectId,timelineId:f.timelineId});
  assert(!scope.ok&&plain(await db.timelines.get(f.timelineId))===snapshot,'Foreign scope read/set touched owner');
 }finally{await cleanup(f.projectId);await cleanup(foreign.projectId);}
 return ['Independent registered native handlers resolve real Timeline parent, preserve group/engine metadata and refuse switched-off engine before domain CAS'];
}

export async function reviewBannerMissingOwnerRemap(){
 const f=await fixture('missing-owner');let copied='';
 try{
  const malformed={id:'P',fallback:style,colorMode:'preset'} as unknown as BannerPresetLink;
  const event={id:f.projectId+'-E',projectId:f.projectId,timelineId:f.timelineId,title:'Imported',description:'',date:'',dateMode:'text',eventType:'point',order:0,lane:'',color:'#00aa00',createdAt:1,updatedAt:1,bannerPreset:malformed} as TimelineEvent;
  validateEraDocument(f.projectId,'timeline',f.timelineId,{root:f.timeline as unknown as Record<string,unknown>&{id:string},children:{timelineEvents:[event as unknown as Record<string,unknown>&{id:string}]}});
  await db.timelineEvents.put(event);
  const before=resolveBannerStyle(event,[f.timeline]);assert(before.unavailable&&before.style.shape==='bunting','Missing-owner control did not use fallback');
  copied=await importProjectData(await exportProjectData(f.projectId));
  const imported=(await db.timelineEvents.where('projectId').equals(copied).toArray())[0];
  console.error('MISSING_OWNER_ACTUAL_JSON '+plain(imported?.bannerPreset));
  assert(imported?.bannerPreset&&!Object.hasOwn(imported.bannerPreset,'ownerTimelineId'),'Actual JSON clone synthesized a missing owner');
  const snapshot={project:f.project,tables:{timelines:[f.timeline],timelineEvents:[event]}} as unknown as Parameters<typeof createDuplicateRemapper>[0];
  const clone=createDuplicateRemapper(snapshot,f.projectId+'-duplicate-target');
  const helperResult=remapBannerLink(event,clone.remap);
  console.error('MISSING_OWNER_REAL_HELPER '+plain({actualJsonClonePreservesAbsence:!Object.hasOwn(imported.bannerPreset,'ownerTimelineId'),before:event.bannerPreset,after:helperResult.bannerPreset}));
  assert(!Object.hasOwn(helperResult.bannerPreset!,'ownerTimelineId'),'remapBannerLink with the real Duplicate remap must retain missing owner, not synthesize an undefined-derived Timeline id');
  const duplicateRow=clone.row('timelineEvents',event as unknown as Record<string,unknown>);
  assert(!Object.hasOwn(duplicateRow.bannerPreset as object,'ownerTimelineId'),'Native Duplicate row synthesized missing owner');
  const document={root:f.timeline,children:{timelineEvents:[event]}};
  const eraClone=worldDocumentCloner([{kind:'timeline',document} as unknown as Parameters<typeof worldDocumentCloner>[0][number]],f.project,f.projectId+'-era-target',clone.remap,{timelines:[f.timeline]});
  const cloned=eraClone('timeline',document as unknown as Parameters<typeof eraClone>[1]);
  const eraLink=cloned.children.timelineEvents[0].bannerPreset as unknown as BannerPresetLink;
  assert(!Object.hasOwn(eraLink,'ownerTimelineId'),'Native era/history document cloner synthesized missing owner');
  assert(resolveBannerStyle({...event,projectId:f.projectId+'-era-target',bannerPreset:eraLink},[]).unavailable,'Ownerless cloned link became available');
  assert(!Object.hasOwn(event.bannerPreset!,'ownerTimelineId'),'A remapper mutated the original missing-owner link');
 }finally{if(copied)await cleanup(copied);await cleanup(f.projectId);}
 return ['Independent imported missing owner stays absent/unavailable through actual JSON clone and the shared link remapper with native Duplicate identity mapping'];
}

const uiPause=()=>new Promise(resolve=>setTimeout(resolve,40));
async function uiUntil(check:()=>boolean|Promise<boolean>,message:string){const end=Date.now()+12000;while(Date.now()<end){if(await check())return;await act(async()=>{await uiPause();});}throw Error(message+' DOM='+document.body.textContent?.slice(-1800));}
async function uiClick(node:Element|null|undefined){assert(node,'Missing native control');await act(async()=>{node.dispatchEvent(new MouseEvent('click',{bubbles:true}));await uiPause();});}
async function uiValue(node:Element|null,next:string){assert(node,'Missing native field');await act(async()=>{const prototype=node instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(node,next);node.dispatchEvent(new Event(node instanceof HTMLSelectElement?'change':'input',{bubbles:true}));await uiPause();});}
const uiButton=(name:string,where:ParentNode=document)=>[...where.querySelectorAll('button')].find(button=>button.textContent?.trim()===name);

export async function testReviewBannerCopyExplicitColour(){
 const f=await fixture('copy-colour'),eventId=f.projectId+'-E',root=createRoot(document.getElementById('root')!);useLocaleStore.setState({locale:'en'});
 try{
  await setBannerPreset(f.scope,f.timelineId,(await readBannerCatalog(f.scope,f.timelineId)).version,'upsert','P','Red cloth',style);
  await db.timelineEvents.put({id:eventId,projectId:f.projectId,timelineId:f.timelineId,title:'Explicit blue after copy',description:'Keep prose',date:'',dateMode:'text',eventType:'point',order:0,lane:'',color:'#00aa00',bannerShape:'scallop',bannerPattern:'checks',createdAt:1,updatedAt:1,bannerPreset:{ownerTimelineId:f.timelineId,id:'P',colorMode:'preset',fallback:style}});
  await act(async()=>{root.render(<StrictMode><MemoryRouter initialEntries={['/project/'+f.projectId+'/timeline?entity='+eventId]}><EnginePaneContext.Provider value={{projectId:f.projectId,instanceId:'review-copy-colour',visible:true}}><TimelineEngine projectId={f.projectId}/></EnginePaneContext.Provider></MemoryRouter></StrictMode>);await uiPause();});
  await uiUntil(()=>!!document.querySelector('[data-testid="event-banner-copy"]'),'Event editor not ready');
  await uiClick(document.querySelector('[data-testid="event-banner-copy"]'));
  await uiValue(document.querySelector('[role="dialog"] input[placeholder="#000000"]'),'#1234ef');
  assert((document.querySelector('[role="dialog"] input[placeholder="#000000"]') as HTMLInputElement).value==='#1234ef','Native colour control did not retain explicit input');
  await uiClick(uiButton('Save',document.querySelector('[role="dialog"]')!));await uiUntil(()=>!document.querySelector('[role="dialog"]'),'Copy save did not close');
  const result=(await db.timelineEvents.get(eventId))!;console.error('COPY_EXPLICIT_COLOUR '+plain(result));
  assert(!result.bannerPreset&&result.bannerShape==='bunting'&&result.bannerPattern==='grid','Native copy did not materialize the selected preset');
  assert(result.color==='#1234ef','Native Copy silently overwrote the explicit colour entered afterwards: '+result.color);
  return ['Independent real Timeline editor Copy preserves a later explicit colour instead of overriding it with preset colour'];
 }finally{await act(async()=>root.unmount());await cleanup(f.projectId);}
}

export async function testReviewBannerEraMoveGestures(){
 const f=await fixture('era-gestures'),destination=f.projectId+'-B',eventId=f.projectId+'-E',neighbourId=f.projectId+'-N',scope={projectId:f.projectId,eraId:'own'},root=createRoot(document.getElementById('root')!);useLocaleStore.setState({locale:'en'});
 try{
  await db.timelines.update(f.timelineId,{title:'Era origin',bannerPresets:[{id:'P',name:'Origin cloth',style}]});
  await db.timelines.put({...f.timeline,id:destination,title:'Era destination',bannerPresets:[{id:'P',name:'Destination homonym',style:{shape:'ribbon',pattern:'dots',color:'#1100bb'}}]});
  await db.timelineEvents.bulkPut([
   {id:eventId,projectId:f.projectId,timelineId:f.timelineId,title:'Era traveller',description:'Keep exact prose',date:'old label',dateMode:'text',eventType:'point',order:2,lane:'',color:'#00aa00',bannerShape:'scallop',bannerPattern:'checks',createdAt:1,updatedAt:1,bannerPreset:{ownerTimelineId:f.timelineId,id:'P',fallback:style,colorMode:'preset'}},
   {id:neighbourId,projectId:f.projectId,timelineId:destination,title:'Untouched destination neighbour',description:'Neighbour prose',date:'',dateMode:'text',eventType:'point',order:17,lane:'',color:'#aaaa00',createdAt:1,updatedAt:1}
  ]);
  for(const id of ['own','sibling'])await saveWorldEra(f.projectId,{id,name:id,description:'',revision:0,createdAt:1,updatedAt:1},null);
  await setBannerPreset(scope,f.timelineId,(await readBannerCatalog(scope,f.timelineId)).version,'upsert','P','Own era cloth',{...style,shape:'ribbon',pattern:'crosshatch',patternParams:{repeatSizePx:53,opacity:.37}});
  const base=plain({timelines:await db.timelines.where('projectId').equals(f.projectId).toArray(),events:await db.timelineEvents.where('projectId').equals(f.projectId).toArray()});
  const effective=async(timelineId:string)=>(await readWorldDocument(scope,'timeline',timelineId))!.document.children.timelineEvents as unknown as TimelineEvent[];
  const checkMoved=async()=>{
   assert(!(await effective(f.timelineId)).some(row=>row.id===eventId),'Source era aggregate retained moved event');
   const moved=(await effective(destination)).find(row=>row.id===eventId)!;assert(moved,'Destination era aggregate missing moved event');
   assert(moved.bannerPreset?.ownerTimelineId===f.timelineId&&moved.bannerPreset.fallback.shape==='ribbon'&&moved.bannerPreset.fallback.pattern==='crosshatch'&&moved.bannerPreset.fallback.patternParams?.repeatSizePx===53,'Move adopted destination homonym or captured Base instead of current own-era fallback');
   assert(moved.bannerShape==='scallop'&&moved.bannerPattern==='checks'&&moved.description==='Keep exact prose','Era gesture changed manual/prose fields');
   const neighbour=(await effective(destination)).find(row=>row.id===neighbourId)!;assert(neighbour.description==='Neighbour prose'&&neighbour.title==='Untouched destination neighbour','Scoped move changed neighbour prose');
   assert(plain({timelines:await db.timelines.where('projectId').equals(f.projectId).toArray(),events:await db.timelineEvents.where('projectId').equals(f.projectId).toArray()})===base,'Era gesture wrote Base');
   const sibling=(await readWorldDocument({projectId:f.projectId,eraId:'sibling'},'timeline',f.timelineId))!.document.children.timelineEvents;
   assert(sibling.some(row=>row.id===eventId),'Era gesture changed sibling inheritance');
  };
  await act(async()=>{root.render(<StrictMode><MemoryRouter initialEntries={['/project/'+f.projectId+'/timeline?entity='+eventId]}><EnginePaneContext.Provider value={{...scope,instanceId:'review-era-gestures',visible:true}}><TimelineEngine projectId={f.projectId}/></EnginePaneContext.Provider></MemoryRouter></StrictMode>);await uiPause();});
  await uiUntil(()=>!!document.querySelector<HTMLSelectElement>('[data-testid="event-timeline"]')&&!document.querySelector<HTMLSelectElement>('[data-testid="event-timeline"]')!.disabled,'Era form not ready');
  await uiValue(document.querySelector('[data-testid="event-timeline"]'),destination);await uiClick(uiButton('Save',document.querySelector('[role="dialog"]')!));await uiUntil(()=>!document.querySelector('[role="dialog"]'),'Era form save failed');await checkMoved();
  await uiClick(uiButton('Undo banner change'));await uiUntil(async()=>(await effective(f.timelineId)).some(row=>row.id===eventId),'Era form Undo failed');assert((await effective(destination)).find(row=>row.id===neighbourId)?.order===17,'Era form Undo did not restore neighbour order');
  const node=()=>[...document.querySelectorAll<SVGGElement>('g[role="button"]')].find(row=>row.getAttribute('aria-label')?.startsWith('Era traveller'));
  await uiUntil(()=>!!node(),'Era traveller missing from actual SVG');
  const element=node()!,svg=element.ownerSVGElement!,bounds=svg.parentElement!.getBoundingClientRect(),circle=element.querySelector('circle')!,label=[...svg.querySelectorAll('text')].find(row=>row.textContent==='Era destination')!;
  assert(bounds.width>600&&!!label,'Native CSS/SVG lane geometry unavailable');
  const from={clientX:bounds.left+Number(circle.getAttribute('cx')),clientY:bounds.top+Number(circle.getAttribute('cy'))},to={clientX:bounds.left+260,clientY:bounds.top+Number(label.getAttribute('y'))+6};
  await act(async()=>{element.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,...from}));await uiPause();});
  await act(async()=>{window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,...to}));await uiPause();});
  await act(async()=>{window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,...to}));await uiPause();});
  await uiUntil(async()=>(await effective(destination)).some(row=>row.id===eventId),'Actual SVG era drag did not commit');await checkMoved();
  await uiClick(uiButton('Undo banner change'));await uiUntil(async()=>(await effective(f.timelineId)).some(row=>row.id===eventId),'Era SVG Undo failed');
  assert(!(await effective(destination)).some(row=>row.id===eventId),'Era SVG Undo left a duplicate in destination');
  assert((await effective(destination)).find(row=>row.id===neighbourId)?.order===17,'Era SVG Undo did not restore neighbour order');
  return ['Independent actual Timeline form and SVG drag each move/Undo an own-era linked event across homonymous catalogs, preserve Base/sibling/manual/neighbour and capture the own-era live fallback'];
 }finally{await act(async()=>root.unmount());await cleanup(f.projectId);}
}
