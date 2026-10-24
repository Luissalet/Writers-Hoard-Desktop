import {db} from '@/db';
import {deserializeEdits,editKey,serializeEdits,sitesPolicyFrom,targetFromKey} from '@/engines/worldgen/core/edits';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {openWorldForReading} from '@/engines/worldgen/bridgeAccess';
import {assertPlaceImage,placeIconFixture} from './worldgen-place-icons.browser';
import {act,StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {EnginePaneContext} from '@/engines/_shared/EnginePaneContext';
import SpatialEntityInspector from '@/engines/worldgen/components/SpatialEntityInspector';
import {buildAtlas} from '@/engines/worldgen/core/atlas';
import {placeIconPng} from './worldgen-place-icons.browser';
import {placeImageBytes} from '@/engines/worldgen/core/placeImage';
import {useLocaleStore} from '@/stores/localeStore';
import {saveWorldEra} from '@/services/worldEras/store';
import WorldView from '@/engines/worldgen/components/WorldView';
import {ToastHost} from '@/components/common/toast';
import {landmarkKey,resolveWorldLandmarks} from '@/engines/worldgen/core/spatialEntities';
import {createRegionWorkerCore} from '@/engines/worldgen/region/workerCore';
import {packRegionGeography,type RegionWorkerReply} from '@/engines/worldgen/region/workerProtocol';
import {generateWorld} from '@/engines/worldgen/core/pipeline';
import {DEFAULT_PARAMS} from '@/engines/worldgen/core/types';
import {buildHumanGeography} from '@/engines/worldgen/core/settlements';
import {preparePlaceImages,webPlaceImageAdapter} from '@/engines/worldgen/cartography/placeImages';
import RegionSheetView from '@/engines/worldgen/components/RegionSheetView';
import {regionClient} from '@/engines/worldgen/region/client';
import {DEFAULT_REGION_PARAMS,type RegionData} from '@/engines/worldgen/region/types';
import {THEME_ANTIQUE} from '@/engines/worldgen/cartography/theme';
import {PaintSession} from '@/engines/worldgen/core/paintSession';
import {regionVisibleRect} from '@/engines/worldgen/region/coordinates';

const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
async function until(check:()=>boolean,message:string){const deadline=Date.now()+15000;while(!check()&&Date.now()<deadline)await act(async()=>{await pause();});assertPlaceImage(check(),message);}

export async function reviewPlaceIconVisibleCorruption(){
 const f=await placeIconFixture('review-visible-corrupt');
 try{
  const edits=serializeEdits([{kind:'style',target:'settlement',key:f.key,style:{iconImage:{dataUrl:'data:image/png;base64,AAAA',mode:'colour'}}}]);
  await db.generatedWorlds.update(f.worldId,{edits});
  const result=await runBridgeTool('wh_render_world_map',{worldId:f.worldId,width:512,view:{x:f.town.x-12,y:f.town.y-8,w:24,h:16}});
  assertPlaceImage(!result.ok,'Visible corrupt raster silently disappeared from successful strict PNG');
  assertPlaceImage((await db.generatedWorlds.get(f.worldId))!.edits===edits,'Export rewrote imported raster');
  return ['Independent strict-export control: visible corrupt raster rejects with no recipe write'];
 }finally{await f.cleanup();}
}

export async function reviewPlaceIconHiddenAndOffViewResources(){
 const f=await placeIconFixture('review-hidden-offview');
 const args={worldId:f.worldId,theme:'relief',width:512,view:{x:f.town.x-12,y:f.town.y-8,w:24,h:16}};
 const bad={iconImage:{dataUrl:'data:image/png;base64,AAAA',mode:'colour' as const}};
 try{
  const places=buildAtlas(f.world,f.geography).places;
  const far=places.find(p=>p.kind==='settlement'&&Math.abs(p.x-f.town.x)>60&&Math.abs(p.y-f.town.y)>40);
  assertPlaceImage(far,'Need a real settlement well outside requested crop');
  const states=[{name:'hidden',key:f.key,edits:[{kind:'remove' as const,target:'settlement' as const,key:f.key}]},{name:'offview',key:far.key,edits:[]}];
  for(const state of states){
   await db.generatedWorlds.update(f.worldId,{edits:serializeEdits(state.edits)});
   const control=await runBridgeTool('wh_render_world_map',args);
   assertPlaceImage(control.ok,'Control failed '+state.name);
   const edits=serializeEdits([...state.edits,{kind:'style',target:'settlement',key:state.key,style:bad}]);
   await db.generatedWorlds.update(f.worldId,{edits});
   const result=await runBridgeTool('wh_render_world_map',args);
   assertPlaceImage(result.ok,'Nonparticipating '+state.name+' corrupt raster blocked strict PNG '+JSON.stringify(result));
   assertPlaceImage((result.result as {dataUrl:string}).dataUrl===(control.result as {dataUrl:string}).dataUrl,'Nonparticipating '+state.name+' style changed PNG');
   assertPlaceImage((await db.generatedWorlds.get(f.worldId))!.edits===edits,'Export repaired '+state.name+' data while reading');
  }
  return ['Independent actual dispatcher: hidden and far off-view corrupt image resources do not block or alter PNG and imported recipes remain intact'];
 }finally{await f.cleanup();}
}

export async function testReviewPlaceIconWorldViewExportResources(){
 const f=await placeIconFixture('review-worldview-export'),host=document.createElement('div');
 host.style.cssText='position:fixed;inset:0;width:1100px;height:800px';document.body.append(host);
 const root=createRoot(host),nativeDispatch=HTMLAnchorElement.prototype.dispatchEvent,originalDispatch=Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype,'dispatchEvent');
 let downloads=0;Object.defineProperty(HTMLAnchorElement.prototype,'dispatchEvent',{configurable:true,writable:true,value:function(this:HTMLAnchorElement,event:Event){if(this.download.endsWith('-carta.png')&&event.type==='click'){downloads++;return true;}return nativeDispatch.call(this,event);}});
 useLocaleStore.setState({locale:'en',loaded:true});
 const button=(label:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===label);
 const show=async(edits:string)=>{await db.generatedWorlds.update(f.worldId,{edits});const world=(await db.generatedWorlds.get(f.worldId))!;await act(async()=>{root.render(<MemoryRouter><WorldView projectId={f.projectId} world={world} onCreateAlternative={async()=>{}} onRefreshWorld={async()=>{}} onSaveEdits={()=>{}} onSaveRegions={()=>{}} onThumbnail={()=>{}} focusWaypoint={null}/><ToastHost/></MemoryRouter>);});await until(()=>!!button('Export')&&!button('Export')!.disabled,'Actual WorldView snapshot did not become exportable');};
 const exportChart=async()=>{await act(async()=>button('Export')!.click());await until(()=>!!button('Drawn chart (4K)'),'Normal export menu missing chart action');await act(async()=>button('Drawn chart (4K)')!.click());await until(()=>downloads>0||host.textContent?.includes('Could not create the image')===true,'WorldView export neither completed nor reported failure');};
 try{
  await show('[]');await exportChart();assertPlaceImage(downloads===1,'Control WorldView chart did not export');
  await act(async()=>root.render(null));downloads=0;
  await show(serializeEdits([{kind:'style',target:'settlement',key:'settlement:999999:999999',style:{iconImage:{dataUrl:'data:image/png;base64,AAAA',mode:'colour'}}}]));
  await exportChart();assertPlaceImage(downloads===1,'Actual WorldView chart export blocked on corrupt nonexistent resource');
  return ['Independent WorldView normal Export/chart action ignores corrupt nonexistent style while producing a real PNG download'];
 }finally{if(originalDispatch)Object.defineProperty(HTMLAnchorElement.prototype,'dispatchEvent',originalDispatch);else Reflect.deleteProperty(HTMLAnchorElement.prototype,'dispatchEvent');await act(async()=>root.unmount());host.remove();await f.cleanup();}
}

