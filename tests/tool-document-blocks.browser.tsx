import { act,useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter,useLocation } from 'react-router-dom';
import { EditorContent,useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { db } from '@/db';
import type { Project,CodexEntry } from '@/types';
import '@/engines/tables';
import '@/engines/character-sheets';
import '@/engines/maps';
import { ToolDocumentBlock } from '@/components/editor/toolBlocks/ToolDocumentBlock';
import ToolDocumentModal from '@/components/editor/toolBlocks/ToolDocumentModal';
import ToolDocumentControls from '@/components/editor/toolBlocks/ToolDocumentControls';
import { createCodexBlockHost } from '@/components/editor/codexBlocks/model';
import { listToolDocuments,prepareToolDocumentBlocksForExport,resolveToolPreview,safeToolSvg,sanitizeToolPreviewHtml } from '@/components/editor/toolBlocks/preview';
import { hydrateToolDocumentBlocks } from '@/components/editor/toolBlocks/reading';
import { toolDocumentPath,type ToolDocumentTarget } from '@/components/editor/toolBlocks/model';
import { createSheet } from '@/engines/character-sheets/types';
import { createRadarChart } from '@/engines/radar/model';
import { ToolDocumentDepth } from '@/components/editor/toolBlocks/EmbeddedToolCloseContext';
import { modelViewerFixture } from './model-viewer-fixture';
import { assetFromFile } from '@/engines/model-viewer/model';
import { sheetDraftStore } from '@/engines/character-sheets/drafts';
import { saveSheet } from '@/engines/character-sheets/operations';
import { buildWorldWiki,loadWorldWikiData } from '@/services/worldWikiExport';
import { exportProjectData,importProjectData } from '@/db/operations';
import { useLocaleStore } from '@/stores/localeStore';
const P='test-tool-blocks',Q=P+'-foreign',MAP=P+'-map',TABLE=P+'-table',SHEET=P+'-sheet';
const pause=()=>new Promise(resolve=>setTimeout(resolve,70));
function assert(value:unknown,message:string):asserts value {if(!value)throw new Error(message);}
const block=(kind:string,id:string,projectId=P,label='Cached title')=>`<figure data-wh-tool-block="true" data-project-id="${projectId}" data-tool-kind="${kind}" data-document-id="${id}" data-label="${label}"><figcaption>${label}</figcaption></figure>`;
const target=(kind:ToolDocumentTarget['kind'],documentId:string):ToolDocumentTarget=>({kind,documentId,projectId:P,label:'Stored fallback'});
function setValue(input:HTMLInputElement,value:string){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}
export async function testToolDocumentBlocks():Promise<string[]> {
  const host=document.getElementById('root');assert(host,'root');const root=createRoot(host),passed:string[]=[];let cloneId='';
  const waitFor=async(check:()=>boolean,message:string)=>{for(let i=0;i<80;i++){if(check())return;await act(async()=>{await pause();});}throw new Error(message);};
  const project:Project={id:P,title:'Local world',description:'',mode:'custom',type:'standalone',status:'draft',color:'#000',enabledEngines:['tables','character-sheets'],engineOrder:['tables','character-sheets'],createdAt:1,updatedAt:1,dataTables:[{id:P+'-first',title:'First table',mode:'table',columns:[{id:'first',name:'First',kind:'text'}],rows:[]},{id:TABLE,title:'Trade prices',mode:'sheet',columns:[{id:'a',name:'Price',kind:'number'},{id:'b',name:'Double',kind:'text'}],rows:[{id:'r',cells:{a:'12',b:'=A1*2'}}]}]};
  const sheet=createSheet('custom','Second character');sheet.id=SHEET;sheet.revision=1;project.characterSheets=[{...createSheet('custom','First character'),revision:1},sheet];
  const radar=createRadarChart('Measures');radar.id=P+'-radar';
  project.radarCharts=[radar];project.dictionaries=[{id:P+'-language',name:'Harbor speech',description:'Local language',scriptMapping:'',detectInManuscript:true,words:[{id:'word',word:'nar',nativeForm:'',pronunciation:'',partOfSpeech:'noun',meaning:'water',examples:'',phrases:'',derivatives:'',origin:''}]}];
  project.relationTrees=[{id:P+'-tree',title:'Harbor family',nodes:[{id:'node',label:'Free person',position:{x:0,y:0}}],edges:[],revision:1,createdAt:1,updatedAt:1}];
  project.modelAssets=[{...await assetFromFile(new File([await modelViewerFixture()],'Harbor.glb')),id:P+'-model'}];
  const entry:CodexEntry={id:P+'-entry',projectId:P,title:'World entry',type:'location',fields:{},content:block('maps',MAP)+block('tables',TABLE),tags:[],relations:[],createdAt:1,updatedAt:1};
  useLocaleStore.setState({locale:'en',loaded:true});
  try {
    await db.projects.bulkPut([project,{...project,id:Q,title:'Private foreign project',dataTables:[{...project.dataTables![1],id:Q+'-table',title:'ForeignSecretTitle'}]}]);
    await db.worldMaps.bulkPut([{id:MAP,projectId:P,title:'Harbor map',backgroundImage:'https://example.invalid/never-fetch',features:[{id:'region',kind:'region',name:'Harbor',points:[{x:0,y:0},{x:30,y:0},{x:20,y:30}],color:'url(https://example.invalid/color)'}],createdAt:1,updatedAt:1},{id:Q+'-map',projectId:Q,title:'ForeignSecretMap',createdAt:1,updatedAt:1}]);
    await db.codexEntries.put(entry);
    await db.boards.put({id:P+'-board',projectId:P,title:'Harbor board',surface:'cork',createdAt:1,updatedAt:1});
    await db.timelines.put({id:P+'-timeline',projectId:P,title:'Harbor history',color:'#d5b575',createdAt:1,updatedAt:1});
    const documents=await listToolDocuments(P);assert(documents.some(doc=>doc.documentId===TABLE)&&!documents.some(doc=>doc.projectId===Q||doc.label.includes('ForeignSecret')),'catalog scopes every source');
    assert(await resolveToolPreview(target('maps',Q+'-map'),P)===null,'foreign core ID refused');assert(await resolveToolPreview({...target('tables',Q+'-table'),projectId:Q},P)===null,'foreign metadata scope refused');
    for(const document of documents)assert(await resolveToolPreview(document,P),'every supported core/metadata kind has a usable local preview: '+document.kind);
    const computed=await resolveToolPreview(target('tables',TABLE),P);assert(computed?.html.includes('24')&&!computed.html.includes('=A1'),'sheet preview computes formula');
    const safe=safeToolSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><foreignObject><img src="https://evil.invalid"/></foreignObject><image href="https://evil.invalid"/><path onclick="alert(1)" fill="url(https://evil.invalid)" d="M0 0L1 1"/></svg>');
    assert(!/script|onclick|foreignObject|https:/.test(safe),'SVG resource/script whitelist');assert(!sanitizeToolPreviewHtml('<p onclick="x">safe</p><iframe src="https://evil.invalid"></iframe><script>BAD</script>').includes('BAD'),'cached HTML sanitizer rejects active content');
    passed.push('Scoped catalog, missing/foreign privacy, formula projection and hostile SVG/HTML admission');

    let editor:Editor|null=null,changes=0;const context=createCodexBlockHost({projectId:P,scopeId:'host'});
    function Fixture({nested=false}:{nested?:boolean}){const e=useEditor({extensions:[StarterKit,ToolDocumentBlock.configure(context)],content:'<p>Before</p>'+block('tables',TABLE)+'<p>After</p>',onUpdate:()=>{changes++;}});useEffect(()=>{editor=e;},[e]);return <ToolDocumentDepth.Provider value={nested?1:0}>{e&&<ToolDocumentControls editor={e} projectId={P} locale="en"/>}<EditorContent editor={e}/></ToolDocumentDepth.Provider>;}
    await act(async()=>{root.render(<MemoryRouter><Fixture/></MemoryRouter>);await pause();});await act(async()=>{await pause();});
    assert(editor&&host.textContent?.includes('Trade prices'),'actual node view mounted');const html=(editor as Editor).getHTML(),beforeChanges=changes;
    await act(async()=>{const current=await db.projects.get(P);await db.projects.update(P,{dataTables:current!.dataTables!.map(doc=>doc.id===TABLE?{...doc,title:'Current live prices'}:doc)});await pause();});await act(async()=>{await pause();});
    assert(host.textContent?.includes('Current live prices'),'source update refreshes preview');assert((editor as Editor).getHTML()===html&&changes===beforeChanges,'live refresh leaves host prose/undo untouched');
    assert(!(editor as Editor).commands.insertToolDocumentBlock({...target('maps',MAP),projectId:Q}),'command refuses foreign insertion');
    await act(async()=>{context.setContext({projectId:Q});await pause();});assert(!host.textContent?.includes('Current live prices'),'context switch hides stale preview immediately');
    await act(async()=>{context.setContext({projectId:P});(editor as Editor).commands.setTextSelection(2);await pause();});
    await act(async()=>{host.querySelector<HTMLButtonElement>('[data-tool-block-controls] button')!.click();await pause();});
    const insert=[...host.querySelectorAll<HTMLButtonElement>('[data-tool-block-controls] li button')].find(button=>button.textContent?.includes('Harbor map'));assert(insert,'real picker scopes map');
    await act(async()=>{insert.click();await pause();});assert((editor as Editor).getHTML().includes('data-document-id="'+MAP+'"'),'picker inserts pointer');
    await act(async()=>{(editor as Editor).commands.undo();await pause();});assert((editor as Editor).getHTML()===html,'one undo removes inserted tool block only');
    await act(async()=>{root.render(<MemoryRouter><Fixture nested/></MemoryRouter>);await pause();});assert(!host.querySelector('[data-tool-block-controls]')&&![...host.querySelectorAll('button')].some(button=>button.textContent==='Edit document'),'nested preview cannot recursively open another editor');
    passed.push('Actual editor atom retains tiny pointers; live changes do not edit host and context switches hide source');

    await act(async()=>{root.render(<div/>);await pause();});
    const reader=document.createElement('div');reader.innerHTML=block('tables',TABLE)+block('maps',Q+'-map',Q,'ForeignSecretFallback');host.append(reader);
    const stop=hydrateToolDocumentBlocks(reader,P,'en');await pause();assert(reader.textContent?.includes('Current live prices')&&!reader.textContent.includes('ForeignSecret'),'reader hydration is scoped');
    stop();reader.remove();
    const allowed=await prepareToolDocumentBlocksForExport(entry.content,P,'en');assert(allowed.includes('<svg')&&allowed.includes('24')&&!allowed.includes('example.invalid'),'offline export includes safe vector and computed values');
    const excluded=await prepareToolDocumentBlocksForExport(entry.content,P,'en',{includeMaps:false,includeImages:false});assert(!excluded.includes('Harbor')&&!excluded.includes('<svg'),'map exclusions honored through embedded pointer');
    const data=await loadWorldWikiData(P,{locale:'en'});const wiki=buildWorldWiki(data,{locale:'en'}).html;assert(wiki.includes('Current live prices')&&wiki.includes('24')&&wiki.includes('<svg'),'wiki loads same-snapshot prepared blocks');
    const omitted=buildWorldWiki(data,{locale:'en',includeMaps:false}).html;assert(!omitted.includes('Current live prices'),'changed export policy cannot reuse older prepared cache');
    await db.codexEntries.bulkPut(Array.from({length:160},(_,index)=>({...entry,id:P+'-bulk-'+index,title:'Bulk '+index})));
    const largeSnapshot=await loadWorldWikiData(P,{locale:'en'});assert(largeSnapshot.entries.length===161&&Object.keys(largeSnapshot.toolPreviews?.blocks??{}).length===2,'161-entry snapshot deduplicates pointer resolution without early commit');
    await db.codexEntries.bulkDelete(Array.from({length:160},(_,index)=>P+'-bulk-'+index));
    passed.push('Reader live hydration and offline wiki preserve safe SVG/text while export policy changes invalidate cached previews');

    cloneId=await importProjectData(await exportProjectData(P));const copied=(await db.codexEntries.where('projectId').equals(cloneId).toArray())[0];assert(copied,'cloned entry');const copyDoc=new DOMParser().parseFromString(copied.content,'text/html'),pointers=[...copyDoc.querySelectorAll<HTMLElement>('[data-wh-tool-block]')];
    const cloneProject=await db.projects.get(cloneId),cloneMap=(await db.worldMaps.where('projectId').equals(cloneId).toArray())[0];assert(pointers[0].dataset.projectId===cloneId&&pointers[0].dataset.documentId===cloneMap.id&&pointers[1].dataset.documentId===cloneProject?.dataTables?.[1].id,'real clone remaps core and metadata pointers');
    passed.push('Real project clone remaps map and metadata document pointers to independent local identities');

    let closed=0;const routes:string[]=[];function RouteProbe(){const location=useLocation();routes.push(location.pathname);return null;}
    await act(async()=>{root.render(<MemoryRouter initialEntries={['/project/'+P+'/writings']}><RouteProbe/><ToolDocumentModal target={target('tables',TABLE)} locale="en" onClose={()=>{closed++;}}/></MemoryRouter>);await pause();});await act(async()=>{await pause();});
    await waitFor(()=>Boolean(document.querySelector('[data-tool-document-modal] [aria-current="page"]')?.textContent?.includes('Current live prices')),'modal deep link selects second table');
    let modal=document.querySelector<HTMLElement>('[data-tool-document-modal]');assert(modal,'table modal');
    assert(routes.every(route=>route.endsWith('/writings')),'source router never alters host route');
    const cell=modal.querySelector<HTMLInputElement>('td input');assert(cell,'actual editable cell');await act(async()=>{setValue(cell,'33');await pause();});
    const closeButton=[...modal.querySelectorAll('button')].find(button=>button.textContent==='Save and close');assert(closeButton,'save and close');await act(async()=>{closeButton.click();await pause();});assert(closed===1&&(await db.projects.get(P))!.dataTables![1].rows[0].cells.a==='33','closing flushes debounced real table write');
    passed.push('Actual source engine deep-link, local router isolation and close flush of debounced edits');

    await db.worldMaps.update(MAP,{backgroundImage:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='});
    await act(async()=>{root.render(<MemoryRouter><ToolDocumentModal key="map" target={target('maps',MAP)} locale="en" onClose={()=>{closed++;}}/></MemoryRouter>);await pause();});await act(async()=>{await pause();});
    modal=document.querySelector<HTMLElement>('[data-tool-document-modal]');assert(modal,'map modal');
    await waitFor(()=>Boolean(modal?.querySelector('[data-testid="map-feature-select-region"]')),'map source ready');
    await act(async()=>{modal!.querySelector<HTMLButtonElement>('[data-testid="map-feature-select-region"]')!.click();await pause();});
    const featureName=modal.querySelector<HTMLInputElement>('[data-testid="map-feature-name"]');assert(featureName,'source map inspector');await act(async()=>{setValue(featureName,'Revised Harbor');await pause();});
    await act(async()=>{[...modal!.querySelectorAll('button')].find(button=>button.textContent==='Save and close')!.click();await pause();});assert(closed===1&&document.querySelector('[data-tool-document-modal] [role="alert"]'),'unsubmitted feature cannot disappear on modal close');
    await act(async()=>{modal!.querySelector<HTMLButtonElement>('[data-testid="map-feature-save"]')!.click();await pause();});await act(async()=>{[...modal!.querySelectorAll('button')].find(button=>button.textContent==='Save and close')!.click();await pause();});
    assert(closed===2&&(await db.worldMaps.get(MAP))?.features?.[0].name==='Revised Harbor','map own Save resolves close guard without discarding draft');
    passed.push('Actual map source requires explicit feature save before closing; saved vector persists and releases guard');

    await act(async()=>{root.render(<MemoryRouter><ToolDocumentModal key="sheet" target={target('character-sheets',SHEET)} locale="en" onClose={()=>{closed++;}}/></MemoryRouter>);await pause();});await act(async()=>{await pause();});
    modal=document.querySelector<HTMLElement>('[data-tool-document-modal]');assert(modal,'sheet modal');
    await waitFor(()=>[...modal!.querySelectorAll<HTMLInputElement>('input')].some(input=>input.value==='Second character'),'sheet source ready');
    const name=[...modal.querySelectorAll<HTMLInputElement>('input')].find(input=>input.value==='Second character');assert(name,'selected second RPG source');await act(async()=>{setValue(name,'Unsaved own draft');await pause();});
    const latest=(await db.projects.get(P))!.characterSheets!.find(item=>item.id===SHEET)!;await saveSheet(P,{...latest,title:'Concurrent saved title'},latest.revision);
    await act(async()=>{[...modal!.querySelectorAll('button')].find(button=>button.textContent==='Save and close')!.click();await pause();});
    assert(Number(closed)===2&&document.querySelector('[data-tool-document-modal] [role="alert"]'),'CAS close failure keeps modal open');assert(sheetDraftStore(P).get(SHEET)?.sheet.title==='Unsaved own draft'&&(await db.projects.get(P))!.characterSheets!.find(item=>item.id===SHEET)?.title==='Concurrent saved title','CAS failure retains own recovery and concurrent saved source');
    passed.push('Actual independent source draft CAS failure preserves modal, recovery text and concurrent source');
    assert(toolDocumentPath(target('board','b')).includes('?board=b')&&toolDocumentPath(target('relation-tree','t')).includes('/genealogy?tree=t'),'tool-specific deep-link contracts');
    return passed;
  }finally{
    await act(async()=>{root.unmount();await pause();});sheetDraftStore(P).clear();
    for(const id of [P,Q,cloneId].filter(Boolean)){await db.codexEntries.where('projectId').equals(id).delete();await db.worldMaps.where('projectId').equals(id).delete();await db.boards.where('projectId').equals(id).delete();await db.timelines.where('projectId').equals(id).delete();await db.projects.delete(id);}
  }
}
