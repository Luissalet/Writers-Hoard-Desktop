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
import {validateRichBlockDocument} from '@/engines/local/convergence/blockFormat';
import {validateLocalToolCodecState,type LocalToolFieldCodec,type LocalToolStateCodec} from '@/engines/local/stateCodec';
import {localToolSemanticPreview} from '@/engines/local/previewTypes';

/** An absent optional field stays empty; present invalid data never becomes an empty preview. */
export async function testInlineAnnotationOptionalPreview(){
 const projectId='own-inline-optional-'+crypto.randomUUID(),checks:string[]=[];
 const eq=(name:string,a:unknown,b:unknown)=>{if(annotationCanonical(a)!==annotationCanonical(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);};
 const rejects=async(name:string,run:()=>unknown|Promise<unknown>)=>{let refused=false;try{await run();}catch{refused=true;}eq(name,refused,true);};
 const annotationCodec:LocalToolStateCodec={version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/3',annotation:{id:'own.optional',version:1,attributes:{key:{type:'string'}}}}}},legacyCodec:LocalToolStateCodec={version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/2'}}};
 const preview={version:1 as const,fields:[{key:'body',label:{en:'Body',es:'Cuerpo'}}]};
 const tool=(namespace:string,codec:LocalToolStateCodec,initialState:Record<string,LocalToolJson>)=>defineLocalTool({...definition,namespace,codec,initialState,preview,validateState:(value:LocalToolJson):value is Record<string,LocalToolJson>=>{try{validateLocalToolCodecState(value,codec);return !!value&&typeof value==='object'&&!Array.isArray(value);}catch{return false;}},component:()=>null});
 const old=tool('qa.inline.optional-legacy',legacyCodec,{}),empty=tool('qa.inline.optional-empty',annotationCodec,{}),present=tool('qa.inline.optional-present',annotationCodec,{body:{type:'doc',content:[{id:'P',type:'paragraph',content:[{type:'text',text:'Own clue',marks:[{type:'annotation',attrs:{key:'own-key'}}]}]}]}});
 try{
  eq('optional preview private library initially empty',await db.projects.count(),0);
  registerLocalToolModules({'./installed/qa.inline.optional-legacy/module.tsx':{default:old},'./installed/qa.inline.optional-empty/module.tsx':{default:empty},'./installed/qa.inline.optional-present/module.tsx':{default:present}});
  await db.projects.add({id:projectId,title:'Own optional preview',description:'Synthetic only',mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:[old,empty,present].map(d=>'local-tool-'+d.namespace),createdAt:1,updatedAt:1});
  const legacyDocument=await createSourceToolDocument({projectId},old.namespace,'Legacy optional');eq('normal legacy absent field previews empty',sourceDocumentPreview(legacyDocument).fields,[{label:'Body',value:''}]);
  const emptyDocument=await createSourceToolDocument({projectId},empty.namespace,'Initially absent'),emptyClient=createLocalToolClient(projectId,empty,{documentId:emptyDocument.id}),before=await db.projects.get(projectId);eq('normal annotation creator and read preserve absence',(await emptyClient.read()).data,{});eq('normal initial absent annotation previews empty',sourceDocumentPreview(emptyDocument).fields,[{label:'Body',value:''}]);eq('absent preview leaves Source exact',await db.projects.get(projectId),before);
  const presentDocument=await createSourceToolDocument({projectId},present.namespace,'Present then unset'),client=createLocalToolClient(projectId,present,{documentId:presentDocument.id});await client.convergence!.start(await client.read());const original=(await client.read()).data,unset=await client.state!.apply(await client.read(),[{type:'unset',field:'body'}]),stored=(await readSourceToolDocument({projectId},presentDocument.id))!.document,afterUnset=await db.projects.get(projectId);eq('normal unset preserves valid absence',(await client.read()).data,{});eq('unset checkpoint remains valid',(await client.convergence!.export()).pending,false);eq('normal unset annotation previews empty',sourceDocumentPreview(stored).fields,[{label:'Body',value:''}]);eq('unset preview leaves Source exact',await db.projects.get(projectId),afterUnset);
  const undone=await client.state!.undo(unset.receiptId!);eq('Undo unset restores exact semantic body',(await client.read()).data,original);await client.state!.redo(undone.receiptId!);eq('Redo unset restores absence',(await client.read()).data,{});
  for(const bad of [null,{},'bad',{type:'doc',content:[{id:'P',type:'paragraph',content:[{type:'text',text:'Bad',marks:[{type:'annotation',attrs:{key:12}}]}]}]},{type:'doc',content:[{id:'P',type:'paragraph',content:[{type:'text',text:'Bad',marks:[{type:'annotation',attrs:{key:'ok',extra:true}}]}]}]}]){
   await rejects('present invalid annotation still rejects preview',()=>localToolSemanticPreview('Invalid',{body:bad},preview,'en',annotationCodec));const exact=await db.projects.get(projectId);await rejects('present invalid annotation still rejects normal set',async()=>client.state!.apply(await client.read(),[{type:'set',field:'body',value:bad}]));eq('invalid present value leaves Source exact',await db.projects.get(projectId),exact);
  }
 }finally{if(await db.projects.get(projectId))await deleteProject(projectId);eq('optional preview all private tables empty',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);}
 return checks;
}

