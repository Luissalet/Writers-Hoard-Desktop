import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {saveWorldEra} from '@/services/worldEras/store';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import definition from '@/engines/local/installed/examples.shared-table-axes/module';
import legacyDefinition from '@/engines/local/installed/examples.shared-tables/module';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {createLocalToolClient} from '@/engines/local/storage';
import {createLocalToolReplica} from '@/engines/local/convergence/replica';
import {registerLocalToolModules} from '@/engines/local/registry';
import {convergenceCanonical} from '@/engines/local/convergence/format';
import type {RichBlockDocument} from '@/engines/local/convergence/blockFormat';

/** Actual Source writer and normal dispatcher in an isolated renderer; no transport-key claim. */
export async function testSourceTableAxes(){
 const checks:string[]=[],projectId='own-source-axes-'+crypto.randomUUID(),namespace=definition.namespace;
 const eq=(name:string,a:unknown,b:unknown)=>{if(convergenceCanonical(a)!==convergenceCanonical(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);Reflect.set(window,'__testStage',name);};
 const reject=async(name:string,work:()=>Promise<unknown>)=>{let reason='';try{await work();}catch(error){reason=String(error);}eq(name,!!reason,true);};
 try{
  eq('health89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);
  registerLocalToolModules({'./installed/examples.shared-table-axes/module.tsx':{default:definition},'./installed/examples.shared-tables/module.tsx':{default:legacyDefinition}});
  await db.projects.add({id:projectId,title:projectId,description:projectId,mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+namespace,'local-tool-'+legacyDefinition.namespace],createdAt:1,updatedAt:1});
  const documentId=(await createSourceToolDocument({projectId},namespace,'Own Source axes')).id,args={projectId,namespace,documentId},base=createLocalToolClient(projectId,definition,{documentId}),start=await base.convergence!.start(await base.read());
  eq('real Source starts engine6',start.checkpoint.engine.version,'6');
  const table=await base.convergence!.richBlockEditCapture('body',[],{parentId:null,slot:'body',afterId:'P'});
  const created=await runBridgeTool('wh_local_tool_state_apply',{...args,baseline:table.snapshot,actions:[{type:'rich-table-create',field:'body',capture:table.capture,table:{id:'T',rows:[{id:'R1',header:false}],columns:[{id:'C1'}]}}]});eq('normal dispatcher creates table',created.ok,true);
  const cell=await base.convergence!.richTableCellCapture('body','T','R1','C1'),bridgeCell=await runBridgeTool('wh_local_tool_rich_table_cell_capture',{...args,field:'body',tableId:'T',rowId:'R1',columnId:'C1'});eq('normal readonly dispatcher captures logical cell',bridgeCell.ok,true);
  const text=await base.state!.apply(cell.snapshot,[{type:'rich-table-cell-insert',field:'body',capture:cell.capture,fragment:{id:'FA',paragraph:{id:'PA',text:'AΩ',marks:['bold'],link:{href:'https://example.test/axes'}}}}]);eq('first Source write owns receipt',typeof text.receiptId,'string');
  const prior=(await base.convergence!.export()).checkpoint!,peer=createLocalToolReplica(prior,{authorId:'B',contract:{namespace,codec:definition.codec!,validationId:prior.validationId,schemaEpoch:prior.schemaEpoch,validateState:definition.validateState}});
  const body=(snapshot:Awaited<ReturnType<typeof base.read>>)=>(snapshot.data as unknown as {body:RichBlockDocument}).body;
  try{
   const b=peer.apply([{type:'rich-table-axis-insert',field:'body',capture:peer.richTableAxisCapture('body','T','rows','R1'),id:'R2'}]);
   const old=await base.convergence!.richTableCellCapture('body','T','R1','C1'),row=await base.convergence!.richTableAxisCapture('body','T','rows','R1'),hidden=await base.state!.apply(row.snapshot,[{type:'rich-table-axis-hide',field:'body',capture:row.capture}]);eq('Source saves honest zero rows',body(hidden.snapshot).axisOrder![0].rows,[]);
   const before=await db.projects.get(projectId),axis=await runBridgeTool('wh_local_tool_rich_table_axis_capture',{...args,field:'body',tableId:'T',axis:'rows',afterId:'R1'});eq('readonly axis capture on active zero-row T',axis.ok,true);
   await reject('readonly cell capture needs both current axes',()=>base.convergence!.richTableCellCapture('body','T','R1','C1'));
   await reject('old Source placeholder cannot author under hidden axis',()=>base.state!.apply(old.snapshot,[{type:'rich-table-cell-insert',field:'body',capture:old.capture,fragment:{id:'FX',paragraph:{id:'PX',text:'BAD'}}}]));eq('captures and failed apply wrote no rows',await db.projects.get(projectId),before);
   const imported=await base.convergence!.import(b.update,{expectedLineage:hidden.snapshot.document!.lineage});eq('real B update survives last-row hide',body(imported.snapshot).axisOrder![0].rows,['R2']);eq('import complete without repair',imported.pending,false);
   await reject('Source has no Undo authority for B',()=>base.state!.undo(b.receiptId!));
   const restored=await base.state!.undo(hidden.receiptId!);eq('Source Undo returns only A row and keeps B row',body(restored.snapshot).axisOrder![0].rows,['R1','R2']);eq('original styled text restored',body(restored.snapshot).blocks.find(n=>n.id==='PA')?.content,body(text.snapshot).blocks.find(n=>n.id==='PA')?.content);
  }finally{peer.destroy();}
  const saved=await base.read(),checkpoint=(await base.convergence!.export()).checkpoint!,zip=await createProjectZipArchive(projectId),col=await base.convergence!.richTableAxisCapture('body','T','columns','C1');
  await base.state!.apply(col.snapshot,[{type:'rich-table-axis-hide',field:'body',capture:col.capture}]);await importProjectZip(new File([zip.blob],'own-axes.zip',{type:'application/zip'}),{replaceProjectIds:[projectId]});
  eq('same-ID ZIP restores exact axis checkpoint',(await base.convergence!.export()).checkpoint,checkpoint);eq('ZIP restores exact visible data',(await base.read()).data,saved.data);
  await saveWorldEra(projectId,{id:'E',name:'E',description:'Own era',revision:0,createdAt:1,updatedAt:1},null);
  const era=createLocalToolClient(projectId,definition,{documentId,eraId:'E'});eq('inherited era export is readonly same origin',(await era.convergence!.export()).checkpoint,checkpoint);eq('inherited read creates no variants',await db.worldEraVariants.where('projectId').equals(projectId).count(),0);
  const branch=await era.convergence!.start(await era.read());eq('explicit era fork retains axis data',branch.snapshot.data,saved.data);eq('explicit era fork has fresh origin',branch.checkpoint.genesisId!==checkpoint.genesisId,true);
  const eraAxis=await era.convergence!.richTableAxisCapture('body','T','columns','C1');await era.state!.apply(eraAxis.snapshot,[{type:'rich-table-axis-insert',field:'body',capture:eraAxis.capture,id:'CE'}]);
  await reject('era capture cannot retarget Base',()=>base.state!.apply(saved,[{type:'rich-table-axis-insert',field:'body',capture:eraAxis.capture,id:'BAD'}]));eq('era apply and stale capture keep Base checkpoint exact',(await base.convergence!.export()).checkpoint,checkpoint);
  let active=true;const leased=createLocalToolClient(projectId,definition,{documentId,isCurrent:()=>active}),lease=leased.convergence!.richTableAxisCapture('body','T','rows',null);active=false;await reject('retired lease cannot deliver axis capture',()=>lease);
  await db.projects.update(projectId,{worldEras:[]});await reject('removed era cannot capture axes',()=>era.convergence!.richTableAxisCapture('body','T','rows',null));
  const oldId=(await createSourceToolDocument({projectId},legacyDefinition.namespace,'Old fixed source')).id,old=createLocalToolClient(projectId,legacyDefinition,{documentId:oldId}),oldStart=await old.convergence!.start(await old.read());eq('old Source healthy5',oldStart.checkpoint.engine.version,'5');
  const changed={...legacyDefinition,codec:{version:2 as const,fields:{...legacyDefinition.codec!.fields,extra:{kind:'rich' as const,profile:'blocks-tree/4' as const,schema:'writers-blocks/3' as const}}}},next=createLocalToolClient(projectId,changed,{documentId:oldId});
  eq('new definition can export old untouched bytes',(await next.convergence!.export()).checkpoint,oldStart.checkpoint);const oldExact=await old.read();await reject('adding absent axes field does not reset old Source',()=>next.convergence!.start(oldExact));eq('old Source checkpoint remains exactly5',(await old.convergence!.export()).checkpoint,oldStart.checkpoint);
  db.close();await db.open();eq('cold Source axis data exact',(await base.read()).data,saved.data);eq('cold Source axis checkpoint exact',(await base.convergence!.export()).checkpoint,checkpoint);
 }finally{if(await db.projects.get(projectId))await deleteProject(projectId);eq('cleanup89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);}
 return checks;
}
