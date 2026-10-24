import {defaultWorldCalendar} from '@/engines/timeline/worldCalendar';
import {formatTimedRange} from '@/engines/timeline/eventDetails';
import {bannerBackground,manualBannerStyle} from '@/engines/timeline/bannerStyles';
import EventDetailsFields from '@/engines/timeline/components/EventDetailsFields';
import {editEventDetails,eventDetailFields} from '@/engines/timeline/eventDetails';
import type {BannerCatalogContext} from '@/engines/timeline/bannerStyles';
import {BannerPaintFields} from '@/engines/timeline/components/BannerPresetEditor';
import type {BannerStyle} from '@/engines/timeline/bannerStyles';
import {StrictMode} from 'react';
import {bannerContext,writeBannerEvent,readBannerCatalog,setBannerPreset} from '@/engines/timeline/bannerPresets';
import type {TimelineEvent} from '@/types';
import {act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import TimelineEngine from '@/engines/timeline/TimelineEngine';
import {EnginePaneContext} from '@/engines/_shared/EnginePaneContext';
import {useLocaleStore} from '@/stores/localeStore';
import {deleteProject} from '@/db/operations';
import '@/engines/timeline/index';
import {db} from '@/db';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
function assert(v:unknown,m:string):asserts v{if(!v)throw Error(m);}
export async function testCalendarBannerPatternContract(){
 const p='qa-banner-patterns',tl=p+'-tl';
 try{
  await db.projects.put({id:p,title:'Pattern QA',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['timeline'],createdAt:1,updatedAt:1});
  await db.timelines.put({id:tl,projectId:p,title:'Harbour',color:'#aa4400',createdAt:1,updatedAt:1});
  for(const pattern of ['crosshatch','grid']){
   const made=await runBridgeTool('wh_create_event',{projectId:p,timelineId:tl,title:pattern,bannerPattern:pattern,bannerPatternParams:{repeatSizePx:23,opacity:.19}});
   assert(made.ok,'Native create must accept bitmap-free '+pattern+': '+JSON.stringify(made));
   const row=(await db.timelineEvents.where('projectId').equals(p).toArray()).find(e=>e.title===pattern)!;
   assert((row as unknown as {bannerPatternParams?:{repeatSizePx:number;opacity:number}}).bannerPatternParams?.repeatSizePx===23,'Native create discarded pattern size');
   const changed=await runBridgeTool('wh_update_event',{projectId:p,id:row.id,title:pattern+' kept'});assert(changed.ok,'Title update');
   assert(JSON.stringify((await db.timelineEvents.get(row.id) as unknown as {bannerPatternParams:unknown}).bannerPatternParams)==='{"repeatSizePx":23,"opacity":0.19}','Title update changed params');
  }
  return ['Native create/update preserve Crosshatch/Grid parameters without a bitmap'];
 }finally{await db.timelineEvents.where('projectId').equals(p).delete();await db.timelines.where('projectId').equals(p).delete();await db.projects.delete(p);}
}

const pause=(ms=35)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check:()=>boolean|Promise<boolean>,message:string){const end=Date.now()+10000;while(Date.now()<end){if(await check())return;await act(async()=>{await pause();});}throw Error(message+' DOM='+document.body.textContent?.slice(-2000));}
async function click(node:Element|null){assert(node,'Missing control');await act(async()=>{node.dispatchEvent(new MouseEvent('click',{bubbles:true}));await pause();});}
async function value(node:Element|null,next:string){assert(node,'Missing field');await act(async()=>{const proto=node instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(node,next);node.dispatchEvent(new Event(node instanceof HTMLSelectElement?'change':'input',{bubbles:true}));await pause();});}
const textButton=(name:string,scope:ParentNode=document)=>[...scope.querySelectorAll('button')].find(b=>b.textContent?.trim()===name)??null;
async function closeDialog(){await click(document.querySelector('[role="dialog"] button[aria-label="Close"]'));await until(()=>!document.querySelector('[role="dialog"]'),'Dialog did not close');}
export async function testCalendarBannerNormalEditor(){
 const p='qa-banner-normal',a=p+'-A',b=p+'-B',eid=p+'-E',host=document.getElementById('root')!,root=createRoot(host);useLocaleStore.setState({locale:'en'});
 try{
  await db.projects.put({id:p,title:'Banner UI',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['timeline','codex'],createdAt:1,updatedAt:1});
  for(const id of [a,b])await db.timelines.put({id,projectId:p,title:id===a?'Origin A':'Destination B',color:'#aa4400',createdAt:1,updatedAt:1});
  await db.timelineEvents.put({id:eid,projectId:p,timelineId:a,title:'Arrival',description:'Legacy prose',date:'',dateMode:'calendar',realDate:'1500-01-10',realDateEnd:'1500-01-12',repeat:{every:'week'},eventType:'range',order:0,lane:'Main',color:'#00aa00',bannerShape:'scallop',bannerPattern:'checks',createdAt:1,updatedAt:1});
  await act(async()=>{root.render(<MemoryRouter initialEntries={['/project/'+p+'/timeline?view=calendar']}><EnginePaneContext.Provider value={{projectId:p,instanceId:'banner-ui',visible:true}}><TimelineEngine projectId={p}/></EnginePaneContext.Provider></MemoryRouter>);await pause();});
  await until(()=>!!document.querySelector('[data-testid="calendar-day-10"]'),'No calendar');
  await click(document.querySelector('[data-testid="timeline-banners-open"]'));await until(()=>!!textButton('New banner'),'No banner catalog');await click(textButton('New banner'));
  await value(document.querySelector('[data-testid="banner-preset-name"]'),'Harbour cloth');await value(document.querySelector('[data-testid="banner-preset-pattern"]'),'grid');await value(document.querySelector('[data-testid="banner-preset-shape"]'),'bunting');await value(document.querySelector('[data-testid="banner-repeatSizePx"]'),'23');await value(document.querySelector('[data-testid="banner-opacity"]'),'19');await click(textButton('Save banner'));
  await until(async()=>!!(await db.timelines.get(a))?.bannerPresets?.length,'UI did not persist catalog');
  const preset=(await db.timelines.get(a))!.bannerPresets![0];assert(preset.style.patternParams?.repeatSizePx===23&&preset.style.patternParams.opacity===.19,'UI params not persisted');await closeDialog();
  const openEvent=async()=>{await click(document.querySelector('[data-testid="calendar-day-10"]'));await click(document.querySelector('[data-testid="calendar-open-event-'+eid+'"]'));await until(()=>!!document.querySelector('[data-testid="event-banner-preset"]'),'No existing editor');};
  const save=async()=>{await click(textButton('Save',document.querySelector('[role="dialog"]')!));await until(()=>!document.querySelector('[role="dialog"]'),'Event save failed');};
  await openEvent();await value(document.querySelector('[data-testid="event-banner-preset"]'),JSON.stringify([a,preset.id]));await save();
  let row=(await db.timelineEvents.get(eid))!;assert(row.bannerPreset?.ownerTimelineId===a&&row.bannerShape==='scallop'&&row.bannerPattern==='checks'&&row.color==='#00aa00','UI link destroyed manual');
  await until(()=>document.querySelector('[data-testid="calendar-event"]')?.getAttribute('data-pattern')==='grid','Calendar not live');const stamp=row.updatedAt;
  await click(document.querySelector('[data-testid="timeline-banners-open"]'));await click(document.querySelector('[data-testid="banner-edit-'+preset.id+'"]'));await value(document.querySelector('[data-testid="banner-preset-shape"]'),'ribbon');await click(textButton('Save banner'));await until(async()=>(await db.timelines.get(a))?.bannerPresets?.[0].style.shape==='ribbon','Preset edit failed');await closeDialog();
  await until(()=>document.querySelector('[data-testid="calendar-event"]')?.getAttribute('data-shape')==='ribbon','Preset update did not repaint Calendar');assert((await db.timelineEvents.get(eid))!.updatedAt===stamp,'Live repaint rewrote event');
  await openEvent();await click(document.querySelector('[data-testid="event-banner-copy"]'));await save();row=(await db.timelineEvents.get(eid))!;assert(!row.bannerPreset&&row.bannerShape==='ribbon'&&row.bannerPattern==='grid','UI independent copy failed');
  await click(textButton('Undo banner change'));await until(async()=>!!(await db.timelineEvents.get(eid))?.bannerPreset,'UI Undo missing');
  await openEvent();await click(document.querySelector('[data-testid="event-banner-manual"]'));await save();row=(await db.timelineEvents.get(eid))!;assert(!row.bannerPreset&&row.bannerShape==='scallop'&&row.bannerPattern==='checks'&&row.color==='#00aa00','UI manual recovery failed');
  return ['Normal Calendar catalog creates/reopens Grid23/19, links without destroying manual, live edit repaints without writes, copy/Undo/manual distinct'];
 }finally{await act(async()=>root.unmount());await deleteProject(p);}
}

