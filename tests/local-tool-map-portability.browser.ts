/** Source2382 pre-product oracle body. Not baselineRED evidence before product exists. */
import '@/engines';
import {db} from '@/db';
import {createProject,deleteProject,exportProjectData,importProjectData} from '@/db/operations';
import {worldMapOps} from '@/engines/maps/operations';
import {worldgenScopeOperations} from '@/engines/worldgen/era';
import {DEFAULT_PARAMS} from '@/engines/worldgen/core/types';
import {freshWorldEdits} from '@/engines/worldgen/recipe';
import {defineLocalTool,type LocalToolJson,type LocalToolDocumentReference} from '@/engines/local/sdk';
import {registerLocalToolModules} from '@/engines/local/registry';
import {resolveProjectLocalTool} from '@/engines/local/releases';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument,readSourceToolDocument,listSourceToolDocuments,archiveSourceToolDocument} from '@/engines/local/documents/store';
import {listLocalMapTools,readLocalMapBinding} from '@/engines/local/mapTools/catalog';
import {saveWorldEra,readWorldDocument,hideEraDocument,resetEraDocument} from '@/services/worldEras/store';
import {readProjectDuplicate} from '@/services/projectDuplicate/capture';
import {previewProjectDuplicate,duplicateProject} from '@/services/projectDuplicate/service';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {getBridgeTool} from '@/services/aiBridge/manifest';
import {validateToolArgs} from '@/services/aiRuntime/toolPolicy';
import JSZip from 'jszip';

type PortState={target:LocalToolDocumentReference|null;reviewedVersion:string|null;note:string};
const portNeed:(value:unknown,message:string)=>asserts value=(value,message)=>{if(!value)throw Error(message);};
const portCanon=(value:unknown):string=>{
 if(value===undefined)return 'undefined';
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(portCanon).join(',')+']';
 return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+portCanon(v)).join(',')+'}';
};
const portEq=(actual:unknown,expected:unknown,message:string)=>portNeed(portCanon(actual)===portCanon(expected),message);
const portRefused=async(run:()=>unknown)=>{let error:unknown;try{await run();}catch(reason){error=reason;}portNeed(error!==undefined,'Expected normal refusal');};
const portState=(value:LocalToolJson):value is PortState=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.note==='string'&&value.note!=='AUTHOR-REJECT'&&(value.reviewedVersion===null||typeof value.reviewedVersion==='string')&&(value.target===null||!!value.target&&typeof value.target==='object'&&!Array.isArray(value.target)&&(value.target.kind==='maps'||value.target.kind==='worldgen')&&typeof value.target.documentId==='string');
function portDefinition(namespace:string){return defineLocalTool<PortState>({namespace,name:{en:'Own map review',es:'Revisión propia'},description:{en:'Own portable map context oracle',es:'Oráculo propio de contexto portable'},document:{defaultTitle:{en:'Own review',es:'Revisión propia'}},mapPanel:{version:1,targetField:'target',kinds:['maps','worldgen']},codec:{version:1,fields:{target:{kind:'reference'},reviewedVersion:{kind:'scalar'},note:{kind:'prose'}}},initialState:{target:null,reviewedVersion:null,note:'Own literal á ñ 漢字 🧭'},validateState:portState,component:()=>null});}
async function portFixture(){
 const projectId='own-map-port-'+crypto.randomUUID(),controlId=projectId+'-control',namespace='tests.map-port-'+crypto.randomUUID(),definition=portDefinition(namespace),scope={projectId};
 registerLocalToolModules({['./installed/'+namespace+'/module.tsx']:{default:definition}});
 for(const id of [projectId,controlId])await createProject({id,title:id===projectId?'Own map portability':'Own unrelated control',description:'Synthetic private fixture',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['maps','worldgen','local-tool-'+namespace],engineOrder:['maps','worldgen','local-tool-'+namespace],createdAt:1,updatedAt:1});
 const mapId=projectId+'-map',worldId=projectId+'-world';
 await worldMapOps.create({id:mapId,projectId,title:'Own Map A',createdAt:1,updatedAt:1});
 await worldgenScopeOperations(scope).worlds.create({id:worldId,projectId,title:'Own World C',params:{...DEFAULT_PARAMS,seed:'own-map-port-'+crypto.randomUUID()},edits:freshWorldEdits(),createdAt:1,updatedAt:1});
 await saveWorldEra(projectId,{id:'own-era',name:'Own Era',description:'Own test era',revision:0,createdAt:1,updatedAt:1},null);
 return{projectId,controlId,namespace,definition,scope,mapId,worldId,era:{projectId,eraId:'own-era'}};
}
const portCreate=(f:Awaited<ReturnType<typeof portFixture>>,kind:'maps'|'worldgen',documentId:string,title:string,scope=f.scope)=>createSourceToolDocument(scope,f.namespace,title,{initialActions:[{type:'set',field:'target',value:{kind,documentId}}]});

