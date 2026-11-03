import '@/engines';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { Editor } from '@tiptap/core';
import { db } from '@/db';
import { deleteProject, exportProjectData, importProjectData } from '@/db/operations';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import TiptapEditor from '@/components/editor/TiptapEditor';
import NoteCard from '@/engines/notes/components/NoteCard';
import ReadingView from '@/engines/writings/components/ReadingView';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { hydrateCodexLinkImages } from '@/services/codexReference/imageReading';
import { projectCodexImages } from '@/services/codexReference/imageHtml';
import { saveWorldEra, hideEraDocument, readWorldDocument } from '@/services/worldEras/store';
import { getBridgeTool } from '@/services/aiBridge/manifest';
import { TOOL_HANDLERS } from '@/services/aiBridge/tools';
import { createToolExecutor, type AuditLine } from '@/services/aiRuntime/executorCore';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { buildReaderHtml } from '@/engines/writings/readerExport';
import { defaultReaderPresentation } from '@/engines/writings/readerPresentation';
import { buildWorldWiki, loadWorldWikiData } from '@/services/worldWikiExport';
import { captureWikiSnapshot, wikiSource } from '@/services/wikiProfiles/snapshot';
import { buildDocumentImage } from '@/services/documentImage/build';
import { composePublishingDocument } from '@/engines/writings/publishingDocument';
import { getPendingWritesSnapshot } from '@/services/pendingWrites';
import type { CodexEntry, Project, Writing } from '@/types';
import type { Note } from '@/engines/notes/types';

const P='mention-image-integration', E='mention-image-person';
const A='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF6kAAAAASUVORK5CYII=';
const B='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const html=`<p><a href="/project/${P}/codex?entry=${E}" data-wh-codex-image="true">Alias Ω—李明🙂</a></p>`;
const table='<table><tbody><tr><td><p>Distant</p></td></tr></tbody></table>';
const assert:(value:unknown,message:string)=>asserts value=(value,message)=>{if(!value)throw Error(message);};
const pause=()=>new Promise(r=>setTimeout(r,30));
async function until(check:()=>boolean,message:string){for(let i=0;i<150;i++){if(check())return;await act(async()=>{await pause();});}assert(false,message+' '+JSON.stringify((window as unknown as {__imageDebug?:unknown}).__imageDebug));}
const thumb=(container:ParentNode)=>container.querySelector<HTMLImageElement>('a img[data-wh-codex-thumbnail="true"]');
const parse=(html:string)=>new DOMParser().parseFromString(html,'text/html');

