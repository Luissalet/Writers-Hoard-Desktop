import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import definition from '@/engines/local/installed/examples.table-images/module';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createLocalToolClient} from '@/engines/local/storage';
import {convergenceCanonical} from '@/engines/local/convergence/format';
import type {RichBlockDocument} from '@/engines/local/convergence/blockFormat';
import type {RichBlockEditCapture} from '@/engines/local/convergence/blockEditingTypes';
import type {LocalToolJson,LocalToolSnapshot} from '@/engines/local/sdk';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {rasterFixtures} from './local-tool-image-formats.fixture';

function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}

export async function testSourceTableHeader(){
 const projectId='own-table-header-'+crypto.randomUUID(),field='body',checks:string[]=[];
 const equal=(label:string,actual:unknown,expected:unknown)=>{assert(convergenceCanonical(actual)===convergenceCanonical(expected),label);checks.push(label);};
 const body=(data:unknown)=>(data as {body:RichBlockDocument}).body;
 const table={id:'T',rows:[{id:'R1',header:true},{id:'R2',header:false}],columns:[{id:'C1'},{id:'C2'}]};
 try {
  registerLocalToolModules({'./installed/examples.table-images/module.tsx':{default:definition}});
  await db.projects.add({id:projectId,title:'Own header table',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+definition.namespace],createdAt:1,updatedAt:1});
  const documentId=(await createSourceToolDocument({projectId},definition.namespace,'Own header')).id;
  const scope={projectId,namespace:definition.namespace,documentId},client=createLocalToolClient(projectId,definition,{documentId}),convergence=client.convergence!;
  const {checkpoint}=await convergence.start(await client.read());
  const place=await convergence.richBlockEditCapture(field,[],{parentId:null,slot:'body',afterId:'P'});
  await client.state!.apply(place.snapshot,[{type:'rich-table-create',field,capture:place.capture,table}]);
  const {name,mime,base64}=rasterFixtures[1],bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
  const local=await client.assets.import(new File([bytes],name,{type:mime}),'image');
  const asset={sha256:local.sha256,mime,size:local.size};
  const cell=await convergence.richTableCellCapture(field,'T','R1','C1');
  await client.state!.apply(cell.snapshot,[{type:'rich-table-cell-image-insert',field,capture:cell.capture,fragmentId:'F',id:'I',asset}]);
  const before=await convergence.export();
  const reply=await runBridgeTool('wh_local_tool_rich_block_edit_capture',{...scope,field,nodeIds:['R1']});
  assert(reply.ok,JSON.stringify(reply));
  const witness=reply.result as {capture:RichBlockEditCapture;snapshot:LocalToolSnapshot<LocalToolJson>};
  equal('MCP and SDK return the exact same row capture',witness,await convergence.richBlockEditCapture(field,['R1']));
  equal('Capturing the row preserves the document',await convergence.export(),before);
  const send=(capture:RichBlockEditCapture,baseline:LocalToolSnapshot<LocalToolJson>,header:boolean)=>runBridgeTool('wh_local_tool_state_apply',{...scope,baseline,actions:[{type:'rich-table-row-header',field,capture,header}]});
  const changed=await send(witness.capture,witness.snapshot,false);
  assert(changed.ok&&changed.result.receiptId,JSON.stringify(changed));
  const current=await convergence.export();
  const previous=body(before.snapshot.data);
  equal('The registered action changes only header on the witnessed row',body(current.snapshot.data),{...previous,blocks:previous.blocks.map(b=>b.id==='R1'?{...b,attrs:{header:false}}:b)});
  equal('The existing engine and genesis are retained',[current.checkpoint.engine,current.checkpoint.genesisId],[checkpoint.engine,checkpoint.genesisId]);
  equal('A stale row capture rejects with the current document revision',(await send(witness.capture,current.snapshot,true)).ok,false);
  equal('The stale action leaves the export exact',await convergence.export(),current);
  const zip=await createProjectZipArchive(projectId);
  await importProjectZip(new File([zip.blob],'table-header.zip',{type:'application/zip'}),{replaceProjectIds:[projectId]});
  db.close();await db.open();
  equal('The ZIP retains header, image and history',(await convergence.export()).checkpoint,current.checkpoint);
  const reopened=body((await client.read()).data);
  equal('Cold row and nested image retain their IDs and exact attributes',[reopened.blocks.find(b=>b.id==='R1')?.attrs,reopened.blocks.find(b=>b.id==='I')?.attrs],[{header:false},{asset,displaySize:'medium',alignment:'left'}]);
  const saved=await client.assets.resolveImage(asset);
  assert(saved,'The ZIP lost the original image');
  equal('The original image bytes remain available',Array.from(new Uint8Array(await saved.blob.arrayBuffer())),Array.from(bytes));
  return checks;
 } finally {
  await deleteProject(projectId);
 }
}