export async function testReviewPlaceIconWorldViewMapExportResources(){
 const f=await placeIconFixture('review-worldview-map-export'),host=document.createElement('div');
 host.style.cssText='position:fixed;inset:0;width:1100px;height:800px';document.body.append(host);
 const root=createRoot(host),nativeDispatch=HTMLAnchorElement.prototype.dispatchEvent,originalDispatch=Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype,'dispatchEvent'),nativeUrl=URL.createObjectURL;
 const landmark={type:'volcano' as const,x:Math.round(f.world.width/2),y:Math.round(f.world.height/2)},key=landmarkKey(landmark);
 const marker={kind:'marker' as const,marker:'landmark' as const,landmark:landmark.type,x:landmark.x,y:landmark.y};
 const blobs=new Map<string,Blob>();let lastDownload:Blob|undefined;
 URL.createObjectURL=(value:Blob|MediaSource)=>{const url=nativeUrl.call(URL,value);if(value instanceof Blob)blobs.set(url,value);return url;};
 let downloads=0;Object.defineProperty(HTMLAnchorElement.prototype,'dispatchEvent',{configurable:true,writable:true,value:function(this:HTMLAnchorElement,event:Event){if(this.download.endsWith('-mapa.png')&&event.type==='click'){downloads++;lastDownload=blobs.get(this.href);return true;}return nativeDispatch.call(this,event);}});
 useLocaleStore.setState({locale:'en',loaded:true});
 const button=(label:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===label);
 const show=async(edits:string)=>{await db.generatedWorlds.update(f.worldId,{edits:serializeEdits([marker,...deserializeEdits(edits)])});const world=(await db.generatedWorlds.get(f.worldId))!;await act(async()=>{root.render(<MemoryRouter><WorldView projectId={f.projectId} world={world} onCreateAlternative={async()=>{}} onRefreshWorld={async()=>{}} onSaveEdits={()=>{}} onSaveRegions={()=>{}} onThumbnail={()=>{}} focusWaypoint={null}/><ToastHost/></MemoryRouter>);});await until(()=>!!button('Export')&&!button('Export')!.disabled&&[...host.querySelectorAll('canvas')].some(c=>c.getBoundingClientRect().height>100),'Actual Map2D frame did not become exportable');await act(async()=>{await pause();await pause();});};
 const exportMap=async()=>{await act(async()=>button('Export')!.click());await until(()=>!!button('Map as you see it (PNG)'),'Normal export menu missing map action');await act(async()=>button('Map as you see it (PNG)')!.click());await until(()=>downloads>0||host.textContent?.includes('Could not create the image')===true,'Map export neither completed nor reported failure');};
 try{
  await show('[]');await exportMap();assertPlaceImage(downloads===1,'Control actual Map2D export did not download PNG');
  await act(async()=>root.render(null));downloads=0;
  await show(serializeEdits([{kind:'style',target:'settlement',key:'settlement:999999:999999',style:{iconImage:{dataUrl:'data:image/png;base64,AAAA',mode:'colour'}}}]));
  await exportMap();assertPlaceImage(downloads===1,'Actual Map2D screen export blocked on corrupt nonexistent resource');
  await act(async()=>root.render(null));downloads=0;
  await show(serializeEdits([{kind:'style',target:'landmark',key,style:{size:2.4,iconImage:{dataUrl:placeIconPng(),mode:'colour'}}}]));
  await exportMap();assertPlaceImage(downloads===1&&lastDownload,'Positive consumed-image control did not produce PNG');
  const bitmap=await createImageBitmap(lastDownload);try{const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;for(const channel of [0,1,2])assertPlaceImage(pixels.some((v,i)=>i%4===channel&&v>245&&pixels[i-channel+(channel+1)%3]<10&&pixels[i-channel+(channel+2)%3]<10),'Positive real Map2D PNG does not contain copied RGB channel '+channel);}finally{bitmap.close();}
  await act(async()=>root.render(null));downloads=0;
  const corrupt=serializeEdits([{kind:'style',target:'landmark',key,style:{size:2.4,iconImage:{dataUrl:'data:image/png;base64,AAAA',mode:'colour'}}}]);
  await show(corrupt);const row=(await db.generatedWorlds.get(f.worldId))!,opened=await openWorldForReading(row,'full');assertPlaceImage(opened.ok&&resolveWorldLandmarks(opened.world.data).some(p=>p.key===key),'Visible-control marker did not resolve through its normal registry');
  const before=row.edits;
  await exportMap();assertPlaceImage(downloads===0&&host.textContent?.includes('Could not create the image'),'Visible corrupt resource silently disappeared from successful map export');
  assertPlaceImage((await db.generatedWorlds.get(f.worldId))!.edits===before,'Read-only strict map export changed its recipe');
  return ['Independent actual WorldView/Map2D PNG action ignores corrupt nonexistent style but rejects visible corrupt resource'];
 }finally{URL.createObjectURL=nativeUrl;if(originalDispatch)Object.defineProperty(HTMLAnchorElement.prototype,'dispatchEvent',originalDispatch);else Reflect.deleteProperty(HTMLAnchorElement.prototype,'dispatchEvent');await act(async()=>root.unmount());host.remove();await f.cleanup();}
}

