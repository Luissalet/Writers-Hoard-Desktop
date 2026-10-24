import { db } from '@/db';
import { deleteProject, exportProjectData, importProjectData } from '@/db/operations';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { buildWorldWiki, loadWorldWikiData } from '@/services/worldWikiExport';
import { captureWikiSnapshot, wikiSource } from '@/services/wikiProfiles/snapshot';
import { buildDocumentImage } from '@/services/documentImage/build';
import { createNote, makeNote } from '@/engines/notes/operations';
import { NOTE_IMAGE_LAYOUT_CSS, noteImageLayoutCss } from '@/components/editor/blocks/imageLayout';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import NoteCard from '@/engines/notes/components/NoteCard';
import { MemoryRouter } from 'react-router-dom';
const P='notes-rich-portability';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const parse=(html:string)=>new DOMParser().parseFromString(html,'text/html');
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
export async function testNotesRichPortability():Promise<string[]>{
 const clones:string[]=[],passed:string[]=[];
 try{
  await db.projects.put({id:P,title:'Rich note portability',description:'',mode:'custom',type:'standalone',status:'draft',color:'#888888',enabledEngines:['notes'],createdAt:1,updatedAt:1});
  const note=makeNote(P,{title:'Harbor note',text:'unused fallback',richHtml:`<h2>Pistas del puerto</h2><ul><li><p>Revisar el faro</p></li><li><p>Hablar con la capitana</p></li></ul><p><img src="${PNG}" alt="Local illustration"></p>`,cover:PNG});await createNote(note);
  const legacy=makeNote(P,{text:'Literal <h2>plain note</h2> & preserved\nSecond line'});await createNote(legacy);const before=JSON.stringify(await db.notes.where('projectId').equals(P).toArray());
  const options={locale:'en' as const,includeMaps:false,types:[],additionalDocuments:[{kind:'notes' as const,id:note.id},{kind:'notes' as const,id:legacy.id}]};
  const snapshot=wikiSource(await captureWikiSnapshot({projectId:P}));db.close();
  try{
   const wiki=parse(buildWorldWiki(await loadWorldWikiData(P,options,snapshot),options).html),root=wiki.querySelector('#wiki')!;
   assert([...root.querySelectorAll('h2')].some(heading=>heading.textContent==='Pistas del puerto')&&root.querySelector('ul li')?.textContent?.includes('Revisar el faro')&&root.querySelectorAll('img').length===2,'Captured standalone note wiki lost rich heading/list/inline image or cover');
   assert(root.textContent?.includes('Literal <h2>plain note</h2> & preserved'),'Legacy plain note became HTML');
   const without={...options,includeImages:false};assert(!parse(buildWorldWiki(await loadWorldWikiData(P,without,snapshot),without).html).querySelector('#wiki img'),'Images-off retained note inline image or cover');
  }finally{await db.open();}
  assert(JSON.stringify(await db.notes.where('projectId').equals(P).toArray())===before,'Readonly snapshot/export migrated note rows');
  const image=await buildDocumentImage({projectId:P,kind:'notes',entityId:note.id,locale:'en'});assert(image.html.includes('<h2>Pistas del puerto</h2>')&&image.html.includes('<li>')&&image.html.includes(PNG),'Native document image export source flattened rich note');
  passed.push('Captured standalone wiki with DB closed preserves rich heading/list/local inline image and cover, images-off removes both, plain legacy output stays literal; normal image-export source keeps rich content without read migration');
  const cloneId=await importProjectData(await exportProjectData(P));clones.push(cloneId);const cloned=(await db.notes.where('projectId').equals(cloneId).toArray()).find(row=>row.title==='Harbor note');assert(cloned?.richHtml===note.richHtml&&cloned.text===note.text&&cloned.cover===PNG,'Real project clone lost rich/plain/image pair');
  const {blob}=await createProjectZipArchive(P);await deleteProject(P);await importProjectZip(new File([blob],'rich-notes.zip',{type:'application/zip'}));const restored=await db.notes.get(note.id);assert(restored?.richHtml===note.richHtml&&restored.text===note.text&&restored.cover===PNG,'ZIP delete/restore lost rich note content');
  passed.push('Real JSON/project clone and ZIP delete/restore preserve optional native HTML, coherent text, title and local images');
  return passed;
 }finally{for(const id of [P,...clones])if(await db.projects.get(id))await deleteProject(id);}
}

