import {db} from '@/db';
import {deleteProject,exportProjectData,importProjectData} from '@/db/operations';
import {createLocalToolClient} from '@/engines/local/storage';
import {createLocalToolBlockEnvelope} from '@/engines/local/blocks/definitions';
import {serializeLocalToolBlock,type LocalToolOwnedBlockEnvelope} from '@/engines/local/blocks/types';
import {capturePublicationSnapshot,publicationReaderSource} from '@/services/publishedEditions/snapshot';
import {sourceBlockPreviewHtml,prepareSourceBlocksForExport} from '@/services/sourceBlockReading';
import {assetFixture,assertAsset,ASSET_NS} from './local-tool-assets.browser';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {findLocalToolBlocksInHtml} from '@/engines/local/blocks/types';
import type {LocalAssetOverrides} from '@/engines/local/assets';
import {act,StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import CodexReadContent from '@/components/codex/CodexReadContent';

/** Real browser CSP applied after module loading, not a mocked fetch implementation. */
export async function reviewLocalAssetGalleryCsp(){
 const P='review-assets-csp',{block,client}=await assetFixture(P);
 try{
  const envelope=createLocalToolBlockEnvelope(ASSET_NS,block,'csp') as LocalToolOwnedBlockEnvelope;
  envelope.data={assetOverrides:{portrait:{kind:'image',id:P+'-image'}}};
  await db.writings.put({id:P+'-writing',projectId:P,title:'Captured',content:serializeLocalToolBlock(P,envelope),wordCount:0,status:'draft',tags:[],createdAt:1,updatedAt:1});
  const captured=publicationReaderSource(await capturePublicationSnapshot({projectId:P}));
  const meta=document.createElement('meta');meta.httpEquiv='Content-Security-Policy';meta.content="connect-src 'none'";document.head.append(meta);
  let live=false,liveError='';try{live=(await client.assets.resolve({kind:'image',id:P+'-image'}))?.mime==='image/png';}catch(error){liveError=String(error);}
  await db.close();let html='';try{html=await sourceBlockPreviewHtml(envelope,P,'en',{source:captured});}finally{await db.open();}
  assertAsset(live&&html.includes('data:image/png;base64,'),'Gallery data URLs must resolve under native CSP, live='+live+' captured='+html.includes('<img')+' error='+liveError);
  return ['Actual connect-src none permits gallery PNG resolution and DB-closed captured preview without data fetch'];
 }finally{if(!db.isOpen())await db.open();client.audio?.dispose();await deleteProject(P);}
}

export async function reviewLocalAssetConcurrency(){
 const P='review-assets-cas',{source,client}=await assetFixture(P),passed:string[]=[];
 try{
  const version=(await client.assets.installation.read()).version;
  const results=await Promise.allSettled(['one','two'].map(id=>client.assets.installation.set('click',{kind:'media',id:P+'-'+id},version)));
  assertAsset(results.filter(row=>row.status==='fulfilled').length===1&&results.filter(row=>row.status==='rejected').length===1,'Concurrent writers both consumed one installation CAS');
  const effective=await client.assets.installation.read();assertAsset(Object.keys(effective.own).join(',')==='tick','Concurrent alias write left duplicate or unrelated keys');
  const past=createLocalToolClient(P,source,{eraId:'past'}),stale=(await past.assets.installation.read()).version;
  await client.assets.installation.set('portrait',{kind:'image',id:P+'-image'},effective.version);
  const before=JSON.stringify(await db.projects.get(P));let refused=false;try{await past.assets.installation.set('click',null,stale);}catch{refused=true;}
  assertAsset(refused&&JSON.stringify(await db.projects.get(P))===before,'Era CAS failed to include intervening Base changes');
  passed.push('Concurrent native installation writers serialize exactly one winner; era CAS sees later Base edits without partial states');
  let active=true,release=()=>{},entered=()=>{};const started=new Promise<void>(resolve=>{entered=resolve;}),pending=new Promise<void>(resolve=>{release=resolve;}),load=source.assetFiles!['assets/tick.wav'];
  source.assetFiles!['assets/tick.wav']=async()=>{entered();await pending;return load();};
  try{
   const scoped=createLocalToolClient(P,source,{isCurrent:()=>active}),baseline=JSON.stringify(await db.projects.get(P)),revision=(await scoped.assets.installation.read()).version;
   const operation=scoped.assets.installation.set('tick',{kind:'source',namespace:ASSET_NS,slot:'tick'},revision);
   await started;active=false;release();const result=await Promise.allSettled([operation]);
   assertAsset(result[0].status==='rejected'&&JSON.stringify(await db.projects.get(P))===baseline,'Lease revoked during asset preparation still saved installation');
  }finally{release();source.assetFiles!['assets/tick.wav']=load;}
  passed.push('Revoking the real client lease during asynchronous source preparation refuses the write and preserves every project byte');
  return passed;
 }finally{client.audio?.dispose();await deleteProject(P);}
}

export async function reviewLocalAssetCapturedDrafts(){
 const P='review-assets-drafts',{block,client,png}=await assetFixture(P);
 try{
  await db.inspirationImages.bulkPut([{id:P+'-parallel',projectId:P,imageData:png,name:'Parallel only',notes:'',createdAt:1},{id:P+'-unreferenced',projectId:P,imageData:png,name:'Do not capture',notes:'',createdAt:1}]);
  const envelope=createLocalToolBlockEnvelope(ASSET_NS,block,'parallel-atom') as LocalToolOwnedBlockEnvelope;
  envelope.data={assetOverrides:{portrait:{kind:'image',id:P+'-parallel'}}};
  const markup='<section><blockquote>'+serializeLocalToolBlock(P,envelope)+'</blockquote></section>';
  await db.writings.put({id:P+'-writing',projectId:P,title:'Parent',content:'<p>No asset here</p>',wordCount:3,status:'draft',tags:[],createdAt:1,updatedAt:1});
  await db.writingSnapshots.put({id:P+'-draft',projectId:P,writingId:P+'-writing',title:'Parallel',content:markup,wordCount:0,reason:'manual',createdAt:1,kind:'parallel-draft'});
  const source=publicationReaderSource(await capturePublicationSnapshot({projectId:P}));
  assertAsset(source.capturedImages?.().map(row=>row.id).join(',')===P+'-parallel','Snapshot missed the parallel-draft-only reference or captured unrelated gallery');
  const draft=source.parallelDrafts.find(row=>row.id===P+'-draft');assertAsset(draft,'Parallel body absent from captured source');
  await db.inspirationImages.delete(P+'-parallel');await db.close();
  try{
   const normal=await prepareSourceBlocksForExport(draft.content,P,'en',{source}),excluded=await prepareSourceBlocksForExport(draft.content,P,'en',{source,excludedImageIds:[P+'-parallel']}),omitted=await prepareSourceBlocksForExport(draft.content,P,'en',{source,includeImages:false}),noMedia=await prepareSourceBlocksForExport(draft.content,P,'en',{source,includeMedia:false});
   assertAsset(normal.includes('data:image/png;base64,')&&!normal.includes('<button'),'Nested captured parallel asset was unavailable or mounted controls');
   assertAsset(!excluded.includes('<img')&&!omitted.includes('<img'),'Nested captured asset bypassed image exclusion/omission');
   assertAsset(noMedia.includes('data:image/png;base64,'),'Omitting media incorrectly omitted gallery image controlled by includeImages');
   const noImages={...source,capturedImages:()=>[]};assertAsset(!(await prepareSourceBlocksForExport(draft.content,P,'en',{source:noImages})).includes('<img'),'Missing capture acquired an image from another source');
  }finally{await db.open();}
  return ['A nested parallel-draft-only image is captured precisely, survives deleting live data/closing DB, and obeys exclusion/omission without controls or fallback'];
 }finally{if(!db.isOpen())await db.open();client.audio?.dispose();await deleteProject(P);}
}

export async function reviewLocalAssetCloneCollision(){
 const P='review-assets-collision',{source,block,client,png}=await assetFixture(P);let clone:string|undefined;
 try{
  const shared=P+'-shared';await db.inspirationImages.put({id:shared,projectId:P,imageData:png,name:'Collision image',notes:'',createdAt:1});
  await db.localMediaAssets.put({id:shared,projectId:P,title:'Collision audio',kind:'audio',mime:'audio/wav',blob:new Blob(['collision'],{type:'audio/wav'}),size:9,notes:'',tags:[],linkedEntryIds:[],createdAt:1,updatedAt:1});
  const refs:LocalAssetOverrides={portrait:{kind:'image',id:shared},tick:{kind:'media',id:shared},click:{kind:'media',id:shared}};
  const doc=await createSourceToolDocument({projectId:P},ASSET_NS,'Collision'),scoped=createLocalToolClient(P,source,{documentId:doc.id});
  await scoped.state!.apply(await scoped.read(),Object.entries(refs).map(([key,value])=>({type:'map-set' as const,field:'assetOverrides',key,value})));
  const envelope=createLocalToolBlockEnvelope(ASSET_NS,block,'collision-block') as LocalToolOwnedBlockEnvelope;envelope.data={assetOverrides:refs};
  await db.writings.put({id:P+'-writing',projectId:P,title:'Collision',content:serializeLocalToolBlock(P,envelope),wordCount:0,status:'draft',tags:[],createdAt:1,updatedAt:1});
  await client.assets.installation.set('portrait',refs.portrait,(await client.assets.installation.read()).version);
  const past=createLocalToolClient(P,source,{eraId:'past'});await past.assets.installation.set('tick',refs.tick,(await past.assets.installation.read()).version);
  clone=await importProjectData(await exportProjectData(P));
  const image=(await db.inspirationImages.where('projectId').equals(clone).toArray()).find(row=>row.name==='Collision image'),media=(await db.localMediaAssets.where('projectId').equals(clone).toArray()).find(row=>row.title==='Collision audio');assertAsset(image&&media&&image.id!==shared&&media.id!==shared,'Real clone lost one resource or retained an original identity');
  const project=(await db.projects.get(clone))!,copy=project.sourceToolDocuments!.find(row=>row.title==='Collision')!,copyBlock=findLocalToolBlocksInHtml((await db.writings.where('projectId').equals(clone).first())!.content)[0].envelope as LocalToolOwnedBlockEnvelope;
  for(const data of [copy.data,copyBlock.data]){const refs=(data as {assetOverrides:LocalAssetOverrides}).assetOverrides;assertAsset((refs.portrait as {id:string}).id===image.id&&(refs.tick as {id:string}).id===media.id&&(refs.click as {id:string}).id===media.id,'Real JSON clone crossed or double-remapped a repeated image/media ID');}
  const copied=createLocalToolClient(clone,source),copiedPast=createLocalToolClient(clone,source,{eraId:project.worldEras!.find(era=>era.name==='Past')!.id}),portrait=await copied.assets.slot('portrait'),tick=await copiedPast.assets.slot('tick');assertAsset((portrait?.ref as {id:string})?.id===image.id&&portrait?.mime==='image/png'&&(tick?.ref as {id:string})?.id===media.id&&await tick?.blob.text()==='collision','Installation Base/era differences lost image/media domains or bytes on clone');
  return ['Actual JSON import separates colliding gallery/media IDs across source document, repeated owned refs, Base installation and era differences'];
 }finally{client.audio?.dispose();if(clone)await deleteProject(clone);await deleteProject(P);}
}

export async function reviewLocalAssetAbout(){
 const P='review-assets-about',{block,client}=await assetFixture(P),root=createRoot(document.getElementById('root')!);let mounted=true;
 const pause=()=>new Promise(resolve=>setTimeout(resolve,25));
 const until=async(check:()=>boolean,message:string)=>{for(let i=0;i<80;i++){if(check())return;await act(async()=>{await pause();});}throw Error(message);};
 try{
  const envelope=createLocalToolBlockEnvelope(ASSET_NS,block,'about'),html=serializeLocalToolBlock(P,envelope),baseline=JSON.stringify(await db.projects.get(P));
  await act(async()=>{root.render(<StrictMode><CodexReadContent html={html} projectId={P} locale="en"/></StrictMode>);await pause();});
  await until(()=>!!document.querySelector('[data-wh-local-tool-preview] svg'),'Actual About projection lost the compiled default SVG');
  const vector=document.querySelector('[data-wh-local-tool-preview] svg')!.getBoundingClientRect();assertAsset(vector.width>0&&vector.height>0&&vector.width<=100&&vector.height<=100,'Asset About vector default must retain the 96px asset preview footprint, got '+vector.width+'x'+vector.height);
  assertAsset(!document.querySelector('button,select,audio')&&JSON.stringify(await db.projects.get(P))===baseline,'Readonly About mounted controls/audio or wrote project state');
  await client.assets.installation.set('portrait',{kind:'image',id:P+'-image'},(await client.assets.installation.read()).version);
  await until(()=>!!document.querySelector('img[src^="data:image/png;base64,"]'),'Actual About projection did not react to changed installation image');
  const after=JSON.stringify(await db.projects.get(P));await act(async()=>root.unmount());mounted=false;await pause();
  assertAsset(JSON.stringify(await db.projects.get(P))===after,'Readonly About unmount wrote state');
  return ['Real Codex About renders safe SVG default, refreshes gallery override live, mounts no controls/audio and writes nothing at mount/unmount'];
 }finally{if(mounted)await act(async()=>root.unmount());client.audio?.dispose();await deleteProject(P);}
}