export async function reviewPlaceIconRegionalResourceParticipation(){
 const world=generateWorld({...DEFAULT_PARAMS,width:64,erosion:0,seed:'independent-regional-resource'}),geography=buildHumanGeography(world),replies:RegionWorkerReply[]=[];
 let rendered=0;
 const handle=createRegionWorkerCore({post(reply){replies.push(reply);},preparePlaceImages:(styles,signal)=>preparePlaceImages(styles,webPlaceImageAdapter(),{signal,strict:true}),renderTile(px,draw){const canvas=document.createElement('canvas');canvas.width=canvas.height=px;try{draw(canvas.getContext('2d')!);assertPlaceImage(canvas.toDataURL('image/png').length>1000,'Control did not produce a real regional raster');rendered++;return{transfer:[]};}finally{canvas.width=canvas.height=0;}}});
 const terminal=(id:string)=>replies.find(reply=>'requestId'in reply&&reply.requestId===id&&['tile','error','declined'].includes(reply.type));
 const request={type:'renderTile' as const,contextId:'independent-resource',z:2,tx:0,ty:0,themeId:'antique',layers:{settlements:true,forests:false,relief:false},density:0,reliefAmount:0};
 try{
  handle({type:'configure',contextId:request.contextId,world,geography:packRegionGeography(geography)});await until(()=>replies.some(reply=>reply.type==='configured'),'Real regional core failed to configure');
  handle({...request,requestId:'control'});await until(()=>!!terminal('control'),'Control regional core did not finish');assertPlaceImage(terminal('control')?.type==='tile'&&rendered===1,'Control regional tile did not render '+JSON.stringify(terminal('control')));
  handle({...request,requestId:'ghost',edits:serializeEdits([{kind:'style',target:'settlement',key:editKey('settlement',999999,999999),style:{iconImage:{dataUrl:'data:image/png;base64,AAAA',mode:'colour'}}}])});
  await until(()=>!!terminal('ghost'),'Regional core did not settle ghost request');assertPlaceImage(terminal('ghost')?.type==='tile','Nonexistent image resource blocked unrelated real regional tile '+JSON.stringify(terminal('ghost')));
  assertPlaceImage(rendered===2,'Ghost resource prevented native tile painter');
  return ['Independent real regional queue/Canvas: unrelated corrupt style cannot prevent a tile that renders successfully without that style; no worker-transport claim'];
 }finally{handle({type:'cancel',requestId:'ghost'});}
}