/** Optional capability metadata remains valid at every pre-existing block profile level. */
export async function testInlineAnnotationProfileMatrix(){
 const controls:LocalToolFieldCodec[]=[
  {kind:'rich',profile:'paragraphs-inline/1'},{kind:'rich',profile:'paragraphs-inline/2'},
  {kind:'rich',profile:'blocks-tree/1',schema:'writers-blocks/1'},{kind:'rich',profile:'blocks-tree/2',schema:'writers-blocks/1'},
  {kind:'rich',profile:'blocks-tree/3',schema:'writers-blocks/2'},{kind:'rich',profile:'blocks-tree/4',schema:'writers-blocks/3'},
  {kind:'rich',profile:'blocks-tree/5',schema:'writers-blocks/4'},{kind:'rich',profile:'blocks-tree/6',schema:'writers-blocks/5'},
  {kind:'rich',profile:'blocks-tree/7',schema:'writers-blocks/6'},{kind:'rich',profile:'blocks-tree/8',schema:'writers-blocks/7'},
  {kind:'rich',profile:'blocks-tree/9',schema:'writers-blocks/8'},{kind:'rich',profile:'blocks-tree/10',schema:'writers-blocks/9'},
  {kind:'rich',profile:'blocks-tree/11',schema:'writers-blocks/10'},{kind:'rich',profile:'blocks-tree/12',schema:'writers-blocks/11'},
 ],checks:string[]=[];
 for(const[index,control]of controls.entries()){
  const namespace='qa.inline.matrix'+index,projectId='own-inline-matrix-'+crypto.randomUUID(),mixed=defineLocalTool({...definition,namespace,codec:{version:2,fields:{...definition.codec!.fields,control}}});
  try{
   registerLocalToolModules({['./installed/'+namespace+'/module.tsx']:{default:mixed}});await db.projects.add({id:projectId,title:'Own matrix',description:'Synthetic only',mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+namespace],createdAt:1,updatedAt:1});
   const D=await createSourceToolDocument({projectId},namespace,'Own matrix'),client=createLocalToolClient(projectId,mixed,{documentId:D.id}),c=client.convergence!;await c.start(await client.read());
   const captured=await c.richRange('body','opening',0,5);await client.state!.apply(captured.snapshot,[{type:'rich-annotation',field:'body',nodeId:'opening',range:captured.range,attrs:{clueKey:'matrix',state:'hint'}}]);
   const saved=await c.export();if(saved.pending||Object.hasOwn(saved.snapshot.data,'control'))throw Error('Declared absent field changed or lost supported metadata '+index);
   const reader=createLocalToolReplica(saved.checkpoint!,{authorId:'matrix-reader',contract:{namespace,codec:mixed.codec!,validationId:saved.checkpoint!.validationId,schemaEpoch:saved.checkpoint!.schemaEpoch,validateState:mixed.validateState}});try{if(annotationCanonical(reader.read())!==annotationCanonical(saved.snapshot.data))throw Error('Profile matrix snapshot mismatch '+index);}finally{reader.destroy();}
   checks.push('normal mixed16 with absent '+control.kind+'/'+('profile'in control?control.profile:'')+' retains policy and snapshot');
  }finally{if(await db.projects.get(projectId))await deleteProject(projectId);}
 }
 if(!(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0))throw Error('Profile matrix left private data');checks.push('Profile matrix private DB empty');return checks;
}