export async function testLocalMapDescriptorsAndCreation(){
 const f=await portFixture(),checks:string[]=[];
 try{
  portNeed(Object.isFrozen(f.definition.mapPanel)&&Object.isFrozen(f.definition.mapPanel!.kinds),'Prepared descriptor/kinds must be immutable');
  const original=f.definition.mapPanel;
  for(const malformed of [null,{version:2,targetField:'target',kinds:['maps']},{version:1,targetField:'note',kinds:['maps']},{version:1,targetField:'missing',kinds:['maps']},{version:1,targetField:'target',kinds:[]},{version:1,targetField:'target',kinds:['maps','maps']},{version:1,targetField:'target',kinds:['writings']},{version:1,targetField:'target',kinds:['maps'],extra:true}]){
   const input={...f.definition};Reflect.set(input,'mapPanel',malformed);await portRefused(()=>defineLocalTool(input));
  }
  const nonDocument={...f.definition};Reflect.deleteProperty(nonDocument,'document');await portRefused(()=>defineLocalTool(nonDocument));
  const badInitial={...f.definition};Reflect.set(badInitial,'initialState',{...f.definition.initialState,target:{kind:'maps',documentId:f.mapId}});await portRefused(()=>defineLocalTool(badInitial));
  portEq(f.definition.mapPanel,original,'Malformed input mutated selected descriptor');checks.push('Opt-in descriptor exact shape/version/field/reference/document/kinds/initial-null; malformed inputs reject normally');
  const legacy=await createSourceToolDocument(f.scope,f.namespace,'Ordinary unbound');portEq(legacy.data,f.definition.initialState,'Three-argument ordinary defaults changed');
  const a=await portCreate(f,'maps',f.mapId,'Map review'),c=await portCreate(f,'worldgen',f.worldId,'World review');
  portNeed(a.revision===1&&c.revision===1,'Seed creation added a second revision');portEq(a.data.target,{kind:'maps',documentId:f.mapId},'Map seed not atomic');portEq(a.codec,f.definition.codec,'Portable codec not stored');
  const row=await readLocalMapBinding(f.scope,{kind:'maps',documentId:f.mapId},f.namespace);portNeed(row.definition===resolveProjectLocalTool(f.namespace,(await db.projects.get(f.projectId))!),'Selected compiled handle not resolved');
  const sourceBefore=await readProjectDuplicate(f.projectId),controlBefore=await readProjectDuplicate(f.controlId);
  const invalidBatches=[
   [{type:'set',field:'target',value:{kind:'maps',documentId:f.mapId}},{type:'set',field:'notDeclared',value:1}],
   [{type:'set',field:'target',value:{kind:'maps',documentId:f.mapId}},{type:'set',field:'note',value:'AUTHOR-REJECT'}],
   [{type:'unset',field:'target'}],
   [{type:'set',field:'target',value:{kind:'maps',documentId:f.controlId+'-missing'}}],
  ];
  for(const initialActions of invalidBatches){const reply=await runBridgeTool('wh_local_tool_document_create',{projectId:f.projectId,namespace:f.namespace,title:'Must not remain',initialActions});portNeed(!reply.ok,'Invalid initial batch was ignored/accepted');portNeed(!Object.hasOwn(reply,'result'),'Failed creation emitted success result');portEq(await readProjectDuplicate(f.projectId),sourceBefore,'Rejected initial actions left a Source/history/variant partial');portEq(await readProjectDuplicate(f.controlId),controlBefore,'Rejected creation changed unrelated control');}
  const normalizer=getBridgeTool('wh_local_tool_document_create');portNeed(normalizer,'Create tool absent');const args={projectId:f.projectId,namespace:f.namespace,title:'Normalized',initialActions:[{type:'set',field:'target',value:{kind:'maps',documentId:f.mapId}}]},normalized=validateToolArgs(normalizer.schema,args);portNeed(normalized.ok,'Valid initialActions rejected by normalizer');portEq(normalized.args.initialActions,args.initialActions,'Normalizer silently dropped initialActions');
  const nullArgs=validateToolArgs(normalizer.schema,{projectId:f.projectId,namespace:f.namespace,title:'Null must reject',initialActions:null});portNeed(nullArgs.ok,'Normalizer must preserve provided null for normal constructor refusal');portNeed(Object.hasOwn(nullArgs.args,'initialActions')&&nullArgs.args.initialActions===null,'Normalizer erased provided null');
  const beforeNull=await readProjectDuplicate(f.projectId),nullReply=await runBridgeTool('wh_local_tool_document_create',nullArgs.args);portNeed(!nullReply.ok&&!Object.hasOwn(nullReply,'result'),'Provided null created a document');portEq(await readProjectDuplicate(f.projectId),beforeNull,'Provided null left partial state');
  const emptyArgs=validateToolArgs(normalizer.schema,{projectId:f.projectId,namespace:f.namespace,title:'Empty defaults',initialActions:[]});portNeed(emptyArgs.ok,'Empty actions rejected by normalizer');portEq(emptyArgs.args.initialActions,[],'Normalizer dropped empty actions');const emptyReply=await runBridgeTool('wh_local_tool_document_create',emptyArgs.args);portNeed(emptyReply.ok,'Empty actions rejected by dispatcher');
  const emptyDocument=(await listSourceToolDocuments(f.scope,f.namespace)).find(d=>d.title==='Empty defaults');portNeed(emptyDocument?.revision===1,'Empty actions must create once');portEq(emptyDocument.data,legacy.data,'Empty actions changed ordinary defaults');
  const list=await listLocalMapTools(f.scope,{kind:'maps',documentId:f.mapId}),tool=list.tools.find(t=>t.namespace===f.namespace);portNeed(tool&&tool.documents.length===1&&tool.documents[0].id===a.id,'Catalogue bound an unbound or different-world document');
  const headless=await runBridgeTool('wh_local_tool_map_open',{projectId:f.projectId,hostId:'absent-own-host',target:{kind:'maps',documentId:f.mapId},namespace:f.namespace,documentId:a.id,expectedContentHash:null});portNeed(headless.ok&&!!headless.result&&typeof headless.result==='object'&&!Array.isArray(headless.result)&&'available'in headless.result&&headless.result.available===false,'Headless open invented a host or failed to give unavailable');
  checks.push('Normal map/world creates seed revision1, atomic invalid second action/author/unsupported action/absent-target, schema and dispatcher distinct; catalogue exact and headless unavailable');
  return checks;
 }finally{await deleteProject(f.projectId);await deleteProject(f.controlId);portNeed((await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),'Descriptor test own89tables not empty');}
}

