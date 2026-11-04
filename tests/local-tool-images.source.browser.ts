import JSZip from 'jszip';
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
import type {RichImageAsset,RichImageCapture} from '@/engines/local/convergence/imageFormat';
import type {LocalToolSnapshot,LocalToolJson} from '@/engines/local/sdk';
import {testImageBase64} from './local-tool-image-fixture';

export async function testSourceImages(){
 const projectId='own-images-'+crypto.randomUUID(),foreignId=projectId+'-foreign',namespace=definition.namespace,field='body',nodeId='own-shared-image',checks:string[]=[];
 const equal=(label:string,a:unknown,b:unknown)=>{if(convergenceCanonical(a)!==convergenceCanonical(b))throw Error(`${label}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);checks.push(label);};
 const png=async()=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#d4762b';ctx.fillRect(0,0,64,32);ctx.fillStyle='#123456';ctx.fillRect(5,5,30,10);const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('PNG encode'))));return assetBase64(new Uint8Array(await blob.arrayBuffer()));};
 const addProject=(id:string)=>db.projects.add({id,title:id,description:id,mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+namespace],createdAt:1,updatedAt:1});
 const importImage=async(id:string,base64:string):Promise<RichImageAsset>=>{const reply=await runBridgeTool('wh_local_asset_file_import',{projectId:id,namespace,file:{name:'fixture.png',kind:'image',mime:'image/png',base64}});if(!reply.ok)throw Error(JSON.stringify(reply));return{sha256:reply.result.sha256,mime:'image/png',size:reply.result.size};};
 const image=(snapshot:LocalToolSnapshot<LocalToolJson>)=>(snapshot.data as unknown as {body:RichBlockDocument}).body.blocks.find(block=>block.id===nodeId)?.attrs;
 try{
  registerLocalToolModules({'./installed/examples.shared-images/module.tsx':{default:definition}});
  await addProject(projectId);await addProject(foreignId);
  const documentId=(await createSourceToolDocument({projectId},namespace,'Own images')).id,scope={projectId,namespace,documentId};
  const client=createLocalToolClient(projectId,definition,{documentId}),convergence=client.convergence!;
  equal('Source starts in engine9',(await convergence.start(await client.read())).checkpoint.engine.version,'9');
  const original=await importImage(projectId,testImageBase64),replacement64=await png(),foreign=await importImage(foreignId,replacement64);
  const insertion=await convergence.richBlockEditCapture(field,[],{parentId:null,slot:'body',afterId:'P'});
  const insert=async(asset:RichImageAsset)=>runBridgeTool('wh_local_tool_state_apply',{...scope,baseline:insertion.snapshot,actions:[{type:'rich-image-insert',field,capture:insertion.capture,id:nodeId,asset}]});
  const pre=await convergence.export(),denied=await insert(foreign);
  equal('foreign image insertion rejected',[denied.ok,!denied.ok&&denied.error],[false,'local_asset_image_unavailable']);
  equal('foreign image insertion leaves exact Source',await convergence.export(),pre);
  equal('registered write inserts existing bytes',(await insert(original)).ok,true);
  equal('insert has original source and default size',image(await client.read()),{asset:original,displaySize:'medium'});
  const capture=async(channel:'source'|'size')=>{const reply=await runBridgeTool('wh_local_tool_rich_image_capture',{...scope,field,nodeId,channel});if(!reply.ok)throw Error(JSON.stringify(reply));return reply.result as {capture:RichImageCapture;snapshot:LocalToolSnapshot<LocalToolJson>};};
  const old=await capture('source'),same=await convergence.richImageCapture(field,nodeId,'source');equal('SDK and dispatcher capture same source',old,same);
  const replacement=await importImage(projectId,replacement64);equal('same immutable description in both libraries',replacement,foreign);
  const replace=await runBridgeTool('wh_local_tool_state_apply',{...scope,baseline:old.snapshot,actions:[{type:'rich-image-replace',field,capture:old.capture,asset:replacement}]});
  equal('registered replacement writes',(replace.ok),true);
  const size=await capture('size'),resized=await runBridgeTool('wh_local_tool_state_apply',{...scope,baseline:size.snapshot,actions:[{type:'rich-image-resize',field,capture:size.capture,displaySize:'full'}]});
  equal('registered resize writes',resized.ok,true);
  equal('replacement and resize persist',image(await client.read()),{asset:replacement,displaySize:'full'});
  const saved=await convergence.export(),zip=await createProjectZipArchive(projectId);
  const malformed=await JSZip.loadAsync(zip.blob),indexPath=Object.keys(malformed.files).find(path=>path.endsWith('/local-tool-assets/index.json'))!;
  const rows=JSON.parse(await malformed.file(indexPath)!.async('string')) as {sha256:string;file:string}[];
  const retired=rows.find(row=>row.sha256===original.sha256)!;
  malformed.remove(indexPath.replace(/index\.json$/,retired.file));malformed.file(indexPath,JSON.stringify(rows.filter(row=>row!==retired)));
  let reason='';try{await importProjectZip(new File([await malformed.generateAsync({type:'blob'})],'missing-original.zip'),{replaceProjectIds:[projectId]});}catch(error){reason=String(error)+(error instanceof Error?JSON.stringify(error):'');}
  if(!reason.includes('local_asset_image_archive_missing'))throw Error(`Wrong missing original result: ${reason}`);
  equal('missing original in ZIP rejected before write',await convergence.export(),saved);
  await importProjectZip(new File([zip.blob],'complete-images.zip'),{replaceProjectIds:[projectId]});db.close();await db.open();
  equal('cold ZIP retains exact causal checkpoint',(await convergence.export()).checkpoint,saved.checkpoint);
  for(const [asset,expected] of [[original,testImageBase64],[replacement,replacement64]] as const){const file=await client.assets.resolveImage(asset);equal(`cold file ${asset.sha256.slice(0,8)} exact`,file&&assetBase64(new Uint8Array(await file.blob.arrayBuffer())),expected);}
  return checks;
 }finally{await deleteProject(projectId);await deleteProject(foreignId);}
}