/** Native precheck: npm run build first, then the existing CSS harness supplies its real worker URL. */
export async function testReviewPlaceIconRegionSheetDownloadProvisional(){
 const asset=(window as unknown as{__placeIconWorkerTest?:{url:string;sha256:string}}).__placeIconWorkerTest;
 assertPlaceImage(asset&&new URL(asset.url).protocol==='file:'&&/\/region\.worker-[\w-]+\.js$/.test(new URL(asset.url).pathname)&&/^[a-f0-9]{64}$/.test(asset.sha256),'Run RegionSheet precheck with tests/review-worldgen-place-icons.native.cjs after the normal product build');
 const workerUrl=asset.url;
 const f=await placeIconFixture('review-sheet-download'),host=document.createElement('div');host.style.cssText='position:fixed;inset:0;width:1000px;height:720px;display:flex';document.body.append(host);
 const root=createRoot(host),session=new PaintSession(f.world),request=regionClient.request,nativeDispatch=HTMLAnchorElement.prototype.dispatchEvent,dispatchDescriptor=Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype,'dispatchEvent'),nativeUrl=URL.createObjectURL;
 const blobs=new Map<string,Blob>();let region:RegionData|undefined,lastBlob:Blob|undefined,downloads=0;
 URL.createObjectURL=(value:Blob|MediaSource)=>{const url=nativeUrl.call(URL,value);if(value instanceof Blob)blobs.set(url,value);return url;};
 Object.defineProperty(HTMLAnchorElement.prototype,'dispatchEvent',{configurable:true,writable:true,value:function(this:HTMLAnchorElement,event:Event){if(this.download==='own-regional-export.png'&&event.type==='click'){downloads++;lastBlob=blobs.get(this.href);return true;}return nativeDispatch.call(this,event);}});
 regionClient.request=function(world,geography,win,options){const handle=request.call(this,world,geography,win,{...options,workerFactory:()=>new Worker(workerUrl,{type:'module'})});void handle.promise.then(value=>{region=value;},()=>{});return handle;};
 const sitesPolicy=sitesPolicyFrom([{kind:'placesEverywhere',enabled:true}]),saved={id:'review-sheet',title:'Own regional export',x:f.town.x+.5,y:f.town.y+.5,spanKm:120,params:{...DEFAULT_REGION_PARAMS,res:128},createdAt:1,updatedAt:1};
 const show=async(revision:number)=>{await act(async()=>root.render(<RegionSheetView world={f.world} geography={f.geography} theme={THEME_ANTIQUE} at={{x:saved.x,y:saved.y}} saved={saved} revision={revision} sitesPolicy={sitesPolicy} onClose={()=>{}}/>));};
 const download=async()=>{const button=host.querySelector<HTMLButtonElement>('button[title="Download"]');assertPlaceImage(button,'Actual region sheet lacks Download action');await act(async()=>button.click());await until(()=>downloads>0,'Region sheet did not dispatch its actual PNG download; a prior viewport image warning is not an export result');};
 useLocaleStore.setState({locale:'en',loaded:true});
 try{
  await show(0);await until(()=>!!region&&[...host.querySelectorAll('canvas')].some(c=>c.width>500),'Real built regional worker did not produce sheet');await download();assertPlaceImage(downloads===1,'Real region sheet control PNG did not download');downloads=0;
  const visible=regionVisibleRect(region!),place=region!.places.find(p=>p.x>visible.x+visible.width*.15&&p.x<visible.x+visible.width*.85&&p.y>visible.y+visible.height*.15&&p.y<visible.y+visible.height*.85);assertPlaceImage(place,'Actual generated region lacks a visible place');const target=targetFromKey(place.sourceKey);assertPlaceImage(target,'Actual regional place has no public edit target');
  session.push({kind:'style',target,key:place.sourceKey,style:{size:2.4,iconImage:{dataUrl:placeIconPng(),mode:'colour'}}});await show(1);await download();assertPlaceImage(downloads===1&&lastBlob,'Valid actual regional image did not export');const bitmap=await createImageBitmap(lastBlob);try{const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;assertPlaceImage(pixels.some((v,i)=>i%4===0&&v>245&&pixels[i+1]<10&&pixels[i+2]<10),'Actual sheet PNG did not consume valid copied red pixels');}finally{bitmap.close();}downloads=0;
  session.push({kind:'style',target,key:place.sourceKey,style:{iconImage:{dataUrl:'data:image/png;base64,AAAA',mode:'colour'}}});session.push({kind:'remove',target,key:place.sourceKey});await show(2);const before=session.serialize();await download();assertPlaceImage(downloads===1,'Hidden corrupt image blocked actual RegionSheet download');assertPlaceImage(session.serialize()===before,'Read-only sheet download rewrote place edits');
  return ['Independent real RegionSheet/ROOT-built Worker/PNG control and visible image pixels; hidden corrupt image cannot block download'];
 }finally{regionClient.request=request;regionClient.clear(f.world);URL.createObjectURL=nativeUrl;if(dispatchDescriptor)Object.defineProperty(HTMLAnchorElement.prototype,'dispatchEvent',dispatchDescriptor);else Reflect.deleteProperty(HTMLAnchorElement.prototype,'dispatchEvent');await act(async()=>root.unmount());host.remove();await f.cleanup();}
}