export async function testCalendarBannerMoveGestures(){
 const p='qa-banner-gestures',a=p+'-A',b=p+'-B',eid=p+'-E',host=document.getElementById('root')!,root=createRoot(host);useLocaleStore.setState({locale:'en'});host.style.width='1100px';
 try{
  await db.projects.put({id:p,title:'Move UI',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['timeline','codex'],createdAt:1,updatedAt:1});
  for(const[id,title,shape,color]of [[a,'Origin A','bunting','#aa0000'],[b,'Destination B','ribbon','#0000aa']]){await db.timelines.put({id,projectId:p,title,color,createdAt:1,updatedAt:1});await setBannerPreset({projectId:p},id,(await readBannerCatalog({projectId:p},id)).version,'upsert','P','Homonym',{shape,pattern:'grid',color});}
  const original:TimelineEvent={id:eid,projectId:p,timelineId:a,title:'Arrival',description:'Original prose',date:'',dateMode:'text',eventType:'point',order:0,lane:'Main',color:'#00aa00',bannerShape:'scallop',bannerPattern:'checks',createdAt:1,updatedAt:1};await db.timelineEvents.put(original);
  await writeBannerEvent({projectId:p},{event:original,baseline:original,targets:(await bannerContext({projectId:p})).targets,action:{mode:'live',ownerTimelineId:a,presetId:'P',colorMode:'preset'}});
  await act(async()=>{root.render(<MemoryRouter initialEntries={['/project/'+p+'/timeline?entity='+eid]}><EnginePaneContext.Provider value={{projectId:p,instanceId:'banner-gesture',visible:true}}><TimelineEngine projectId={p}/></EnginePaneContext.Provider></MemoryRouter>);await pause();});
  await until(()=>!!document.querySelector<HTMLSelectElement>('[data-testid="event-timeline"]')&&!document.querySelector<HTMLSelectElement>('[data-testid="event-timeline"]')!.disabled,'No move form');
  await value(document.querySelector('[data-testid="event-timeline"]'),b);await click(textButton('Save',document.querySelector('[role="dialog"]')!));await until(()=>!document.querySelector('[role="dialog"]'),'Form move failed');
  let row=(await db.timelineEvents.get(eid))!;assert(row.timelineId===b&&row.bannerPreset?.ownerTimelineId===a&&row.bannerShape==='scallop','Form move lost live identity/manual');
  const node=()=>[...document.querySelectorAll<SVGGElement>('g[role="button"]')].find(n=>n.getAttribute('aria-label')?.startsWith('Arrival'))!;
  await until(()=>!!node(),'No draggable event');
  const svg=node().ownerSVGElement!,container=svg.parentElement!,bounds=container.getBoundingClientRect(),circle=node().querySelector('circle')!,fromX=bounds.left+Number(circle.getAttribute('cx')),fromY=bounds.top+Number(circle.getAttribute('cy'));
  const label=[...svg.querySelectorAll('text')].find(t=>t.textContent==='Origin A')!,targetY=bounds.top+Number(label.getAttribute('y'))+6,targetX=bounds.left+260;
  await act(async()=>{node().dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:fromX,clientY:fromY}));await pause();});
  await act(async()=>{window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:targetX,clientY:targetY}));await pause();});
  await act(async()=>{window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:targetX,clientY:targetY}));await pause();});
  await until(async()=>(await db.timelineEvents.get(eid))?.timelineId===a,'Actual mouse drag did not move back');row=(await db.timelineEvents.get(eid))!;
  assert(row.bannerPreset?.ownerTimelineId===a&&row.bannerShape==='scallop'&&row.description==='Original prose','Drag lost owner/manual/prose');
  return ['Actual existing Timeline selector and SVG mouse drag both move a linked event without adopting the homonymous destination preset'];
 }finally{await act(async()=>root.unmount());await deleteProject(p);}
}

