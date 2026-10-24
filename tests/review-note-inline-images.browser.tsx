import { act, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Editor } from '@tiptap/core';
import NoteRichEditor from '@/engines/notes/components/NoteRichEditor';
import NoteCard from '@/engines/notes/components/NoteCard';
import { useLocaleStore } from '@/stores/localeStore';
import {t} from '@/i18n/useTranslation';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import type { Note } from '@/engines/notes/types';
import {sanitizeRichHtml} from '@/utils/sanitizeRichHtml';
import {noteImageLayoutCss,NOTE_IMAGE_LAYOUT_CSS} from '@/components/editor/blocks/imageLayout';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {undoAuditEntry} from '@/services/aiBridge/undo';
import {buildDocumentImage} from '@/services/documentImage/build';
import {buildWorldWiki,loadWorldWikiData} from '@/services/worldWikiExport';
import {captureWikiSnapshot,wikiSource} from '@/services/wikiProfiles/snapshot';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(test: () => boolean, message: string) { for (let n=0;n<160;n++) { if(test()) return; await act(async()=>{await pause();}); } throw Error(message); }
function named(root: ParentNode, name: string) { const result=[...root.querySelectorAll<HTMLButtonElement>('button')].find(button=>(button.getAttribute('aria-label')||button.getAttribute('title')||button.textContent||'').trim()===name); assert(result,'Missing normal control '+name); return result; }
async function click(root: ParentNode, name: string) { await act(async()=>{named(root,name).click();await pause();}); }
function raster(color: string, filename='same-original.png') { const canvas=document.createElement('canvas');canvas.width=32;canvas.height=16;const ctx=canvas.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,16,16);const src=canvas.toDataURL('image/png');return {src,file:new File([Uint8Array.from(atob(src.split(',')[1]),char=>char.charCodeAt(0))],filename,{type:'image/png'})}; }
async function file(root: ParentNode, value: File) { let target:HTMLInputElement|undefined;const original=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){if(this.type==='file')target=this;else original.call(this);};try{await click(root,'File');}finally{HTMLInputElement.prototype.click=original;}assert(target,'File control did not open native chooser input');const transfer=new DataTransfer();transfer.items.add(value);await act(async()=>{target!.files=transfer.files;target!.dispatchEvent(new Event('change',{bubbles:true}));await pause();}); }
function editor(host: ParentNode) { const view=host.querySelector<HTMLElement>('.ProseMirror') as (HTMLElement&{editor:Editor})|null;assert(view?.editor,'Real Tiptap editor absent');return view.editor; }
function imagePositions(native: Editor) { const values:number[]=[];native.state.doc.descendants((node,pos)=>{if(node.type.name==='image')values.push(pos);});return values; }
function controls(host: ParentNode) { const element=host.querySelector<HTMLElement>('[data-note-image-controls]');assert(element,'Image controls absent');return element; }
async function insert(host: ParentNode, value: File, expected: number) { const ui=controls(host);await click(ui,'Image');await file(ui,value);await until(()=>host.querySelectorAll('.ProseMirror img').length===expected,'Real File acquisition did not insert '+expected+' image(s)'); }
function holdDecode(src: string) { const real=HTMLImageElement.prototype.decode;let release!:()=>void,ready=false,calls=0;const gate=new Promise<void>(resolve=>{release=resolve;});HTMLImageElement.prototype.decode=async function(){await real.call(this);if(this.src===src){assert(this.naturalWidth===32&&this.naturalHeight===16,'Real raster decoder did not validate own fixture');calls++;ready=true;await gate;}};return{ready:()=>ready,calls:()=>calls,release,restore:()=>{release();HTMLImageElement.prototype.decode=real;}}; }
async function setup(suffix: string, render: (projectId:string)=>React.ReactNode, run:(host:HTMLElement,projectId:string)=>Promise<void>) { const host=document.getElementById('root')!;const root=createRoot(host),id='review-note-inline-'+suffix,locale=useLocaleStore.getState().locale;try{await db.projects.put({id,title:'Independent note QA',description:'',mode:'custom',type:'standalone',status:'draft',color:'#888888',enabledEngines:['notes'],createdAt:1,updatedAt:1});useLocaleStore.setState({locale:'en',loaded:true});await act(async()=>{root.render(<StrictMode>{render(id)}</StrictMode>);await pause();});await run(host,id);}finally{await act(async()=>{root.unmount();await pause();});useLocaleStore.setState({locale});if(await db.projects.get(id))await deleteProject(id);} }
function Rich({projectId}:{projectId:string}) { const [html,setHtml]=useState('<h2>Keep heading</h2><p>Keep neighboring prose</p>');return <NoteRichEditor projectId={projectId} noteId="independent-owned-note" html={html} onChange={(_text,value)=>setHtml(value)}/>; }