export async function testLocalMapPortability(){
 const f=await portFixture(),clones:string[]=[],checks:string[]=[],duplicateOperationId=crypto.randomUUID();
 try{
  const a=await portCreate(f,'maps',f.mapId,'Map review'),c=await portCreate(f,'worldgen',f.worldId,'World review');
  const base=createLocalToolClient(f.projectId,f.definition,{documentId:a.id}),era=createLocalToolClient(f.projectId,f.definition,{documentId:a.id,eraId:f.era.eraId}),eraPeer=createLocalToolClient(f.projectId,f.definition,{documentId:a.id,eraId:f.era.eraId});
  const literal='Opaque map '+f.mapId+' and world '+f.worldId+' | /project/literal | á 🧭';await base.state!.apply(await base.read(),[{type:'set',field:'note',value:literal}]);
  const inherited=await era.read();portNeed(inherited.provenance==='base','Named era did not inherit without copy');
  const change=await era.state!.apply(inherited,[{type:'set',field:'note',value:'Own Era note'}]);const liveVersion=(await base.world.read('maps',f.mapId))!.version;
  await eraPeer.state!.apply(await eraPeer.read(),[{type:'set',field:'reviewedVersion',value:liveVersion}]);await era.state!.undo(change.receiptId!);portEq((await era.read()).data,{...f.definition.initialState,target:{kind:'maps',documentId:f.mapId},note:literal,reviewedVersion:liveVersion},'Era Undo lost disjoint real-version edit');portNeed((await era.read()).provenance==='variant'&&(await base.read()).data.note===literal,'Era write/Undo mutated Base or lost COW');
  const own=await era.state!.apply(await era.read(),[{type:'set',field:'note',value:'Own Era portable note'}]);await portRefused(()=>base.state!.undo(own.receiptId!));
  const forHide=(await readSourceToolDocument(f.era,a.id,f.namespace))!;await archiveSourceToolDocument(f.era,a.id,f.namespace,forHide.document.revision,forHide.version);portNeed(!await readSourceToolDocument(f.era,a.id,f.namespace)&&!!await readSourceToolDocument(f.scope,a.id,f.namespace),'Source era hide leaked to Base');
  const hiddenSource=(await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([f.projectId,f.era.eraId,'local-tool',a.id]).first())!;await resetEraDocument(f.era,'local-tool',a.id,hiddenSource.revision);const inheritedAgain=await era.read();portNeed(inheritedAgain.provenance==='base','Source reset did not reinherit');await portRefused(()=>era.state!.apply(inherited,[{type:'set',field:'note',value:'STALE'}]));await era.state!.apply(inheritedAgain,[{type:'set',field:'note',value:'Own Era portable note'}]);
  const mapRead=(await readWorldDocument(f.era,'maps',f.mapId))!;await hideEraDocument(f.era,'maps',f.mapId,mapRead.version);await portRefused(()=>readLocalMapBinding(f.era,{kind:'maps',documentId:f.mapId},f.namespace));const eraList=await listLocalMapTools(f.era);portNeed(!eraList.tools.flatMap(t=>t.documents).some(d=>d.id===a.id),'Contextual catalogue exposed target hidden in era');portNeed(!!await readSourceToolDocument(f.era,a.id,f.namespace),'Target hide deleted Source notes');
  checks.push('Source Base/era inherit/COW, normal Undo preserving disjoint stamp, Source hide/reset lineage and effective map hide retain independent notes');
  const before=await readProjectDuplicate(f.projectId),control=await readProjectDuplicate(f.controlId),exported=await exportProjectData(f.projectId);const jsonId=await importProjectData(JSON.parse(JSON.stringify(exported)));clones.push(jsonId);
  const preview=await previewProjectDuplicate({projectId:f.projectId,title:'Own map duplicate'});portNeed(preview.externalVersion==='browser-no-native-storage','Renderer focal must honestly use browser duplicate fallback');const duplicated=await duplicateProject({projectId:f.projectId,title:preview.title,operationId:duplicateOperationId,expectedSourceVersion:preview.sourceVersion});clones.push(duplicated.projectId);portNeed(duplicated.operationId===duplicateOperationId&&duplicated.complete&&duplicated.unfinished.length===0,'Normal duplicate incomplete');
  for(const id of clones){
   const target=await readProjectDuplicate(id),map=target.tables.worldMaps.find(r=>r.title==='Own Map A'),world=target.tables.generatedWorlds.find(r=>r.title==='Own World C');portNeed(map&&world&&map.id!==f.mapId&&world.id!==f.worldId,'Real target identities not remapped');
   const docs=await listSourceToolDocuments({projectId:id},f.namespace),copyA=docs.find(d=>d.title===a.title),copyC=docs.find(d=>d.title===c.title);portNeed(copyA&&copyC&&copyA.id!==a.id&&copyC.id!==c.id,'Source logical IDs not remapped');portEq(copyA.data,{...a.data,note:literal,target:{kind:'maps',documentId:map.id}},'Mapped Map Source data/literals changed');portEq(copyC.data,{...c.data,target:{kind:'worldgen',documentId:world.id}},'Mapped World Source data changed');portEq(copyA.codec,a.codec,'Mapped codec changed');
   const e=target.project.worldEras!.find(e=>e.name==='Own Era')!;portNeed(e&&e.id!==f.era.eraId,'Actual named era not remapped');const ownCopy=(await readSourceToolDocument({projectId:id,eraId:e.id},copyA.id,f.namespace))!;portNeed(ownCopy.provenance==='variant'&&ownCopy.document.data.note==='Own Era portable note','Own Source era content lost');portEq(ownCopy.document.data.target,{kind:'maps',documentId:map.id},'Era source target not remapped');await portRefused(()=>readLocalMapBinding({projectId:id,eraId:e.id},{kind:'maps',documentId:String(map.id)},f.namespace));
  }
  portEq(await readProjectDuplicate(f.projectId),before,'Normal JSON/duplicate mutated source');portEq(await readProjectDuplicate(f.controlId),control,'Normal JSON/duplicate changed control');
  const docsBefore=await listSourceToolDocuments(f.scope,f.namespace),archive=await createProjectZipArchive(f.projectId),zip=await JSZip.loadAsync(await archive.blob.arrayBuffer(),{checkCRC32:true});portNeed(Object.keys(zip.files).some(path=>path.endsWith('/project.json')),'Normal ZIP missing project metadata');
  const restoreFile=new File([archive.blob],'own-map-context.zip',{type:'application/zip'});await portRefused(()=>importProjectZip(restoreFile));portEq(await readProjectDuplicate(f.projectId),before,'Unapproved ZIP collision changed source');await importProjectZip(restoreFile,{replaceProjectIds:[f.projectId]});portEq(await listSourceToolDocuments(f.scope,f.namespace),docsBefore,'ZIP normal restore changed Source identity/data/codec');
  const restoredEra=(await readSourceToolDocument(f.era,a.id,f.namespace))!;portNeed(restoredEra.document.data.note==='Own Era portable note','ZIP lost Source own-era data');await portRefused(()=>readLocalMapBinding(f.era,{kind:'maps',documentId:f.mapId},f.namespace));portEq(await readProjectDuplicate(f.controlId),control,'ZIP changed unrelated control');
  checks.push('Normal JSON copy with source IDs occupied and real duplicate remap Map/World/Source/era identities, opaque literals exact, source/control unchanged; normal ZIP collision refusal and explicit restore preserve current and own-era notes');
  return checks;
 }catch(error){console.error('MAP_PORTABILITY_ORIGINAL_FAILURE '+String(error instanceof Error?error.stack:error));throw error;
 }finally{
  for(const id of [...clones,f.projectId,f.controlId])await deleteProject(id);
  // Normal duplication retains its operation journal after deleting a project.
  // Remove only this fixture's real completed operation metadata, as the existing
  // todos-link and table-row-order portability tests do; no authored row is seeded.
  const key='projectDuplicate.operation.'+duplicateOperationId,entry=await db.settings.get(key);
  if(entry){const receipt=JSON.parse(entry.value);portNeed(receipt.operationId===duplicateOperationId&&receipt.sourceProjectId===f.projectId&&clones.includes(receipt.projectId),'Own duplicate cleanup boundary mismatch');await db.settings.delete(key);}
  const counts=await Promise.all(db.tables.map(async table=>({table:table.name,count:await table.count()})));if(counts.some(row=>row.count))console.error('MAP_PORTABILITY_CLEANUP_REMAINDERS '+JSON.stringify(counts.filter(row=>row.count)));portNeed(counts.every(row=>row.count===0),'Portability own89tables not empty');
 }
}