const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6mWQAAAAASUVORK5CYII=';
function paintFile(){return new File([Uint8Array.from(atob(PNG.split(',')[1]),c=>c.charCodeAt(0))],'own.png',{type:'image/png'});}
async function fileChange(input:HTMLInputElement,file:File){await act(async()=>{Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new Event('change',{bubbles:true}));await pause();});}
export async function testCalendarBannerLocalImages(){
 const p='qa-banner-files',host=document.getElementById('root')!,root=createRoot(host);useLocaleStore.setState({locale:'en'});let saved:BannerStyle|undefined;
 function Fields(){const[style,setStyle]=useState<BannerStyle>({shape:'bunting',pattern:'image',color:'#aa4400'});saved=style;return <BannerPaintFields projectId={p} style={style} onChange={setStyle}/>;}
 try{
  await db.inspirationImages.put({id:p+'-image',projectId:p,imageData:PNG,imageDataOriginal:PNG,thumbnailData:PNG,tags:[],notes:'Own gallery cloth',createdAt:1} as import('@/types').InspirationImage);
  await db.inspirationImages.put({id:p+'-foreign',projectId:p+'-other',imageData:PNG,tags:[],notes:'FOREIGN PRIVATE',createdAt:1} as import('@/types').InspirationImage);
  await act(async()=>{root.render(<MemoryRouter><Fields/></MemoryRouter>);await pause();});
  await fileChange(document.querySelector('[data-testid="banner-local-file"]')!,paintFile());await until(()=>saved?.image?.dataUrl===PNG,'Native FileReader did not import raster');
  await value(document.querySelector('[data-testid="banner-repeatSizePx"]'),'64');await value(document.querySelector('[data-testid="banner-opacity"]'),'42');assert(saved?.patternParams?.repeatSizePx===64&&saved.patternParams.opacity===.42,'Raster controls missing');
  const paint=document.querySelector<HTMLElement>('[data-testid="banner-paint"]')!;assert(paint.style.opacity==='0.42'&&paint.style.backgroundSize==='64px'&&document.querySelector<HTMLElement>('[data-testid="banner-preview"]')!.style.opacity==='','Text/base opacity incorrectly changed '+JSON.stringify({paint:paint.style.opacity,size:paint.style.backgroundSize,base:document.querySelector<HTMLElement>('[data-testid="banner-preview"]')!.style.opacity}));
  const old=JSON.stringify(saved);await fileChange(document.querySelector('[data-testid="banner-local-file"]')!,new File(['<svg/>'],'bad.svg',{type:'image/svg+xml'}));assert(JSON.stringify(saved)===old&&document.querySelector('[role="alert"]'),'Invalid raster changed previous style');
  await click(textButton('Choose from Gallery'));await until(()=>!!textButton('Own gallery cloth'),'Gallery did not load');assert(!document.body.textContent?.includes('FOREIGN PRIVATE'),'Gallery crossed project');await click(textButton('Own gallery cloth'));await until(()=>!document.querySelector('[role="dialog"]'),'Gallery did not close');await db.inspirationImages.delete(p+'-image');assert(saved?.image?.dataUrl===PNG,'Saved image depends on gallery row');
  return ['Real local FileReader and same-project Gallery import raster bytes; opacity affects paint only, invalid image retains draft and deleting Gallery source leaves copied bytes'];
 }finally{await act(async()=>root.unmount());await db.inspirationImages.where('projectId').equals(p).delete();await db.inspirationImages.where('projectId').equals(p+'-other').delete();}
}
export async function testCalendarBannerLateImageRetarget(){
 const host=document.getElementById('root')!,root=createRoot(host),Native=window.FileReader,pending:DelayedReader[]=[];let aborted=0;const saved=new Map<string,BannerStyle>();
 class DelayedReader extends Native {cancelled=false;override readAsDataURL(_blob:Blob){pending.push(this);}override abort(){this.cancelled=true;aborted++;super.abort();}deliver(){if(this.cancelled)return;Object.defineProperty(this,'result',{value:PNG});this.dispatchEvent(new ProgressEvent('load'));}}
 function Fields({binding}:{binding:string}){const[style,setStyle]=useState<BannerStyle>({shape:'plain',pattern:'image',color:'#aa4400'});saved.set(binding,style);return <BannerPaintFields projectId="qa-banner-late" style={style} onChange={setStyle}/>;}
 try{
  window.FileReader=DelayedReader;
  const render=async(binding:string)=>{await act(async()=>{root.render(<StrictMode><MemoryRouter><Fields key={binding} binding={binding}/></MemoryRouter></StrictMode>);await pause();});};
  await render('eraA/timelineA/draftA');await fileChange(document.querySelector('[data-testid="banner-local-file"]')!,paintFile());assert(pending.length===1,'Reader did not start');
  await render('eraB/timelineB/draftB');await act(async()=>{pending[0].deliver();await pause();});assert(aborted>0&&!saved.get('eraB/timelineB/draftB')?.image,'Late old reader entered new draft');
  await fileChange(document.querySelector('[data-testid="banner-local-file"]')!,paintFile());await act(async()=>{pending[1].deliver();await pause();});assert(saved.get('eraB/timelineB/draftB')?.image?.dataUrl===PNG,'Current reader failed after retarget');
  return ['StrictMode cleanup aborts old FileReader; era/Timeline/draft-key retarget blocks late bytes while the current draft still loads'];
 }finally{window.FileReader=Native;await act(async()=>root.unmount());}
}

