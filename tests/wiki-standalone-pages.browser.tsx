import {assetFromFile} from '@/engines/model-viewer/model';
import {modelViewerFixture} from './model-viewer-fixture';
import '@/engines';
import { db } from '@/db';
import { buildWorldWiki, loadWorldWikiData } from '@/services/worldWikiExport';
import { captureWikiSnapshot, wikiSource } from '@/services/wikiProfiles/snapshot';
import { wikiDocumentCatalog, wikiDocumentArticleId } from '@/services/wikiProfiles/documents';
import { saveWikiProfile, prepareWikiEdition, commitWikiEdition, getWikiEdition, publishWikiProfile } from '@/services/wikiProfiles/store';
import { wikiProfileChanges } from '@/services/wikiProfiles/changes';
import { validateWikiOptions, remapWikiProfiles } from '@/services/wikiProfiles/validation';
import { saveEraDocument, readWorldDocument } from '@/services/worldEras/store';
import { createSheet } from '@/engines/character-sheets/types';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { duplicateProject, previewProjectDuplicate } from '@/services/projectDuplicate/service';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { deleteProject } from '@/db/operations';
import type { Project } from '@/types';
import type { WorldWikiOptions, WikiDocumentRef } from '@/types/worldWiki';
import type { WorldTable } from '@/engines/tables/types';

function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
async function rejects(work:()=>Promise<unknown>){let refused=false;try{await work();}catch{refused=true;}assert(refused,'Expected rejection');}
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const page=(html:string)=>new DOMParser().parseFromString(html,'text/html');

