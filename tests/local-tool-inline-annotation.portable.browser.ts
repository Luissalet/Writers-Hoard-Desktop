import {db} from '@/db';
import {deleteProject,exportProjectData,importProjectData} from '@/db/operations';
import {createProjectZipArchive,importProjectZip,createFullZipArchive,importFullZip} from '@/services/zipBackup';
import {previewProjectDuplicate,duplicateProject} from '@/services/projectDuplicate/service';
import {saveWorldEra} from '@/services/worldEras/store';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createSourceToolDocument,readSourceToolDocument} from '@/engines/local/documents/store';
import {sourceDocumentPreview,renderLocalToolPreview} from '@/engines/local/documents/preview';
import {createLocalToolClient} from '@/engines/local/storage';
import {defineLocalTool,createLocalToolReplica,type LocalToolJson} from '@/engines/local/sdk';
import definition from '@/engines/local/installed/examples.inline-clues/module';
import {annotationCanonical} from '@/engines/local/convergence/annotationFormat';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {collectRoomImageAssets} from '@/engines/local/convergence/imageRefs';
import {testImageBase64} from './local-tool-image-fixture';
import {rasterFixtures} from './local-tool-image-formats.fixture';
import {LOCAL_TOOL_TOOLS} from '@/engines/local/manifest';

export async function testInlineAnnotationManifest(){
 const range=LOCAL_TOOL_TOOLS.find(tool=>tool.name==='wh_local_tool_rich_range'),apply=LOCAL_TOOL_TOOLS.find(tool=>tool.name==='wh_local_tool_state_apply');if(!range||!apply)throw Error('Shipping MCP tool absent');
 const schema=JSON.parse(JSON.stringify(apply.schema)),actions=schema.properties.actions.items.oneOf.filter((action:{properties:{type:{const:string}}})=>['rich-annotation','rich-text-splice','rich-insert-paragraph'].includes(action.properties.type.const));if(actions.length!==3||!JSON.stringify(range.schema).includes('paragraphs-inline/1 or /2, or /3'))throw Error('Shipping MCP declaration incomplete');
 return['MCP_SCHEMA '+JSON.stringify({range,apply:{name:apply.name,description:apply.description,actions}})];
}