export async function testInlineAnnotationManifest(){
 const range=LOCAL_TOOL_TOOLS.find(tool=>tool.name==='wh_local_tool_rich_range'),apply=LOCAL_TOOL_TOOLS.find(tool=>tool.name==='wh_local_tool_state_apply');if(!range||!apply)throw Error('Shipping MCP tool absent');
 const schema=JSON.parse(JSON.stringify(apply.schema)),actions=schema.properties.actions.items.oneOf.filter((action:{properties:{type:{const:string}}})=>['rich-annotation','rich-text-splice','rich-insert-paragraph'].includes(action.properties.type.const));if(actions.length!==3||!JSON.stringify(range.schema).includes('paragraphs-inline/1 or /2, or /3'))throw Error('Shipping MCP declaration incomplete');
 return['MCP_SCHEMA '+JSON.stringify({range,apply:{name:apply.name,description:apply.description,actions}})];
}

export async function testInlineAnnotationMixed(){
 const projectId='own-inline-mixed-'+crypto.randomUUID(),namespace='qa.inline.mixed',checks:string[]=[];
 const eq=(name:string,a:unknown,b:unknown)=>{if(annotationCanonical(a)!==annotationCanonical(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);};
 const mixed=defineLocalTool({...definition,namespace,initialState:{...definition.initialState,plain:'abΩ',outline:{type:'block-doc',schema:'writers-blocks/11',blocks:[],axisOrder:[]}},codec:{version:2,fields:{...definition.codec!.fields,plain:{kind:'prose',collaboration:'plain-utf16/1'},outline:{kind:'rich',profile:'blocks-tree/12',schema:'writers-blocks/11'},emptyOutline:{kind:'rich',profile:'blocks-tree/12',schema:'writers-blocks/11'}}}});
 try{
  registerLocalToolModules({'./installed/qa.inline.mixed/module.tsx':{default:mixed}});await db.projects.add({id:projectId,title:'Own mixed',description:'Synthetic only',mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+namespace],createdAt:1,updatedAt:1});
  const D=await createSourceToolDocument({projectId},namespace,'Own mixed'),client=createLocalToolClient(projectId,mixed,{documentId:D.id}),c=client.convergence!;
  eq('normal mixed starts engine16',(await c.start(await client.read())).checkpoint.engine.version,'16');
  const plain=await c.textRange('plain',1,2),plainChanged=await client.state!.apply(plain.snapshot,[{type:'text-splice',field:'plain',range:plain.range,text:'X'}]);eq('mixed16 declared plain API remains available',(await client.read()).data.plain,'aXΩ');await client.state!.undo(plainChanged.receiptId!);eq('mixed16 plain Undo exact',(await client.read()).data.plain,'abΩ');
  const range=await c.richRange('body','opening',0,5);await client.state!.apply(range.snapshot,[{type:'rich-annotation',field:'body',nodeId:'opening',range:range.range,attrs:{clueKey:'mixed',state:'hint'}}]);
  const originalBody=(await client.read()).data.body,split=await c.richSplitCapture('body','opening',3);await client.state!.apply(split.snapshot,[{type:'rich-split',field:'body',capture:split.capture,newNodeId:'split-Q'}]);const moved=await client.state!.apply(await client.read(),[{type:'rich-move-paragraph',field:'body',id:'split-Q',afterId:null}]);await client.state!.undo(moved.receiptId!);const join=await c.richJoinCapture('body','opening','split-Q');await client.state!.apply(join.snapshot,[{type:'rich-join',field:'body',capture:join.capture}]);eq('mixed16 split move Undo join retain annotation',(await client.read()).data.body,originalBody);
  const outline=async()=>{const data=(await client.read()).data.outline;validateRichBlockDocument(data,true,true,true,true,true,true,true,true,true,true,true);return data;};
  const place=await c.richBlockEditCapture('outline',[],{parentId:null,slot:'body',afterId:null});await client.state!.apply(place.snapshot,[{type:'rich-table-create',field:'outline',capture:place.capture,table:{id:'T',rows:[{id:'R',header:false},{id:'R2',header:false}],columns:[{id:'C'},{id:'C2'}]}}]);
  const axis=await c.richTableAxisCapture('outline','T','rows','R2'),axisAdded=await client.state!.apply(axis.snapshot,[{type:'rich-table-axis-insert',field:'outline',capture:axis.capture,id:'R3',header:false}]);eq('mixed16 axis insertion available',(await outline()).blocks.some(b=>b.id==='R3'),true);await client.state!.undo(axisAdded.receiptId!);eq('mixed16 axis Undo exact',(await outline()).blocks.some(b=>b.id==='R3'),false);
  const width=await c.richTableColumnWidthCapture('outline','T','C2');await client.state!.apply(width.snapshot,[{type:'rich-table-column-width',field:'outline',capture:width.capture,widthPx:233}]);eq('mixed16 column width available',(await outline()).blocks.find(b=>b.id==='C2')?.attrs.widthPx,233);
  const height=await c.richBlockEditCapture('outline',['R']);await client.state!.apply(height.snapshot,[{type:'rich-table-row-height',field:'outline',capture:height.capture,heightPx:79}]);const header=await c.richBlockEditCapture('outline',['R']);await client.state!.apply(header.snapshot,[{type:'rich-table-row-header',field:'outline',capture:header.capture,header:true}]);eq('mixed16 row height and header available',(await outline()).blocks.find(b=>b.id==='R')?.attrs,{header:true,heightPx:79});
  const paste=await c.richBlockEditCapture('outline',['T']);await client.state!.apply(paste.snapshot,[{type:'rich-table-paste',field:'outline',capture:paste.capture,target:{rows:['R','R2'],columns:['C','C2'],anchor:['R2','C'],head:['R2','C2']},matrix:[[{header:true,paragraphs:[[{type:'text',text:'merged'}]],span:{rows:1,columns:2}},null]]}]);eq('mixed16 cell span available',(await outline()).blocks.some(b=>b.type==='table-cell-span'),true);eq('mixed16 cell header available',(await outline()).blocks.some(b=>b.type==='table-cell-style'&&b.attrs.header===true),true);
  const imported=await runBridgeTool('wh_local_asset_file_import',{projectId,namespace,documentId:D.id,file:{name:'own.png',kind:'image',mime:'image/png',base64:testImageBase64}});if(!imported.ok)throw Error(JSON.stringify(imported));
  const asset={sha256:imported.result.sha256,mime:'image/png' as const,size:imported.result.size};
  const cell=await c.richTableCellCapture('outline','T','R','C');await client.state!.apply(cell.snapshot,[{type:'rich-table-cell-image-insert',field:'outline',capture:cell.capture,id:'I',fragmentId:'F',asset}]);
  const size=await c.richImageCapture('outline','I','size');await client.state!.apply(size.snapshot,[{type:'rich-image-resize',field:'outline',capture:size.capture,displaySize:'full'}]);const alignment=await c.richImageCapture('outline','I','alignment');await client.state!.apply(alignment.snapshot,[{type:'rich-image-align',field:'outline',capture:alignment.capture,alignment:'center'}]);eq('mixed16 image size and alignment available',(await outline()).blocks.find(b=>b.id==='I')?.attrs,{asset,displaySize:'full',alignment:'center'});
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