export async function testCodexMentionImageIntegration():Promise<string[]> {
  const project:Project={id:P,title:'Own image QA',description:'',type:'standalone',mode:'custom',status:'draft',color:'#aaaaaa',enabledEngines:['codex','writings','notes'],engineOrder:['codex','writings','notes'],createdAt:1,updatedAt:1};
  const entry:CodexEntry={id:E,projectId:P,title:'Person',type:'character',fields:{},content:'<p>Admitted source.</p>',avatar:A,tags:[],relations:[],createdAt:1,updatedAt:1};
  const writing:Writing={id:'mention-image-writing',projectId:P,title:'Chapter',content:html+table,wordCount:3,status:'draft',tags:[],createdAt:1,updatedAt:1};
  const note:Note={id:'mention-image-note',projectId:P,text:'Alias Ω—李明🙂',richHtml:html,kind:'note',tags:[],pinned:false,createdAt:1,updatedAt:1};
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const passed:string[]=[],clones:string[]=[];let release:(()=>void)|undefined,editor:Editor|null=null;
  const ready=(value:Editor|null)=>{editor=value;};
  try {
    await db.projects.put(project);await db.codexEntries.put(entry);
    await db.codexEntries.put({...entry,id:'mention-image-host',title:'Host card',content:html,avatar:undefined});
    await db.codexEntries.put({...entry,id:'mention-image-other',title:'Other card',avatar:B});
    await db.writings.put(writing);await db.notes.put(note);
    // Cold passive consumers mount before any Tiptap editor.
    await act(async()=>{root.render(<MemoryRouter><NoteCard note={note} onUpdate={()=>{throw Error('Passive read must not write');}} onDelete={()=>{throw Error('No delete');}}/></MemoryRouter>);await pause();});
    await until(()=>thumb(host)?.getAttribute('src')===A,'Cold NoteCard must hydrate the current avatar');
    assert((await db.notes.get(note.id))?.richHtml===html,'Passive NoteCard must not persist hydrated HTML');
    await act(async()=>{root.render(<MemoryRouter><ReadingView pieces={[writing]} onClose={()=>{}} onOpenInEditor={()=>{}}/></MemoryRouter>);await pause();});
    await until(()=>thumb(host)?.getAttribute('src')===A,'Cold ReadingView must hydrate without editor');
    passed.push('Cold NoteCard/ReadingView resolve local thumbnails without editor or prose writes');

    await saveWorldEra(P,{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1},null);
    const past={projectId:P,eraId:'past'},read=await readWorldDocument(past,'codex',E);assert(read,'Inherited entry exists');
    await hideEraDocument(past,'codex',E,read.version);
    await act(async()=>{root.render(<MemoryRouter><EnginePaneContext.Provider value={{instanceId:'past-pane',projectId:P,eraId:'past',visible:true}}><NoteCard note={note} onUpdate={()=>{throw Error('No repair writes');}} onDelete={()=>{}}/></EnginePaneContext.Provider></MemoryRouter>);await pause();});
    await act(async()=>{await pause();await pause();});
    assert(!thumb(host),'Hidden era entry must not fall back to Base avatar');
    const privateHost=document.createElement('div');privateHost.innerHTML=html;host.append(privateHost);
    release=hydrateCodexLinkImages(privateHost,P);
    await until(()=>thumb(privateHost)?.getAttribute('src')===A,'Hydrator Base health');
    await db.codexEntries.update(E,{avatar:B});await until(()=>thumb(privateHost)?.getAttribute('src')===B,'Avatar refresh updates presentation');
    await db.codexEntries.update(E,{avatar:undefined});await until(()=>!thumb(privateHost),'Avatar removal removes derived image');
    await db.codexEntries.update(E,{avatar:A});await until(()=>Boolean(thumb(privateHost)),'Avatar restore');
    release();release=undefined;privateHost.innerHTML=html.replaceAll(P,'foreign-project');
    release=hydrateCodexLinkImages(privateHost,'foreign-project');
    await db.codexEntries.update(E,{avatar:B});await act(async()=>{await pause();await pause();});
    assert(!thumb(privateHost),'Retired scope must not hydrate a late old avatar');release();release=undefined;privateHost.remove();
    passed.push('Era hiding, Base avatar update/removal and retiring async scope preserve prose and prevent fallback');

    await db.codexEntries.update(E,{avatar:A});
    const selfHtml=html+`<p><a href="/project/${P}/codex?entry=mention-image-other" data-wh-codex-image="true">Other β</a></p><p>Person</p>`;
    const renderSelf=async(entryId?:string)=>act(async()=>{root.render(<MemoryRouter><TiptapEditor key="self-explicit" content={selfHtml} referenceContext={{projectId:P,scopeId:'self-explicit',entryId}} onEditorReady={ready}/></MemoryRouter>);await pause();});
    const widgets=()=>editor!.view.dom.querySelectorAll('img[data-wh-codex-thumbnail="true"]').length;
    await renderSelf();await until(()=>Boolean(editor)&&widgets()===2,'Self/Other explicit links must initially both project');
    const selfBefore=editor!.getHTML(),selfRows=JSON.stringify(await db.codexEntries.where('projectId').equals(P).sortBy('id'));
    await renderSelf(E);await act(async()=>{await pause();await pause();});
    assert(widgets()===2,'Explicit ON self-link must retain its admitted avatar in the current-card editor');
    assert(editor!.getHTML()===selfBefore&&JSON.stringify(await db.codexEntries.where('projectId').equals(P).sortBy('id'))===selfRows,'Self context alone must not change HTML or card rows');
    assert(![...editor!.view.dom.querySelectorAll('[data-wh-codex-mention]')].some(node=>node.textContent==='Person'),'Self must remain excluded from automatic detection');
    await act(async()=>{editor!.commands.setTextSelection(2);await pause();});
    const selfToggle=[...host.querySelectorAll('button')].find(button=>button.textContent==='Ocultar imagen'||button.textContent==='Hide image');assert(selfToggle,'Self appearance retains normal image control');
    await act(async()=>{selfToggle.click();await pause();});assert(widgets()===1,'Self OFF must preserve Other thumbnail');
    await act(async()=>{editor!.commands.undo();await pause();});assert(editor!.getHTML()===selfBefore&&widgets()===2,'One Undo must restore self choice without changing Other');
    passed.push('Explicit Self/Other projections remain complete in current-card context; automatic Self exclusion and one-gesture OFF/Undo remain intact');
    await act(async()=>{root.render(<MemoryRouter><TiptapEditor key="image-editor" content={html} referenceContext={{projectId:P,scopeId:'image-pane'}} onEditorReady={ready}/></MemoryRouter>);await pause();});
    await until(()=>Boolean(editor?.view.dom.querySelector('img[data-wh-codex-thumbnail="true"]')),'Normal editor must mount its widget');
    const literal=editor!.getHTML();assert(!literal.includes('<img'),'Normal getHTML excludes widget');
    await act(async()=>{editor!.commands.setTextSelection(2);await pause();});
    await db.codexEntries.update(E,{avatar:B});
    await until(()=>editor!.view.dom.querySelector<HTMLImageElement>('img[data-wh-codex-thumbnail]')?.getAttribute('src')===B,'Avatar refresh changes editor presentation without a new selection');
    assert(editor!.getHTML()===literal,'Avatar refresh must not alter document/history');
    const hide=[...host.querySelectorAll('button')].find(button=>button.textContent==='Ocultar imagen'||button.textContent==='Hide image');assert(hide,'Normal controls expose Hide image');
    await act(async()=>{hide.click();await pause();});assert(!editor!.getHTML().includes('data-wh-codex-image'),'Visible control toggles OFF');
    await act(async()=>{editor!.commands.undo();await pause();});assert(editor!.getHTML()===literal,'Visible control has one exact Undo');
    const oldHide=[...host.querySelectorAll('button')].find(button=>button.textContent==='Ocultar imagen'||button.textContent==='Hide image');assert(oldHide,'Old control health');
    await act(async()=>{
      editor!.commands.setContent(html.replaceAll(E,'unavailable-new-target'));
      editor!.commands.setTextSelection(2);const current=editor!.getHTML();
      oldHide.click();assert(editor!.getHTML()===current,'A queued control from the old selection/document must not edit a new target');
    });
    await act(async()=>{root.render(<MemoryRouter><TiptapEditor key="image-sdk" content={html} contentProfile="sdk-prose" referenceContext={{projectId:P,scopeId:'sdk-image'}} onEditorReady={ready}/></MemoryRouter>);await pause();});
    await until(()=>Boolean(editor?.view.dom.querySelector('img[data-wh-codex-thumbnail="true"]')),'SDK prose editor preserves Link preference');
    assert(editor!.getHTML().includes('data-wh-codex-image="true"'),'SDK editor serializes semantic preference');
    const originalGet=db.projects.get.bind(db.projects);let releaseRead!:()=>void;
    const held=new Promise<void>(resolve=>{releaseRead=resolve;});
    db.projects.get=(async (...args:Parameters<typeof db.projects.get>)=>{await held;return originalGet(...args);}) as typeof db.projects.get;
    try {
      await act(async()=>{root.render(<MemoryRouter><TiptapEditor key="image-sdk" content={html} contentProfile="sdk-prose" referenceContext={{projectId:P,eraId:'past',scopeId:'sdk-image'}} onEditorReady={ready}/></MemoryRouter>);await pause();});
      assert(!editor!.view.dom.querySelector('img[data-wh-codex-thumbnail]'),'Pending era query must retire the previous Base avatar before resolving');
    } finally {db.projects.get=originalGet;releaseRead();await act(async()=>{await pause();});}
    passed.push('Mounted normal and SDK prose editors expose the control, derive one widget and keep one-gesture Undo');

    const hydrated=parse(html+`<img src="${A}" alt="authored">`);projectCodexImages(hydrated.body,P,[entry]);
    for(const key of ['reimport-first','reimport-second']) {
      await act(async()=>{root.render(<MemoryRouter><TiptapEditor key={key} content={hydrated.body.innerHTML} referenceContext={{projectId:P,scopeId:key}} onEditorReady={ready}/></MemoryRouter>);await pause();});
      await until(()=>Boolean(editor),'Reimport editor health');
      const imported=parse(editor!.getHTML());
      assert(imported.querySelectorAll('img').length===1&&imported.querySelector('img')?.alt==='authored'&&Boolean(imported.querySelector('a[data-wh-codex-image="true"]')),'Normal editor HTML reimport removes only the synthetic image and preserves authored image/preference');
    }
    passed.push('Normal component reimport twice discards synthetic thumbnails, retaining the authored adjacent image and preference');

    const audit:AuditLine[]=[];
    const execute=createToolExecutor({writesEnabled:async()=>true,audit:async line=>{audit.push(line);return audit.length-1;},relay:async(name,args)=>{try{return{ok:true,result:await TOOL_HANDLERS[name](args)};}catch(error){return{ok:false,code:(error as {code?:string}).code,error:String(error)};}}});
    const args={projectId:P,id:writing.id},ctx={origin:'bridge' as const,clientLabel:'own-image-area'};
    assert(getBridgeTool('wh_edit_writing_document')?.description.includes('setCodexImage'),'Existing MCP manifest exposes semantic operation');
    const current=await TOOL_HANDLERS.wh_get_writing_document(args) as {html:string;updatedAt:number;cells:{from:number}[]};
    assert(current.html.includes('data-wh-codex-image="true"'),'Headless reader must preserve flag');
    const tableEdit=await execute({tool:'wh_edit_writing_document',args:{...args,operation:'addRowAfter',from:current.cells[0].from+2,expectedUpdatedAt:current.updatedAt}},ctx);
    assert(tableEdit.ok&&(await db.writings.get(writing.id))?.content.includes('data-wh-codex-image="true"'),'Distant table edit must preserve image preference');
    assert((await undoAuditEntry({entry:audit[tableEdit.auditIndex!]})).undone,'Distant edit normal audit Undo');
    assert((await TOOL_HANDLERS.wh_get_writing_document(args) as {html:string}).html===current.html,'Distant edit Undo restores exact normalized document');
    const latest=(await db.writings.get(writing.id))!;
    const toggled=await execute({tool:'wh_edit_writing_document',args:{...args,operation:'setCodexImage',from:2,to:2,codexImage:false,expectedUpdatedAt:latest.updatedAt}},ctx);
    assert(toggled.ok&&!(await db.writings.get(writing.id))?.content.includes('data-wh-codex-image'),'Existing MCP handler toggles preference');
    const reject=await execute({tool:'wh_edit_writing_document',args:{...args,operation:'setCodexImage',from:2,to:2,codexImage:true,expectedUpdatedAt:latest.updatedAt}},ctx);assert(!reject.ok&&reject.code==='conflict','Stale CAS rejects without changing winner');
    assert((await undoAuditEntry({entry:audit[toggled.auditIndex!]})).undone,'Preference normal audit Undo');
    const beforeInvalid=JSON.stringify(await db.writings.get(writing.id)),beforeSnapshots=await db.writingSnapshots.count(),beforeLedger=JSON.stringify(getPendingWritesSnapshot());
    let directRejected=false;
    try{await TOOL_HANDLERS.wh_edit_writing_document({...args,operation:'setCodexImage',from:2,to:2,codexImage:'true'});}catch{directRejected=true;}
    assert(directRejected,'Public handler rejects a nonboolean before the common bridge normalizer');
    for(const invalid of ['yes','enabled',1,'1',{},[],[true]]) {
      assert(!(await execute({tool:'wh_edit_writing_document',args:{...args,operation:'setCodexImage',from:2,to:2,codexImage:invalid}},ctx)).ok,'Common MCP executor rejects other truthy values');
      assert(JSON.stringify(await db.writings.get(writing.id))===beforeInvalid&&await db.writingSnapshots.count()===beforeSnapshots&&JSON.stringify(getPendingWritesSnapshot())===beforeLedger,'Invalid MCP gesture preserves document/versions/ledger');
    }
    for(const normalized of ['true','false']) {
      const accepted=await execute({tool:'wh_edit_writing_document',args:{...args,operation:'setCodexImage',from:2,to:2,codexImage:normalized}},ctx);
      assert(accepted.ok&&accepted.args?.codexImage===(normalized==='true'),'Common executor preserves incumbent exact literal boolean normalization');
      if(accepted.auditIndex!==undefined)assert((await undoAuditEntry({entry:audit[accepted.auditIndex]})).undone,'Normalized edit retains normal audit Undo');
    }
    passed.push('Existing registered MCP executor/manifest, distant table edit, finite boolean, CAS and normal audit Undo (not Native transport)');

    await db.codexEntries.update(E,{avatar:A});
    const snapshot=await captureWikiSnapshot({projectId:P}),source=wikiSource(snapshot);
    assert(source.rows('codexEntries').find(row=>row.id===E)?.avatar===A,'Captured source health must pin avatar A before the live change');
    await db.codexEntries.update(E,{avatar:B});
    const reader=await buildReaderHtml(project,[writing],defaultReaderPresentation(),'en',{projectId:P},source);
    assert(thumb(parse(reader.html))?.getAttribute('src')===A,'Reader must use captured S, never changed live avatar');
    const missing={...source,rows:((name:string)=>name==='codexEntries'?[]:source.rows(name as Parameters<typeof source.rows>[0])) as typeof source.rows};
    const omitted=await buildReaderHtml(project,[writing],defaultReaderPresentation(),'en',{projectId:P},missing);
    assert(!parse(omitted.html).querySelector('a img'),'Incomplete Source must not fall back to live Codex entries');
    const wikiData=await loadWorldWikiData(P,{},source),wiki=buildWorldWiki(wikiData,{locale:'en'});
    assert(parse(wiki.html).querySelector('a img')?.getAttribute('src')===A,'Wiki uses admitted captured entry before rewriting href');
    assert(!parse(buildWorldWiki(wikiData,{locale:'en',includeImages:false}).html).querySelector('a img'),'Wiki images OFF omits thumbnail');
    const image=await buildDocumentImage({projectId:P,kind:'writings',entityId:writing.id});
    assert(parse(image.html).querySelector('a img')?.getAttribute('src')===B,'Document image resolves current normal scope');
    const capturedImage=await buildDocumentImage({projectId:P,kind:'codex',entityId:'mention-image-host'},source);
    assert(parse(capturedImage.html).querySelector('a img')?.getAttribute('src')===A,'Captured card image uses S rather than live avatar');
    const options={projectTitle:project.title,includeTitlePage:false,includeSynopsis:false,chapterLabel:'Chapter'};
    const portable=composePublishingDocument([writing],options),optin=composePublishingDocument([{...writing,content:writing.content+`<img src="${A}" alt="authored">`}],{...options,includeInlineImages:true});
    assert(!portable.sections[0].portableHtml.includes('<img')&&optin.sections[0].portableHtml.includes(A),'Portable default and authored image opt-in remain intact');
    passed.push('Captured Reader/wiki use S after live avatar changes; image export uses current scope; portable default/opt-in remain intact, no visual DOCX/ePub claim');

    const exported=await exportProjectData(P),clone=await importProjectData(exported);clones.push(clone);
    const copied=(await db.writings.where('projectId').equals(clone).toArray())[0],copiedEntry=(await db.codexEntries.where('projectId').equals(clone).toArray()).find(row=>row.title===entry.title)!;
    assert(copied.content.includes(`/project/${clone}/codex?entry=${copiedEntry.id}`)&&copied.content.includes('data-wh-codex-image="true"')&&!copied.content.includes('data:image'),'Actual project fork preserves flag/remaps identity without embedded avatar');
    const archive=await createProjectZipArchive(P);await importProjectZip(new File([archive.blob],'mention-image.zip'),{replaceProjectIds:[P]});
    assert((await db.writings.get(writing.id))?.content.includes('data-wh-codex-image="true"'),'Project ZIP literal roundtrip preserves preference');
    passed.push('Actual project fork and literal ZIP preserve preference and identity mapping without image bytes in prose');
    return passed;
  } finally {
    release?.();await act(async()=>root.unmount());host.remove();
    for(const id of [...clones,P])await deleteProject(id);
    // Fresh private Electron profile: no user rows exist; retire QA settings/history too.
    for(const table of db.tables)await table.clear();
    const counts=await Promise.all(db.tables.map(table=>table.count())),ledger=getPendingWritesSnapshot();
    assert(counts.every(count=>count===0),'Private profile cleanup must leave every table empty');
    assert(ledger.pending===0&&ledger.failed===0&&ledger.dirty===0,'Private profile cleanup must retire every pending writer');
    (window as unknown as {__mentionImageCleanup:unknown}).__mentionImageCleanup={tables:db.tables.length,rows:counts.reduce((a,b)=>a+b,0),ledger};
    db.close();
  }
}