// Bounded normal regression batches. The original test bodies remain unchanged.
import {oraclePublicCreation as portPublicOracle} from './local-tool-map-context.browser';
import {testDocumentHostLease as portLegacyLease} from './local-tool-document-host-lease.browser';
import {testSourceToolDocuments as portLegacyDocuments} from './local-tool-documents.browser';
import {testSourceAdditivePinAndRead as portLegacyAdditiveRead,testSourceAdditivePromotion as portLegacyAdditivePromotion} from './local-tool-source-additive.browser';
import {testLocalToolPublishedDocumentFields as portLegacyPublications} from './local-tool-published-document-fields.browser';
import {testLocalToolDefaultsAll as portLegacyDefaults} from './local-tool-defaults.browser';

export async function testLocalMapPublicAndPortability(){
 console.info('MAP_CONTEXT_OTHER_START public');const publicResult=await portPublicOracle();console.info('MAP_CONTEXT_OTHER_PASS public '+JSON.stringify({checks:publicResult.checks.length}));
 const descriptor=await testLocalMapDescriptorsAndCreation();console.info('MAP_CONTEXT_OTHER_PASS descriptors '+JSON.stringify(descriptor));
 const portable=await testLocalMapPortability();console.info('MAP_CONTEXT_OTHER_PASS portability '+JSON.stringify(portable));
 return ['Original public dispatcher oracle: '+publicResult.checks.length+' checks',...descriptor,...portable];
}
export async function testLocalMapLegacyRegressions(){
 const checks:string[]=[];
 for(const [name,run]of Object.entries({portLegacyLease,portLegacyDocuments,portLegacyAdditiveRead,portLegacyAdditivePromotion,portLegacyPublications,portLegacyDefaults})){
  console.info('MAP_CONTEXT_LEGACY_START '+name);const result=await run();console.info('MAP_CONTEXT_LEGACY_PASS '+name+' '+JSON.stringify(result));checks.push(name);
 }
 return checks;
}

