import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import cells from '@/engines/local/installed/examples.table-images/module';
import raster from '@/engines/local/installed/examples.image-formats/module';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createLocalToolClient} from '@/engines/local/storage';
import {convergenceCanonical} from '@/engines/local/convergence/format';
import {tableCellAddress} from '@/engines/local/convergence/tableAxesFormat';
import type {RichBlockDocument} from '@/engines/local/convergence/blockFormat';
import type {RichTableCellCapture} from '@/engines/local/convergence/tableAxesEditing';
import type {RichImageAsset} from '@/engines/local/convergence/imageFormat';
import type {LocalToolJson,LocalToolSnapshot} from '@/engines/local/sdk';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {rasterFixtures} from './local-tool-image-formats.fixture';

function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}

export async function testSourceImageCells(){
 const projectId='own-image-cells-'+crypto.randomUUID(),field='body',id='own-nested-image',fragmentId='own-image-fragment',checks:string[]=[];
 const equal=(label:string,actual:unknown,expected:unknown)=>{assert(convergenceCanonical(actual)===convergenceCanonical(expected),label);checks.push(label);};
 const table={id:'T',rows:[{id:'R',header:true},{id:'R2',header:false}],columns:[{id:'C'},{id:'C2'}]};
 const address=['T','R2','C'] as const,destination={parentId:null,slot:'body' as const,afterId:'P'};
 const body=(data:unknown)=>(data as {body:RichBlockDocument}).body;
 const action=(capture:RichTableCellCapture,asset:RichImageAsset)=>({type:'rich-table-cell-image-insert' as const,field,capture,id,fragmentId,asset});
 try {
  registerLocalToolModules({'./installed/examples.table-images/module.tsx':{default:cells},'./installed/examples.image-formats/module.tsx':{default:raster}});
  await db.projects.add({id:projectId,title:'Own nested image',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:[cells,raster].map(definition=>'local-tool-'+definition.namespace),createdAt:1,updatedAt:1});
  const documentId=(await createSourceToolDocument({projectId},cells.namespace,'Image inside a cell')).id;
  const scope={projectId,namespace:cells.namespace,documentId},client=createLocalToolClient(projectId,cells,{documentId}),convergence=client.convergence!;
  equal('Cell-image profile starts engine12',(await convergence.start(await client.read())).checkpoint.engine.version,'12');
  const place=await convergence.richBlockEditCapture(field,[],destination);
  await client.state!.apply(place.snapshot,[{type:'rich-table-create',field,capture:place.capture,table}]);
  const {name,mime,base64,sha256}=rasterFixtures[1];
  const unimported={sha256,mime,size:atob(base64).length};
  const baseline=await convergence.export();
  const capture=await runBridgeTool('wh_local_tool_rich_table_cell_capture',{...scope,field,tableId:address[0],rowId:address[1],columnId:address[2]});
  assert(capture.ok,JSON.stringify(capture));
  const witness=capture.result as {capture:RichTableCellCapture;snapshot:LocalToolSnapshot<LocalToolJson>};
  equal('MCP and SDK capture the same empty intersection',witness,await convergence.richTableCellCapture(field,...address));
  equal('The capture leaves the checkpoint exact',await convergence.export(),baseline);
  const send=(a:RichImageAsset)=>runBridgeTool('wh_local_tool_state_apply',{...scope,baseline:witness.snapshot,actions:[action(witness.capture,a)]});
  equal('MCP cannot insert unavailable bytes',(await send(unimported)).ok,false);
  equal('Missing asset leaves the checkpoint exact',await convergence.export(),baseline);
  const imported=await runBridgeTool('wh_local_asset_file_import',{...scope,file:{name,mime,base64,kind:'image'}});
  assert(imported.ok,JSON.stringify(imported));
  const asset={sha256:imported.result.sha256,mime,size:imported.result.size};
  equal('MCP retains the immutable descriptor',asset,unimported);
  const added=await send(asset);
  assert(added.ok&&added.result.receiptId,JSON.stringify(added));
  const document=body((await client.read()).data);
  equal('The image is in the requested cell',tableCellAddress(document,id),address);
  equal('The fragment carries one image without manufacturing text',document.blocks.filter(block=>block.parentId===fragmentId).map(block=>[block.id,block.type]),[[id,'image']]);
  const width=await convergence.richImageCapture(field,id,'size');
  await client.state!.apply(width.snapshot,[{type:'rich-image-resize',field,capture:width.capture,displaySize:'small'}]);
  const saved=await convergence.export();
  const zip=await createProjectZipArchive(projectId);
  await importProjectZip(new File([zip.blob],'cell-image.zip',{type:'application/zip'}),{replaceProjectIds:[projectId]});
  db.close();await db.open();
  equal('ZIP cold restore keeps the checkpoint',(await convergence.export()).checkpoint,saved.checkpoint);
  const reopened=body((await client.read()).data);
  equal('Cold image stays in its cell',tableCellAddress(reopened,id),address);
  equal('Cold image preserves size, alignment and descriptor',reopened.blocks.find(block=>block.id===id)?.attrs,{asset,displaySize:'small',alignment:'left'});
  const bytes=await runBridgeTool('wh_local_asset_image_find',{...scope,asset,includeContent:true});
  assert(bytes.ok,JSON.stringify(bytes));
  equal('Cold MCP resolves exact original bytes',bytes.result,{available:true,...asset,base64});

  const oldId=(await createSourceToolDocument({projectId},raster.namespace,'Root-only raster')).id;
  const old=createLocalToolClient(projectId,raster,{documentId:oldId}),previous=old.convergence!;
  equal('Raster profile remains engine11',(await previous.start(await old.read())).checkpoint.engine.version,'11');
  const oldPlace=await previous.richBlockEditCapture(field,[],destination);
  await old.state!.apply(oldPlace.snapshot,[{type:'rich-table-create',field,capture:oldPlace.capture,table}]);
  const oldCell=await previous.richTableCellCapture(field,...address),oldBefore=await previous.export();
  const rejected=await runBridgeTool('wh_local_tool_state_apply',{projectId,namespace:raster.namespace,documentId:oldId,baseline:oldCell.snapshot,actions:[action(oldCell.capture,asset)]});
  equal('Root-only profile rejects a cell image with available bytes',rejected.ok,false);
  equal('Root-only profile is byte-identical after rejection',await previous.export(),oldBefore);
  return checks;
 } finally {
  await deleteProject(projectId);
 }
}
