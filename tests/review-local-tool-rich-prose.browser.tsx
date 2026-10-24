import {act,StrictMode,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import type {Editor} from '@tiptap/core';
import {db} from '@/db';
import {deleteProject,exportProjectData,importProjectData} from '@/db/operations';
import {registerLocalToolModules} from '@/engines/local/registry';
import definition from '@/engines/local/installed/examples.rich-prose/module';
import {getLocalToolCatalog} from '@/engines/local/definitions';
import {archiveSourceToolDocument,createSourceToolDocument,readSourceToolDocument} from '@/engines/local/documents/store';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import {createLocalToolClient} from '@/engines/local/storage';
import SourceDockBlock from '@/engines/writings/toolDock/SourceDockBlock';
import {applyWritingToolDock,readWritingToolDock,type ToolDockRead} from '@/engines/writings/toolDock/store';
import {readWorldDocument,saveEraDocument,saveWorldEra} from '@/services/worldEras/store';
import {createLocalToolBlockEnvelope} from '@/engines/local/blocks/definitions';
import {findLocalToolBlocksInHtml,serializeLocalToolBlock} from '@/engines/local/blocks/types';
import {useLocaleStore} from '@/stores/localeStore';
import CodexEntryForm from '@/components/codex/CodexEntryForm';
import {saveCodexDraft} from '@/engines/codex/operations';
import {EnginePaneContext} from '@/engines/_shared/EnginePaneContext';
import type {CodexEntry} from '@/types';
import type {Writing} from '@/types';
import {localToolSemanticPreview} from '@/engines/local/previewTypes';
import {renderRichProsePreview} from '@/engines/local/richProseHtml';
import {capturePublicationSnapshot,publicationReaderSource} from '@/services/publishedEditions/snapshot';
import {buildReaderHtml} from '@/engines/writings/readerExport';
import {defaultReaderPresentation} from '@/engines/writings/readerPresentationTypes';
import {buildWorldWiki,loadWorldWikiData} from '@/services/worldWikiExport';
import BookEditor from '@/engines/writings/components/BookEditor';
import WritingsView from '@/engines/writings/components/WritingsView';
import {commitPublishedEdition,getPublishedEdition,preparePublishedEdition,restorePublishedEdition} from '@/services/publishedEditions/store';

function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=()=>new Promise(resolve=>setTimeout(resolve,40));
async function until(check:()=>unknown|Promise<unknown>,message:string){const end=Date.now()+10000;while(Date.now()<end){if(await check())return;await act(async()=>{await pause();});}throw Error(message+' '+document.body.textContent?.slice(-1400));}
async function click(node:Element|undefined|null){assert(node,'Missing actual UI control');await act(async()=>{node.dispatchEvent(new MouseEvent('click',{bubbles:true}));await pause();});}
const button=(label:string,scope:ParentNode=document)=>[...scope.querySelectorAll<HTMLButtonElement>('button')].find(row=>row.textContent?.trim()===label);
const richEditor=(scope:ParentNode=document)=>(scope.querySelector('[data-sdk-prose-editor] .tiptap') as (HTMLElement&{editor:Editor})|null)?.editor;
async function fixture(){const projectId='review-rich-prose-'+crypto.randomUUID();registerLocalToolModules({'./installed/examples.rich-prose/module.tsx':{default:definition}});useLocaleStore.setState({locale:'en',loaded:true});await db.projects.put({id:projectId,title:'Independent prose review',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['codex','writings','local-tool-'+definition.namespace],createdAt:1,updatedAt:1});const source=await createSourceToolDocument({projectId},definition.namespace,'Real briefing');return{projectId,source};}
function card(projectId:string):CodexEntry{return{id:projectId+'-parent',projectId,type:'custom',title:'Independent Owned parent',content:'',fields:{},propertyDefinitions:[],tags:[],relations:[],createdAt:1,updatedAt:1};}

/** The production Codex list closes this same form after its onSave succeeds. */
export async function reviewRichProseParentSavePending():Promise<string[]>{
 const f=await fixture(),root=createRoot(document.getElementById('root')!),entry=card(f.projectId),words='DRAFT_CHILD_PARENT_SAVE_719';let saves=0;
 entry.content=serializeLocalToolBlock(f.projectId,createLocalToolBlockEnvelope(definition.namespace,definition.blocks![0],'review-owned-parent'));
 function Parent(){const[open,setOpen]=useState(true);return <EnginePaneContext.Provider value={{instanceId:'review-rich-parent',projectId:f.projectId,visible:true}}>{open?<CodexEntryForm projectId={f.projectId} entry={entry} onSave={async(draft,base)=>{await saveCodexDraft(base??entry,draft);saves++;setOpen(false);}} onCancel={()=>setOpen(false)}/>:<p data-review-parent-closed>Parent saved</p>}</EnginePaneContext.Provider>;}
 try{
  await db.codexEntries.put(entry);await act(async()=>{root.render(<StrictMode><MemoryRouter><Parent/></MemoryRouter></StrictMode>);await pause();});await until(()=>richEditor(),'Real module did not mount in actual parent');
  await act(async()=>{richEditor()!.commands.setContent('<p>'+words+'</p>');await pause();});assert(button('Save briefing')&&!button('Save briefing')!.disabled,'Child draft was not pending');
  await click(button('Save Changes')??button('Save changes'));await act(async()=>{await pause();});
  const stored=await db.codexEntries.get(entry.id),block=stored&&findLocalToolBlocksInHtml(stored.content)[0]?.envelope,persisted=block?.scope==='host'&&String(block.data.briefing).includes(words),retained=richEditor()?.getText().includes(words);
  assert(persisted||retained,`Parent Save lost child draft: parentSaves=${saves}, closed=${!!document.querySelector('[data-review-parent-closed]')}, savedBriefing=${block?.scope==='host'?String(block.data.briefing):'missing'}, retained=${!!retained}`);
  return ['Actual parent Save either confirms the pending real Owned briefing or keeps its draft/editor available; no successful close silently loses it'];
 }finally{await act(async()=>root.unmount());await deleteProject(f.projectId);}
}

const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6mWQAAAAASUVORK5CYII=';
export async function reviewRichProseExplicitBaseAndLateRaster():Promise<string[]>{
 const f=await fixture(),root=createRoot(document.getElementById('root')!),scope={projectId:f.projectId},owner={kind:'project' as const},target={...card(f.projectId),id:f.projectId+'-reference',title:'BASE_REFERENCE_842'};
 const NativeReader=window.FileReader,held:Array<{reader:FileReader;cancelled:boolean}>=[];
 class DeferredReader extends NativeReader{slot?:{reader:FileReader;cancelled:boolean};override readAsDataURL(_file:Blob){this.slot={reader:this,cancelled:false};held.push(this.slot);}override abort(){if(this.slot)this.slot.cancelled=true;super.abort();}}
 try{
  await db.codexEntries.put(target);await saveWorldEra(f.projectId,{id:'other-era',name:'Other era',description:'',revision:0,createdAt:1,updatedAt:1},null);
  const base=await readWorldDocument({projectId:f.projectId,eraId:'other-era'},'codex',target.id);assert(base,'Era reference base absent');await saveEraDocument({projectId:f.projectId,eraId:'other-era'},'codex',{root:{...target,title:'ERA_REFERENCE_369'},children:{}},base.version);
  const initial=await readWritingToolDock(scope,owner),read=await applyWritingToolDock(scope,owner,initial.version,[{type:'add-source',namespace:definition.namespace,key:'briefing',id:'review-dock-base'}]);
  function Dock(){const[current,setCurrent]=useState<ToolDockRead>(read),block=current.layout!.blocks[0];assert(block.kind==='owned','Actual dock did not create Owned');return <SourceDockBlock scope={scope} owner={owner} read={current} envelope={block.envelope} locale="en" readOnly={false} onSaved={setCurrent} onFailed={()=>{}}/>;}
  await act(async()=>{root.render(<StrictMode><MemoryRouter><EnginePaneContext.Provider value={{instanceId:'review-pane-era',projectId:f.projectId,eraId:'other-era',visible:true}}><Dock/></EnginePaneContext.Provider></MemoryRouter></StrictMode>);await pause();});await until(()=>richEditor(),'Normal dock rich editor absent');
  await click(document.querySelector('button[aria-label="Insert a Codex text link"]'));await until(()=>button('BASE_REFERENCE_842Insert'),'Explicit Base host adopted pane era or did not load Base entry');assert(!button('ERA_REFERENCE_369Insert'),'Pane era leaked into explicit Base reference picker');
  const second=await createSourceToolDocument(scope,definition.namespace,'Second real briefing'),clientB=createLocalToolClient(f.projectId,definition,{documentId:second.id}),beforeB=JSON.stringify(await clientB.read());
  const render=async(documentId:string)=>{await act(async()=>{root.render(<StrictMode><MemoryRouter><LocalToolDocumentHost projectId={f.projectId} documentId={documentId}/></MemoryRouter></StrictMode>);await pause();});await until(()=>richEditor(),'Retargeted real source editor absent');};
  await render(f.source.id);window.FileReader=DeferredReader;
  const input=document.querySelector<HTMLInputElement>('[data-testid="sdk-prose-image"]')!,transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob(PNG.split(',')[1]),c=>c.charCodeAt(0))],'late-local.png',{type:'image/png'}));
  await act(async()=>{input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));await pause();});assert(held.length===1,'Native file input did not start the controlled reader');await render(second.id);
  await act(async()=>{for(const pending of held)if(!pending.cancelled){Object.defineProperty(pending.reader,'result',{value:PNG});pending.reader.dispatchEvent(new ProgressEvent('load'));}await pause();});
  assert(held[0].cancelled,'Retarget did not abort pending image read');assert(!document.querySelector('[data-sdk-prose-editor] img')&&button('Save briefing')?.disabled,'Late image contaminated next source draft');assert(JSON.stringify(await clientB.read())===beforeB,'Late image changed next source state');
  return ['Real dock explicit Base references override a different pane era; real Source retarget aborts late raster and preserves the next owner'];
 }finally{window.FileReader=NativeReader;await act(async()=>root.unmount());await deleteProject(f.projectId);}
}

