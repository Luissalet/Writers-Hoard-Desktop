// Future contract frozen before product2425. Not a runnable baseline RED:
// insertRadarAxis/moveRadarAxis and the two tool schemas are proposed APIs.
import {act, StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {db} from '@/db';
import {createProject, createCodexEntry, deleteProject, exportProjectData, importProjectData} from '@/db/operations';
import type {Project, CodexEntry} from '@/types';
import type {RadarChartDocument} from '@/engines/radar/types';
import RadarEngine from '@/engines/radar/RadarEngine';
import RadarGraphic from '@/engines/radar/RadarGraphic';
import {createRadarChart, addRadarAxis, insertRadarAxis, moveRadarAxis, validateRadarChart, resolveRadarSeries, MAX_RADAR_AXES} from '@/engines/radar/model';
import {saveRadarChart, radarDraftStore} from '@/engines/radar/operations';
import {exportRadarJson, parseRadarJson} from '@/engines/radar/interchange';
import {radarAudioEnabled, setRadarAudioEnabled} from '@/engines/radar/audio';
import {getBridgeTool} from '@/services/aiBridge/manifest';
import {runBridgeTool, type BridgeReply} from '@/services/aiBridge/dispatch';
import {applyProjectScope, validateToolArgs} from '@/services/aiRuntime/toolPolicy';
import {saveWorldEra, getEraProject} from '@/services/worldEras/store';
import {previewProjectDuplicate, duplicateProject} from '@/services/projectDuplicate/service';
import {createProjectZipArchive, importProjectZip} from '@/services/zipBackup';
import {useLocaleStore} from '@/stores/localeStore';

function assert(value:unknown, message:string):asserts value {if(!value) throw Error(message);}
const pause=(ms=70)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate:()=>boolean,message:string){const end=Date.now()+8000;while(!predicate()&&Date.now()<end)await act(async()=>{await pause(25);});assert(predicate(),message);}
const json=(value:unknown):string=>JSON.stringify(value, (_key, item:unknown)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const equal=(a:unknown,b:unknown,message:string)=>assert(json(a)===json(b),message);
const ids=(chart:RadarChartDocument)=>chart.axes.map(axis=>axis.id);
async function rejects(action:()=>unknown|Promise<unknown>,message:string){let refused=false;try{await action();}catch{refused=true;}assert(refused,message);}
function chartFixture(linkedEntryId:string):RadarChartDocument {
 const chart=createRadarChart('Axis contract');chart.description='Keep notes, identities, bindings and raw outliers';chart.isPreset=true;chart.presetCategory='Synthetic axes';
 chart.axes=chart.axes.map((axis,index)=>({...axis,label:['Influence','Roads','Reserve','Lore','Reach'][index],min:index===0?-10:0,max:index===0?30:10,unit:index===0?'pts':'',step:index===0?2:1,icon:index===0?'Accessibility':undefined,color:index===0?'#81a8d3':undefined}));
 chart.series[0]={...chart.series[0],name:'Manual',values:{...chart.series[0].values,[chart.axes[0].id]:50,[chart.axes[1].id]:-25}};
 chart.series.push({...structuredClone(chart.series[0]),id:crypto.randomUUID(),name:'Live',color:'#6ba88a',linkedEntryId,bindings:{[chart.axes[0].id]:'total'}});
 chart.series.push({...structuredClone(chart.series[0]),id:crypto.randomUUID(),name:'Hidden',visible:false,color:'#b596ca'});
 validateRadarChart(chart);return chart;
}
/** Check preservation, not a second implementation of either order operation. */
function preserved(before:RadarChartDocument,after:RadarChartDocument,expectedIds:string[],addedId?:string){
 equal(ids(after),expectedIds,'Wrong ordered identities');
 const {axes:_oldAxes,series:_oldSeries,...oldMeta}=before,{axes:_newAxes,series:_newSeries,...newMeta}=after;
 equal(oldMeta,newMeta,'Axis gesture altered unrelated root fields');
 for(const axis of before.axes)equal(after.axes.find(item=>item.id===axis.id),axis,'Axis metadata or stable identity changed');
 assert(after.series.length===before.series.length,'Series count changed');
 before.series.forEach((series,index)=>{
  const next=after.series[index];assert(next.id===series.id,'Series identity/order changed');
  if(!addedId){equal(next,series,'Reordering changed values/binding/visibility/style');return;}
  const {values, ...meta}=series,{values:nextValues,...nextMeta}=next;equal(meta,nextMeta,'Insertion changed series metadata/bindings');
  const {[addedId]:initial,...oldValues}=nextValues;assert(initial===0,'New axis does not have the normal zero fallback');equal(oldValues,values,'Existing raw values changed');
  assert(!Object.hasOwn(next.bindings??{},addedId),'Inserted identity inherited another binding');
 });
}
function inserted(before:RadarChartDocument,after:RadarChartDocument):string {
 const fresh=after.axes.filter(axis=>!before.axes.some(old=>old.id===axis.id));assert(fresh.length===1&&after.axes.length===before.axes.length+1,'Insertion did not add exactly one unique identity');
 assert(fresh[0].min===0&&fresh[0].max===10&&fresh[0].unit==='','Insertion lost normal axis defaults');return fresh[0].id;
}
function content(chart:RadarChartDocument){const {id:_id,revision:_revision,createdAt:_created,updatedAt:_updated,...rest}=chart;return rest;}
function withoutSavedClock(chart:RadarChartDocument){const {revision:_revision,updatedAt:_updated,...rest}=chart;return rest;}
async function saved(projectId:string,chartId:string,eraId?:string){const chart=(await getEraProject({projectId,eraId})).radarCharts?.find(item=>item.id===chartId);assert(chart,'Missing normally saved chart');return chart;}
async function snapshot(projectId:string){const {exportedAt:_exported,...data}=await exportProjectData(projectId);return data;}
function result(reply:BridgeReply){assert(reply.ok,reply.error??'Tool failed');const value=reply.result as {chart?:RadarChartDocument};assert(value.chart,'Normal tool result has no chart');return value.chart;}
async function call(projectId:string,name:string,args:Record<string,unknown>,eraId?:string){
 const tool=getBridgeTool(name);assert(tool,'Future schema/registration absent; setup failure is not a functional RED');
 const original={...args,projectId,...(eraId?{eraId}:{})},normalized=validateToolArgs(tool.schema,original);
 assert(normalized.ok,'Invalid normal fixture: '+(!normalized.ok?normalized.error:''));
 if(Object.hasOwn(args,'beforeAxisId'))equal(normalized.args.beforeAxisId,args.beforeAxisId,'Normalizer changed optional anchor intent');
 const scoped=applyProjectScope(tool,normalized.args,{origin:'copilot',projectId});assert(scoped.ok,'Normal project scope refused fixture');
 return runBridgeTool(name,scoped.args);
}
interface Fixture {projectId:string;controlId:string;entry:CodexEntry;chart:RadarChartDocument;controlChart:RadarChartDocument;eraIds:string[];copies:string[];operationIds:string[];locale:ReturnType<typeof useLocaleStore.getState>;sound:boolean}
async function seed():Promise<Fixture>{
 const suffix=crypto.randomUUID(),projectId='axis-source-'+suffix,controlId='axis-control-'+suffix,now=Date.now();
 const f:Fixture={projectId,controlId,entry:undefined as unknown as CodexEntry,chart:undefined as unknown as RadarChartDocument,controlChart:undefined as unknown as RadarChartDocument,eraIds:[],copies:[],operationIds:[],locale:useLocaleStore.getState(),sound:radarAudioEnabled()};
 try{
  const project=(id:string,title:string):Project=>({id,title,description:'Private axis fixture',mode:'custom',type:'standalone',color:'#777777',status:'draft',enabledEngines:['radar','codex'],engineOrder:['radar','codex'],createdAt:now,updatedAt:now});
  const source=project(projectId,'Axis source');source.codexTemplates=[{id:'axis-template-'+suffix,name:'Source',category:'custom',fields:{base:'4',total:''},content:'',propertyDefinitions:[{id:'base-property',key:'base',label:'Base',kind:'number'},{id:'total-property',key:'total',label:'Total',kind:'number',formula:'=@[Base] * 2',formulaBindings:{Base:'base-property'}}],revision:1,createdAt:now,updatedAt:now}];
  await createProject(source);await createProject(project(controlId,'Axis control'));
  f.entry={id:'axis-entry-'+suffix,projectId,title:'Axis live source',type:'custom',templateId:source.codexTemplates[0].id,fields:{base:'4'},content:'Source prose stays intact',tags:[],relations:[],createdAt:now,updatedAt:now};
  await createCodexEntry(f.entry);f.chart=await saveRadarChart(projectId,chartFixture(f.entry.id),null);f.controlChart=await saveRadarChart(controlId,createRadarChart('Control chart'),null);
  useLocaleStore.setState({locale:'en',loaded:true});setRadarAudioEnabled(false);return f;
 }catch(error){await clean(f);throw error;}
}
async function clean(f:Fixture){
 for(const projectId of [f.projectId,f.controlId,...f.copies]){radarDraftStore(projectId).clear();for(const eraId of f.eraIds)radarDraftStore(projectId,eraId).clear();await deleteProject(projectId);}
 for(const operationId of f.operationIds)await db.settings.delete('projectDuplicate.operation.'+operationId);
 setRadarAudioEnabled(f.sound);useLocaleStore.setState({locale:f.locale.locale,loaded:f.locale.loaded});
 const counts:Record<string,number>={projects:await db.projects.where('id').anyOf([f.projectId,f.controlId,...f.copies]).count()};
 for(const table of [db.codexEntries,db.worldEraVariants,db.worldEraAssets,db.documentHistory,db.documentArchives])counts[table.name]=await table.where('projectId').anyOf([f.projectId,f.controlId,...f.copies]).count();
 counts.ownDuplicateReceipts=(await db.settings.bulkGet(f.operationIds.map(id=>'projectDuplicate.operation.'+id))).filter(Boolean).length;
 console.log('RADAR_AXIS_CLEANUP '+json({projectIds:[f.projectId,f.controlId,...f.copies],counts}));assert(Object.values(counts).every(n=>n===0),'Private axis rows remain after normal deletion');
}

export async function testRadarAxisModel():Promise<string[]>{
 const chart=chartFixture('synthetic-model-reference'),before=json(chart),[a,b,c,d,e]=ids(chart);
 const middle=insertRadarAxis(chart,'Gap',c),fresh=inserted(chart,middle);preserved(chart,middle,[a,b,fresh,c,d,e],fresh);assert(middle.axes[2].label==='Gap','Insertion label lost');
 for(const anchor of [undefined,null]){const append=insertRadarAxis(chart,'Append',anchor),id=inserted(chart,append);preserved(chart,append,[a,b,c,d,e,id],id);}
 const legacy=addRadarAxis(chart,'Legacy append'),legacyId=inserted(chart,legacy);preserved(chart,legacy,[a,b,c,d,e,legacyId],legacyId);
 preserved(chart,moveRadarAxis(chart,c,a),[c,a,b,d,e]);preserved(chart,moveRadarAxis(chart,a,d),[b,c,a,d,e]);
 preserved(chart,moveRadarAxis(chart,a,null),[b,c,d,e,a]);preserved(chart,moveRadarAxis(chart,a),[b,c,d,e,a]);assert(moveRadarAxis(chart,c,c)===chart,'Move before itself is not a pure no-op');
 for(const action of [()=>insertRadarAxis(chart,'Bad','missing'),()=>moveRadarAxis(chart,'missing',a),()=>moveRadarAxis(chart,a,'foreign'),()=>insertRadarAxis({...chart,axes:[chart.axes[0],chart.axes[0],...chart.axes.slice(2)]},'Duplicate source'),()=>moveRadarAxis({...chart,axes:[chart.axes[0],chart.axes[0],...chart.axes.slice(2)]},a,b)])await rejects(action,'Invalid identity/anchor admitted');
 let full=chart;while(full.axes.length<MAX_RADAR_AXES)full=addRadarAxis(full,'Capacity '+full.axes.length);await rejects(()=>insertRadarAxis(full,'Overflow',null),'Axis capacity changed');
 equal(json(chart),before,'Pure helper mutated input');return['Insert at stable gap/append plus legacy add; both move directions/append/self no-op; metadata/three series/bindings/raw outliers intact; invalid identities and capacity rejected without mutation'];
}

export async function testRadarAxisBridge():Promise<string[]>{
 const f=await seed();try{
  const control=await snapshot(f.controlId),[a,b,c,d,e]=ids(f.chart);
  for(const name of ['wh_radar_axis_insert','wh_radar_axis_move']){const tool=getBridgeTool(name);assert(tool?.engineId==='radar'&&tool.writes===true,'Axis tool not registered normally');assert(Object.hasOwn(tool.schema.properties,'eraId'),'Era scope missing from schema');}
  const schema=getBridgeTool('wh_radar_axis_insert')!,alias=validateToolArgs(schema.schema,{project_id:f.projectId,chart_id:f.chart.id,before_axis_id:b,expected_revision:String(f.chart.revision)});assert(alias.ok&&alias.args.beforeAxisId===b&&alias.args.expectedRevision===f.chart.revision,'Alias/revision normalization lost intent');
  let chart=result(await call(f.projectId,'wh_radar_axis_insert',{chartId:f.chart.id,label:'Bridge gap',beforeAxisId:b,expectedRevision:f.chart.revision})),fresh=inserted(f.chart,chart);
  preserved(f.chart,{...chart,revision:f.chart.revision,updatedAt:f.chart.updatedAt},[a,fresh,b,c,d,e],fresh);equal(chart,await saved(f.projectId,chart.id),'Bridge result differs from durable reader');
  const beforeMove=chart;chart=result(await call(f.projectId,'wh_radar_axis_move',{chartId:chart.id,axisId:e,beforeAxisId:a,expectedRevision:chart.revision}));preserved(beforeMove,{...chart,revision:beforeMove.revision,updatedAt:beforeMove.updatedAt},[e,a,fresh,b,c,d]);
  const beforeAppend=chart;chart=result(await call(f.projectId,'wh_radar_axis_move',{chartId:chart.id,axisId:e,beforeAxisId:null,expectedRevision:chart.revision}));preserved(beforeAppend,{...chart,revision:beforeAppend.revision,updatedAt:beforeAppend.updatedAt},[a,fresh,b,c,d,e]);
  const beforeDefault=chart;chart=result(await call(f.projectId,'wh_radar_axis_insert',{chartId:chart.id,expectedRevision:chart.revision}));const appended=inserted(beforeDefault,chart);assert(chart.axes.at(-1)?.id===appended&&chart.axes.at(-1)?.label===String(beforeDefault.axes.length+1),'Default ordinal/omitted append changed');
  const resolved=await runBridgeTool('wh_radar_get',{projectId:f.projectId,chartId:chart.id});assert(resolved.ok&&(resolved.result as {resolved:{values:Record<string,number>}[]}).resolved[1].values[a]===8,'Axis operations broke derived Codex binding');
  const stable=await snapshot(f.projectId);
  for(const args of [{axisId:a,beforeAxisId:f.controlChart.axes[0].id},{axisId:f.controlChart.axes[0].id,beforeAxisId:a},{axisId:a,beforeAxisId:'missing'},{axisId:a,beforeAxisId:null,expectedRevision:chart.revision-1}]){
   const reply=await call(f.projectId,'wh_radar_axis_move',{chartId:chart.id,expectedRevision:chart.revision,...args});assert(!reply.ok,'Invalid/stale move succeeded');equal(await snapshot(f.projectId),stable,'Negative move changed source/history');equal(await snapshot(f.controlId),control,'Negative move changed control');
  }
  for(const name of ['wh_radar_axis_insert','wh_radar_axis_move'])for(const args of [{beforeAxisId:f.controlChart.axes[0].id},{beforeAxisId:'missing'},{beforeAxisId:null,expectedRevision:chart.revision-1}]){const reply=await call(f.projectId,name,{chartId:chart.id,axisId:a,expectedRevision:chart.revision,...args});assert(!reply.ok,'Bad anchor/stale insert or move succeeded');equal(await snapshot(f.projectId),stable,'Rejected insert/move changed full source snapshot');}
  for(const anchor of [7,{},'',[]])for(const name of ['wh_radar_axis_insert','wh_radar_axis_move']){
   const args={projectId:f.projectId,chartId:chart.id,expectedRevision:chart.revision,axisId:a,beforeAxisId:anchor};
   const direct=await runBridgeTool(name,args);assert(!direct.ok,'Direct malformed anchor silently became append');
   const normalized=validateToolArgs(getBridgeTool(name)!.schema,args);if(normalized.ok){const reply=await runBridgeTool(name,normalized.args);assert(!reply.ok,'Normalized malformed anchor silently became append');}
   equal(await snapshot(f.projectId),stable,'Malformed optional anchor changed source');equal(await snapshot(f.controlId),control,'Malformed optional anchor changed control');
  }
  let maximum=createRadarChart('Full axes');while(maximum.axes.length<MAX_RADAR_AXES)maximum=addRadarAxis(maximum,'Capacity '+maximum.axes.length);maximum=await saveRadarChart(f.projectId,maximum,null);const fullSnapshot=await snapshot(f.projectId);
  assert(!(await call(f.projectId,'wh_radar_axis_insert',{chartId:maximum.id,label:'Overflow',expectedRevision:maximum.revision})).ok,'Bridge exceeded24 axes');equal(await snapshot(f.projectId),fullSnapshot,'Rejected insertion changed full chart/project');
  equal(await snapshot(f.controlId),control,'Positive bridge operations touched control');equal(await db.codexEntries.get(f.entry.id),f.entry,'Axis bridge wrote source prose/properties');
  return['Normal manifest/normalizer/dispatcher insert/move/append and default ordinal; exact identities/fallbacks/bindings; stale/foreign/malformed anchors/capacity atomically rejected, complete control unchanged'];
 }finally{await clean(f);}
}

export async function testRadarAxisEra():Promise<string[]>{
 const f=await seed();try{
  const base=await saved(f.projectId,f.chart.id),control=await snapshot(f.controlId),now=Date.now();
  for(const name of ['Axis era','Sibling era']){const era={id:crypto.randomUUID(),name,description:'Private axis era',revision:0,createdAt:now,updatedAt:now};await saveWorldEra(f.projectId,era,null);f.eraIds.push(era.id);}
  const inherited=await saved(f.projectId,base.id,f.eraIds[0]);equal(inherited,base,'Era fixture does not inherit Base');
  const own=result(await call(f.projectId,'wh_radar_axis_insert',{chartId:base.id,label:'Era gap',beforeAxisId:base.axes[1].id,expectedRevision:base.revision},f.eraIds[0])),fresh=inserted(base,own);
  preserved(base,{...own,revision:base.revision,updatedAt:base.updatedAt},[base.axes[0].id,fresh,...ids(base).slice(1)],fresh);equal(await saved(f.projectId,base.id),base,'Inherited insertion changed Base');equal(await saved(f.projectId,base.id,f.eraIds[1]),base,'Inherited insertion changed sibling era');
  const moved=result(await call(f.projectId,'wh_radar_axis_move',{chartId:own.id,axisId:fresh,beforeAxisId:null,expectedRevision:own.revision},f.eraIds[0]));preserved(own,{...moved,revision:own.revision,updatedAt:own.updatedAt},[...ids(base),fresh]);
  const snapshotBefore=await snapshot(f.projectId);assert(!(await call(f.projectId,'wh_radar_axis_move',{chartId:own.id,axisId:fresh,beforeAxisId:base.axes[0].id,expectedRevision:own.revision},f.eraIds[0])).ok,'Stale own-era revision accepted');equal(await snapshot(f.projectId),snapshotBefore,'Rejected era CAS changed variant/history/Base');
  equal(await saved(f.projectId,base.id),base,'Own-era move changed Base');equal(await snapshot(f.controlId),control,'Era edit changed project control');
  return['Base-inherited era insertion creates normal own metadata, subsequent move/CAS uses own era, Base/sibling/control and negative complete snapshot remain exact'];
 }finally{await clean(f);}
}

export async function testRadarAxisPortable():Promise<string[]>{
 const f=await seed();try{
  let chart=result(await call(f.projectId,'wh_radar_axis_insert',{chartId:f.chart.id,label:'Portable gap',beforeAxisId:f.chart.axes[2].id,expectedRevision:f.chart.revision}));chart=result(await call(f.projectId,'wh_radar_axis_move',{chartId:chart.id,axisId:chart.axes.at(-1)!.id,beforeAxisId:chart.axes[0].id,expectedRevision:chart.revision}));
  const jsonText=exportRadarJson(chart),parsed=parseRadarJson(jsonText);assert(parsed.id!==chart.id&&parsed.revision===0,'Chart JSON did not make independent root');equal(content(parsed),content(chart),'Chart JSON lost axis order/IDs/metadata/series/bindings');
  const sourceBefore=await snapshot(f.projectId),control=await snapshot(f.controlId),exportedText=JSON.stringify(await exportProjectData(f.projectId));f.copies.push(await importProjectData(JSON.parse(exportedText)));
  const preview=await previewProjectDuplicate({projectId:f.projectId}),operationId=crypto.randomUUID();f.operationIds.push(operationId);const duplicate=await duplicateProject({projectId:f.projectId,title:'Axis duplicate',operationId,expectedSourceVersion:preview.sourceVersion});f.copies.push(duplicate.projectId);assert(duplicate.complete,'Normal duplicate did not complete');
  for(const id of f.copies){
   const project=await db.projects.get(id),copy=project?.radarCharts?.find(item=>item.title===chart.title),entries=await db.codexEntries.where('projectId').equals(id).toArray(),entry=entries.find(item=>item.title===f.entry.title);assert(copy&&entry&&copy.id!==chart.id&&entry.id!==f.entry.id,'Copy failed real owner/identity remapping');
   equal(copy.axes,chart.axes,'Project copy changed local axis identities/order/style');assert(copy.series.length===chart.series.length,'Copy lost a series');
   copy.series.forEach((series,index)=>{const {linkedEntryId,...rest}=series,{linkedEntryId:oldLinked,...oldRest}=chart.series[index];equal(rest,oldRest,'Copy changed local series IDs/value maps/bindings');if(oldLinked)assert(linkedEntryId===entry.id,'Copied binding still targets foreign Codex');else assert(linkedEntryId===undefined,'Copy invented a Codex link');});
   assert(entry.projectId===id&&entry.content===f.entry.content,'Copied source owner/prose changed');
  }
  equal(await snapshot(f.projectId),sourceBefore,'JSON/duplicate mutated source');
  const archive=await createProjectZipArchive(f.projectId);await importProjectZip(new File([archive.blob],archive.fileName,{type:'application/zip'}),{replaceProjectIds:[f.projectId]});equal(await saved(f.projectId,chart.id),chart,'Normal ZIP restore changed chart/order/values/bindings');equal(await db.codexEntries.get(f.entry.id),f.entry,'ZIP changed linked source/prose');equal(await snapshot(f.controlId),control,'Portability changed control');
  return['Chart JSON, serialized project JSON collision remap, normal duplicate and normal ZIP preserve ordered axis payload/series/bindings; actual copied Codex owner observed; source/control preserved'];
 }finally{await clean(f);}
}

const button=(label:string,scope:ParentNode=document)=>[...scope.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()===label);
const named=(label:string,scope:ParentNode=document)=>[...scope.querySelectorAll<HTMLElement>('[aria-label]')].find(node=>node.getAttribute('aria-label')===label);
async function click(node:HTMLElement|undefined|null,label:string){assert(node,'Missing '+label);await until(()=>node.isConnected&&!(node instanceof HTMLButtonElement&&node.disabled)&&!node.closest('fieldset:disabled')&&node.getAttribute('aria-disabled')!=='true','Control not enabled: '+label);await act(async()=>{node.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0}));await pause(100);});}
async function key(node:HTMLElement,keyName:string,altKey=false){await act(async()=>{node.focus();node.dispatchEvent(new KeyboardEvent('keydown',{key:keyName,altKey,bubbles:true}));await pause();});}
async function discard(host:HTMLElement){await click(button('Discard draft',host),'Discard draft');const dialog=document.querySelector<HTMLElement>('[role="dialog"]');assert(dialog,'Normal discard confirmation absent');await click(button('Discard draft',dialog),'confirmed discard');await until(()=>!document.querySelector('[role="dialog"]'),'Discard dialog did not close');}

