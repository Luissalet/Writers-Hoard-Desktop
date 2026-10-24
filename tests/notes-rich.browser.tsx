import { db } from '@/db';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { deleteProject } from '@/db/operations';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { SCOPE_KEY } from '@/services/aiBridge/schema';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { noteImageLayoutCss, NOTE_IMAGE_LAYOUT_CSS } from '@/components/editor/blocks/imageLayout';
const P='notes-rich-regression';
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
export async function testNotesRichContracts():Promise<string[]>{
 const html='<h2>Pistas del puerto</h2><ul><li><p>Revisar el faro</p></li><li><p>Hablar con la capitana</p></li></ul>',plain='Pistas del puerto\nRevisar el faro\nHablar con la capitana';
 const call=async(tool:string,args:Record<string,unknown>)=>{const reply=await runBridgeTool(tool,{projectId:P,...args});assert(reply.ok,tool+': '+JSON.stringify(reply));return reply.result as Record<string,unknown>;};
 try{
  await db.projects.put({id:P,title:'Rich notes QA',description:'',mode:'custom',type:'standalone',status:'draft',color:'#888888',enabledEngines:['notes'],createdAt:1,updatedAt:1,worldEras:[{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1}]});
  const created=await call('wh_create_note',{text:'Fallback plain',richHtml:html,title:'QA rich note'}),id=created.id as string;
  let row=await db.notes.get(id) as unknown as {text:string;richHtml?:string};
  assert(row.richHtml?.includes('<h2>')&&row.text===plain,'Registered note create ignores rich content or loses coherent plain projection');
  const listed=await call('wh_list_notes',{}),entry=(listed.notes as {id:string;text:string;richHtml?:string}[]).find(item=>item.id===id)!;assert(entry.richHtml===row.richHtml&&entry.text===plain,'Native note read omits rich data');
  await call('wh_update_note',{id,pinned:true});row=await db.notes.get(id) as typeof row;assert(row.richHtml===entry.richHtml,'Metadata update removed rich content');
  const changed=await call('wh_update_note',{id,text:'Explicit plain replacement'});row=await db.notes.get(id) as typeof row;assert(row.text==='Explicit plain replacement'&&row.richHtml===undefined,'Plain update left stale rich content');
  await undoAuditEntry({entry:{...(changed.__audit as object),kind:'update',tool:'wh_update_note'}});row=await db.notes.get(id) as typeof row;assert(row.richHtml===entry.richHtml&&row.text===plain,'Native Undo lost rich/plain pair');
  await call('wh_update_note',{id,richHtml:html+'<script>BAD_SCRIPT</script><p onclick="BAD_EVENT">Safe</p>'});row=await db.notes.get(id) as typeof row;assert(!/BAD_SCRIPT|BAD_EVENT|onclick/.test(row.richHtml??'')&&row.text===plain+'\nSafe','Rich update sanitizer or plain projection differs');
  const base=JSON.stringify(await db.notes.get(id));await call('wh_update_note',{id,eraId:'past',richHtml:'<h2>Era note</h2><p>Only in past</p>'});const past=await call('wh_list_notes',{eraId:'past'});assert((past.notes as {id:string;text:string;richHtml?:string}[]).find(item=>item.id===id)?.text==='Era note\nOnly in past'&&JSON.stringify(await db.notes.get(id))===base,'Native era write did not normalize or changed Base');
  const foreign=await runBridgeTool('wh_update_note',{[SCOPE_KEY]:'foreign-project',id,richHtml:'<p>FORBIDDEN</p>'});assert(!foreign.ok&&JSON.stringify(await db.notes.get(id))===base,'Cross-scope note update succeeded');
  const plainCreated=await call('wh_create_note',{text:'Legacy plain'}),plainId=plainCreated.id as string;
  const richChanged=await call('wh_update_note',{id:plainId,richHtml:'<h2>Opted in</h2>'});await undoAuditEntry({entry:{...(richChanged.__audit as object),kind:'update',tool:'wh_update_note'}});const plainRestored=await db.notes.get(plainId);assert(plainRestored?.text==='Legacy plain'&&plainRestored.richHtml===undefined,'Undo did not restore absent optional rich field');
  let inboxId='';try{const inbox=await call('wh_create_note',{inbox:true,text:'fallback',richHtml:'<h2>Inbox note</h2>'});inboxId=inbox.id as string;assert((await db.notes.get(inboxId))?.projectId==='__inbox__'&&(await db.notes.get(inboxId))?.text==='Inbox note','Inbox rich note crossed into project');}finally{if(inboxId)await db.notes.delete(inboxId);}
  return['Registered note create/list/update preserve optional rich formatting, coherent plain text, metadata-only changes, explicit plain replacement and sanitized content','Native Undo restores rich/plain pair and absent option; era normalizes without changing Base, foreign update fails, inbox remains separate'];
 }finally{if(await db.projects.get(P))await deleteProject(P);}
}

export async function testNoteInlineImageSanitizer(): Promise<string[]> {
 const source=`<p data-wh-align="justify">Paragraph legacy</p><h2 data-wh-align="right">Heading legacy</h2><span data-wh-align="right">No inline align</span><img src="${'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='}" data-wh-align="right" data-wh-width="50" data-wh-frame="polaroid" style="position:fixed" onerror="BAD_HANDLER"><img data-wh-align="justify"><div data-wh-align="right">No block align</div>`;
 const sanitized=sanitizeRichHtml(source),doc=new DOMParser().parseFromString(sanitized,'text/html');
 assert(doc.querySelector('p')?.getAttribute('data-wh-align')==='justify'&&doc.querySelector('h2')?.getAttribute('data-wh-align')==='right','Image sanitizer changed legacy paragraph/heading alignment');
 assert(doc.querySelector('img')?.getAttribute('data-wh-align')==='right'&&doc.querySelector('img')?.getAttribute('data-wh-width')==='50'&&doc.querySelector('img')?.getAttribute('data-wh-frame')==='polaroid','Native image sanitizer lost admitted layout');
 assert(!doc.querySelector('span[data-wh-align],div[data-wh-align],img[data-wh-align="justify"],[onerror],img[style]'),'Invalid image align, active attributes or arbitrary style survived: '+sanitized);
 assert(noteImageLayoutCss(sanitized)===NOTE_IMAGE_LAYOUT_CSS&&noteImageLayoutCss('<p data-wh-align="right">text</p>')===''&&noteImageLayoutCss('<img data-wh-align="right">')===''&&noteImageLayoutCss('<img alt="data-wh-align=right">')==='','Image CSS feature detection used text, paragraph, missing raster or invalid tag');
 assert(noteImageLayoutCss(sanitizeRichHtml('<img src="data:image/svg+xml;base64,PHN2Zy8+" data-wh-align="right">'))==='','Removed SVG activated image CSS');
 return['Sanitizer preserves P justify/H right legacy and valid IMG width/frame/right while removing invalid tags/enums, events/style; conditional CSS requires a real admitted raster IMG'];
}