import {act as portAct,StrictMode as PortStrictMode,createElement as portElement,useLayoutEffect as portLayoutEffect} from 'react';
import {createRoot as portCreateRoot} from 'react-dom/client';
import {MemoryRouter as PortMemoryRouter} from 'react-router-dom';
import PortDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import type {LocalToolProps as PortProps,LocalToolClient as PortClient,LocalToolHostContext as PortContext} from '@/engines/local/sdk';

/** Ordinary preview is a presentation choice; an explicit readonly prop remains authoritative. */
export async function testOrdinaryPreviewFullscreen(){
 type State={counter:number};
 const projectId='own-preview-full-'+crypto.randomUUID(),namespace='tests.preview-full-'+crypto.randomUUID(),mount=document.createElement('div');document.body.append(mount);const root=portCreateRoot(mount);
 let emitted:{client:PortClient<State>;context:PortContext}|undefined;
 function OrdinaryPreviewProbe({client,context}:PortProps<State>){
  portNeed(context,'Normal host context absent');
  portLayoutEffect(()=>{const issued={client,context};emitted=issued;return()=>{if(emitted===issued)emitted=undefined;};},[client,context]);
  return portElement('output',{'data-own-preview-author':context.view},String(context.canEdit));
 }
 const definition=defineLocalTool<State>({namespace,name:{en:'Own preview',es:'Vista propia'},description:{en:'Own legacy fullscreen regression',es:'Prueba propia de pantalla completa'},document:{defaultTitle:{en:'Own preview',es:'Vista propia'}},codec:{version:1,fields:{counter:{kind:'scalar'}}},preview:{version:1,fields:[{key:'counter',label:{en:'Counter',es:'Cuenta'}}]},initialState:{counter:0},validateState:(value):value is State=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.counter==='number',component:OrdinaryPreviewProbe});
 const wait=async(predicate:()=>boolean,message:string)=>{for(let i=0;i<200;i++){if(predicate())return;await portAct(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});}throw Error(message+'; DOM '+mount.innerHTML);};
 const button=(pattern:RegExp)=>{const found=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>pattern.test(b.textContent?.trim()??''));portNeed(found,'Real fullscreen control absent');return found;};
 const click=async(node:HTMLButtonElement)=>portAct(async()=>{portNeed(!node.disabled,'Real fullscreen control disabled');await Promise.resolve();node.click();});
 try{
  registerLocalToolModules({['./installed/'+namespace+'/module.tsx']:{default:definition}});
  await createProject({id:projectId,title:'Own ordinary preview',description:'Synthetic private regression',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['local-tool-'+namespace],engineOrder:['local-tool-'+namespace],createdAt:1,updatedAt:1});
  const sourceDocument=await createSourceToolDocument({projectId},namespace,'Ordinary preview');
  const render=async(readOnly=false)=>portAct(async()=>{root.render(portElement(PortStrictMode,null,portElement(PortMemoryRouter,null,portElement(PortDocumentHost,{projectId,documentId:sourceDocument.id,namespace,view:'embed',readOnly}))));});
  await render();await wait(()=>!!mount.querySelector('[data-source-document-view="embed"]'),'Ordinary default embed preview did not load');portNeed(!mount.querySelector('[data-own-preview-author]'),'Default embed mounted editable author');
  await click(button(/^(Fullscreen|Pantalla completa)$/));await wait(()=>!!document.body.querySelector('[data-source-document-view="fullscreen"]'),'Actual fullscreen modal did not mount');
  await wait(()=>emitted?.context.view==='fullscreen'&&emitted.context.canEdit===true,'Ordinary readonly preview lost its normal editable fullscreen');
  const issued=emitted!;const change=await issued.client.state!.apply(await issued.client.read(),[{type:'set',field:'counter',value:1}]);await issued.client.state!.undo(change.receiptId!);portEq((await readSourceToolDocument({projectId},sourceDocument.id,namespace))!.document.data,{counter:0},'Ordinary fullscreen normal apply/Undo failed');
  await click(button(/^(Save and return|Guardar y volver)$/));await wait(()=>!document.body.querySelector('[data-source-document-view="fullscreen"]'),'Ordinary fullscreen did not return to preview');await portRefused(async()=>issued.client.state!.apply(await issued.client.read(),[{type:'set',field:'counter',value:99}]));
  await render(true);await click(button(/^(Fullscreen|Pantalla completa)$/));await wait(()=>!!document.body.querySelector('[data-source-document-view="fullscreen"]'),'Explicit readonly fullscreen modal absent');portNeed(!document.body.querySelector('[data-source-document-view="fullscreen"] [data-own-preview-author]'),'Explicit readonly fullscreen mounted editable controls');portEq((await readSourceToolDocument({projectId},sourceDocument.id,namespace))!.document.data,{counter:0},'Readonly fullscreen changed data');
  return ['Ordinary default readonly embed opens normal editable fullscreen with real apply/Undo and independently revoked close lease','Explicit readonly prop keeps ordinary fullscreen inert; contextual authority is tested separately'];
 }finally{await portAct(async()=>root.unmount());mount.remove();await deleteProject(projectId);portNeed((await Promise.all(db.tables.map(t=>t.count()))).every(count=>count===0),'Ordinary preview regression own89tables not empty');}
}