export async function testInlineAnnotationMixed(){
 const projectId='own-inline-mixed-'+crypto.randomUUID(),namespace='qa.inline.mixed',checks:string[]=[];
 const eq=(name:string,a:unknown,b:unknown)=>{if(annotationCanonical(a)!==annotationCanonical(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);};
 const mixed=defineLocalTool({...definition,namespace,initialState:{...definition.initialState,outline:{type:'block-doc',schema:'writers-blocks/11',blocks:[],axisOrder:[]}},codec:{version:2,fields:{...definition.codec!.fields,outline:{kind:'rich',profile:'blocks-tree/12',schema:'writers-blocks/11'},emptyOutline:{kind:'rich',profile:'blocks-tree/12',schema:'writers-blocks/11'}}}});
 try{
  registerLocalToolModules({'./installed/qa.inline.mixed/module.tsx':{default:mixed}});await db.projects.add({id:projectId,title:'Own mixed',description:'Synthetic only',mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+namespace],createdAt:1,updatedAt:1});
  const D=await createSourceToolDocument({projectId},namespace,'Own mixed'),client=createLocalToolClient(projectId,mixed,{documentId:D.id}),c=client.convergence!;
  eq('normal mixed starts engine16',(await c.start(await client.read())).checkpoint.engine.version,'16');
  const range=await c.richRange('body','opening',0,5);await client.state!.apply(range.snapshot,[{type:'rich-annotation',field:'body',nodeId:'opening',range:range.range,attrs:{clueKey:'mixed',state:'hint'}}]);
  const place=await c.richBlockEditCapture('outline',[],{parentId:null,slot:'body',afterId:null});await client.state!.apply(place.snapshot,[{type:'rich-table-create',field:'outline',capture:place.capture,table:{id:'T',rows:[{id:'R',header:false}],columns:[{id:'C'}]}}]);
  const imported=await runBridgeTool('wh_local_asset_file_import',{projectId,namespace,documentId:D.id,file:{name:'own.png',kind:'image',mime:'image/png',base64:testImageBase64}});if(!imported.ok)throw Error(JSON.stringify(imported));
  const asset={sha256:imported.result.sha256,mime:'image/png' as const,size:imported.result.size};
  const cell=await c.richTableCellCapture('outline','T','R','C');await client.state!.apply(cell.snapshot,[{type:'rich-table-cell-image-insert',field:'outline',capture:cell.capture,id:'I',fragmentId:'F',asset}]);
  const replacementFile=rasterFixtures[1],replacementImport=await runBridgeTool('wh_local_asset_file_import',{projectId,namespace,documentId:D.id,file:{name:replacementFile.name,kind:'image',mime:replacementFile.mime,base64:replacementFile.base64}});if(!replacementImport.ok)throw Error(JSON.stringify(replacementImport));const replacementAsset={sha256:replacementImport.result.sha256,mime:replacementFile.mime,size:replacementImport.result.size};
  const source=await c.richImageCapture('outline','I','source'),replaced=await client.state!.apply(source.snapshot,[{type:'rich-image-replace',field:'outline',capture:source.capture,asset:replacementAsset}]);
  const expectedAssets=[asset,replacementAsset].sort((a,b)=>a.sha256.localeCompare(b.sha256));eq('mixed retained original and replacement refs',collectRoomImageAssets((await c.export()).update!),expectedAssets);await client.state!.undo(replaced.receiptId!);eq('mixed dormant replacement survives Undo for replay',collectRoomImageAssets((await c.export()).update!),expectedAssets);
  const saved=await c.export();eq('mixed media refs retained',collectRoomImageAssets(saved.update!),expectedAssets);
  const reader=createLocalToolReplica(saved.checkpoint!,{authorId:'mixed-cold',contract:{namespace,codec:mixed.codec!,validationId:saved.checkpoint!.validationId,schemaEpoch:saved.checkpoint!.schemaEpoch,validateState:mixed.validateState}});try{eq('mixed checkpoint reopen exact',reader.read(),saved.snapshot.data);}finally{reader.destroy();}
  const absent=(await client.read()).data;eq('declared empty block field stays absent',Object.hasOwn(absent,'emptyOutline'),false);
  const zip=await createProjectZipArchive(projectId);await db.projects.update(projectId,{sourceToolDocuments:[]});await importProjectZip(new File([zip.blob],zip.fileName),{replaceProjectIds:[projectId]});eq('mixed ZIP Source data exact',(await client.read()).data,saved.snapshot.data);eq('mixed ZIP media refs exact',collectRoomImageAssets((await c.export()).update!),expectedAssets);
  db.close();await db.open();eq('mixed cold normal Source exact',(await client.read()).data,saved.snapshot.data);
 }finally{if(await db.projects.get(projectId))await deleteProject(projectId);eq('mixed private DB cleaned',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);}
 return checks;
}