export async function testReviewNoteReplaceDeletedTwin():Promise<string[]> {
 const original=raster('#d04b21'),replacement=raster('#255acf','replacement.png');
 await setup('deleted-twin',id=><Rich projectId={id}/>,async host=>{
  await until(()=>!!host.querySelector('[data-note-image-controls]'),'Image controls not ready');
  await insert(host,original.file,1);
  const native=editor(host);const firstAcquired=imagePositions(native)[0];await act(async()=>{native.commands.setTextSelection(firstAcquired+native.state.doc.nodeAt(firstAcquired)!.nodeSize);await pause();});
  await insert(host,original.file,2);
  const [first,second]=imagePositions(native);assert(first!==undefined&&second!==undefined,'Two acquired nodes absent');
  const firstNode=native.state.doc.nodeAt(first)!,secondNode=native.state.doc.nodeAt(second)!;console.log('TWIN_FIXTURE '+JSON.stringify({first,second,firstSize:firstNode.nodeSize,doc:native.state.doc.toJSON()}));assert(second===first+firstNode.nodeSize,'Twin fixture nodes are not adjacent');assert(JSON.stringify(firstNode.attrs)===JSON.stringify(secondNode.attrs),'Twin control is not identical');
  const before=host.textContent;await act(async()=>{native.commands.setNodeSelection(first);await pause();});
  const decoder=holdDecode(replacement.src);
  try{
   await click(controls(host),'Replace image');await file(controls(host),replacement.file);await until(decoder.ready,'Replacement did not reach real decoder gate');
   await act(async()=>{native.view.dispatch(native.state.tr.delete(first,first+firstNode.nodeSize));await pause();});
   assert(host.querySelectorAll('.ProseMirror img').length===1,'Deletion control failed');
   await act(async()=>{decoder.release();await pause();});await act(async()=>{await pause();});
   const remaining=host.querySelector<HTMLImageElement>('.ProseMirror img');
   assert(remaining?.getAttribute('src')===original.src,'REPLACE_RETARGETED_DELETED_TWIN: deleting the pending target replaced its identical acquired neighbor; src='+remaining?.src);
   assert(host.querySelector('.ProseMirror h2')?.textContent==='Keep heading'&&host.textContent?.includes('Keep neighboring prose')&&before?.includes('Keep heading'),'Replacement/deletion changed neighboring prose');
  }finally{decoder.restore();}
 });
 return ['Normal File replacement with a real delayed decoder never retargets an identical adjacent acquired image after the selected target is deleted'];
}

export async function testReviewNoteSaveInvalidatesDecode():Promise<string[]> {
 const value=raster('#a83d91','pending-save.png');let releaseSave!:()=>void,entered=false,submitted:Partial<Note>|undefined,attempts=0;
 const saveGate=new Promise<void>(resolve=>{releaseSave=resolve;});
 const note:Note={id:'independent-save-note',projectId:'review-note-inline-save',kind:'note',text:'Keep neighboring prose',richHtml:'<h2>Keep heading</h2><p>Keep neighboring prose</p>',tags:[],pinned:false,createdAt:1,updatedAt:1};
 const decoder=holdDecode(value.src);
 try{
  await setup('save',()=> <NoteCard note={note} onDelete={()=>{}} onUpdate={async(_id,changes)=>{attempts++;submitted=changes;entered=true;await saveGate;if(attempts===1)throw Error('Deliberate persistence failure');}}/>,async host=>{
   await click(host,'Edit');await until(()=>!!host.querySelector('[data-note-image-controls]'),'Card controls absent');await click(controls(host),'Image');await file(controls(host),value.file);await until(decoder.ready,'Card did not await real decoder');
   await act(async()=>{named(host,t('common.save')).click();decoder.release();await pause();});
   assert(entered,'Normal parent Save did not reach writer');assert(!submitted?.richHtml?.includes(value.src),'Save captured pending acquisition unexpectedly');
   assert(!host.querySelector('.ProseMirror img'),'SAVE_LATE_IMAGE: pending decode inserted after synchronous Save began');
   await act(async()=>{releaseSave();await pause();});await until(()=>!!host.querySelector('[role="alert"]'),'Failed save did not retain retryable draft');
   assert(host.querySelector('.ProseMirror h2')?.textContent==='Keep heading'&&!host.querySelector('.ProseMirror img'),'Failed persistence lost draft or revived acquisition');
   await click(host,t('common.save'));await until(()=>!!host.querySelector('[data-note-rich-read]'),'Retry did not close through normal writer');assert(attempts===2&&!submitted?.richHtml?.includes(value.src),'Retry changed content with retired acquisition');
  });
 }finally{releaseSave();decoder.restore();}
 return ['Real NoteCard Save invalidates delayed decoded raster before React rerender/first persistence await; failure retains exact draft and normal retry does not resurrect acquisition'];
}