/** Delay the real native decoder after it has produced a real ImageBitmap. */
export async function testReviewPlaceIconInspectorLateDecode(){
 const f=await placeIconFixture('review-inspector-late'),root=createRoot(document.getElementById('root')!),native=window.createImageBitmap;
 const entity=buildAtlas(f.world,f.geography).byKey.get(f.key)!;
 const second=buildAtlas(f.world,f.geography).places.find(p=>p.kind==='settlement'&&p.key!==f.key)!;
 assertPlaceImage(second,'Need another real generated settlement');
 await saveWorldEra(f.projectId,{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1},null);
 useLocaleStore.setState({locale:'en',loaded:true});
 const writes:unknown[]=[];let release:(()=>void)|undefined,started=0,closed=0;
 window.createImageBitmap=(async(...args:Parameters<typeof createImageBitmap>)=>{
  const bitmap=await Reflect.apply(native,window,args),close=bitmap.close.bind(bitmap);bitmap.close=()=>{closed++;close();};
  started++;await new Promise<void>(resolve=>{release=resolve;});return bitmap;
 }) as typeof createImageBitmap;
 const show=async(key=f.key,worldId=f.worldId,eraId?:string)=>{await act(async()=>{root.render(<StrictMode><MemoryRouter><EnginePaneContext.Provider value={{instanceId:'review-place',projectId:f.projectId,eraId,visible:true}}><SpatialEntityInspector projectId={f.projectId} worldId={worldId} entity={key===f.key?entity:second} onRename={()=>{}} onRemove={()=>{}} onRestore={()=>{}} onMove={()=>{}} onStyle={value=>writes.push(value)} onOpenRegion={()=>{}} onReveal2D={()=>{}} onReveal3D={()=>{}}/></EnginePaneContext.Provider></MemoryRouter></StrictMode>);await pause();});};
 const choose=async()=>{const input=document.querySelector<HTMLInputElement>('[data-testid="place-image-file"]')!;assertPlaceImage(input,'Missing actual File control');const data=new DataTransfer();data.items.add(new File([placeImageBytes({dataUrl:placeIconPng(),mode:'colour'})],'review.png',{type:'image/png'}));await act(async()=>{input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));});};
 try{
  for(const scenario of ['entity','world','era','model','unmount']){
   await show();const priorStarted=started,priorClosed=closed;await choose();await until(()=>started>priorStarted,'Real decoder did not reach delayed result');
   if(scenario==='entity')await show(second.key);
   else if(scenario==='world')await show(f.key,f.worldId+'-retarget');
   else if(scenario==='era')await show(f.key,f.worldId,'past');
   else if(scenario==='unmount')await act(async()=>{root.render(null);});
   else await act(async()=>{const select=document.querySelector<HTMLSelectElement>('select[aria-label="Model"]')!;assertPlaceImage(select,'Missing native model control');select.value='cabin';select.dispatchEvent(new Event('change',{bubbles:true}));});
   const expectedWrites=scenario==='model'?1:0;release!();await until(()=>closed===priorClosed+1,'Late native bitmap was not disposed');
   await act(async()=>{await pause();});assertPlaceImage(writes.length===expectedWrites,'Late decoder wrote across '+scenario+' binding');writes.length=0;
   assertPlaceImage(!document.querySelector('[data-testid="place-image-controls"] [role="status"]'),'Retarget left busy indicator for '+scenario);
  }
  await show();const prior=started;await choose();await until(()=>started>prior,'Retry did not decode');release!();await until(()=>writes.length===1,'Current-owner file retry did not apply');
  return ['Independent real inspector/native decoder: same-project entity/world/era retarget, explicit model choice and unmount reject late image writes and close each bitmap; current-owner retry works'];
 }finally{window.createImageBitmap=native;release?.();await act(async()=>root.unmount());await f.cleanup();}
}