export async function reviewRichProseCapturedCodecAndPolicies():Promise<string[]>{
 const f=await fixture(),scope={projectId:f.projectId},client=createLocalToolClient(f.projectId,definition,{documentId:f.source.id}),catalog=getLocalToolCatalog(definition.namespace)!,compiled=catalog.development;let closed=false;
 try{
  const included={...card(f.projectId),id:f.projectId+'-admitted',title:'Allowed entry'},excluded={...card(f.projectId),id:f.projectId+'-excluded',title:'Excluded entry'};
  const html=`<h2>CAPTURED_RICH_842</h2><blockquote><p>QUOTE_842</p></blockquote><pre><code>CODE &lt;842&gt;</code></pre><p><a href="/project/${f.projectId}/codex?entry=${included.id}">ADMITTED_LABEL_842</a><a href="/project/${f.projectId}/codex?entry=${excluded.id}">EXCLUDED_LABEL_842</a></p><img src="${PNG}" alt="INLINE_842">`;
  const semantic=localToolSemanticPreview('Same literal',{rich:html,legacy:html},{version:1,fields:[{key:'rich'},{key:'legacy'}]},'en',{version:1,fields:{rich:{kind:'prose',format:'rich'},legacy:{kind:'prose'}}}),mixed=new DOMParser().parseFromString(renderRichProsePreview(semantic),'text/html'),dds=mixed.querySelectorAll('dd');
  assert(dds[0].querySelector('h2')&&dds[1].textContent===html&&!dds[1].querySelector('h2'),'Rich was inferred from literal HTML instead of the saved codec');
  await client.state!.apply(await client.read(),[{type:'set',field:'briefing',value:html}]);
  const envelope=createLocalToolBlockEnvelope(definition.namespace,definition.blocks![0],'captured-owned');assert(envelope.scope==='host','Real example did not define Owned');envelope.data={briefing:html,caption:'Opaque '+excluded.id};
  const embeds=serializeLocalToolBlock(f.projectId,envelope)+`<figure data-wh-tool-block="true" data-project-id="${f.projectId}" data-tool-kind="local-tool" data-document-id="${f.source.id}" data-namespace="${definition.namespace}" data-label="Captured source"><figcaption>Captured source</figcaption></figure>`,parent={...card(f.projectId),id:f.projectId+'-embedded',title:'Parent article',content:embeds};
  await db.codexEntries.bulkPut([included,excluded,parent]);const writing:Writing={id:f.projectId+'-chapter',projectId:f.projectId,title:'Captured chapter',content:embeds,status:'draft',wordCount:2,tags:[],chapter:1,createdAt:1,updatedAt:1};await db.writings.put(writing);
  const before=JSON.stringify(await db.projects.get(f.projectId)),snapshot=await capturePublicationSnapshot(scope),source=publicationReaderSource(snapshot);delete catalog.development;assert(!getLocalToolCatalog(definition.namespace)?.development,'Compiled module still available');db.close();closed=true;
  const reader=await buildReaderHtml(source.project,[writing],defaultReaderPresentation(),'en',scope,source),readerDoc=new DOMParser().parseFromString(reader.html,'text/html');assert(readerDoc.querySelectorAll('[data-wh-rich-prose] h2').length>=2&&readerDoc.querySelector('[data-wh-rich-prose] pre code')?.textContent==='CODE <842>','DB-closed Reader lost Source/Owned rich vocabulary');
  for(const includeImages of [false,true])for(const includeMedia of [false,true]){
   const options={locale:'en' as const,includeMaps:false,includeImages,includeMedia,excludedEntryIds:[excluded.id],additionalDocuments:[{kind:'local-tool' as const,id:f.source.id,namespace:definition.namespace}]},data=await loadWorldWikiData(f.projectId,options,{...source,images:[]}),wiki=buildWorldWiki(data,options),doc=new DOMParser().parseFromString(wiki.html,'text/html');
   assert(doc.querySelectorAll('[data-wh-rich-prose] h2').length>=3,'Captured wiki embedded/standalone source dropped rich content without its module');assert(!!doc.querySelector('[data-wh-rich-prose] img[alt="INLINE_842"]')===includeImages,'Raster policy conflated includeImages and includeMedia');
   const anchors=[...doc.querySelectorAll('[data-wh-rich-prose] a')];assert(anchors.some(a=>a.textContent==='ADMITTED_LABEL_842'&&a.getAttribute('href')?.startsWith('#entry-')),'Included rich Codex link did not target the local wiki article');assert(!anchors.some(a=>a.textContent==='EXCLUDED_LABEL_842')&&doc.body.textContent?.includes('EXCLUDED_LABEL_842'),'Excluded rich Codex label disappeared or stayed navigable');
   assert(doc.querySelector('[data-wh-rich-prose] pre code')?.textContent==='CODE <842>'&&!wiki.html.includes('; font-src data:'),'Second sanitizer lost code text or added unnecessary font CSP');
  }
  await db.open();closed=false;assert(JSON.stringify(await db.projects.get(f.projectId))===before,'Captured/readonly projection rewrote the raw rich source');
  return ['Saved codec distinguishes equal rich/legacy literals; module-absent DB-closed Reader/wiki preserve text, only admitted anchors and independent image/media policy without writes'];
 }finally{if(closed)await db.open();catalog.development=compiled;await deleteProject(f.projectId);}
}

