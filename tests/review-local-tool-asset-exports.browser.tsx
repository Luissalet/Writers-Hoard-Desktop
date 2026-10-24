import '@/engines';
import {act,StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import type {Project,Writing,CodexEntry} from '@/types';
import {testFontBase64} from './dictionary-test-font';
import {useLocalToolFontFace} from '@/engines/local/useLocalToolFontFace';
import {localAssetFontCss,type LocalAssetFont} from '@/engines/local/localAssetFonts';
import type {LocalAssetResolved,LocalAssetOverrides} from '@/engines/local/assets';
import {defineLocalTool,type LocalToolJson} from '@/engines/local/sdk';
import {defineLocalToolBlock,createLocalToolBlockEnvelope} from '@/engines/local/blocks/definitions';
import {serializeLocalToolBlock,type LocalToolOwnedBlockEnvelope} from '@/engines/local/blocks/types';
import {registerLocalToolModules} from '@/engines/local/registry';
import {localToolReleaseIdentity,LOCAL_TOOL_SOURCE_FORMAT} from '@/engines/local/releaseFormat.mjs';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {sourceBlockPreviewHtml} from '@/services/sourceBlockReading';
import {capturePublicationSnapshot,publicationReaderSource,publicationSourceFingerprint} from '@/services/publishedEditions/snapshot';
import {buildReaderHtml} from '@/engines/writings/readerExport';
import {safeReaderPresentation} from '@/engines/writings/readerPresentation';
import {loadWorldWikiData,buildWorldWiki,type WorldWikiOptions} from '@/services/worldWikiExport';
import {publishEdition,preparePublishedEdition,commitPublishedEdition,getPublishedEdition} from '@/services/publishedEditions/store';

function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=(ms=25)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check:()=>boolean|Promise<boolean>,message:string){const deadline=Date.now()+12000;while(Date.now()<deadline){if(await check())return;await act(async()=>{await pause();});}throw Error(message);}
async function sha(value:Blob|string){const bytes=typeof value==='string'?new TextEncoder().encode(value):await value.arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
const fontBytes=()=>Uint8Array.from(atob(testFontBase64),char=>char.charCodeAt(0));
function secondFont(){const bytes=fontBytes(),view=new DataView(bytes.buffer);for(let i=0;i<view.getUint16(4);i++){const at=12+i*16;if(new TextDecoder().decode(bytes.slice(at,at+4))==='head'){bytes[view.getUint32(at+8)+35]^=1;return bytes;}}throw Error('Procedural test font has no head table');}
const PAYLOAD='AA <img data-review-injected="yes" src=x onerror="window.REVIEW_INJECTED=1"> & <script>window.REVIEW_INJECTED=2</script>';
let readonlyMounts=0;
function NeverMount(){readonlyMounts++;throw Error('Readonly export mounted authored tool');return null;}

async function fixture(id:string){
 const namespace='review.'+id,codec={version:1 as const,fields:{assetOverrides:{kind:'map' as const,assetReferenceValues:true as const}}},initialState={assetOverrides:{} as LocalAssetOverrides};
 const preview={version:1 as const,fields:[],assets:['font','data','portrait'].map(slot=>({namespace,slot,overridesField:'assetOverrides'}))};
 const validateState=(value:LocalToolJson):value is typeof initialState=>!!value&&typeof value==='object'&&!Array.isArray(value)&&!!value.assetOverrides&&typeof value.assetOverrides==='object'&&!Array.isArray(value.assetOverrides);
 const block=defineLocalToolBlock({key:'resources',name:{en:'Resource review',es:'Recursos'},scope:'host',initialState,codec,preview,validateState,component:NeverMount});
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6mWQAAAAASUVORK5CYII=';
 const source=defineLocalTool({namespace,name:{en:'Review resources',es:'Recursos'},description:{en:'Independent resource review',es:'Revisión independiente'},initialState,codec,preview,validateState,component:NeverMount,document:{defaultTitle:{en:'Resources',es:'Recursos'},embed:'interactive'},blocks:[block],assets:{font:{kind:'font',path:'font.ttf'},data:{kind:'data',path:'data.json'},portrait:{kind:'image',path:'portrait.png'}},assetFiles:{'font.ttf':async()=>new Blob([fontBytes()],{type:'font/ttf'}),'data.json':async()=>new Blob(['{"default":"AA"}'],{type:'application/json'}),'portrait.png':async()=>new Blob([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],{type:'image/png'})}});
 const files=await Promise.all(Object.entries(source.assetFiles!).map(async([path,load])=>{const blob=await load();return{path,bytes:blob.size,sha256:await sha(blob)};}));files.push({path:'module.tsx',bytes:0,sha256:await sha('')});
 const manifest={format:LOCAL_TOOL_SOURCE_FORMAT,apiVersion:1 as const,namespace,version:'1.0.0',files,contentHash:''};manifest.contentHash=await sha(localToolReleaseIdentity(manifest));registerLocalToolModules({[`./installed/${namespace}/versions/${manifest.contentHash}/module.tsx`]:{default:source}},{[`./installed/${namespace}/versions/${manifest.contentHash}/release.json`]:manifest});
 const project:Project={id,title:'Resource review '+id,description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['writings','codex','local-tool-'+namespace],createdAt:1,updatedAt:1,localToolInstallations:{[namespace]:{contentHash:manifest.contentHash,revision:1,updatedAt:1}}};await db.projects.put(project);
 const client=createLocalToolClient(id,source,{requireSelectedRelease:true,releaseHash:manifest.contentHash});
 const font=await client.assets.import(new File([fontBytes()],'public.ttf',{type:'font/ttf'}),'font'),data=await client.assets.import(new File([JSON.stringify({sample:PAYLOAD,public:'PUBLIC_RESOURCE_DATA'})],'public.json',{type:'application/json'}),'data');
 await client.assets.installation.set('font',font.ref,(await client.assets.installation.read()).version);await client.assets.installation.set('data',data.ref,(await client.assets.installation.read()).version);
 const privateFont=await client.assets.import(new File([secondFont()],'private.ttf',{type:'font/ttf'}),'font'),privateData=await client.assets.import(new File(['PRIVATE_RESOURCE_DATA'],'private.txt',{type:'text/plain'}),'data');
 const unused=await client.assets.import(new File(['UNUSED_INVENTORY_BYTES'],'unused.txt',{type:'text/plain'}),'data');
 const envelope=createLocalToolBlockEnvelope(namespace,block,id+'-visible') as LocalToolOwnedBlockEnvelope,privateEnvelope={...structuredClone(envelope),id:id+'-private',data:{assetOverrides:{font:privateFont.ref,data:privateData.ref}}} as LocalToolOwnedBlockEnvelope;
 const content=serializeLocalToolBlock(id,envelope),writing:Writing={id:id+'-writing',projectId:id,title:'AA resource chapter',content,wordCount:2,status:'draft',chapter:1,tags:[],createdAt:1,updatedAt:1};await db.writings.put(writing);
 const card:CodexEntry={id:id+'-card',projectId:id,title:'Resource card',type:'custom',content:content+`<div data-wh-wiki-hidden="true">${serializeLocalToolBlock(id,privateEnvelope)}</div>`,fields:{},tags:[],relations:[],createdAt:1,updatedAt:1,revealed:true};await db.codexEntries.put(card);
 return{project,client,envelope,writing,card,font,data,privateFont,privateData,unused,fontToken:await sha(new Blob([fontBytes()])),privateToken:await sha(new Blob([secondFont()]))};
}

async function fontInFrame(html:string){
 const frame=document.createElement('iframe');frame.hidden=true;document.body.append(frame);
 try{
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Export frame load timed out')),10000);frame.onload=()=>{clearTimeout(timer);resolve();};frame.srcdoc=html;});
  const doc=frame.contentDocument!,win=frame.contentWindow!;await doc.fonts.ready;const section=doc.querySelector<HTMLElement>('section[data-wh-asset-font]');assert(section,'Final HTML has no font-bound preview');
  const family=win.getComputedStyle(section).fontFamily.split(',')[0].replaceAll('"','');assert(family.startsWith('wh-asset-'),'Preview lost its own family');
  const loaded=await doc.fonts.load('20px '+family,'AA');assert(loaded.length>0&&loaded.every(face=>face.status==='loaded')&&doc.fonts.check('20px '+family,'AA'),`Real admitted font did not load under final CSP: family=${family}; loaded=${JSON.stringify(loaded.map(face=>({family:face.family,status:face.status})))}; set=${JSON.stringify([...doc.fonts].map(face=>({family:face.family,status:face.status})))}; faceRules=${(html.match(/@font-face/g)||[]).length}`);
  const context=doc.createElement('canvas').getContext('2d')!;context.font='20px '+family;const width=context.measureText('AA').width;context.font='20px monospace';const fallback=context.measureText('AA').width;assert(Math.abs(width-24)<.01&&Math.abs(width-fallback)>.01,`Glyph proof used fallback: actual=${width}, fallback=${fallback}`);
  assert(!doc.querySelector('[data-review-injected]')&&section.textContent?.includes('<img')&&section.textContent.includes('PUBLIC_RESOURCE_DATA'),'Data were not rendered as escaped literal text');assert(!(win as unknown as {REVIEW_INJECTED?:number}).REVIEW_INJECTED,'Data executed');
  const csp=doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')??'';assert(csp.includes('font-src data:')&&csp.includes("connect-src 'none'")&&!/font-src[^;]*(https?:|\*)/.test(csp),'Final font CSP widened remote access');
  assert(!section.querySelector('button,input,select,[contenteditable="true"]'),'Readonly preview contains authored controls');
 }finally{frame.remove();}
}

export async function reviewLocalFontFaceBinding(){
 const native=globalThis.FontFace,host=document.createElement('div');document.body.append(host);const root=createRoot(host),before=new Set(document.fonts),sentinel=await new native('review-unowned',fontBytes()).load();document.fonts.add(sentinel);
 const pending:{face:FontFace;resolve:()=>void;reject:()=>void}[]=[];
 class DeferredFace extends native {load():Promise<FontFace>{return new Promise((resolve,reject)=>pending.push({face:this,resolve:()=>resolve(this),reject:()=>reject(Error('controlled load rejection'))}));}}
 const asset=(id:string):LocalAssetResolved=>({blob:new Blob([fontBytes()],{type:'font/ttf'}),kind:'font',mime:'font/ttf',version:id,ref:{kind:'file',id},origin:'document',slot:'font'}),a=asset('A'),b=asset('B'),c=asset('C');
 function Probe({value,second=true}:{value:LocalAssetResolved|null;second?:boolean}){const first=useLocalToolFontFace(value),other=useLocalToolFontFace(second?value:null);return <><output data-review-first>{JSON.stringify({family:first.family,loading:first.loading,error:first.error})}</output><output data-review-second>{JSON.stringify({family:other.family,loading:other.loading,error:other.error})}</output></>;}
 const read=(selector:string)=>JSON.parse(host.querySelector(selector)!.textContent!) as {family?:string;loading:boolean;error?:string};
 try{
  globalThis.FontFace=DeferredFace as typeof FontFace;
  await act(async()=>{root.render(<StrictMode><Probe value={a}/></StrictMode>);await pause();});await until(()=>pending.length===2,'StrictMode did not create only live A callers');const old=[...pending];
  await act(async()=>{root.render(<StrictMode><Probe value={b}/></StrictMode>);await pause();});await until(()=>pending.length===4,'B callers not started');assert(!read('[data-review-first]').family&&read('[data-review-first]').loading,'Retarget exposed stale family before load');
  await act(async()=>{pending[2].resolve();pending[3].resolve();await pause();});const first=read('[data-review-first]').family,second=read('[data-review-second]').family;assert(first&&second&&first!==second,'Two callers shared font identity');
  await act(async()=>{old.forEach(item=>item.resolve());await pause();});assert(read('[data-review-first]').family===first&&[...document.fonts].filter(face=>!before.has(face)&&face!==sentinel).length===2,'Late A resolution leaked faces or replaced B');
  await act(async()=>{root.render(<StrictMode><Probe value={b} second={false}/></StrictMode>);await pause();});assert(read('[data-review-first]').family===first&&[...document.fonts].filter(face=>!before.has(face)&&face!==sentinel).length===1,'One caller cleanup deleted another owner or leaked');
  await act(async()=>{root.render(<StrictMode><Probe value={null}/></StrictMode>);await pause();});assert(!read('[data-review-first]').family&&[...document.fonts].filter(face=>!before.has(face)&&face!==sentinel).length===0,'Null binding retained a face');
  await act(async()=>{root.render(<StrictMode><Probe value={c} second={false}/></StrictMode>);await pause();});await until(()=>pending.length===5,'Rejected load not started');await act(async()=>{pending[4].reject();await pause();});assert(read('[data-review-first]').error&&!read('[data-review-first]').family,'Rejected load did not report an error');assert(document.fonts.has(sentinel),'Hook deleted unrelated face');
  return['Independent FontFace hook: StrictMode, two owners, late A→B, cleanup/null/reject preserve exact owner and unrelated faces'];
 }finally{await act(async()=>{root.unmount();await pause();});globalThis.FontFace=native;document.fonts.delete(sentinel);host.remove();assert([...document.fonts].every(face=>before.has(face)),'Unmount leaked owned font');}
}

export async function reviewLocalAssetFinalCsp(){
 const id='asset-export-csp',f=await fixture(id);readonlyMounts=0;
 try{
  const snapshot=await capturePublicationSnapshot({projectId:id}),source=publicationReaderSource(snapshot);assert(!snapshot.tables.localToolAssetFiles.some(row=>row.id===f.unused.id),'Capture copied unused inventory');
  db.close({disableAutoOpen:true});
  try{
   const reader=await buildReaderHtml(source.project,source.writings,safeReaderPresentation(),'en',{projectId:id},source);await fontInFrame(reader.html);
   const options={locale:'en' as const},data=await loadWorldWikiData(id,options,{...source,images:source.capturedImages!()}),wiki=buildWorldWiki(data,options);await fontInFrame(wiki.html);
   assert(!wiki.html.includes(f.privateToken)&&!wiki.html.includes('PRIVATE_RESOURCE_DATA')&&!wiki.html.includes('UNUSED_INVENTORY_BYTES'),'Final wiki leaked omitted resources');assert(!db.isOpen()&&readonlyMounts===0,'Closed captured export opened DB or mounted authored tool');
   return['Independent captured Reader/wiki load actual procedural glyphs under final data-only font CSP with escaped data, no private/unused bytes, no readonly mount or live DB'];
  }finally{await db.open();}
 }finally{if(!db.isOpen())await db.open();await deleteProject(id);}
}

export async function reviewLocalAssetPoliciesAndMissingCapture(){
 const id='asset-export-policy',f=await fixture(id);
 try{
  const portrait=(await f.client.assets.slot('portrait'))!,imageData='data:image/png;base64,'+btoa(String.fromCharCode(...new Uint8Array(await portrait.blob.arrayBuffer()))),imageId=id+'-gallery';
  await db.inspirationImages.put({id:imageId,projectId:id,imageData,name:'Exact policy gallery',notes:'',tags:[],createdAt:1});await f.client.assets.installation.set('portrait',{kind:'image',id:imageId},(await f.client.assets.installation.read()).version);
  const source=publicationReaderSource(await capturePublicationSnapshot({projectId:id}));assert(source.capturedImages!().some(row=>row.id===imageId&&row.imageData===imageData),'Policy fixture did not capture the exact gallery identity');db.close({disableAutoOpen:true});
  try{
   const collector:LocalAssetFont[]=[],noImages=await sourceBlockPreviewHtml(f.envelope,id,'en',{source,includeImages:false,assetFontCollector:collector});assert(noImages.includes('PUBLIC_RESOURCE_DATA')&&collector.length===1&&!new DOMParser().parseFromString(noImages,'text/html').querySelector('img'),'includeImages=false suppressed font/data or retained image');
   const imageIn=(html:string)=>new DOMParser().parseFromString(html,'text/html').querySelector('img')?.getAttribute('src');
   const normal=await sourceBlockPreviewHtml(f.envelope,id,'en',{source});assert(imageIn(normal)===imageData&&normal.includes('PUBLIC_RESOURCE_DATA')&&normal.includes('@font-face'),'Normal policy did not preserve exact gallery/font/data');
   const noMediaFonts:LocalAssetFont[]=[],noMedia=await sourceBlockPreviewHtml(f.envelope,id,'en',{source,includeMedia:false,assetFontCollector:noMediaFonts});assert(!noMedia.includes('PUBLIC_RESOURCE_DATA')&&!noMedia.includes('@font-face')&&noMediaFonts.length===0,'includeMedia=false retained font/data');assert(imageIn(noMedia)===imageData,'includeMedia=false incorrectly omitted gallery image controlled by includeImages');
   const neither=await sourceBlockPreviewHtml(f.envelope,id,'en',{source,includeMedia:false,includeImages:false});assert(!neither.includes('PUBLIC_RESOURCE_DATA')&&!neither.includes('@font-face')&&!imageIn(neither),'Combined media/images exclusion retained a resource');
   const missing={...source,capturedAssetFiles:undefined},unavailable=await sourceBlockPreviewHtml(f.envelope,id,'en',{source:missing});assert(!unavailable.includes('PUBLIC_RESOURCE_DATA')&&!unavailable.includes('@font-face')&&!db.isOpen(),'Legacy capture accessed live DB or rescued a default behind unavailable file');
   const missingReader=await buildReaderHtml(missing.project,missing.writings,safeReaderPresentation(),'en',{projectId:id},missing),missingDoc=new DOMParser().parseFromString(missingReader.html,'text/html');assert(!missingReader.html.includes('@font-face')&&!missingDoc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')?.includes('font-src'),'Font-free captured Reader unnecessarily changed legacy CSP');
   const options={locale:'en' as const,includeImages:false},wiki=buildWorldWiki(await loadWorldWikiData(id,options,{...source,images:source.capturedImages!()}),options);assert(wiki.html.includes('PUBLIC_RESOURCE_DATA')&&wiki.html.includes('@font-face')&&!new DOMParser().parseFromString(wiki.html,'text/html').querySelector('img'),'Final wiki conflates images and media policies');
   const disabled={...options,includeMedia:false},omitted=buildWorldWiki(await loadWorldWikiData(id,disabled,{...source,images:source.capturedImages!()}),disabled);assert(!omitted.html.includes('PUBLIC_RESOURCE_DATA')&&!omitted.html.includes('@font-face')&&!new DOMParser().parseFromString(omitted.html,'text/html').querySelector('img'),'Final wiki combined media/images exclusion lost');
   const font=collector[0],marker=`<section data-wh-local-tool-preview data-wh-asset-font="${font.token}"></section>`;assert(localAssetFontCss([font,font],marker).split('@font-face').length===2,'CSS duplicates token');assert(!localAssetFontCss([{...font,token:'x";bad'}],marker),'CSS admitted ungenerated token');assert(!localAssetFontCss([font],''),'Root/author known empty-final-HTML CSS regression returned');
   return['Independent policies preserve exact gallery with media omitted, retain font/data with images omitted, combine both exclusions, never rescue missing captured files and reject malformed CSS tokens'];
  }finally{await db.open();}
 }finally{if(!db.isOpen())await db.open();await deleteProject(id);}
}

export async function reviewLocalAssetWikiFinalVisibility(){
 const id='asset-export-final-html',f=await fixture(id);
 try{
  const source=publicationReaderSource(await capturePublicationSnapshot({projectId:id})),options:WorldWikiOptions={locale:'en',excludedEntryIds:[f.card.id]},data=await loadWorldWikiData(id,options,{...source,images:source.capturedImages!()});
  const excludedHtml=buildWorldWiki(data,options).html;assert(!excludedHtml.includes('@font-face'),'Excluded only card retained font bytes');assert(!new DOMParser().parseFromString(excludedHtml,'text/html').querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')?.includes('font-src'),'Font-free final wiki unnecessarily changed legacy CSP');
  const visibleOptions={locale:'en' as const},normal=await loadWorldWikiData(id,visibleOptions,{...source,images:source.capturedImages!()}),altered=structuredClone(normal);
  // Public buildWorldWiki re-sanitizes cached previews; removed markup cannot
  // justify embedding a font in the final head.
  const key=Object.keys(altered.toolPreviews!.blocks)[0];assert(key,'Native cached preview missing');altered.toolPreviews!.blocks[key].html=`<style>section[data-wh-asset-font="${f.fontToken}"]{}</style><p>Visible plain text</p>`;
  const html=buildWorldWiki(altered,visibleOptions).html,doc=new DOMParser().parseFromString(html,'text/html');assert(!doc.body.querySelector('[data-wh-asset-font]'),'Fixture should have no visible generated marker');assert(!html.includes('@font-face'),'Font CSS was selected from discarded cached markup rather than final visible HTML');
  const document=await createSourceToolDocument({projectId:id},f.envelope.namespace,'Standalone resources'),standaloneSource=publicationReaderSource(await capturePublicationSnapshot({projectId:id}));
  const standaloneOptions:WorldWikiOptions={locale:'en',excludedEntryIds:[f.card.id],additionalDocuments:[{kind:'local-tool',id:document.id,namespace:f.envelope.namespace}]},standaloneData=await loadWorldWikiData(id,standaloneOptions,{...standaloneSource,images:standaloneSource.capturedImages!()});
  assert(standaloneData.standalone?.pages.length===1,'Native standalone preview was not captured');const discarded=structuredClone(standaloneData);discarded.standalone!.pages[0].preview.html=`<style>section[data-wh-asset-font="${f.fontToken}"]{}</style><p>Visible standalone text</p>`;
  const standaloneHtml=buildWorldWiki(discarded,standaloneOptions).html,standaloneDoc=new DOMParser().parseFromString(standaloneHtml,'text/html');assert(!standaloneDoc.body.querySelector('[data-wh-asset-font]'),'Standalone fixture should have no final generated marker');assert(!standaloneHtml.includes('@font-face'),'Standalone font CSS selected discarded cached markup instead of final sanitized body');
  return['Independent final wiki font selection excludes hidden cards and discarded cached markup, using only final admitted preview markers'];
 }finally{await deleteProject(id);}
}

export async function reviewLocalAssetPublishedFreeze(){
 const id='asset-export-published',f=await fixture(id);
 try{
  const published=await publishEdition({projectId:id,chapterIds:[f.writing.id],title:'Frozen resource edition',locale:'en',expectedRevision:0}),html=published.edition.reader.html,digest=published.edition.reader.sha256;
  assert(html.includes('@font-face')&&html.includes('PUBLIC_RESOURCE_DATA')&&await sha(html)===digest,'Native published artifact lost font/data/hash');
  const prepared=await preparePublishedEdition({projectId:id,chapterIds:[f.writing.id],title:'Must conflict after source change',locale:'en',expectedRevision:1});
  const snapshot=await capturePublicationSnapshot({projectId:id}),changed=structuredClone(snapshot),file=changed.tables.localToolAssetFiles.find(row=>row.id===f.data.id)!;file.blob=new Blob(['DIFFERENT_CAPTURE_BYTES'],{type:'application/json'});assert(await publicationSourceFingerprint(changed)!==await publicationSourceFingerprint(snapshot),'Source fingerprint ignores captured Blob bytes');
  const next=await f.client.assets.import(new File(['{"public":"LATER_LIVE_DATA"}'],'later.json',{type:'application/json'}),'data');await f.client.assets.installation.set('data',next.ref,(await f.client.assets.installation.read()).version);
  let rejected=false;try{await commitPublishedEdition(prepared,1);}catch{rejected=true;}assert(rejected,'Changed live resource selection did not invalidate captured source commit');
  await db.localToolAssetFiles.where('projectId').equals(id).delete();const reread=await getPublishedEdition(id,published.edition.id);assert(reread.reader.html===html&&reread.reader.sha256===digest,'Reading old edition rebuilt source or changed artifact');
  await fontInFrame(reread.reader.html);assert(readonlyMounts===0,'Published readonly artifact mounted authored tool');
  return['Independent native publication freezes real font/data HTML and hash; captured bytes affect fingerprint, changed sources conflict and deleting live files does not rebuild artifact'];
 }finally{await deleteProject(id);}
}
