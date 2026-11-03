import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import definition from '@/engines/local/installed/examples.shared-table-width/module';
import legacy from '@/engines/local/installed/examples.shared-table-axes/module';
import {createSourceToolDocument,readSourceToolDocument} from '@/engines/local/documents/store';
import {remapSourceToolDocument} from '@/engines/local/documents/portability';
import {createLocalToolClient} from '@/engines/local/storage';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createLocalToolReplica,exportLocalToolConvergenceCheckpoint} from '@/engines/local/convergence/replica';
import {convergenceCanonical} from '@/engines/local/convergence/format';
import type {RichBlockDocument} from '@/engines/local/convergence/blockFormat';
import type {RichTableColumnWidthCapture} from '@/engines/local/convergence/tableAxesEditing';
import type {LocalToolSnapshot,LocalToolJson} from '@/engines/local/sdk';

export async function testSourceTableWidths(){
 const projectId='own-width-source-'+crypto.randomUUID(),checks:string[]=[];
 const equal=(label:string,a:unknown,b:unknown)=>{if(convergenceCanonical(a)!==convergenceCanonical(b))throw Error(label);checks.push(label);Reflect.set(window,'__testStage',label);};
 const blockDoc=(data:LocalToolJson)=>(data as unknown as {body:RichBlockDocument}).body;
 const column=(data:LocalToolJson,id:string)=>blockDoc(data).blocks.find(block=>block.id===id)?.attrs;
 const empty=async()=>{const rows=await Promise.all(db.tables.map(table=>table.count()));return rows.length===89&&rows.every(count=>count===0);};
 try{
  equal('Source width private health89zero',await empty(),true);
  const namespace=definition.namespace,scope={projectId};
  registerLocalToolModules({'./installed/examples.shared-table-width/module.tsx':{default:definition},'./installed/examples.shared-table-axes/module.tsx':{default:legacy}});
  await db.projects.add({id:projectId,title:projectId,description:projectId,mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+namespace,'local-tool-'+legacy.namespace],createdAt:1,updatedAt:1});
  const documentId=(await createSourceToolDocument(scope,namespace,'Own width')).id,args={...scope,namespace,documentId};
  const client=createLocalToolClient(projectId,definition,{documentId});
  equal('explicit Source start engine7',(await client.convergence!.start(await client.read())).checkpoint.engine.version,'7');
  const created=await client.convergence!.richBlockEditCapture('body',[],{parentId:null,slot:'body',afterId:'P'});
  await client.state!.apply(created.snapshot,[{type:'rich-table-create',field:'body',capture:created.capture,table:{id:'T',rows:[{id:'R',header:false}],columns:[{id:'C1'},{id:'C2'}]}}]);
  const capture=()=>runBridgeTool('wh_local_tool_rich_table_column_width_capture',{...args,field:'body',tableId:'T',columnId:'C2'});
  const before=await db.projects.get(projectId),captured=await capture();
  equal('normal dispatcher width capture exists',captured.ok,true);
  equal('capture does not modify persisted Source',await db.projects.get(projectId),before);
  const {capture:width,snapshot}=captured.result as {capture:RichTableColumnWidthCapture;snapshot:LocalToolSnapshot<LocalToolJson>};
  const applied=await runBridgeTool('wh_local_tool_state_apply',{...args,baseline:snapshot,actions:[{type:'rich-table-column-width',field:'body',capture:width,widthPx:233}]});
  equal('normal dispatcher width apply persists',applied.ok,true);
  const receipt=(applied.result as {receiptId:string}).receiptId;
  equal('width only changes its column',[column((await client.read()).data,'C1'),column((await client.read()).data,'C2')],[{},{widthPx:233}]);
  const beforeReject=await client.convergence!.export();
  const invalid=await runBridgeTool('wh_local_tool_state_apply',{...args,baseline:beforeReject.snapshot,actions:[{type:'rich-table-column-width',field:'body',capture:width,widthPx:235}]});
  equal('stale capture fails through dispatcher',invalid.ok,false);
  equal('stale capture leaves checkpoint and snapshot exact',await client.convergence!.export(),beforeReject);
  equal('dispatcher Undo consumes the real receipt',(await runBridgeTool('wh_local_tool_state_undo',{...args,receiptId:receipt})).ok,true);
  equal('dispatcher Undo restores Auto',column((await client.read()).data,'C2'),{});

  const final=await client.convergence!.richTableColumnWidthCapture('body','T','C2');
  await client.state!.apply(final.snapshot,[{type:'rich-table-column-width',field:'body',capture:final.capture,widthPx:248}]);
  const saved=(await readSourceToolDocument(scope,documentId,namespace))!.document;
  const copied=remapSourceToolDocument(saved,(id,prefix)=>prefix+'-'+id),oldCheckpoint=saved.convergence!.checkpoint,copyCheckpoint=copied.convergence!.checkpoint;
  equal('semantic fork has a different genesis',copyCheckpoint.genesisId!==oldCheckpoint.genesisId,true);
  equal('semantic fork retains width, Auto and axes',copied.data,saved.data);
  equal('semantic fork exports complete',exportLocalToolConvergenceCheckpoint(copyCheckpoint).pending,false);
  const replica=createLocalToolReplica(copyCheckpoint,{authorId:'copy-reader',contract:{namespace,codec:definition.codec!,validationId:copyCheckpoint.validationId,schemaEpoch:copyCheckpoint.schemaEpoch,validateState:definition.validateState}});
  try{equal('fork data equals its independent replica',replica.read(),copied.data);}
  finally{replica.destroy();}
  const zip=await createProjectZipArchive(projectId),auto=await client.convergence!.richTableColumnWidthCapture('body','T','C2');
  await client.state!.apply(auto.snapshot,[{type:'rich-table-column-width',field:'body',capture:auto.capture,widthPx:null}]);
  await importProjectZip(new File([zip.blob],'own-width.zip',{type:'application/zip'}),{replaceProjectIds:[projectId]});
  db.close();await db.open();
  const restored=await client.convergence!.export();
  equal('same ID ZIP and cold preserve exact checkpoint',restored.checkpoint,oldCheckpoint);
  equal('same ID ZIP and cold preserve exact width projection',restored.snapshot.data,saved.data);

  const oldId=(await createSourceToolDocument(scope,legacy.namespace,'Own strict axes')).id,old=createLocalToolClient(projectId,legacy,{documentId:oldId});
  const oldStarted=await old.convergence!.start(await old.read());
  equal('old Source remains engine6',oldStarted.checkpoint.engine.version,'6');
  const mixed={...legacy,codec:{version:2 as const,fields:{...legacy.codec!.fields,extra:{kind:'rich' as const,profile:'blocks-tree/5' as const,schema:'writers-blocks/4' as const}}}};
  const wrong=createLocalToolClient(projectId,mixed,{documentId:oldId});
  let rejected=false;
  try{await wrong.convergence!.start(await old.read());}catch{rejected=true;}
  equal('absent new field does not upgrade old Source',rejected,true);
  equal('engine6 checkpoint after attempt is byte exact',(await old.convergence!.export()).checkpoint,oldStarted.checkpoint);
 }finally{
  if(await db.projects.get(projectId))await deleteProject(projectId);
  equal('Source width cleanup89zero',await empty(),true);
 }
 return checks;
}