export async function testWikiStandalonePages():Promise<string[]>{
  const P='wiki-standalone-pages',extras:string[]=[],passed:string[]=[];
  const refs:WikiDocumentRef[]=[{kind:'notes',id:P+'-note'},{kind:'tables',id:P+'-table'},{kind:'board',id:P+'-board'},{kind:'timeline',id:P+'-timeline'},{kind:'character-sheets',id:P+'-sheet'},{kind:'dictionary',id:P+'-dictionary'},{kind:'local-tool',id:P+'-local',namespace:'qa.counter'},{kind:'relation-tree',id:P+'-tree'},{kind:'radar',id:P+'-radar'},{kind:'model-viewer',id:P+'-model'}];
  try{
    const table:WorldTable={id:P+'-table',title:'Wide and long table',mode:'sheet',columns:Array.from({length:10},(_,i)=>({id:'c'+i,name:i===1?'SECRET_COLUMN':'Column '+i,kind:'text' as const})),rows:Array.from({length:16},(_,r)=>({id:'r'+r,cells:Object.fromEntries(Array.from({length:10},(_,c)=>['c'+c,c===1?'SECRET_CELL':r===0&&c===2?'=A1+2':c===0?'3':`R${r}C${c}`]))}))};
    const sheet=createSheet('custom','Standalone sheet');sheet.id=P+'-sheet';sheet.details.notes='Full sheet notes';sheet.ink={version:1,surface:'paper-v1',width:1000,strokes:[{id:'pen',tool:'pen',color:'#334455',width:3,points:[{x:10,y:20},{x:40,y:50}]},{id:'eraser',tool:'eraser',color:'#334455',width:3,points:[{x:20,y:30},{x:30,y:40}]}]};
    const model=await assetFromFile(new File([await modelViewerFixture()],'Standalone castle.glb'));model.id=P+'-model';
    await db.projects.put({id:P,title:'Standalone QA',description:'',mode:'custom',type:'standalone',status:'draft',color:'#999999',enabledEngines:['codex','notes','tables','board','timeline','character-sheets'],engineOrder:[],createdAt:1,updatedAt:1,dataTables:[table],characterSheets:[sheet],dictionaries:[{id:P+'-dictionary',name:'Complete dictionary',description:'All words',scriptMapping:'',detectInManuscript:false,words:Array.from({length:16},(_,i)=>({id:'word'+i,word:'Word '+i,nativeForm:'',pronunciation:'pronunciation '+i,partOfSpeech:'noun',meaning:'Meaning '+i,examples:'Example '+i,phrases:'',derivatives:'',origin:'',senses:[{partOfSpeech:'verb',meaning:'Sense '+i,examples:'Extra example '+i}]}))}],sourceToolDocuments:[{id:P+'-local',namespace:'qa.counter',title:'Declarative count',revision:0,createdAt:1,updatedAt:1,data:{count:42}}],modelAssets:[model],relationTrees:[{id:P+'-tree',title:'Complete tree',nodes:[...Array.from({length:82},(_,i)=>({id:'tree'+i,label:'Tree member '+i,position:{x:i*150,y:0}})),{id:'private-tree',label:'PRIVATE_CACHED_TREE',codexEntryId:P+'-private-card',position:{x:0,y:0}}],edges:[],revision:0,createdAt:1,updatedAt:1}],radarCharts:[{id:P+'-radar',title:'Complete radar',description:'',axes:[0,1,2].map(i=>({id:'a'+i,label:'Axis '+i,min:0,max:10,unit:''})),series:[{id:'visible',name:'Visible radar series',color:'#779988',values:{a0:3,a1:4,a2:5}},{id:'private',name:'PRIVATE_CACHED_RADAR',linkedEntryId:P+'-private-card',color:'#998877',values:{a0:5,a1:6,a2:7}}],revision:0,createdAt:1,updatedAt:1}],worldEras:[{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1}]} as Project);
    await db.notes.put({id:P+'-note',projectId:P,kind:'note',title:'A standalone note',text:'Literal <script>do not execute</script> & ink\nLast line',source:'QA attribution',tags:[],pinned:false,cover:PNG,createdAt:1,updatedAt:1});
    await db.notes.put({id:P+'-inbox',projectId:'__inbox__',kind:'note',text:'INBOX_SECRET',tags:[],pinned:false,createdAt:1,updatedAt:1});
    await db.boards.put({id:P+'-board',projectId:P,title:'Large board',surface:'white',createdAt:1,updatedAt:1});
    await db.boardNodes.bulkPut(Array.from({length:35},(_,i)=>({id:P+'-node'+i,projectId:P,boardId:P+'-board',kind:'card' as const,title:'Card '+i,content:i===34?'Long body '+ 'x'.repeat(450)+' LAST_BOARD_TEXT':'Content '+i,color:'#ffffff',position:{x:i*20,y:20},size:{width:100,height:80},zIndex:i,createdAt:1,updatedAt:1})));
    await db.boardNodes.put({id:P+'-private-node',projectId:P,boardId:P+'-board',kind:'card',title:'PRIVATE_CACHED_NAME',content:'PRIVATE_CACHED_BODY',color:'#ffffff',position:{x:0,y:0},size:{width:50,height:50},zIndex:0,ref:{engineId:'codex',entityType:'character',entityId:P+'-private-card',title:'PRIVATE_CACHED_NAME'},createdAt:1,updatedAt:1});
    await db.boardNodes.put({id:P+'-foreign-node',projectId:P,boardId:P+'-board',kind:'entity',title:'PRIVATE_CACHED_FOREIGN_MAP',content:'PRIVATE_CACHED_FOREIGN_BODY',color:'#ffffff',position:{x:0,y:0},size:{width:50,height:50},zIndex:0,ref:{engineId:'maps',entityType:'world-map',entityId:'foreign-map',title:'PRIVATE_CACHED_FOREIGN_MAP'},createdAt:1,updatedAt:1});
    await db.codexEntries.put({id:P+'-private-card',projectId:P,title:'PRIVATE_CACHED_NAME',type:'character',content:'PRIVATE_CARD',fields:{},relations:[],tags:[],createdAt:1,updatedAt:1});
    await db.timelines.put({id:P+'-timeline',projectId:P,title:'Only timeline',description:'Events',createdAt:1,updatedAt:1});
    await db.timelineEvents.bulkPut([{id:P+'-event',projectId:P,timelineId:P+'-timeline',title:'Visible event',description:'Event body',date:'Day 1',order:0,tags:[],color:'#ffffff',createdAt:1,updatedAt:1},{id:P+'-secret-event',projectId:P,timelineId:P+'-timeline',title:'HIDDEN_EVENT',description:'Hidden body',date:'Day 2',order:1,tags:[],color:'#ffffff',hideFromWiki:true,createdAt:1,updatedAt:1}]);
    await db.timelines.put({id:P+'-omitted-timeline',projectId:P,title:'PRIVATE_CACHED_TIMELINE',description:'',createdAt:1,updatedAt:1});
    await db.timelineEvents.put({id:P+'-omitted-event',projectId:P,timelineId:P+'-omitted-timeline',title:'PRIVATE_CACHED_EVENT',description:'',date:'Day 3',order:0,tags:['PRIVATE_CACHED_TAG'],color:'#ffffff',createdAt:1,updatedAt:1});
    const plain=buildWorldWiki(await loadWorldWikiData(P,{types:[],includeMaps:false}),{types:[],includeMaps:false}).html;
    assert(!page(plain).querySelector('#wiki article'),'Extra documents never appear by default');
    const options:WorldWikiOptions={types:[],includeMaps:false,locale:'en',additionalDocuments:refs,excludedEntryIds:[P+'-private-card'],excludedFields:['SECRET_COLUMN'],grouping:'manual',sections:[{id:'root',name:'Root section',documents:[]},{id:'child',parentId:'root',name:'Child section',documents:refs}]};
    validateWikiOptions(options);
    const built=buildWorldWiki(await loadWorldWikiData(P,options),options),doc=page(built.html);
    assert(doc.querySelectorAll('#wiki article').length===10,'Ten standalone pages, without a Codex wrapper');
    assert(doc.querySelector('[data-section-id="root"] [data-section-id="child"] article'),'Nested section contains pages');
    assert(doc.body.textContent?.includes('Literal <script>do not execute</script> & ink')&&!doc.querySelector('#wiki script'),'Note is literal escaped text');
    assert(doc.querySelector('#wiki img')?.getAttribute('src')===PNG,'Note raster cover is retained');
    assert(doc.getElementById(wikiDocumentArticleId(refs[1]))?.textContent?.includes('5'),'Formula result is rendered after filtering a preceding column');
    assert(built.html.includes('R15C9')&&built.html.includes('LAST_BOARD_TEXT')&&built.html.includes('Extra example 15'),'No preview row/column/body/dictionary truncation');
    assert(!/SECRET_COLUMN|SECRET_CELL|PRIVATE_CACHED_|HIDDEN_EVENT|INBOX_SECRET/.test(built.html),'Private references, field values, hidden events and inbox omitted physically');
    assert(doc.querySelector('[data-section-id="child"]')?.textContent?.includes('Full sheet notes')&&built.html.includes('42'),'Native sheet and declarative local preview exported');
    assert(doc.querySelectorAll('article[id^="timeline-"]').length===1,'Explicit timeline renders once');
    assert(built.html.includes('Tree member 81')&&built.html.includes('Visible radar series')&&doc.querySelector('template[data-wh-model-data]'),'Full tree, radar and native offline model render');
    passed.push('Ten standalone document kinds publish without Codex; full table/board/dictionary content, literal notes, sheets and local declarative data; private fields/references/events/inbox omitted');

    const withAll={...options,includeTimelines:true,excludedDocuments:[{kind:'timeline' as const,id:P+'-omitted-timeline'}]};assert(!/PRIVATE_CACHED_/.test(buildWorldWiki(await loadWorldWikiData(P,withAll),withAll).html),'Omitted timeline title, events and tags absent from all-times mode');assert(page(buildWorldWiki(await loadWorldWikiData(P,withAll),withAll).html).querySelectorAll('article[id^="timeline-"]').length===1,'Legacy all timelines does not duplicate selected timeline');
    await db.codexEntries.put({id:P+'-holder',projectId:P,title:'Public holder',type:'custom',content:`<p>Public holder text.</p><figure data-wh-tool-block="true" data-project-id="${P}" data-tool-kind="board" data-document-id="${P}-board" data-label="PRIVATE_CACHED_BOARD"></figure>`,fields:{},relations:[],tags:[],createdAt:1,updatedAt:1});
    const hidden={...options,types:['custom' as const],sections:options.sections!.map(section=>section.id==='root'?{...section,hideDocuments:true}:section)};
    const hiddenHtml=buildWorldWiki(await loadWorldWikiData(P,hidden),hidden).html;
    const embeddedOptions:WorldWikiOptions={types:['custom'],includeMaps:false,sections:[{id:'embedded',name:'Embedded board',documents:[refs[2]]}]};
    const cachedEmbedded=await loadWorldWikiData(P,embeddedOptions),changedEmbedded={...embeddedOptions,sections:embeddedOptions.sections!.map(section=>({...section,hideDocuments:true}))};
    assert(!buildWorldWiki(cachedEmbedded,changedEmbedded).html.includes('Card 0'),'Changing a section policy invalidates an embedded preview cache even without an additional selection');
    assert(hiddenHtml.includes('Public holder text.')&&!/PRIVATE_CACHED_BOARD/.test(hiddenHtml),'Public holder retains text, hidden board embedded block stays unavailable');
    assert(!/A standalone note|LAST_BOARD_TEXT|Full sheet notes|data:image\/png/.test(hiddenHtml),'Hidden ancestor removes descendants, names and raster hydration');
    const revealed={...options,onlyRevealed:true};assert(!page(buildWorldWiki(await loadWorldWikiData(P,revealed),revealed).html).querySelector('#wiki article'),'Revealed-only does not publish unmarked tools or unlinked events');
    const noImage={...options,includeImages:false};assert(!page(buildWorldWiki(await loadWorldWikiData(P,noImage),noImage).html).querySelector('#wiki img'),'Image switch applies to standalone notes');
    const snap=wikiSource(await captureWikiSnapshot({projectId:P}));
    const catalog=wikiDocumentCatalog(snap);assert(catalog.length===11&&!catalog.some(item=>item.ref.id===P+'-inbox'),'Captured catalogue stays in project scope');
    db.close();try{assert(buildWorldWiki(await loadWorldWikiData(P,options,snap),options).html.includes('LAST_BOARD_TEXT'),'Standalone projection uses only captured data');}finally{await db.open();}
    passed.push('Ancestor visibility and revealed-only omissions precede hydration; image toggle and catalogue scope work; captured rendering works with DB closed');

    const eraRead=(await readWorldDocument({projectId:P,eraId:'past'},'notes',P+'-note'))!;
    await saveEraDocument({projectId:P,eraId:'past'},'notes',{...eraRead.document,root:{...eraRead.document.root,text:'Era note, not Base'}},eraRead.version);
    const eraOptions={...options,eraId:'past'};assert(buildWorldWiki(await loadWorldWikiData(P,eraOptions),eraOptions).html.includes('Era note, not Base')&&(await db.notes.get(P+'-note'))!.text.includes('Literal'),'Effective era note without Base mutation');
    const profile=await saveWikiProfile(P,{name:'Standalone edition',options},null);
    const metadata=await runBridgeTool('wh_wiki_profile_get',{projectId:P,profileId:profile.id,includeDocuments:true});assert(metadata.ok&&(metadata.result as {documents:unknown[]}).documents.length===11,'MCP profile catalogue contains all effective standalone refs');
    const pending=await prepareWikiEdition(P,profile.id,profile.revision);
    await db.notes.update(P+'-note',{text:'A concurrent note edit'});
    await rejects(()=>commitWikiEdition(P,profile.id,pending,profile.revision));
    const published=await publishWikiProfile(P,profile.id,profile.revision),edition=published.editions!.at(-1)!;
    await db.notes.update(P+'-note',{text:'After the frozen edition'});
    assert((await getWikiEdition(P,profile.id,edition.id)).reader.html===edition.reader.html,'Frozen edition never resolves current notes');
    const changes=await wikiProfileChanges(P,profile.id);assert(changes.changes.length===1&&changes.changes[0].kind==='notes'&&changes.changes[0].change==='changed','Standalone note change counted once');
    passed.push('Era note resolves from capture; MCP catalog discovers refs; source-race CAS refuses commit; frozen edition remains exact and changes tracks the note');

    const mapped=remapWikiProfiles({wikiProfiles:[published]},(id,prefix)=>`${prefix}-copy-${id}`).wikiProfiles![0];
    assert(mapped.options.sections![1].parentId===mapped.options.sections![0].id&&mapped.options.additionalDocuments!.find(ref=>ref.kind==='notes')!.id==='note-copy-'+P+'-note','Clone remaps parent/notes refs');
    assert(mapped.editions![0].reader.html===edition.reader.html&&mapped.editions![0].reader.sha256===edition.reader.sha256,'Frozen clone artifact and digest stay exact');
    const preview=await previewProjectDuplicate({projectId:P}),copy=await duplicateProject({projectId:P,title:'Standalone copied',operationId:crypto.randomUUID(),expectedSourceVersion:preview.sourceVersion});extras.push(copy.projectId);
    const copied=(await db.projects.get(copy.projectId))!.wikiProfiles![0];
    const copiedNote=copied.options.additionalDocuments!.find(ref=>ref.kind==='notes')!;
    assert(copiedNote.id!==P+'-note'&&(await db.notes.get(copiedNote.id))?.projectId===copy.projectId,'Actual project copy points to its own note');
    assert(copied.editions![0].reader.sha256===edition.reader.sha256,'Actual project duplicate preserves frozen digest');
    const {blob}=await createProjectZipArchive(P);
    await deleteProject(P);await importProjectZip(new File([blob],'wiki-standalone.zip',{type:'application/zip'}));
    const restored=(await db.projects.get(P))!.wikiProfiles![0];assert(restored.options.sections![1].parentId==='root'&&(await getWikiEdition(P,restored.id,edition.id)).reader.sha256===edition.reader.sha256,'ZIP restores tree and exact frozen edition');

    passed.push('Profile remapping, actual project duplication and ZIP round trip preserve refs/tree while frozen HTML and digest stay exact');
    return passed;
  }finally{
    for(const id of [P,...extras])if(await db.projects.get(id))await deleteProject(id);
    await db.notes.delete(P+'-inbox');
  }
}

