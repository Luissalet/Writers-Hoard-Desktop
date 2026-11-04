import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {assetBase64} from '@/engines/local/assetFileFormat';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import definition from '@/engines/local/installed/examples.shared-images/module';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createLocalToolClient} from '@/engines/local/storage';
import {convergenceCanonical} from '@/engines/local/convergence/format';
import type {RichBlockDocument} from '@/engines/local/convergence/blockFormat';

export async function testSourceFigures(){
 const projectId='own-figures-'+crypto.randomUUID(),namespace=definition.namespace,field='body',nodeId='own-figure',checks:string[]=[];
 const equal=(label:string,a:unknown,b:unknown)=>{if(convergenceCanonical(a)!==convergenceCanonical(b))throw Error(`${label}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);checks.push(label);};
 const png=async()=>{const canvas=document.createElement('canvas');canvas.width=96;canvas.height=48;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#2b8fd4';ctx.fillRect(0,0,96,48);ctx.fillStyle='#fff';ctx.fillRect(8,8,40,16);const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('PNG encode'))));return assetBase64(new Uint8Array(await blob.arrayBuffer()));};
 try{
  registerLocalToolModules({'./installed/examples.shared-images/module.tsx':{default:definition}});
  await db.projects.add({id:projectId,title:projectId,description:projectId,mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+namespace],createdAt:1,updatedAt:1});
  const documentId=(await createSourceToolDocument({projectId},namespace,'Own figures')).id,scope={projectId,namespace,documentId};
  const client=createLocalToolClient(projectId,definition,{documentId}),convergence=client.convergence!;
  await convergence.start(await client.read());
  const figure={format:'vitruvius.figure/1',document_id:'0123456789ab',revision:3,title:'Pump',page_id:'p2',state_id:null,
   content:{diagram:{type:'flow',nodes:[{id:'a',label:'A'},{id:'b',label:'B'}],future:{kept:true}},view:{pages:[{id:'p1'},{id:'p2'}]}},
   origin:{vitruvius:'http://127.0.0.1:5191/d/0123456789ab'},preview:{mime:'image/png',data:await png()}};
  const text=JSON.stringify(figure);
  const files=async()=>(await db.localToolAssetFiles.where('projectId').equals(projectId).toArray()).length;
  const bad=await runBridgeTool('wh_local_figure_import',{...scope,figure:{...figure,preview:{mime:'image/png',data:figure.preview.data.slice(0,-40)+'AAAA'.repeat(10)}}});
  equal('damaged capture rejected without files',[bad.ok,await files()],[false,0]);
  const wrong=await runBridgeTool('wh_local_figure_import',{...scope,figure:{...figure,revision:0}});
  equal('invalid revision rejected without files',[wrong.ok,await files()],[false,0]);
  const imported=await runBridgeTool('wh_local_figure_import',{...scope,figure:text});
  if(!imported.ok)throw Error(JSON.stringify(imported));
  const result=imported.result as {asset:{sha256:string;mime:string;size:number};revision:number;pageId:string|null;stateId:string|null;width:number;height:number};
  equal('descriptor keeps revision, page and PNG size',[result.revision,result.pageId,result.stateId,result.width,result.height],[3,'p2',null,96,48]);
  equal('PNG and source are two project files',await files(),2);
  const repeat=await runBridgeTool('wh_local_figure_import',{...scope,figure});
  equal('repeat import is idempotent',[repeat.ok,await files()],[true,2]);
  const insertion=await convergence.richBlockEditCapture(field,[],{parentId:null,slot:'body',afterId:'P'});
  const insert=await runBridgeTool('wh_local_tool_state_apply',{...scope,baseline:insertion.snapshot,actions:[{type:'rich-image-insert',field,capture:insertion.capture,id:nodeId,asset:result.asset}]});
  equal('figure image inserts through the normal action',insert.ok,true);
  const attrs=((await client.read()).data as unknown as {body:RichBlockDocument}).body.blocks.find(block=>block.id===nodeId)?.attrs;
  equal('document carries only the image descriptor',attrs,{asset:result.asset,displaySize:'medium'});
  const source=await runBridgeTool('wh_local_figure_source',{...scope,asset:result.asset});
  equal('retained source is the exact figure text',source.ok&&source.result,{available:true,source:text});
  const plain=await runBridgeTool('wh_local_figure_source',{...scope,asset:{sha256:'0'.repeat(64)}});
  equal('ordinary image has no source',plain.ok&&plain.result,{available:false});
  const newer=JSON.stringify({...figure,revision:4});
  const update=await runBridgeTool('wh_local_figure_import',{...scope,figure:newer});
  equal('same capture with a newer revision imports',update.ok&&(update.result as {revision:number}).revision,4);
  const latest=await runBridgeTool('wh_local_figure_source',{...scope,asset:result.asset});
  equal('update figure returns the newest source for the same capture',latest.ok&&latest.result,{available:true,source:newer});
  const saved=await convergence.export(),zip=await createProjectZipArchive(projectId);
  await importProjectZip(new File([zip.blob],'figures.zip'),{replaceProjectIds:[projectId]});db.close();await db.open();
  equal('cold ZIP keeps checkpoint',(await convergence.export()).checkpoint,saved.checkpoint);
  const cold=await runBridgeTool('wh_local_figure_source',{...scope,asset:result.asset});
  equal('cold ZIP keeps the figure source',cold.ok&&cold.result,{available:true,source:newer});
  return checks;
 }finally{await deleteProject(projectId);}
}