/** Independent counterexample: strict resources must belong to the final map. */
export async function reviewPlaceIconExportResources(){
 const f=await placeIconFixture('review-export-resources');
 const bad={iconImage:{dataUrl:'data:image/png;base64,AAAA',mode:'colour' as const}};
 const args={worldId:f.worldId,theme:'relief',width:512,view:{x:f.town.x-12,y:f.town.y-8,w:24,h:16}};
 try{
  const baseline=await runBridgeTool('wh_render_world_map',args);
  assertPlaceImage(baseline.ok,'Control map without images must export '+JSON.stringify(baseline));
  const key='settlement:999999:999999';
  await db.generatedWorlds.update(f.worldId,{edits:serializeEdits([{kind:'style',target:'settlement',key,style:bad}])});
  const row=(await db.generatedWorlds.get(f.worldId))!;
  const opened=await openWorldForReading(row,'full');
  assertPlaceImage(opened.ok&&!opened.world.atlas.byKey.has(key),'Counterexample accidentally refers to an actual place');
  assertPlaceImage(opened.ok&&opened.world.data.painted?.styles?.[key]?.iconImage,'Fixture did not preserve imported extraneous style');
  const extraneous=await runBridgeTool('wh_render_world_map',args);
  assertPlaceImage(extraneous.ok,'Nonexistent place resource blocked strict map export '+JSON.stringify(extraneous));
  assertPlaceImage((extraneous.result as {dataUrl:string}).dataUrl===(baseline.result as {dataUrl:string}).dataUrl,'Extraneous style changed pixels');
  await db.generatedWorlds.update(f.worldId,{edits:serializeEdits([{kind:'style',target:'settlement',key:f.key,style:bad}])});
  const visible=await runBridgeTool('wh_render_world_map',args);
  assertPlaceImage(!visible.ok,'Visible corrupt place image was silently omitted by strict export');
  assertPlaceImage((await db.generatedWorlds.get(f.worldId))!.edits===serializeEdits([{kind:'style',target:'settlement',key:f.key,style:bad}]),'Read-only export rewrote corrupt imported data');
  return ['Independent actual dispatcher: nonexistent corrupt style cannot block or alter PNG; visible corrupt image still rejects and export does not rewrite imported data'];
 }finally{await f.cleanup();}
}