export async function testCalendarBannerLinkRetarget(){
 const p='qa-banner-relink',a=p+'-A',b=p+'-B',eid=p+'-E',host=document.getElementById('root')!,root=createRoot(host);let context:BannerCatalogContext|undefined;let written=false;useLocaleStore.setState({locale:'en'});
 let event:TimelineEvent;
 function Fields({banners}:{banners?:BannerCatalogContext}){const[form,setForm]=useState(()=>editEventDetails(event));return <><EventDetailsFields projectId={p} eventColor={event.color} event={event} value={form} banners={banners} entries={[]} mode="calendar" onChange={patch=>setForm(v=>({...v,...patch}))}/><button onClick={async()=>{await writeBannerEvent({projectId:p},{event:{...event,...eventDetailFields(form,'calendar')},baseline:event,targets:form.bannerIntent!.targets,action:form.bannerIntent?.action});written=true;}}>Commit relink</button></>;}
 try{
  await db.projects.put({id:p,title:'Relink',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['timeline'],createdAt:1,updatedAt:1});
  for(const[id,title,color]of [[a,'Origin A','#aa0000'],[b,'Destination B','#0000aa']]){await db.timelines.put({id,projectId:p,title,color,createdAt:1,updatedAt:1});await setBannerPreset({projectId:p},id,(await readBannerCatalog({projectId:p},id)).version,'upsert','P',title+' cloth',{shape:id===a?'bunting':'ribbon',pattern:'grid',color});}
  event={id:eid,projectId:p,timelineId:a,title:'Arrival',description:'',date:'',dateMode:'calendar',realDate:'1500-01-10',eventType:'point',order:0,lane:'',color:'#00aa00',createdAt:1,updatedAt:1,bannerPreset:{ownerTimelineId:a,id:'P',colorMode:'preset',fallback:{shape:'bunting',pattern:'grid',color:'#aa0000'}}};await db.timelineEvents.put(event);
  const render=async()=>{await act(async()=>{root.render(<MemoryRouter><Fields banners={context}/></MemoryRouter>);await pause();});};await render();assert(!document.querySelector('[data-testid="event-banner-preset"]'),'Pending catalog should not expose a broken picker');
  context=await bannerContext({projectId:p});await render();await until(()=>!!document.querySelector<HTMLSelectElement>('[data-testid="event-banner-preset"]')&&!document.querySelector<HTMLSelectElement>('[data-testid="event-banner-preset"]')!.disabled,'Late context did not capture initial baseline');
  assert(document.querySelector<HTMLInputElement>('[data-testid="event-banner-preset-color"]')!.checked,'Initial preset colour missing');await value(document.querySelector('[data-testid="event-banner-preset"]'),JSON.stringify([b,'P']));
  assert(!document.querySelector<HTMLInputElement>('[data-testid="event-banner-preset-color"]')!.checked,'New selection adopted old preset colorMode');assert([...document.querySelectorAll('[data-testid="event-banner-presets"] p')].some(n=>n.textContent==='Linked to Destination B / Destination B cloth'),'New selection label still shows old owner');assert(document.querySelector('[data-testid="banner-preview"]')?.getAttribute('data-shape')==='ribbon','Preview did not show newly selected preset');
  await click(textButton('Commit relink'));await until(()=>written,'Relink did not save');const row=(await db.timelineEvents.get(eid))!;assert(row.bannerPreset?.ownerTimelineId===b&&row.bannerPreset.colorMode===undefined&&row.color==='#00aa00','Relink Save disagreed with preview/default event colour');
  return ['Late catalog loading captures one baseline; changing A/preset-colour to B resets colour mode and keeps label, preview and native save consistent'];
 }finally{await act(async()=>root.unmount());await deleteProject(p);}
}