export async function testRadarAxisUI():Promise<string[]>{
 const f=await seed(),host=document.getElementById('root')!,root=createRoot(host);let mounted=true;
 const render=async(visible=true)=>{await act(async()=>{root.render(<StrictMode><MemoryRouter>{visible&&<RadarEngine projectId={f.projectId}/>}</MemoryRouter></StrictMode>);await pause();});if(visible){const title=(await saved(f.projectId,f.chart.id)).title;await until(()=>{const name=named('Chart name',host) as HTMLInputElement|undefined,gap=named('Insert axis before · Roads',host);return name?.value===title&&!!gap&&!gap.closest('fieldset:disabled');},'Real chart/liveQuery controls never became ready');}};
 const draft=()=>radarDraftStore(f.projectId).get(f.chart.id)?.chart;
 try{
  const original=f.chart,[a,b,c,d,e]=ids(original),control=await snapshot(f.controlId);await render();
  assert(named('Insert axis before · Roads',host),'Accessible real graphic gap button missing');await click(named('Insert axis before · Roads',host),'graphic gap');const afterGap=draft();assert(afterGap,'Graphic insertion did not use normal draft');const fresh=inserted(original,afterGap);preserved(original,afterGap,[a,fresh,b,c,d,e],fresh);equal(await saved(f.projectId,original.id),original,'Gap bypassed Save');
  await click(button('Axes & scales',host),'Axes & scales');let handle=named('Reorder axis · Reserve',host);assert(handle,'Accessible axis handle missing');await key(handle,'ArrowUp',true);equal(ids(draft()!),[a,fresh,c,b,d,e],'Alt+Up reordered wrong stable axis');await key(named('Reorder axis · Reserve',host)!,'ArrowDown',true);equal(draft(),afterGap,'Alt+Down did not preserve exact original draft');
  await click(named('Move axis up · 3',host),'legacy up');equal(ids(draft()!),[a,b,fresh,c,d,e],'Legacy up alternative removed/broken');await click(named('Move axis down · 2',host),'legacy down');equal(draft(),afterGap,'Legacy down changed values/metadata');
  await click(button('Add axis',host),'legacy append');const appended=inserted(afterGap,draft()!);preserved(afterGap,draft()!,[...ids(afterGap),appended],appended);
  await discard(host);assert(!draft(),'Confirmed discard left draft');equal(await saved(f.projectId,original.id),original,'Discard wrote saved chart');await render(false);await render();assert(!draft(),'Discarded draft revived');
  await click(named('Insert axis before · Roads',host),'gap for Save');const toSave=structuredClone(draft()!);await click(button('Save chart',host),'Save chart');await until(()=>!draft(),'Normal Save did not finish');const durable=await saved(f.projectId,original.id);equal(withoutSavedClock(durable),withoutSavedClock(toSave),'Save changed payload/order');assert(durable.revision===original.revision+1&&!draft(),'Save did not clear normal draft/revision');
  await render(false);await render();equal(await saved(f.projectId,original.id),durable,'Saved order failed remount');
  await click(named('Insert axis before · Roads',host),'gap for conflict');const pending=structuredClone(draft()!);await saveRadarChart(f.projectId,{...durable,title:'Other normal writer'},durable.revision);await click(button('Save chart',host),'stale UI save');await until(()=>!!host.textContent?.includes('This chart changed in another view'),'CAS conflict not visible');equal(draft(),pending,'Conflict lost draft');assert((await saved(f.projectId,original.id)).title==='Other normal writer','Stale UI save overwrote later writer');await discard(host);assert(!draft(),'Conflict discard failed');
  await act(async()=>{useLocaleStore.setState({locale:'es',loaded:true});await pause();});assert(named('Insertar eje antes de · Roads',host),'Spanish gap label absent');await click(button('Ejes y escalas',host),'Spanish axes');assert(named('Reordenar eje · Roads',host),'Spanish handle label absent');
  await act(async()=>{root.unmount();});mounted=false;
  const reader=createRoot(host);try{const current=await saved(f.projectId,original.id),resolved=current.series.map(series=>resolveRadarSeries(series,current.axes,[f.entry],f.projectId));await act(async()=>{reader.render(<RadarGraphic chart={current} series={resolved} locale="es"/>);await pause();});assert(!host.querySelector('[role="slider"]')&&!host.querySelector('[aria-label^="Insertar eje antes de"]')&&!host.querySelector('[aria-label^="Reordenar eje"]'),'Readonly graphic exposes author gestures');}finally{await act(async()=>reader.unmount());}
  equal(await snapshot(f.controlId),control,'UI touched unrelated control');equal(await db.codexEntries.get(f.entry.id),f.entry,'UI axis gesture changed source prose/value');
  return['Real Base RadarEngine gap/Alt/legacy append/up/down, Draft→Save/Discard/remount and CAS recovery; es/en accessible names; normal readonly graphic has no author gestures; no fake writer'];
 }finally{if(mounted)await act(async()=>root.unmount());await clean(f);}
}