/** An actual Codex-held sheet atom must reach the native paper renderer in legacy mode. */
export async function testWikiEmbeddedSheet():Promise<string[]>{
 const P='wiki-embedded-sheet';
 try{
  const sheet=createSheet('custom','Embedded character sheet');sheet.id=P+'-sheet';sheet.details.notes='EMBEDDED_SHEET_NATIVE_NOTES';sheet.ink={version:1,surface:'paper-v1',width:1000,strokes:[{id:'pen',tool:'pen',color:'#334455',width:3,points:[{x:10,y:20},{x:40,y:50}]},{id:'eraser',tool:'eraser',color:'#334455',width:3,points:[{x:20,y:30},{x:30,y:40}]}]};
  await db.projects.put({id:P,title:'Embedded sheet QA',description:'',mode:'custom',type:'standalone',status:'draft',color:'#999999',enabledEngines:['codex','character-sheets'],createdAt:1,updatedAt:1,characterSheets:[sheet]} as Project);
  await db.codexEntries.put({id:P+'-entry',projectId:P,title:'Holder',type:'custom',content:`<p>Before the real sheet.</p><figure data-wh-tool-block="true" data-project-id="${P}" data-tool-kind="character-sheets" data-document-id="${sheet.id}" data-label="Cached sheet name"></figure><p>After the real sheet.</p>`,fields:{},relations:[],tags:[],createdAt:1,updatedAt:1});
  const options:WorldWikiOptions={locale:'en',includeMaps:false};
  const html=buildWorldWiki(await loadWorldWikiData(P,options),options).html,doc=page(html),article=doc.querySelector('#wiki article');
  assert(article?.textContent?.includes('Before the real sheet.')&&article.textContent.includes('After the real sheet.'),'Codex holder prose remains');
  assert(article.querySelector('svg[data-sheet-paper="paper-v1"]')&&article.textContent?.includes('EMBEDDED_SHEET_NATIVE_NOTES'),'Actual embedded sheet renders native SVG and full source notes');
  const mask=article.querySelector('mask[id]');assert(mask&&article.querySelector(`[mask="url(#${mask.id})"]`)&&article.querySelector('[data-sheet-ink-stroke]'),'Native ink and eraser reference the same mask');
  assert(!article.textContent?.includes('Model unavailable.')&&!article.textContent?.includes('Linked document not included.'),'A valid sheet never becomes an unavailable placeholder');
  return['Legacy wiki renders an actual embedded character sheet with source notes, pen and eraser, alongside its holder prose'];
 }finally{if(await db.projects.get(P))await deleteProject(P);}
}