export async function testCalendarBannerLegacyAbsences(){
 const p='qa-banner-absence',tl=p+'-tl',host=document.getElementById('root')!,root=createRoot(host);useLocaleStore.setState({locale:'en'});
 try{
  await db.projects.put({id:p,title:'Legacy',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['timeline','codex'],createdAt:1,updatedAt:1});await db.timelines.put({id:tl,projectId:p,title:'Legacy',color:'#aa4400',createdAt:1,updatedAt:1});
  for(const pattern of ['stripes','dots','checks'] as const){
   const e:TimelineEvent={id:p+'-'+pattern,projectId:p,timelineId:tl,title:pattern,description:'Legacy prose',date:'',dateMode:'calendar',realDate:'1500-01-10',realDateEnd:'1500-01-12',eventType:'range',order:0,lane:'',color:'#aa4400',bannerPattern:pattern,createdAt:1,updatedAt:1};await db.timelineEvents.put(e);
   const background=bannerBackground(manualBannerStyle(e));assert(background.includes(pattern==='stripes'?'6px 9px':pattern==='dots'?'6px 6px':'8px 8px'),'Legacy pattern geometry changed');
   await act(async()=>{root.render(<MemoryRouter key={pattern} initialEntries={['/project/'+p+'/timeline?view=list&entity='+e.id]}><EnginePaneContext.Provider value={{projectId:p,instanceId:'legacy-'+pattern,visible:true}}><TimelineEngine projectId={p}/></EnginePaneContext.Provider></MemoryRouter>);await pause();});await until(()=>!!document.querySelector('[role="dialog"] input'),'No legacy editor');
   const title=[...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input')].find(input=>input.value===pattern)!;await value(title,pattern+' renamed');await click(textButton('Save',document.querySelector('[role="dialog"]')!));await until(()=>!document.querySelector('[role="dialog"]'),'Legacy title save failed');
   const actual=(await db.timelineEvents.get(e.id))!;assert(actual.title===pattern+' renamed'&&actual.bannerPattern===pattern&&!Object.hasOwn(actual,'bannerShape')&&!Object.hasOwn(actual,'bannerPatternParams')&&!Object.hasOwn(actual,'bannerImage')&&!Object.hasOwn(actual,'bannerPreset'),'Legacy title-only save materialized new fields');
   assert(bannerBackground(manualBannerStyle(actual))===background,'Title-only changed legacy render');
  }
  assert(formatTimedRange('Jan 10','Jan 12','08:00','09:00')==='Jan 10 · 08:00 – Jan 12 · 09:00','Native range separator UTF8 changed');
  return ['Opening/saving only title for Stripes/Dots/Checks preserves every new-field absence and exact background; native time/range separators retain original UTF8'];
 }finally{await act(async()=>root.unmount());await deleteProject(p);}
}

export async function testCalendarBannerWorldMoveAfterRename(){
 const p='qa-banner-world-move',a=p+'-A',b=p+'-B',host=document.getElementById('root')!,root=createRoot(host);useLocaleStore.setState({locale:'en'});
 try{
  const calendar=defaultWorldCalendar('Harbour');await db.projects.put({id:p,title:'World move',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['timeline','codex'],worldCalendar:calendar,createdAt:1,updatedAt:1});for(const id of[a,b])await db.timelines.put({id,projectId:p,title:id,color:'#aa4400',createdAt:1,updatedAt:1});await setBannerPreset({projectId:p},a,(await readBannerCatalog({projectId:p},a)).version,'upsert','P','A cloth',{shape:'bunting',pattern:'grid',color:'#aa4400'});
  const created=await runBridgeTool('wh_create_event',{projectId:p,timelineId:a,title:'World arrival',dateMode:'world',worldDate:{year:1500,month:1,day:10},worldDateEnd:{year:1500,month:1,day:12},banner:{mode:'live',ownerTimelineId:a,presetId:'P'},expectedTargets:(await bannerContext({projectId:p})).targets});assert(created.ok,'Seed native world event');const id=(created.result as {id:string}).id;
  calendar.months[0].name='Renamed Frost';await db.projects.update(p,{worldCalendar:calendar,updatedAt:2});
  await act(async()=>{root.render(<MemoryRouter initialEntries={['/project/'+p+'/timeline']}><EnginePaneContext.Provider value={{projectId:p,instanceId:'world-move',visible:true}}><TimelineEngine projectId={p}/></EnginePaneContext.Provider></MemoryRouter>);await pause();});await until(()=>!![...document.querySelectorAll('g[role="button"]')].find(n=>n.getAttribute('aria-label')?.startsWith('World arrival')),'No world event node');await act(async()=>{[...document.querySelectorAll('g[role="button"]')].find(n=>n.getAttribute('aria-label')?.startsWith('World arrival'))!.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));await pause();});await until(()=>!!document.querySelector<HTMLSelectElement>('[data-testid="event-timeline"]')&&!document.querySelector<HTMLSelectElement>('[data-testid="event-timeline"]')!.disabled,'No world event move editor');
  await value(document.querySelector('[data-testid="event-timeline"]'),b);await click(textButton('Save',document.querySelector('[role="dialog"]')!));await until(()=>!document.querySelector('[role="dialog"]'),'World-linked form move rejected a live renamed calendar label');
  const row=(await db.timelineEvents.get(id))!;assert(row.timelineId===b&&row.bannerPreset?.ownerTimelineId===a&&row.worldDate?.day===10&&row.worldDateEnd?.day===12,'World move changed dates or owner');return ['Linked world event moves through the real form after a calendar month rename without confusing projected date labels with persisted CAS baseline'];
 }finally{await act(async()=>root.unmount());await deleteProject(p);}
}
