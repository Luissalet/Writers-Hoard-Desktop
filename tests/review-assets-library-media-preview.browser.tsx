// Independent 1504 focus, prepared from the public contract and stable fixtures.
// No author test exports or copied preview/controller implementation.
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import AssetsLibrary from '@/components/project/AssetsLibrary';
import {EnginePaneContext} from '@/engines/_shared/EnginePaneContext';
import {db} from '@/db';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {replaceWithCompressed} from '@/services/assetsLibrary/operations';
import {listProjectAssets} from '@/services/assetsLibrary/catalog';
import {useLocaleStore} from '@/stores/localeStore';
import {boardMediaFixture} from './board-media.browser';

function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=(ms=40)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
async function until(predicate:()=>boolean|Promise<boolean>,label:string){const end=Date.now()+15000;while(Date.now()<end){if(await predicate())return;await act(async()=>{await pause();});}throw Error(label);}
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return{promise,release};}
const digest=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(value=>value.toString(16).padStart(2,'0')).join('');
const row=(id:string)=>document.querySelector<HTMLElement>('[data-testid="assets-row"][data-asset-id="'+id+'"]');
const media=()=>document.querySelector<HTMLMediaElement>('[data-testid="assets-library"] audio[controls], [data-testid="assets-library"] video[controls]');
async function click(node:HTMLElement|null,label:string){check(node,label);await act(async()=>{node.click();await pause();});}
async function open(id:string){const button=row(id)?.querySelector<HTMLButtonElement>('button');check(button&&!button.disabled,'Owned row preview must be enabled: '+id);await click(button,'Owned row open missing: '+id);}
async function ready(kind:'audio'|'video'){await until(()=>{const player=media();return player?.tagName.toLowerCase()===kind&&!!player.getAttribute('src')&&player.readyState>=1&&Number.isFinite(player.duration)&&player.duration>0;},'Actual '+kind+' metadata/source unavailable');return media()!;}
async function closePreview(){const library=document.querySelector('[data-testid="assets-library"]');const button=[...library!.querySelectorAll<HTMLButtonElement>('button')].find(node=>/close/i.test((node.getAttribute('aria-label')??'')+' '+node.textContent));await click(button??null,'Inline Close control must remain available');}
async function sourceDigest(player:HTMLMediaElement){const src=player.getAttribute('src');check(src?.startsWith('blob:'),'Real player must use a BlobURL');const response=await fetch(src);check(response.ok,'Own live BlobURL must resolve');return digest(await response.blob());}

function trackUrls(){
 const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL,created=new Set<string>(),revoked=new Map<string,number>();
 URL.createObjectURL=function(blob){const url=originalCreate.call(URL,blob);created.add(url);return url;};
 URL.revokeObjectURL=function(url){revoked.set(url,(revoked.get(url)??0)+1);originalRevoke.call(URL,url);};
 return{created,revoked,restore(){URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;}};
}
function retainOneImage(id:string){
 const prototype=Object.getPrototypeOf(db.inspirationImages) as{get:(this:{name:string},key:unknown)=>Promise<unknown>},original=prototype.get,held=gate();let armed=true,entered=false;
 prototype.get=function(key){const request=original.call(this,key);if(this.name==='inspirationImages'&&key===id&&armed){armed=false;entered=true;return request.then(async actual=>{await held.promise;return actual;});}return request;};
 return{entered:()=>entered,release:held.release,restore(){held.release();prototype.get=original;}};
}
async function normalized(value:unknown):Promise<unknown>{
 if(value instanceof Blob)return{type:value.type,size:value.size,sha256:await digest(value)};
 if(Array.isArray(value))return Promise.all(value.map(normalized));
 if(value&&typeof value==='object')return Object.fromEntries(await Promise.all(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(async([key,child])=>[key,await normalized(child)])));
 return value;
}
async function snapshot(projectIds:string[]){const result=[];for(const projectId of projectIds)result.push({project:await db.projects.get(projectId),media:await db.localMediaAssets.where('projectId').equals(projectId).sortBy('id'),images:await db.inspirationImages.where('projectId').equals(projectId).sortBy('id')});return JSON.stringify(await normalized(result));}