export async function reviewRichProseBookExitPending():Promise<string[]>{
 const f=await fixture(),root=createRoot(document.getElementById('root')!),words='BOOK_CHILD_ONLY_DRAFT_639';let closed=false;
 const writing:Writing={id:f.projectId+'-book-chapter',projectId:f.projectId,title:'Owned book chapter',content:'<p>Unchanged parent prose.</p>'+serializeLocalToolBlock(f.projectId,createLocalToolBlockEnvelope(definition.namespace,definition.blocks![0],'review-book-owned')),status:'draft',wordCount:4,tags:[],chapter:1,createdAt:1,updatedAt:1};
 function Host(){const[open,setOpen]=useState(true);return <EnginePaneContext.Provider value={{instanceId:'review-book-exit',projectId:f.projectId,visible:true,navigate:()=>{}}}>{open?<BookEditor projectId={f.projectId} writings={[writing]} onRefresh={async()=>{}} onOpenChapter={()=>{}} onClose={()=>{closed=true;setOpen(false);}}/>:<p data-review-book-closed>Book closed</p>}</EnginePaneContext.Provider>;}
 try{
  await db.writings.put(writing);await act(async()=>{root.render(<StrictMode><MemoryRouter><Host/></MemoryRouter></StrictMode>);await pause();});await until(()=>richEditor(),'Actual Book did not mount real Owned rich editor');
  await act(async()=>{richEditor()!.commands.setContent('<p>'+words+'</p>');await pause();});assert(button('Save briefing')&&!button('Save briefing')!.disabled,'Book child draft not pending');await click(button('Back'));await act(async()=>{await pause();});
  const stored=await db.writings.get(writing.id),block=stored&&findLocalToolBlocksInHtml(stored.content)[0]?.envelope,persisted=block?.scope==='host'&&String(block.data.briefing).includes(words),retained=richEditor()?.getText().includes(words);
  assert(persisted||retained,`Book Back lost child-only draft: closed=${closed}, savedBriefing=${block?.scope==='host'?String(block.data.briefing):'missing'}, retained=${!!retained}`);
  return ['Actual combined Book Back either confirms a child-only Owned draft or retains its editor instead of silently closing over unsaved work'];
 }finally{await act(async()=>root.unmount());await deleteProject(f.projectId);}
}

