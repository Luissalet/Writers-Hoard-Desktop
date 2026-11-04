import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import aligned from '@/engines/local/installed/examples.image-layout/module';
import legacy from '@/engines/local/installed/examples.shared-images/module';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createLocalToolClient} from '@/engines/local/storage';
import type {RichBlockDocument} from '@/engines/local/convergence/blockFormat';
import {convergenceCanonical} from '@/engines/local/convergence/format';
import type {RichImageAsset,RichImageCapture} from '@/engines/local/convergence/imageFormat';
import type {LocalToolJson,LocalToolSnapshot} from '@/engines/local/sdk';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {testImageBase64} from './local-tool-image-fixture';

function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}

export async function testSourceImageAlignment(){
 const projectId='own-image-alignment-'+crypto.randomUUID(),field='body',nodeId='own-png-aligned',checks:string[]=[];
 const equal=(label:string,actual:unknown,expected:unknown)=>{assert(convergenceCanonical(actual)===convergenceCanonical(expected),label);checks.push(label);};
 const attrs=(snapshot:LocalToolSnapshot<LocalToolJson>)=>{
  const document=(snapshot.data as unknown as {body:RichBlockDocument}).body;
  return document.blocks.find(block=>block.id===nodeId)?.attrs;
 };
 try {
  registerLocalToolModules({
   './installed/examples.image-layout/module.tsx':{default:aligned},
   './installed/examples.shared-images/module.tsx':{default:legacy},
  });
  await db.projects.add({id:projectId,title:'Own image alignment',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:[aligned,legacy].map(definition=>'local-tool-'+definition.namespace),createdAt:1,updatedAt:1});
  const documentId=(await createSourceToolDocument({projectId},aligned.namespace,'Own aligned image')).id;
  const scope={projectId,namespace:aligned.namespace,documentId};
  const client=createLocalToolClient(projectId,aligned,{documentId}),convergence=client.convergence!;
  equal('Aligned profile starts engine10',(await convergence.start(await client.read())).checkpoint.engine.version,'10');
  const bytes=Uint8Array.from(atob(testImageBase64),char=>char.charCodeAt(0));
  const saved=await client.assets.import(new File([bytes],'alignment.png',{type:'image/png'}),'image');
  const asset:RichImageAsset={sha256:saved.sha256,mime:'image/png',size:saved.size};
  const atRoot=()=>({parentId:null,slot:'body' as const,afterId:'P'});
  const place=await convergence.richBlockEditCapture(field,[],atRoot());
  await client.state!.apply(place.snapshot,[{type:'rich-image-insert',field,capture:place.capture,id:nodeId,asset}]);
  equal('Birth projects explicit left',attrs(await client.read()),{asset,displaySize:'medium',alignment:'left'});

  const beforeCapture=await convergence.export();
  const response=await runBridgeTool('wh_local_tool_rich_image_capture',{...scope,field,nodeId,channel:'alignment'});
  assert(response.ok,JSON.stringify(response));
  const captured=response.result as {capture:RichImageCapture;snapshot:LocalToolSnapshot<LocalToolJson>};
  equal('SDK and registered MCP capture exactly the same alignment',captured,await convergence.richImageCapture(field,nodeId,'alignment'));
  equal('Alignment capture is read only',await convergence.export(),beforeCapture);
  const set=async(capture:RichImageCapture,baseline:LocalToolSnapshot<LocalToolJson>,alignment:'left'|'center'|'right')=>{
   return runBridgeTool('wh_local_tool_state_apply',{...scope,baseline,actions:[{type:'rich-image-align',field,capture,alignment}]});
  };
  const right=await set(captured.capture,captured.snapshot,'right');
  assert(right.ok&&right.result.receiptId,JSON.stringify(right));
  equal('Registered right preserves the descriptor and width',attrs(await client.read()),{asset,displaySize:'medium',alignment:'right'});
  const fresh=await convergence.export(),stale=await set(captured.capture,fresh.snapshot,'center');
  assert(!stale.ok,'Stale alignment capture was accepted');
  equal('Stale align capture leaves Source exact',await convergence.export(),fresh);

  const width=await convergence.richImageCapture(field,nodeId,'size');
  await client.state!.apply(width.snapshot,[{type:'rich-image-resize',field,capture:width.capture,displaySize:'full'}]);
  equal('Full width retains right',attrs(await client.read()),{asset,displaySize:'full',alignment:'right'});
  const final=await convergence.export(),zip=await createProjectZipArchive(projectId);
  await importProjectZip(new File([zip.blob],'alignment.zip',{type:'application/zip'}),{replaceProjectIds:[projectId]});
  db.close();await db.open();
  equal('Cold ZIP preserves the alignment checkpoint',(await convergence.export()).checkpoint,final.checkpoint);
  equal('Cold ZIP resolves the exact same PNG',Array.from(new Uint8Array(await (await client.assets.resolveImage(asset))!.blob.arrayBuffer())),Array.from(bytes));
  equal('Alignment creates no additional files',await db.localToolAssetFiles.where('projectId').equals(projectId).count(),1);

  const oldDocument=(await createSourceToolDocument({projectId},legacy.namespace,'Own previous image')).id;
  const oldClient=createLocalToolClient(projectId,legacy,{documentId:oldDocument}),old=oldClient.convergence!;
  equal('Previous profile still starts engine9',(await old.start(await oldClient.read())).checkpoint.engine.version,'9');
  const oldPlace=await old.richBlockEditCapture(field,[],atRoot());
  await oldClient.state!.apply(oldPlace.snapshot,[{type:'rich-image-insert',field,capture:oldPlace.capture,id:nodeId,asset}]);
  const previous=await old.export();
  const oldCapture=await runBridgeTool('wh_local_tool_rich_image_capture',{projectId,namespace:legacy.namespace,documentId:oldDocument,field,nodeId,channel:'alignment'});
  equal('Previous profile rejects the alignment channel',oldCapture.ok,false);
  equal('Previous profile keeps its literal two attributes',attrs(await oldClient.read()),{asset,displaySize:'medium'});
  equal('Previous profile checkpoint stays exact',await old.export(),previous);
  return checks;
 } finally {
  await deleteProject(projectId);
 }
}