/** Actual private IndexedDB, normal Source creator, era writer and portable entry points. */
export async function testInlineAnnotationPortable(){
 const checks:string[]=[],projectId='own-inline-portable-'+crypto.randomUUID(),copies:string[]=[],duplicateOperation=crypto.randomUUID(),namespace=definition.namespace,scope={projectId};
 const eq=(name:string,a:unknown,b:unknown)=>{if(annotationCanonical(a)!==annotationCanonical(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);};
 const rejects=async(name:string,fn:()=>Promise<unknown>)=>{let rejected=false;try{await fn();}catch{rejected=true;}eq(name,rejected,true);};
 try{
  eq('isolated DB initially empty',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);
  registerLocalToolModules({'./installed/examples.inline-clues/module.tsx':{default:definition}});
  await db.projects.add({id:projectId,title:'Own clue portability',description:'Synthetic only',mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+namespace],createdAt:1,updatedAt:1});
  const D=await createSourceToolDocument(scope,namespace,'Own clues'),client=createLocalToolClient(projectId,definition,{documentId:D.id});
  eq('normal creation has no causal history',(await readSourceToolDocument(scope,D.id))!.document.convergence,undefined);
  const untouched=await db.projects.get(projectId);await client.read();eq('new Source read does not create history',await db.projects.get(projectId),untouched);
  await client.convergence!.start(await client.read());
  const captured=await client.convergence!.richRange('body','opening',6,11);
  await client.state!.apply(captured.snapshot,[{type:'rich-annotation',field:'body',nodeId:'opening',range:captured.range,attrs:{clueKey:'<script>north-door</script>',state:'hint'}}]);
  const base=(await readSourceToolDocument(scope,D.id))!.document,baseExport=await client.convergence!.export();eq('normal annotation-only room has no media',collectRoomImageAssets(baseExport.update!),[]);
  const native=sourceDocumentPreview(base,'es'),html=renderLocalToolPreview(native);eq('code-free fallback gives semantic label',native.fields[0].value.includes('story.clue')&&native.fields[0].value.includes('north-door'),true);eq('code-free fallback escapes attr text',html.includes('&lt;script&gt;')&&!html.includes('<script>'),true);
  const readonly=createLocalToolClient(projectId,definition,{documentId:D.id,readOnly:true}),beforeRead=await db.projects.get(projectId);await readonly.read();await readonly.convergence!.export();await readonly.convergence!.richRange('body','opening',6,11);eq('readonly reads do not write',await db.projects.get(projectId),beforeRead);
  await rejects('readonly annotation rejected',()=>readonly.state!.apply(captured.snapshot,[{type:'rich-annotation',field:'body',nodeId:'opening',range:captured.range,attrs:null}]));eq('readonly refusal exact',await db.projects.get(projectId),beforeRead);
  await saveWorldEra(projectId,{id:'past',name:'Own past',description:'Own era',revision:0,createdAt:1,updatedAt:1},null);
  const era=createLocalToolClient(projectId,definition,{documentId:D.id,eraId:'past'});await era.convergence!.start(await era.read());const eraCaptured=await era.convergence!.richRange('body','opening',6,11);
  const changed=await era.state!.apply(eraCaptured.snapshot,[{type:'rich-annotation',field:'body',nodeId:'opening',range:eraCaptured.range,attrs:{clueKey:'past-door',state:'revealed'}}]);
  const eraData=(await era.read()).data,eraDocument=(await readSourceToolDocument({projectId,eraId:'past'},D.id))!.document;
  eq('era annotation differs from base',annotationCanonical(eraData)!==annotationCanonical(base.data),true);eq('era write leaves Base bytes exact',(await readSourceToolDocument(scope,D.id))!.document,base);
  await era.state!.undo(changed.receiptId!);eq('era Undo restores inherited semantics',(await era.read()).data,base.data);const eraCurrent=await era.convergence!.richRange('body','opening',6,11);await era.state!.apply(eraCurrent.snapshot,[{type:'rich-annotation',field:'body',nodeId:'opening',range:eraCurrent.range,attrs:{clueKey:'past-door',state:'revealed'}}]);
  const verifyCopy=async(id:string,label:string)=>{const project=(await db.projects.get(id))!,document=project.sourceToolDocuments!.find(row=>row.namespace===namespace)!;eq(label+' codec descriptor exact',document.codec,base.codec);eq(label+' data opaque clueKey exact',document.data,base.data);eq(label+' distinct causal lineage',document.convergence!.checkpoint.genesisId!==base.convergence!.checkpoint.genesisId,true);const v=(await db.worldEraVariants.where('projectId').equals(id).toArray()).find(row=>row.kind==='local-tool')!;eq(label+' era source preserved',v.document?.root.data,eraData);const checkpoint=document.convergence!.checkpoint;const reader=createLocalToolReplica(checkpoint,{authorId:label+'-reader',contract:{namespace,codec:definition.codec!,validationId:checkpoint.validationId,schemaEpoch:checkpoint.schemaEpoch,validateState:definition.validateState}});try{eq(label+' independent restored reader',reader.read(),base.data);}finally{reader.destroy();}};
  const json=await importProjectData(await exportProjectData(projectId));copies.push(json);await verifyCopy(json,'JSON');
  const preview=await previewProjectDuplicate({projectId}),duplicated=await duplicateProject({projectId,title:'Own duplicate',operationId:duplicateOperation,expectedSourceVersion:preview.sourceVersion});copies.push(duplicated.projectId);await verifyCopy(duplicated.projectId,'Duplicate');
  const zip=await createProjectZipArchive(projectId),beforeZip=await db.projects.get(projectId),variants=await db.worldEraVariants.where('projectId').equals(projectId).toArray();const modify=await client.convergence!.richRange('body','opening',6,11);await client.state!.apply(modify.snapshot,[{type:'rich-annotation',field:'body',nodeId:'opening',range:modify.range,attrs:null}]);await importProjectZip(new File([zip.blob],zip.fileName),{replaceProjectIds:[projectId]});eq('same-ID ZIP exact all Source rows',(await db.projects.get(projectId))!.sourceToolDocuments,beforeZip!.sourceToolDocuments);eq('same-ID ZIP exact era rows',await db.worldEraVariants.where('projectId').equals(projectId).toArray(),variants);eq('same-ID ZIP checkpoint exact',(await client.convergence!.export()).checkpoint,baseExport.checkpoint);
  const full=await createFullZipArchive();await db.projects.update(projectId,{sourceToolDocuments:[]});await importFullZip(new File([full.blob],full.fileName));eq('Full ZIP exact Source rows',(await db.projects.get(projectId))!.sourceToolDocuments,beforeZip!.sourceToolDocuments);eq('Full ZIP exact era rows',await db.worldEraVariants.where('projectId').equals(projectId).toArray(),variants);
  db.close();await db.open();eq('cold real Source data',(await client.read()).data,base.data);eq('cold era data',(await era.read()).data,eraData);
  const legacyNamespace='qa.inline.portable-legacy',legacy=defineLocalTool({namespace:legacyNamespace,name:{en:'Own legacy',es:'Legado propio'},description:{en:'Own legacy',es:'Legado propio'},initialState:definition.initialState,document:{defaultTitle:{en:'Legacy',es:'Legado'}},codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/2'}}},validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v),component:()=>null});
  registerLocalToolModules({'./installed/qa.inline.portable-legacy/module.tsx':{default:legacy}});const old=await createSourceToolDocument(scope,legacyNamespace,'Legacy'),upgraded=defineLocalTool({...legacy,codec:definition.codec,stateSchemaVersion:'new-inline'}),oldRaw=await db.projects.get(projectId),newClient=createLocalToolClient(projectId,upgraded,{documentId:old.id});
  await rejects('legacy cannot implicitly start inline16',async()=>newClient.convergence!.start(await newClient.read()));eq('legacy refusal creates no history or partial write',await db.projects.get(projectId),oldRaw);
  const legacyClient=createLocalToolClient(projectId,legacy,{documentId:old.id});await legacyClient.convergence!.start(await legacyClient.read());const established=await db.projects.get(projectId);await rejects('established legacy cannot implicitly reset into16',async()=>newClient.convergence!.start(await newClient.read()));eq('established legacy causal bytes exact',await db.projects.get(projectId),established);
  eq('original era codec retained',eraDocument.codec,base.codec);
 }finally{for(const id of copies)if(await db.projects.get(id))await deleteProject(id);if(await db.projects.get(projectId))await deleteProject(projectId);await db.settings.delete('projectDuplicate.operation.'+duplicateOperation);eq('private DB fully cleaned',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);}
 return checks;
}