export async function reviewRichProseWritingExitPending():Promise<string[]>{
 const f=await fixture(),root=createRoot(document.getElementById('root')!),words='WRITING_CHILD_ONLY_DRAFT_481';
 const writing:Writing={id:f.projectId+'-single-chapter',projectId:f.projectId,title:'Single Owned chapter',content:'<p>Unchanged single parent prose.</p>'+serializeLocalToolBlock(f.projectId,createLocalToolBlockEnvelope(definition.namespace,definition.blocks![0],'review-writing-owned')),status:'draft',wordCount:5,tags:[],chapter:1,createdAt:1,updatedAt:1};
 try{
  await db.writings.put(writing);await act(async()=>{root.render(<StrictMode><MemoryRouter initialEntries={[`/project/${f.projectId}/writings?writing=${writing.id}`]}><EnginePaneContext.Provider value={{instanceId:'review-writing-exit',projectId:f.projectId,visible:true}}><WritingsView projectId={f.projectId} writings={[writing]} onAdd={async()=>{}} onEdit={async()=>{}} onDelete={async()=>{}}/></EnginePaneContext.Provider></MemoryRouter></StrictMode>);await pause();});await until(()=>richEditor(),'Actual WritingsView did not open its real Owned editor');
  await act(async()=>{richEditor()!.commands.setContent('<p>'+words+'</p>');await pause();});assert(button('Save briefing')&&!button('Save briefing')!.disabled,'Single chapter child draft not pending');await click(button('Back'));await act(async()=>{await pause();});
  const stored=await db.writings.get(writing.id),block=stored&&findLocalToolBlocksInHtml(stored.content)[0]?.envelope,persisted=block?.scope==='host'&&String(block.data.briefing).includes(words),retained=richEditor()?.getText().includes(words);
  assert(persisted||retained,`Single chapter Back lost child-only draft: savedBriefing=${block?.scope==='host'?String(block.data.briefing):'missing'}, retained=${!!retained}`);
  return ['Actual single chapter Back confirms or retains a child-only real Owned draft without closing silently'];
 }finally{await act(async()=>root.unmount());await deleteProject(f.projectId);}
}