export async function testReviewNoteReplaceMappedLayout():Promise<string[]> {
 const original=raster('#d98722'),replacement=raster('#257f4c','new-picture.png');
 await setup('mapped-layout',id=><Rich projectId={id}/>,async host=>{
  await until(()=>!!host.querySelector('[data-note-image-controls]'),'Image controls absent');await insert(host,original.file,1);const native=editor(host);
  await act(async()=>{native.commands.setNodeSelection(imagePositions(native)[0]);await pause();});
  await act(async()=>{host.querySelector<HTMLButtonElement>('[data-testid="image-width-50"]')!.click();host.querySelector<HTMLButtonElement>('[data-testid="image-frame-polaroid"]')!.click();await pause();});await click(controls(host),'Image right');
  const decoded=holdDecode(replacement.src);
  try{
   await click(controls(host),'Replace image');await file(controls(host),replacement.file);await until(decoded.ready,'Replacement did not reach real decoder');
   await act(async()=>{host.querySelector<HTMLButtonElement>('[data-testid="image-width-75"]')!.click();await pause();});
   await act(async()=>{native.view.dispatch(native.state.tr.insert(0,native.schema.nodes.paragraph.create(null,native.schema.text('Prefix typed while decoding'))));await pause();});
   await act(async()=>{decoded.release();await pause();});await until(()=>host.querySelector<HTMLImageElement>('.ProseMirror img')?.getAttribute('src')===replacement.src,'Valid mapped replacement was canceled or inserted elsewhere');
   const node=host.querySelector<HTMLImageElement>('.ProseMirror img')!;assert(node.dataset.whWidth==='75'&&node.dataset.whFrame==='polaroid'&&node.dataset.whAlign==='right','Replacement did not retain current changed layout');
   assert(host.querySelectorAll('.ProseMirror img').length===1&&host.querySelector('.ProseMirror h2')?.textContent==='Keep heading'&&host.textContent?.includes('Prefix typed while decoding'),'Replacement did not preserve text/target identity');
  }finally{decoded.restore();}
 });
 return ['Normal replacement survives a width change and text insertion before its target during real decode, preserving the latest width/frame/alignment and prose'];
}

export async function testReviewNoteGalleryScope():Promise<string[]> {
 const thumb=raster('#b06f11','thumbnail.png'),original=raster('#1b7c8b','owned-original.png');
 await setup('gallery',id=><Rich projectId={id}/>,async(host,id)=>{
  await until(()=>!!host.querySelector('[data-note-image-controls]'),'Controls absent');
  const imageId=id+'-image';await db.inspirationImages.put({id:imageId,projectId:id,imageData:thumb.src,imageDataOriginal:original.src,notes:'Independent original choice',tags:[],createdAt:1});
  await click(controls(host),'Image');await click(controls(host),'Gallery');await until(()=>[...document.querySelectorAll('button')].some(button=>button.textContent?.trim()==='Independent original choice'),'Own gallery row absent');
  const cached=named(document.body,'Independent original choice');
  await db.inspirationImages.update(imageId,{projectId:'foreign-gallery-owner'});
  assert(cached.isConnected,'Stale-row fixture refreshed before its click');
  await act(async()=>{cached.click();await pause();});await until(()=>!!host.querySelector('[data-note-image-controls] [role="alert"]'),'Foreign reassigned gallery row was not refused');
  assert(!host.querySelector('.ProseMirror img'),'Cached gallery choice copied bytes from a foreign owner');
  await db.inspirationImages.update(imageId,{projectId:id});
  await click(controls(host),'Image');await click(controls(host),'Gallery');await until(()=>[...document.querySelectorAll('button')].some(button=>button.textContent?.trim()==='Independent original choice'),'Valid gallery retry absent');
  await click(document.body,'Independent original choice');await until(()=>host.querySelector<HTMLImageElement>('.ProseMirror img')?.getAttribute('src')===original.src,'Gallery did not copy freshly read original bytes on retry');
  assert(host.querySelector<HTMLImageElement>('.ProseMirror img')?.getAttribute('src')!==thumb.src,'Gallery used presentation thumbnail rather than original');
 });
 return ['Normal Gallery revalidates the real row/project after a cached chooser row becomes foreign, retains the draft on rejection and retries with current original bytes'];
}