/** Runner observes requests and sends trusted mouse input, as radar-depth.runner.
 * This export MUST NOT be run by the focused runner without that observer. */
interface PointerWindow {__nativeDrag:{from:{x:number;y:number};to:{x:number;y:number};n:number;cancel?:boolean}|null;__dragDone:number}
export async function testRadarAxisPointer():Promise<string[]>{
 const f=await seed(),host=document.getElementById('root')!,root=createRoot(host),state=window as unknown as PointerWindow;let serial=0;
 const draft=()=>radarDraftStore(f.projectId).get(f.chart.id)?.chart;
 const payload=()=>structuredClone(draft()??f.chart);
 const wait=async(predicate:()=>boolean,message:string)=>{const end=Date.now()+8000;await act(async()=>{while(!predicate()&&Date.now()<end)await pause(25);});assert(predicate(),message);};
 const drag=async(mode:'commit'|'escape'|'cancel'|'lost'|'stale')=>{
  const before=payload(),from=named('Reorder axis · Roads',host),to=named('Reorder axis · Influence',host);assert(from&&to,'Real axis reorder handles missing');from.scrollIntoView({block:'center'});const a=from.getBoundingClientRect(),b=to.getBoundingClientRect();assert(a.width>0&&a.height>0&&b.width>0&&a.top>=0&&a.bottom<=innerHeight&&b.top>=0&&b.bottom<=innerHeight,'Both native drag handles must be visible in actual layout');
  let captureSeen=false,heldCaptureSeen=false,preDrop:RadarChartDocument|undefined,external:RadarChartDocument|undefined,acted=false;
  const observe=(event:PointerEvent)=>console.info('RADAR_AXIS_POINTER_OBSERVE '+JSON.stringify({mode,type:event.type,trusted:event.isTrusted,buttons:event.buttons,pointerId:event.pointerId,captured:from.hasPointerCapture(event.pointerId),target:event.target instanceof Element?event.target.getAttribute('aria-label'):null,order:ids(payload())}));
  const down=(event:PointerEvent)=>{if(event.target instanceof Node&&from.contains(event.target)){captureSeen=from.hasPointerCapture(event.pointerId);observe(event);}};
  const move=(event:PointerEvent)=>{if(!captureSeen||acted)return;acted=true;heldCaptureSeen=event.isTrusted&&event.buttons===1&&from.hasPointerCapture(event.pointerId);preDrop=payload();observe(event);
   if(mode==='cancel')from.dispatchEvent(new PointerEvent('pointercancel',{pointerId:event.pointerId,bubbles:true}));
   if(mode==='lost')from.releasePointerCapture(event.pointerId);
   if(mode==='stale'){const add=button('Add axis',host);assert(add,'Actual append unavailable');add.click();void pause(20).then(()=>{external=payload();});}
  };
  // Observe after the product's bubbled pointerdown handler has captured it.
  document.addEventListener('pointerdown',down);document.addEventListener('pointermove',move);document.addEventListener('lostpointercapture',observe);document.addEventListener('pointerup',observe);
  try{const n=++serial;state.__nativeDrag={from:{x:a.x+a.width/2,y:a.y+a.height/2},to:{x:b.x+b.width/2,y:b.y+b.height/2},n,...(mode==='escape'?{cancel:true}:{})};await wait(()=>state.__dragDone===n,'Native pointer request did not reach normal mouseUp');assert(captureSeen&&heldCaptureSeen&&acted&&preDrop,'Trusted held-button movement with actual pointer capture was not observed');equal(preDrop,before,'Reorder mutated draft before drop');
   if(mode==='commit')preserved(before,payload(),[before.axes[1].id,before.axes[0].id,...ids(before).slice(2)]);
   else if(mode==='stale'){await wait(()=>!!external,'Real external structure edit not observed');const fresh=inserted(before,external!);preserved(before,external!,[...ids(before),fresh],fresh);equal(payload(),external,'Drop applied stale captured structure over actual append');}
   else{console.info('RADAR_AXIS_POINTER_COMPARE '+JSON.stringify({mode,before,after:payload()}));equal(payload(),before,'Cancelled/Escape/lost-capture drag changed chart: '+mode);}
  }finally{document.removeEventListener('pointerdown',down);document.removeEventListener('pointermove',move);document.removeEventListener('lostpointercapture',observe);document.removeEventListener('pointerup',observe);}
 };
 try{
  const control=await snapshot(f.controlId);await act(async()=>{root.render(<MemoryRouter><RadarEngine projectId={f.projectId}/></MemoryRouter>);await pause(180);});await until(()=>{const name=named('Chart name',host) as HTMLInputElement|undefined,axes=button('Axes & scales',host);return name?.value===f.chart.title&&!!axes&&!axes.disabled;},'Native fixture liveQuery chart not ready');await click(button('Axes & scales',host),'Axes for native handles');
  for(const mode of ['escape','cancel','lost','stale'] as const){await drag(mode);if(draft())await discard(host);equal(await saved(f.projectId,f.chart.id),f.chart,'Cancelled native gesture persisted data');}
  await drag('commit');const intended=payload();await click(button('Save chart',host),'Save native reorder');await until(()=>!draft(),'Native normal Save did not finish');equal(withoutSavedClock(await saved(f.projectId,f.chart.id)),withoutSavedClock(intended),'Native reorder Save changed payload');equal(await snapshot(f.controlId),control,'Native gestures changed control');
  return['Real native pointer capture defers order until drop; Escape, pointercancel handler and actual lost capture cancel; actual UI append invalidates stale gesture; normal Save preserves series/raw values/bindings'];
 }finally{await act(async()=>root.unmount());await clean(f);}
}


