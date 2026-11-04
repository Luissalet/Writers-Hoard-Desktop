import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import raster from '@/engines/local/installed/examples.image-formats/module';
import aligned from '@/engines/local/installed/examples.image-layout/module';
import legacy from '@/engines/local/installed/examples.shared-images/module';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createLocalToolClient} from '@/engines/local/storage';
import {convergenceCanonical} from '@/engines/local/convergence/format';
import {detectSourceRasterMime} from '@/services/sourceRasterFormat';
import type {RichImageAsset} from '@/engines/local/convergence/imageFormat';
import type {RichBlockDocument} from '@/engines/local/convergence/blockFormat';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {rasterFixtures} from './local-tool-image-formats.fixture';

function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}

export async function testSourceImageFormats(){
 const projectId='own-image-formats-'+crypto.randomUUID(),field='body',id='own-raster',checks:string[]=[];
 const equal=(label:string,actual:unknown,expected:unknown)=>{assert(convergenceCanonical(actual)===convergenceCanonical(expected),label);checks.push(label);};
 const atRoot={parentId:null,slot:'body' as const,afterId:'P'};
 const attrs=(data:unknown)=>(data as {body:RichBlockDocument}).body.blocks.find(block=>block.id===id)?.attrs;
 try {
  registerLocalToolModules({
   './installed/examples.image-formats/module.tsx':{default:raster},
   './installed/examples.image-layout/module.tsx':{default:aligned},
   './installed/examples.shared-images/module.tsx':{default:legacy},
  });
  await db.projects.add({id:projectId,title:'Own raster images',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:[raster,aligned,legacy].map(definition=>'local-tool-'+definition.namespace),createdAt:1,updatedAt:1});
  const documentId=(await createSourceToolDocument({projectId},raster.namespace,'Own mixed raster')).id;
  const scope={projectId,namespace:raster.namespace,documentId},client=createLocalToolClient(projectId,raster,{documentId}),convergence=client.convergence!;
  equal('Raster Source starts engine11',(await convergence.start(await client.read())).checkpoint.engine.version,'11');
  const assets:RichImageAsset[]=[];
  for(const {name,mime,base64,sha256} of rasterFixtures){
   const imported=await runBridgeTool('wh_local_asset_file_import',{...scope,file:{name,mime,base64,kind:'image'}});
   assert(imported.ok,JSON.stringify(imported));
   const asset={sha256:imported.result.sha256,mime:imported.result.mime,size:imported.result.size} as RichImageAsset;
   equal(`MCP import retains ${mime}`,asset,{sha256,mime,size:atob(base64).length});
   assets.push(asset);
  }
  const jpeg=Uint8Array.from(atob(rasterFixtures[0].base64),c=>c.charCodeAt(0));
  // Keep marker structure, but remove all Huffman tables so a real decoder rejects it.
  for(let i=2;i<jpeg.length-1;i++)if(jpeg[i]===0xff&&jpeg[i+1]===0xc4)jpeg[i+1]=0xe2;
  equal('Corruption still passes the container-only check',detectSourceRasterMime(jpeg),'image/jpeg');
  const invalid=await runBridgeTool('wh_local_asset_file_import',{...scope,file:{name:'undecodable.jpeg',mime:'image/jpeg',base64:btoa(String.fromCharCode(...jpeg)),kind:'image'}});
  equal('Browser decoder rejects structurally plausible corrupt content',invalid.ok,false);
  equal('Decoder failure inserts no file',await db.localToolAssetFiles.where('projectId').equals(projectId).count(),2);

  const place=await convergence.richBlockEditCapture(field,[],atRoot);
  await client.state!.apply(place.snapshot,[{type:'rich-image-insert',field,capture:place.capture,id,asset:assets[0]}]);
  const source=await convergence.richImageCapture(field,id,'source'),before=await convergence.export();
  const changed=await runBridgeTool('wh_local_tool_state_apply',{...scope,baseline:source.snapshot,actions:[{type:'rich-image-replace',field,capture:source.capture,asset:assets[1]}]});
  assert(changed.ok&&changed.result.receiptId,JSON.stringify(changed));
  equal('MCP replaces JPEG with WebP at the same node',attrs((await client.read()).data),{asset:assets[1],displaySize:'medium',alignment:'left'});
  const next=await convergence.export();
  const stale=await runBridgeTool('wh_local_tool_state_apply',{...scope,baseline:next.snapshot,actions:[{type:'rich-image-replace',field,capture:source.capture,asset:assets[0]}]});
  equal('Stale capture rejects a second replacement',stale.ok,false);
  equal('Stale replacement leaves the exact export',await convergence.export(),next);
  assert(before.checkpoint.checkpointBase64!==next.checkpoint.checkpointBase64,'Replacement did not reach the checkpoint');

  for(const [definition,version] of [[legacy,'9'],[aligned,'10']] as const){
   const oldId=(await createSourceToolDocument({projectId},definition.namespace,'Own previous PNG')).id;
   const old=createLocalToolClient(projectId,definition,{documentId:oldId}),oldConvergence=old.convergence!;
   equal(`Prior profile keeps engine${version}`,(await oldConvergence.start(await old.read())).checkpoint.engine.version,version);
   const oldPlace=await oldConvergence.richBlockEditCapture(field,[],atRoot),prior=await oldConvergence.export();
   const rejected=await runBridgeTool('wh_local_tool_state_apply',{projectId,namespace:definition.namespace,documentId:oldId,baseline:oldPlace.snapshot,actions:[{type:'rich-image-insert',field,capture:oldPlace.capture,id,asset:assets[0]}]});
   equal(`Engine${version} rejects a JPEG already in this library`,rejected.ok,false);
   equal(`Engine${version} export stays exact`,await oldConvergence.export(),prior);
  }

  const zip=await createProjectZipArchive(projectId);
  await importProjectZip(new File([zip.blob],'mixed-raster.zip',{type:'application/zip'}),{replaceProjectIds:[projectId]});
  db.close();await db.open();
  equal('Cold ZIP keeps the exact mixed raster checkpoint',(await convergence.export()).checkpoint,next.checkpoint);
  for(const [i,asset] of assets.entries()){
   const {base64,width,height}=rasterFixtures[i];
   const found=await runBridgeTool('wh_local_asset_image_find',{...scope,asset,includeContent:true});
   assert(found.ok,JSON.stringify(found));
   equal(`Cold MCP lookup returns exact ${asset.mime}`,found.result,{available:true,...asset,base64});
   const resolved=await client.assets.resolveImage(asset);
   assert(resolved,'Missing historical bytes');
   const bitmap=await createImageBitmap(resolved.blob);
   try{equal(`Cold decoder opens historical ${asset.mime}`,[bitmap.width,bitmap.height],[width,height]);}finally{bitmap.close();}
  }
  equal('Lookup adds no files and leaves the checkpoint exact',await convergence.export(),next);
  equal('The project retains exactly its two image files',await db.localToolAssetFiles.where('projectId').equals(projectId).count(),2);
  return checks;
 } finally {
  await deleteProject(projectId);
 }
}