export async function testReviewNoteImageColdPresentation():Promise<string[]> {
 const src=raster('#b83f71').src,legacy=document.createElement('div');legacy.style.width='800px';legacy.innerHTML=`<img src="${src}" data-wh-width="25" data-wh-frame="border" alt="Outside legacy control">`;document.body.append(legacy);
 const old=legacy.querySelector<HTMLImageElement>('img')!;await old.decode();const measure=()=>{const css=getComputedStyle(old);return JSON.stringify({width:css.width,height:css.height,display:css.display,marginLeft:css.marginLeft,marginRight:css.marginRight,border:css.border,padding:css.padding});};const before=measure();
 try{
  const richHtml=`<p data-wh-align="justify">Legacy paragraph</p><h2 data-wh-align="right">Legacy heading</h2><img src="${src}" data-wh-width="50" data-wh-frame="polaroid" data-wh-align="right" alt="Aligned new"><img src="${src}" data-wh-width="25" data-wh-frame="border" alt="Legacy inner">`;
  const sanitized=sanitizeRichHtml(richHtml),doc=new DOMParser().parseFromString(sanitized,'text/html');assert(doc.querySelector('p')?.getAttribute('data-wh-align')==='justify'&&doc.querySelector('h2')?.getAttribute('data-wh-align')==='right','P/H legacy alignment changed');
  for(const html of ['<p data-wh-align="right">Only legacy prose</p>','<span data-wh-align="right">Not IMG</span>',`<img src="${src}" data-wh-align="justify">`,'<img data-wh-align="right">','&lt;img data-wh-align="right"&gt;','<img src="data:image/svg+xml;base64,PHN2Zy8+" data-wh-align="right">'])assert(noteImageLayoutCss(sanitizeRichHtml(html))==='','Non-image/removed/invalid alignment activated image CSS: '+html);
  assert(noteImageLayoutCss(sanitized)===NOTE_IMAGE_LAYOUT_CSS,'Valid image did not activate separate fragment');
  await setup('cold',id=><NoteCard note={{id:'cold-note',projectId:id,kind:'note',text:'Legacy paragraph\nLegacy heading',richHtml:sanitized,tags:[],pinned:false,createdAt:1,updatedAt:1}} onUpdate={()=>{throw Error('Readonly cold mount wrote');}} onDelete={()=>{}}/>,async host=>{
   const image=host.querySelector<HTMLImageElement>('[data-note-rich-read] img[alt="Aligned new"]')!;await image.decode();assert(!host.querySelector('.ProseMirror'),'Cold read mounted editor');
   const css=getComputedStyle(image),parent=getComputedStyle(image.parentElement!);assert(Math.abs(parseFloat(css.width)-parseFloat(parent.width)*.5)<2&&css.marginRight==='0px'&&parseFloat(css.marginLeft)>0,'Cold read is not half-width/right: '+JSON.stringify({width:css.width,parent:parent.width,left:css.marginLeft,right:css.marginRight}));
   assert(css.paddingBottom==='34px'&&css.transform!=='none','Cold read lost polaroid framing');assert(measure()===before,'New image CSS changed an unaligned legacy sibling');
   assert(!host.querySelector('[data-note-rich-read] img[alt="Legacy inner"]')?.hasAttribute('data-wh-align'),'Cold read invented legacy alignment');
  });
 }finally{legacy.remove();}
 return ['Cold real NoteCard uses half-width/right/polaroid without opening Tiptap, while a measured unaligned legacy sibling remains exact','P/H legacy alignment survives; only sanitized raster IMG with left/center/right activates image CSS, never missing/active/invalid/tag/text controls'];
}