/** Actual installed map-review module, normal map snapshot, Source host and editor. */
import portMapReviewModule from '@/engines/local/installed/examples.map-review/module';
import PortMapWorkspace from '@/engines/local/mapTools/MapToolWorkspace';
import type {LocalToolMapTarget as PortMapTarget} from '@/engines/local/mapTools/contracts';
import {captureMapVersion as portCaptureVersion} from '@/engines/maps/operations';
import {useState as portMapState} from 'react';
import {useLiveQuery as portMapLiveQuery} from 'dexie-react-hooks';
import PortEventDexie from 'dexie';
import {getPendingWritesSnapshot as portPending,flushPendingWrites as portFlush} from '@/services/pendingWrites';

function PortRealReviewMap({scope,mapId,versionId,preview}:{scope:{projectId:string;eraId?:string};mapId:string;versionId:string;preview:boolean}){
 const [selected,setSelected]=portMapState<PortMapTarget>({kind:'maps',documentId:mapId});
 const read=portMapLiveQuery(()=>readWorldDocument(scope,'maps',selected.documentId),[scope.projectId,scope.eraId,selected.documentId]);
 const actualVersion=read&&Array.isArray(read.document.root.versions)?read.document.root.versions.find(version=>version&&typeof version==='object'&&'id'in version&&version.id===versionId):undefined;
 const historical=preview&&!!actualVersion;
 return portElement(PortMapWorkspace,{scope,kind:'maps',target:read?selected:null,readOnly:historical,presentation:historical?{kind:'map-version',versionId}:{kind:'current'},onSelectTarget:target=>{if(target.kind==='maps')setSelected(target);},children:()=>portElement('div',{'data-own-real-map':selected.documentId},'Own real map context')});
}