async function fixture(suffix:string){
 const own=await boardMediaFixture('review-library-'+suffix),other=await boardMediaFixture('review-library-other-'+suffix),imageId=own.projectId+'-image';
 const canvas=document.createElement('canvas');canvas.width=canvas.height=4;const paint=canvas.getContext('2d')!;paint.fillStyle='#a43d26';paint.fillRect(0,0,4,4);
 await db.inspirationImages.add({id:imageId,projectId:own.projectId,imageData:canvas.toDataURL('image/png'),name:'Independent library image',notes:'Owned image control',tags:['review'],createdAt:1});
 const host=document.createElement('div');document.getElementById('root')!.append(host);const root=createRoot(host),locale=useLocaleStore.getState().locale,loaded=useLocaleStore.getState().loaded;
 useLocaleStore.setState({locale:'en',loaded:true});
 const render=async(projectId:string)=>{await act(async()=>{root.render(<MemoryRouter><EnginePaneContext.Provider value={{instanceId:'review-library',projectId,visible:true}}><AssetsLibrary projectId={projectId}/></EnginePaneContext.Provider></MemoryRouter>);await pause();});await until(()=>!!row(projectId===own.projectId?own.audio.id:other.audio.id),'Actual library owner rows unavailable');};
 const cleanup=async()=>{await act(async()=>{root.unmount();await pause();});host.remove();await own.cleanup();await other.cleanup();useLocaleStore.setState({locale,loaded});};
 return{own,other,imageId,render,cleanup};
}

async function reviewLateImageOwners(){
 for(const destination of ['media','closed','project']as const){
  const f=await fixture('late-'+destination),urls=trackUrls();let held:ReturnType<typeof retainOneImage>|undefined;
  try{
   await f.render(f.own.projectId);await until(()=>!!row(f.imageId)?.querySelector<HTMLImageElement>('img')?.complete,'Image thumbnail positive must finish before retaining the preview read');
   const before=await snapshot([f.own.projectId,f.other.projectId]);held=retainOneImage(f.imageId);
   await open(f.imageId);await until(held.entered,'Image preview did not enter the retained actual storage read');
   let winner:HTMLMediaElement|null=null;
   if(destination==='project'){await f.render(f.other.projectId);check(!row(f.own.audio.id),'Retarget must remove the former owner rows');await open(f.other.audio.id);winner=await ready('audio');check(await sourceDigest(winner)===await digest(f.other.audio.blob),'Retarget winner must use the new owner bytes');}
   else{await open(f.own.video.id);winner=await ready('video');check(await sourceDigest(winner)===await digest(f.own.video.blob),'Media winner must use the selected video bytes');if(destination==='closed'){const old=winner,src=old.getAttribute('src')!;await closePreview();await until(()=>!media()&&urls.revoked.has(src),'Explicit close must retire the player and its own URL');check(!old.isConnected&&old.getAttribute('src')===null,'Closed player must lose its actual src');winner=null;}}
   held.release();await act(async()=>{await pause(160);});held.restore();held=undefined;
   check(!document.querySelector('[data-testid="lightbox-image"]'),'LATE_IMAGE_'+destination+': obsolete image completion opened GalleryLightbox over the current selection');
   check(media()===winner,'LATE_IMAGE_'+destination+': obsolete completion changed the selected/closed media presentation');
   if(destination==='project'){await f.render(f.own.projectId);check(!media()&&!document.querySelector('[data-testid="lightbox-image"]'),'Returning to the original project must not revive a retired request');}
   check(await snapshot([f.own.projectId,f.other.projectId])===before,'Preview owner/cancel race must not write project, media or image data');
  }finally{held?.restore();await f.cleanup();urls.restore();}
 }
 return 'Independent late-image focus: held real image read cannot override media B, explicit close or a project retarget/return; scoped data unchanged';
}