export async function testReviewNoteImageMcpContracts():Promise<string[]> {
 await setup('mcp',()=>null,async(_host,projectId)=>{
  const src=raster('#1647bd').src;
  const call=async(name:string,args:Record<string,unknown>)=>{const reply=await runBridgeTool(name,{projectId,...args});assert(reply.ok,name+': '+JSON.stringify(reply));return reply.result as Record<string,unknown>;};
  for(const richHtml of ['<img>','<img src="">','<img src="javascript:bad()" data-wh-align="right">','<img src="data:image/svg+xml;base64,PHN2Zy8+" data-wh-align="right">']){const reply=await runBridgeTool('wh_create_note',{projectId,text:'',richHtml});assert(!reply.ok,'Invalid normalized image created empty note: '+richHtml);}
  const missing=await runBridgeTool('wh_create_note',{projectId,richHtml:`<img src="${src}">`});assert(!missing.ok,'Missing required text was accepted');
  const created=await call('wh_create_note',{text:'',richHtml:`<img src="${src}" data-wh-width="50" data-wh-frame="polaroid" data-wh-align="right">`}),id=String(created.id);const row=(await db.notes.get(id))!;assert(row.text===''&&row.richHtml?.includes('data-wh-align="right"')&&row.richHtml.includes(src),'Image-only note lost coherent projection or bytes');
  await call('wh_update_note',{id,pinned:true});assert((await db.notes.get(id))?.richHtml===row.richHtml,'Metadata update removed image content');
  const plain=await call('wh_update_note',{id,text:'Explicit plain'});assert((await db.notes.get(id))?.richHtml===undefined,'Plain update retained stale image HTML');
  await undoAuditEntry({entry:{...(plain.__audit as object),kind:'update',tool:'wh_update_note'}});assert((await db.notes.get(id))?.richHtml===row.richHtml&&(await db.notes.get(id))?.text==='','Native Undo did not restore exact image/plain pair');
  const listed=await call('wh_list_notes',{});assert(JSON.stringify(listed).includes(src),'Native read omitted image content');
 });
 return ['Registered native note dispatcher rejects missing/empty/active image content, preserves coherent image-only create/list and metadata, and plain replacement Undo restores exact rich/plain pair'];
}

export async function testReviewNoteImageCapturedExports():Promise<string[]> {
 await setup('exports',()=>null,async(_host,projectId)=>{
  const src=raster('#478c21').src,html=`<p>Captured note</p><img src="${src}" data-wh-width="50" data-wh-frame="polaroid" data-wh-align="right">`,id=projectId+'-note';
  await db.notes.put({id,projectId,kind:'note',text:'Captured note',richHtml:html,tags:[],pinned:false,createdAt:1,updatedAt:1});
  const before=JSON.stringify(await db.notes.get(id)),options={locale:'en' as const,includeMaps:false,types:[],additionalDocuments:[{kind:'notes' as const,id}]};
  const snapshot=wikiSource(await captureWikiSnapshot({projectId}));db.close();
  try{
   const wiki=buildWorldWiki(await loadWorldWikiData(projectId,options,snapshot),options).html;assert(wiki.includes(NOTE_IMAGE_LAYOUT_CSS)&&new DOMParser().parseFromString(wiki,'text/html').querySelector('#wiki img[data-wh-align="right"]')?.getAttribute('src')===src,'Frozen wiki lost own aligned image');
   for(const filtered of [{...options,includeImages:false},{...options,additionalDocuments:[]}]){const output=buildWorldWiki(await loadWorldWikiData(projectId,filtered,snapshot),filtered).html;assert(!output.includes(NOTE_IMAGE_LAYOUT_CSS),'Omitted final image emitted new layout CSS');}
  }finally{await db.open();}
  const image=await buildDocumentImage({projectId,kind:'notes',entityId:id,locale:'en'});assert(image.html.includes(NOTE_IMAGE_LAYOUT_CSS)&&image.html.includes(src),'DocumentImage omitted admitted layout or original raster');
  assert(JSON.stringify(await db.notes.get(id))===before,'Frozen exports/DocumentImage wrote note');
 });
 return ['Captured wiki with DB closed preserves original aligned raster; images-off/omitted document emit no image CSS, and native DocumentImage includes the same conditional layout without writes'];
}