export async function testActualMapReviewReadonly(){
 const checks:string[]=[];
 for(const ownEra of [false,true]){
  const projectId='own-review-note-'+crypto.randomUUID(),controlId=projectId+'-control',mapId=projectId+'-map',scope={projectId,...(ownEra?{eraId:'own-e'}:{})},namespace=portMapReviewModule.namespace;
  const mount=document.createElement('div');document.body.append(mount);const root=portCreateRoot(mount);
  const wait=async(predicate:()=>boolean,message:string)=>{for(let i=0;i<200;i++){if(predicate())return;await portAct(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});}throw Error((ownEra?'E: ':'Base: ')+message+'; DOM '+document.body.innerHTML);};
  const click=async(button:HTMLButtonElement)=>portAct(async()=>{portNeed(!button.disabled,'Actual map-review control disabled');PortEventDexie.ignoreTransaction(()=>button.click());await new Promise(resolve=>setTimeout(resolve,20));});
  const button=(parent:ParentNode,pattern:RegExp)=>{const node=[...parent.querySelectorAll<HTMLButtonElement>('button')].find(item=>pattern.test(item.textContent?.trim()??''));portNeed(node,'Actual map-review control absent: '+pattern);return node;};
  const snapshot=async()=>portCanon({source:await readProjectDuplicate(projectId),control:await readProjectDuplicate(controlId)});
  try{
   registerLocalToolModules({['./installed/'+namespace+'/module.tsx']:{default:portMapReviewModule}});
   for(const id of [projectId,controlId])await createProject({id,title:'Own actual map-review notes',description:'Private synthetic UI oracle',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['maps','local-tool-'+namespace],engineOrder:['maps','local-tool-'+namespace],createdAt:1,updatedAt:1});
   await worldMapOps.create({id:mapId,projectId,title:'Own actual review map',createdAt:1,updatedAt:1});
   if(ownEra)await saveWorldEra(projectId,{id:'own-e',name:'Own E',description:'Private era',revision:0,createdAt:1,updatedAt:1},null);
   const versionId=await portCaptureVersion(mapId,{name:'Own actual historical version',date:''},scope);
   const source=await createSourceToolDocument({projectId},namespace,'Actual saved map notes',{initialActions:[{type:'set',field:'target',value:{kind:'maps',documentId:mapId}}]});
   const client=createLocalToolClient(projectId,portMapReviewModule,{documentId:source.id,eraId:scope.eraId});
   const token=(ownEra?'Era':'Base')+' saved note \u00e1 \u6f22\u5b57 \ud83e\udded',html='<p>'+token+' <strong>saved markup</strong></p>';
   await client.state!.apply(await client.read(),[{type:'set',field:'note',value:html}]);
   const before=await snapshot(),dirtyBefore=portPending().dirty;
   const render=async(preview:boolean)=>portAct(async()=>root.render(portElement(PortStrictMode,null,portElement(PortMemoryRouter,null,portElement(PortRealReviewMap,{scope,mapId,versionId,preview})))));
   await render(true);
   await wait(()=>[...mount.querySelectorAll<HTMLOptionElement>('select[data-map-tool-namespace] option')].some(option=>option.value===namespace&&!option.disabled),'actual installed module missing from catalogue');
   const select=mount.querySelector<HTMLSelectElement>('select[data-map-tool-namespace]')!;
   await portAct(async()=>{PortEventDexie.ignoreTransaction(()=>{select.value=namespace;select.dispatchEvent(new Event('change',{bubbles:true}));});});
   await wait(()=>!!mount.querySelector('button[data-map-tool-document="'+source.id+'"]'),'actual bound document not listed');
   await click(mount.querySelector<HTMLButtonElement>('button[data-map-tool-document="'+source.id+'"]')!);
   await wait(()=>!!mount.querySelector('[data-map-review]'),'actual installed author did not mount');
   const mapRead=await readWorldDocument(scope,'maps',mapId),inherited=ownEra&&mapRead?.provenance==='base';
   const checkScopeHeader=(parent:ParentNode)=>{const line=parent.querySelector('[data-map-review] > header > p')?.textContent??'',labels=ownEra?['Current era','Época actual']:['Base'];portNeed(labels.some(label=>line.includes(' · '+label)),'Actual map-review header lacks readable Base/current-era context');if(scope.eraId)portNeed(!line.includes(scope.eraId),'Implementation era ID leaked in actual map-review header');portNeed(/inherited from Base|heredado de Base/.test(line)===inherited,'Actual map-review inherited indicator changed');};
   checkScopeHeader(mount);
   await wait(()=>mount.querySelector('[data-map-review-saved-note]')?.textContent?.includes(token)===true,'readonly actual example hides saved note');
   const savedView=mount.querySelector('[data-map-review-saved-note]')!;
   portNeed(savedView.querySelector('strong')?.textContent==='saved markup','Readonly saved markup flattened or escaped');
   portNeed(!mount.querySelector('[data-map-review] [contenteditable="true"]'),'Snapshot note exposes editable prose');
   portNeed(button(mount,/^(Record review|Registrar revisi\u00f3n)$/).disabled,'Readonly snapshot exposes record action');
   portNeed(await snapshot()===before,'Readonly note projection wrote full Source/control data');
   await click(button(mount,/^(Fullscreen|Pantalla completa)$/));
   await wait(()=>document.querySelector('[data-source-document-view="fullscreen"] [data-map-review-saved-note]')?.textContent?.includes(token)===true,'actual readonly fullscreen hides saved note');
   portNeed(!document.querySelector('[data-source-document-view="fullscreen"] [contenteditable="true"]'),'Readonly fullscreen exposes editable prose');
   checkScopeHeader(document.querySelector('[data-source-document-view="fullscreen"]')!);
   await click(button(document,/^(Save and return|Guardar y volver)$/));
   await wait(()=>!document.querySelector('[data-source-document-view="fullscreen"]'),'Readonly fullscreen failed to close');
   await render(false);
   await wait(()=>!!mount.querySelector('[data-map-review] [contenteditable="true"]'),'normal current author did not become editable');
   const editor=mount.querySelector<HTMLElement>('[data-map-review] [contenteditable="true"]')!,pendingToken=' own pending draft \u03a9';
   await portAct(async()=>{PortEventDexie.ignoreTransaction(()=>{editor.focus();const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);const selection=window.getSelection();portNeed(selection,'Normal editable selection unavailable');selection.removeAllRanges();selection.addRange(range);portNeed(document.execCommand('insertText',false,pendingToken),'Normal contenteditable insert failed');});await new Promise(resolve=>setTimeout(resolve,30));});
   await wait(()=>portPending().dirty>dirtyBefore&&editor.textContent?.includes(pendingToken)===true,'actual rich editor did not buffer normal DOM edit');
   portNeed(await snapshot()===before,'Buffered actual editor wrote before Save');
   await render(true);
   await wait(()=>!!mount.querySelector('[data-map-review-saved-note]')&&editor.getAttribute('contenteditable')==='false','Historical view failed to keep actual dirty editor readonly');
   portNeed(mount.querySelector('[data-map-review] [contenteditable]')===editor&&editor.textContent?.includes(pendingToken),'Readonly saved projection replaced or erased the actual editor draft');
   portNeed(mount.querySelector('[data-map-review-saved-note]')?.textContent?.includes(token)===true,'Readonly projection does not show the saved note beside the retained draft');
   await click(button(mount,/^(Discard changes|Descartar cambios)$/));
   await wait(()=>portPending().dirty===dirtyBefore,'Normal actual editor Discard did not recover pending state');
   portNeed((await portFlush()).ok&&await snapshot()===before,'Readonly enter/fullscreen/draft/Discard changed full durable Source/control snapshot');
   checks.push((ownEra?'E':'Base')+': readable Base/current-era headers in actual panel/fullscreen, internal era ID absent and inherited indicator matches real map');
   checks.push((ownEra?'E':'Base')+': actual installed module shows saved rich note in genuine map-version and readonly fullscreen; current editor buffers DOM edit, readonly keeps same draft node, normal Discard recovers; full snapshots exact');
  }finally{await portAct(async()=>root.unmount());mount.remove();await deleteProject(projectId);await deleteProject(controlId);portNeed((await Promise.all(db.tables.map(table=>table.count()))).every(count=>count===0),'Actual map-review oracle own89tables not empty');}
 }
 return checks;
}