export async function testNoteInlineImageLayoutPortability():Promise<string[]>{
 const projectId=P+'-inline-layout',clones:string[]=[];
 const source=`<h2>Layout prose</h2><img src="${PNG}" alt="New aligned" data-wh-width="50" data-wh-frame="polaroid" data-wh-align="right"><img src="${PNG}" alt="Legacy sibling" data-wh-width="25" data-wh-frame="border">`;
 const legacySource=`<p data-wh-align="justify">Legacy paragraph</p><img src="${PNG}" data-wh-width="25" data-wh-frame="border">`;
 try{
  await db.projects.put({id:projectId,title:'Inline layout portability',description:'',mode:'custom',type:'standalone',status:'draft',color:'#888888',enabledEngines:['notes'],createdAt:1,updatedAt:1,worldEras:[{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1}]});
  const note=makeNote(projectId,{text:'unused',richHtml:source}),legacy=makeNote(projectId,{text:'unused',richHtml:legacySource});await createNote(note);await createNote(legacy);
  const options={locale:'en' as const,includeMaps:false,types:[],additionalDocuments:[{kind:'notes' as const,id:note.id},{kind:'notes' as const,id:legacy.id}]};
  const snapshot=wikiSource(await captureWikiSnapshot({projectId}));db.close();
  let wikiHtml='';
  try{
   wikiHtml=buildWorldWiki(await loadWorldWikiData(projectId,options,snapshot),options).html;
   assert(wikiHtml.includes(NOTE_IMAGE_LAYOUT_CSS)&&parse(wikiHtml).querySelector('img[alt="New aligned"]')?.getAttribute('data-wh-align')==='right','Captured wiki lost alignment or conditional CSS');
   const noImages={...options,includeImages:false},without=buildWorldWiki(await loadWorldWikiData(projectId,noImages,snapshot),noImages).html;
   assert(!without.includes(NOTE_IMAGE_LAYOUT_CSS)&&!parse(without).querySelector('#wiki img'),'Images-off emitted image layout CSS or retained IMG');
   const onlyLegacy={...options,additionalDocuments:[{kind:'notes' as const,id:legacy.id}]},legacyHtml=buildWorldWiki(await loadWorldWikiData(projectId,onlyLegacy,snapshot),onlyLegacy).html;
   assert(!legacyHtml.includes(NOTE_IMAGE_LAYOUT_CSS)&&parse(legacyHtml).body.textContent?.includes('Legacy paragraph'),'Legacy-only wiki gained image CSS or lost prose');
  }finally{await db.open();}
  const frame=document.createElement('iframe');frame.sandbox.add('allow-same-origin');frame.style.width='1000px';frame.style.height='700px';document.body.append(frame);
  try{
   await new Promise<void>(resolve=>{frame.onload=()=>resolve();frame.srcdoc=wikiHtml;});
   const image=frame.contentDocument!.querySelector<HTMLImageElement>('img[alt="New aligned"]')!,sibling=frame.contentDocument!.querySelector<HTMLImageElement>('img[alt="Legacy sibling"]')!;
   await image.decode();const css=frame.contentWindow!.getComputedStyle(image),container=frame.contentWindow!.getComputedStyle(image.parentElement!);
   assert(Math.abs(parseFloat(css.width)-parseFloat(container.width)*.5)<2&&css.marginRight==='0px'&&parseFloat(css.marginLeft)>0,'Captured iframe geometry is not half-width/right');
   const legacyCss=frame.contentWindow!.getComputedStyle(sibling),beforeLegacy=[legacyCss.width,legacyCss.marginLeft,legacyCss.marginRight,legacyCss.display,legacyCss.border];
   frame.contentDocument!.querySelector('style')!.textContent=frame.contentDocument!.querySelector('style')!.textContent!.replace(NOTE_IMAGE_LAYOUT_CSS,'');
   const afterLegacy=frame.contentWindow!.getComputedStyle(sibling);
   assert(!sibling.hasAttribute('data-wh-align')&&JSON.stringify(beforeLegacy)===JSON.stringify([afterLegacy.width,afterLegacy.marginLeft,afterLegacy.marginRight,afterLegacy.display,afterLegacy.border]),'New CSS changed legacy sibling geometry');
  }finally{frame.remove();}
  const image=await buildDocumentImage({projectId,kind:'notes',entityId:note.id,locale:'en'}),legacyImage=await buildDocumentImage({projectId,kind:'notes',entityId:legacy.id,locale:'en'});
  assert(image.html.includes(NOTE_IMAGE_LAYOUT_CSS)&&!legacyImage.html.includes(NOTE_IMAGE_LAYOUT_CSS),'DocumentImage CSS not conditional on final admitted aligned image');
  // No Tiptap is mounted: cold readonly card must provide its own new image CSS.
  document.getElementById('wh-note-image-layout')?.remove();const host=document.getElementById('root')!,root=createRoot(host);
  try{await act(async()=>{root.render(<MemoryRouter><NoteCard note={note} onUpdate={()=>{}} onDelete={()=>{}}/></MemoryRouter>);await new Promise(resolve=>setTimeout(resolve,50));});assert(document.getElementById('wh-note-image-layout')&&host.querySelector('[data-note-rich-read] img[data-wh-align="right"]'),'Cold read depends on having opened Tiptap');}finally{await act(async()=>root.unmount());}
  const base=JSON.stringify(await db.notes.get(note.id)),era=await runBridgeTool('wh_update_note',{projectId,eraId:'past',id:note.id,richHtml:source.replace('data-wh-align="right"','data-wh-align="center"')});assert(era.ok&&JSON.stringify(await db.notes.get(note.id))===base,'Era aligned image update changed Base');
  const eraList=await runBridgeTool('wh_list_notes',{projectId,eraId:'past'});assert(eraList.ok&&JSON.stringify(eraList.result).includes('data-wh-align=\\"center\\"'),'Era read lost explicit alignment');
  const cloneId=await importProjectData(await exportProjectData(projectId));clones.push(cloneId);const clone=(await db.notes.where('projectId').equals(cloneId).toArray()).find(row=>row.text==='Layout prose');assert(clone?.richHtml===note.richHtml,'Real JSON clone changed raster/layout HTML');
  const archive=await createProjectZipArchive(projectId);await deleteProject(projectId);await importProjectZip(new File([archive.blob],'inline-note-layout.zip',{type:'application/zip'}));assert((await db.notes.get(note.id))?.richHtml===note.richHtml,'ZIP delete/restore changed raster/layout HTML');
  assert(noteImageLayoutCss(legacySource)==='','No-align legacy source activated new fragment');
  return['Captured wiki with DB closed and iframe geometry preserves half-width/right; images-off/omitted note emit no new CSS; legacy paragraph and sibling stay unchanged','Cold readonly card and DocumentImage support admitted aligned raster without Tiptap; Base/era isolation, real JSON clone and ZIP delete/restore preserve original layout HTML'];
 }finally{if(!db.isOpen())await db.open();for(const id of [projectId,...clones])if(await db.projects.get(id))await deleteProject(id);}
}
