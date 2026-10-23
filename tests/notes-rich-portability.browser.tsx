import { db } from '@/db';
import { deleteProject, exportProjectData, importProjectData } from '@/db/operations';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { buildWorldWiki, loadWorldWikiData } from '@/services/worldWikiExport';
import { captureWikiSnapshot, wikiSource } from '@/services/wikiProfiles/snapshot';
import { buildDocumentImage } from '@/services/documentImage/build';
import { createNote, makeNote } from '@/engines/notes/operations';
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