async function reviewSameIdReplacementCleanup(){
 const f=await fixture('replacement'),urls=trackUrls();
 try{
  await f.render(f.own.projectId);const before=await snapshot([f.own.projectId,f.other.projectId]);await open(f.own.audio.id);const old=await ready('audio'),oldSrc=old.getAttribute('src')!;
  check(urls.created.has(oldSrc)&&old.paused&&!old.autoplay&&await sourceDigest(old)===await digest(f.own.audio.blob),'Initial real player must use admitted paused bytes without autoplay');
  check(await snapshot([f.own.projectId,f.other.projectId])===before,'Opening metadata/preview must not write');
  let pauseCalls=0,loadWithoutSrc=0;const originalPause=old.pause,originalLoad=old.load;
  old.pause=function(){pauseCalls++;return originalPause.call(old);};old.load=function(){if(!old.hasAttribute('src'))loadWithoutSrc++;return originalLoad.call(old);};
  const bytes=await f.own.audio.blob.arrayBuffer(),samples=new Uint8Array(bytes);check(samples.length>44,'Reusable WAV must contain actual PCM data');samples[samples.length-1]^=1;
  const admitted=(await listProjectAssets(f.own.projectId)).find(asset=>asset.id===f.own.audio.id)!;check(admitted,'Actual catalogue must admit replacement source');
  await act(async()=>{await replaceWithCompressed(f.own.projectId,admitted,{bytes,mime:f.own.audio.mime,ext:'wav'});await pause();});
  await until(()=>!!media()&&media()!==old&&media()!.getAttribute('src')!==oldSrc&&urls.revoked.has(oldSrc),'SAME_ID_VERSION: effective-byte replacement must retire the old keyed player and URL');
  const next=await ready('audio'),nextSrc=next.getAttribute('src')!;
  check(!old.isConnected&&old.getAttribute('src')===null&&pauseCalls>0&&loadWithoutSrc>0,'Old actual player cleanup must pause, remove src, load and revoke');
  check(next.paused&&!next.autoplay&&await sourceDigest(next)===await digest(new Blob([bytes],{type:f.own.audio.mime})),'Replacement same-id source must use its new bytes and remain paused');
  const afterExplicitReplacement=await snapshot([f.own.projectId,f.other.projectId]);check(afterExplicitReplacement!==before,'Normal replacement positive must actually change the stored resource');
  await closePreview();await until(()=>!media()&&urls.revoked.has(nextSrc),'Closing replacement must release its URL too');
  check(await snapshot([f.own.projectId,f.other.projectId])===afterExplicitReplacement,'Close after explicit mutation must not introduce another write');
 }finally{await f.cleanup();urls.restore();}
 return 'Independent same-id focus: actual replace operation swaps one PCM byte/version, retires old native player with pause/src/load/revoke, mounts new paused bytes and closes without extra writes';
}

type AssetDto={id:string;kind:string;name:string;size:number;createdAt:number;mime:string;tags:string[]};
async function list(projectId:string){const reply=await runBridgeTool('wh_list_assets',{projectId});check(reply.ok,'Real scoped asset list rejected: '+JSON.stringify(reply));return reply.result as{projectId:string;assets:AssetDto[]};}
async function reviewScopedMcpReadonly(){
 const f=await fixture('mcp-readonly');
 try{
  await f.render(f.own.projectId);const before=await snapshot([f.own.projectId,f.other.projectId]),listed=await list(f.own.projectId);
  const own=listed.assets.find(asset=>asset.id===f.own.audio.id);check(own?.kind==='audio'&&own.name===f.own.audio.title&&row(own.id)?.dataset.assetKind==='audio','Real MCP and UI must describe the same owned audio');
  check(JSON.stringify(Object.keys(own).sort())===JSON.stringify(['createdAt','id','kind','mime','name','size','tags']),'Existing list DTO must remain unchanged without a preview flag or BlobURL');
  check(!listed.assets.some(asset=>asset.id===f.other.audio.id||asset.id===f.other.video.id),'Scoped list must not include another project media');
  const usage=await runBridgeTool('wh_asset_usage',{projectId:f.own.projectId,assetId:f.own.audio.id});check(usage.ok,'Actual asset usage positive failed');
  await open(f.own.audio.id);const player=await ready('audio');check(player.paused&&!player.autoplay&&await sourceDigest(player)===await digest(f.own.audio.blob),'Preview reads the same scoped bytes without playing');await closePreview();await until(()=>!media(),'Readonly preview did not close');
  const afterUsage=await runBridgeTool('wh_asset_usage',{projectId:f.own.projectId,assetId:f.own.audio.id});check(afterUsage.ok&&JSON.stringify(afterUsage.result)===JSON.stringify(usage.result),'Preview must not create an asset usage');
  const rejected=await runBridgeTool('wh_asset_usage',{projectId:f.own.projectId,assetId:f.other.audio.id});check(!rejected.ok,'Usage must reject the other project asset under the own scope');
  await f.render(f.other.projectId);check(!row(f.own.audio.id)&&row(f.other.audio.id),'UI owner must change independently of the previous explicit MCP scope');
  const otherList=await list(f.other.projectId);check(otherList.assets.some(asset=>asset.id===f.other.audio.id)&&!otherList.assets.some(asset=>asset.id===f.own.audio.id),'Explicit MCP scopes must remain separate after UI retarget');
  check(await snapshot([f.own.projectId,f.other.projectId])===before,'Opening/closing and readonly MCP must preserve exact project/media/image data and bytes');
 }finally{await f.cleanup();}
 return 'Independent MCP/data focus: real renderer list/usage retain existing DTO and project identities; preview adds no usage or stored data/byte/timestamp changes (not Native playback)';
}

export async function testReviewAssetsLibraryMediaPreview(){return[await reviewLateImageOwners(),await reviewSameIdReplacementCleanup(),await reviewScopedMcpReadonly()];}