/** A normal center click must reach its own gap, even in a dense narrow chart. */
export async function testRadarAxisDenseGraphic():Promise<string[]>{
 const host=document.getElementById('root')!,root=createRoot(host),oldWidth=host.style.width,oldOverflow=host.style.overflow;
 try{
  for(const count of [3,5,23])for(const width of [240,320,720]){
   let chart=createRadarChart('Dense gap hit targets');while(chart.axes.length<count)chart=addRadarAxis(chart,'Added '+chart.axes.length);if(count===3)chart={...chart,axes:chart.axes.slice(0,3)};
   chart.axes=chart.axes.map((axis,index)=>({...axis,label:'Axis '+index}));const resolved=chart.series.map(series=>resolveRadarSeries(series,chart.axes,[],''));let selected='';
   host.style.width=width+'px';host.style.overflow='auto';
   await act(async()=>{root.render(<RadarGraphic chart={chart} series={resolved} onValue={()=>{}} onInsertAxis={id=>{selected=id;}}/>);await pause(120);});
   const controls=[...host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Insert axis before"]')];assert(controls.length===count,'Missing dense gap controls');
   for(let index=0;index<controls.length;index++){
    const control=controls[index];control.scrollIntoView({block:'center',inline:'center'});await pause(30);const r=control.getBoundingClientRect(),target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button');
    assert(target===control,`Dense ${count}-axis gap ${index} at width ${width} hits ${target?.getAttribute('aria-label')} instead of its own control`);
    selected='';await click(target,'actual hit-tested gap');assert(selected===chart.axes[index].id,'Hit-tested center selected the wrong stable anchor');
   }
  }
  return['Every gap center selects its own stable anchor at 3/5/23 axes and 240/320/720px host widths, including horizontal scrolling'];
 }finally{await act(async()=>root.unmount());host.style.width=oldWidth;host.style.overflow=oldOverflow;}
}