export async function reviewRichProseFrozenEditionAndMissingReferences():Promise<string[]>{
 const f=await fixture(),scope={projectId:f.projectId},client=createLocalToolClient(f.projectId,definition,{documentId:f.source.id});let cloned='';
 try{
  const target={...card(f.projectId),id:f.projectId+'-historical-target',title:'Historical target'},opaque=f.projectId+'-opaque-id',anchor=`<a href="/project/${f.projectId}/codex?entry=${target.id}">HISTORICAL_LABEL_428</a>`;
  await db.codexEntries.put(target);await client.state!.apply(await client.read(),[{type:'set',field:'briefing',value:'<h2>SOURCE_ONLY_CANARY_428</h2><p>'+anchor+'</p>'}]);
  const envelope=createLocalToolBlockEnvelope(definition.namespace,definition.blocks![0],'historical-owned');assert(envelope.scope==='host','Actual example is not Owned');envelope.data={briefing:'<h2>OWNED_ONLY_CANARY_428</h2><p>'+anchor+'</p>',caption:opaque};
  const content=serializeLocalToolBlock(f.projectId,envelope)+`<figure data-wh-tool-block="true" data-project-id="${f.projectId}" data-tool-kind="local-tool" data-document-id="${f.source.id}" data-namespace="${definition.namespace}" data-label="Historical source"><figcaption>Historical source</figcaption></figure>`,writing:Writing={id:f.projectId+'-historical-chapter',projectId:f.projectId,title:'Published rich chapter',content,status:'draft',wordCount:2,tags:[],chapter:1,createdAt:1,updatedAt:1};await db.writings.put(writing);
  const input={projectId:f.projectId,chapterIds:[writing.id],title:'Independent rich edition',locale:'en' as const,expectedRevision:0},stale=await preparePublishedEdition(input);
  await client.state!.apply(await client.read(),[{type:'set',field:'briefing',value:'<h2>SOURCE_ONLY_CANARY_428</h2><p>Confirmed intervening rich edit '+anchor+'</p>'}]);
  let conflict=false;try{await commitPublishedEdition(stale,0);}catch(error){conflict=String(error).includes('published_edition_conflict');}assert(conflict&&!(await db.projects.get(f.projectId))!.publishedEditions?.length,'Changed captured rich source committed a stale edition or partial publication');
  const {edition}=await commitPublishedEdition(await preparePublishedEdition(input),0),frozenHtml=edition.reader.html,frozenHash=edition.reader.sha256;assert(frozenHtml.includes('SOURCE_ONLY_CANARY_428'),'Published artifact did not capture source rich prose');
  await db.codexEntries.delete(target.id);const read=await readSourceToolDocument(scope,f.source.id);assert(read,'Source missing before normal archive');await archiveSourceToolDocument(scope,f.source.id,definition.namespace,read.document.revision,read.version);
  const restored=await restorePublishedEdition({projectId:f.projectId,editionId:edition.id,expectedRevision:1});assert(restored.missingReferences.some(row=>row.kind==='codex'&&row.id===target.id)&&restored.missingReferences.some(row=>row.kind==='local-tool'&&row.id===f.source.id),'Restore omitted rich missing reference or missing Source document');assert(!restored.missingReferences.some(row=>row.id===opaque),'Restore searched an opaque legacy scalar by substring');
  assert(!(await db.projects.get(f.projectId))!.sourceToolDocuments?.some(row=>row.id===f.source.id),'Restore reconstructed a deleted Source document from frozen HTML');assert(!restored.writings[0].content.includes('SOURCE_ONLY_CANARY_428'),'Restored editable chapter copied Source text out of frozen reader HTML');
  const current=await getPublishedEdition(f.projectId,edition.id);assert(current.reader.html===frozenHtml&&current.reader.sha256===frozenHash,'Restore/source deletion changed frozen reader artifact');
  cloned=await importProjectData(await exportProjectData(f.projectId));const imported=(await db.projects.get(cloned))!.publishedEditions![0],span=findLocalToolBlocksInHtml(imported.chapters[0].writing.content)[0];assert(span.projectId===cloned&&span.envelope.scope==='host','Historical editable Owned did not remap into destination');
  const doc=new DOMParser().parseFromString(String(span.envelope.data.briefing),'text/html'),href=doc.querySelector('a')!.getAttribute('href')!,url=new URL(href,'https://writer.invalid');assert(url.pathname===`/project/${cloned}/codex`&&url.searchParams.get('entry')!==target.id,'Historical missing pointer was dropped or still targets old project/ID');assert(span.envelope.data.caption===opaque,'Historical rich remap changed undeclared opaque scalar');assert(imported.reader.html===frozenHtml&&imported.reader.sha256===frozenHash,'JSON clone regenerated frozen reader HTML/hash');
  return ['Native prepare/commit detects rich-source edits; restore reports rich missing pointers without inventing Source text; JSON remaps historical editable links while frozen artifact and opaque data stay exact'];
 }finally{if(cloned)await deleteProject(cloned);await deleteProject(f.projectId);}
}
