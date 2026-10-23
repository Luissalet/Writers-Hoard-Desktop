import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { db } from '@/db';
import type { Project, CodexEntry } from '@/types';
import { deleteProject, exportProjectData, importProjectData } from '@/db/operations';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { useLocaleStore } from '@/stores/localeStore';
import { createSheet, type CharacterSheet } from '@/engines/character-sheets/types';
import { saveSheet } from '@/engines/character-sheets/operations';
import { ToolDocumentBlock } from '@/components/editor/toolBlocks/ToolDocumentBlock';
import { createCodexBlockHost } from '@/components/editor/codexBlocks/model';
import { resolveToolPreview, prepareToolDocumentBlocksForExport } from '@/components/editor/toolBlocks/preview';
import { hydrateToolDocumentBlocks } from '@/components/editor/toolBlocks/reading';
import { toolTarget, toolPreviewKey, type ToolDocumentTarget } from '@/components/editor/toolBlocks/model';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { registerPendingFlusher, flushPendingWrites } from '@/services/pendingWrites';
import { buildWorldWiki, loadWorldWikiData } from '@/services/worldWikiExport';
import { captureWikiSnapshot, wikiSource } from '@/services/wikiProfiles/snapshot';
import { readWorldDocument, saveEraDocument } from '@/services/worldEras/store';

const P = 'tool-sheet-compact-regression';
const pause = () => new Promise(resolve => setTimeout(resolve, 50));
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const block = (id: string, compact = false, projectId = P) => `<figure data-wh-tool-block="true" data-project-id="${projectId}" data-tool-kind="character-sheets" data-document-id="${id}"${compact?' data-sheet-display="compact"':''} data-label="CACHED_MISSING_SECRET"><figcaption>Cached</figcaption></figure>`;

export async function testToolSheetCompact(): Promise<string[]> {
  const host = document.getElementById('root')! , root = createRoot(host), passed: string[] = [], clones: string[] = [];
  let editor: Editor|null = null, stopReader: (()=>void)|undefined;
  const context = createCodexBlockHost({projectId:P,scopeId:'compact'});
  const waitFor = async (check:()=>boolean,message:string) => { for(let i=0;i<100;i++){if(check())return;await act(async()=>{await pause();});}throw Error(message); };
  let sheet = createSheet('coc7','Nora <safe>');
  const call = async (args: Record<string,unknown>) => { const reply = await runBridgeTool('wh_sheet_coc_action',{projectId:P,sheetId:sheet.id,revision:sheet.revision,...args});assert(reply.ok,JSON.stringify(reply));sheet=(reply.result as {sheet:CharacterSheet}).sheet; };
  function Fixture({editable=true,content}:{editable?:boolean;content:string}) {
    const current=useEditor({editable,extensions:[StarterKit,ToolDocumentBlock.configure(context)],content});
    useEffect(()=>{editor=current;},[current]);return <EditorContent editor={current}/>;
  }
  try {
    await db.projects.put({id:P,title:'Compact test',description:'',mode:'custom',type:'standalone',status:'draft',color:'#888888',enabledEngines:['character-sheets','codex'],createdAt:1,updatedAt:1,worldEras:[{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1}]} as Project);
    for(const [id,value] of [['str',85],['con',70],['siz',60]] as const)sheet.traits.find(row=>row.id===id)!.value=value;
    sheet.coc!.summarySkillIds=sheet.skills.slice(0,5).map(row=>row.id);
    sheet.details.notes='FULL_PAPER_NOTES_ONLY';sheet=await saveSheet(P,sheet,null);
    await call({action:'mode',era:'modern',pulp:true});await call({action:'heal',amount:26});await call({action:'damage',amount:13});
    const full:ToolDocumentTarget={projectId:P,kind:'character-sheets',documentId:sheet.id,label:'Nora'},compact:ToolDocumentTarget={...full,sheetDisplay:'compact'};
    const before=JSON.stringify(await db.projects.get(P)),preview=await resolveToolPreview(compact,P,'en');
    assert(preview?.summary&&!preview.sheet&&preview.html.includes('13 / 26')&&preview.summary.skills.length===5,'Compact projection must use selected saved vitals/skills and avoid full-sheet payload: '+JSON.stringify(preview?.summary));
    assert(!preview.html.includes('FULL_PAPER_NOTES_ONLY')&&!parse(preview.html).querySelector('button,script'),'Readonly compact leaked full paper or interactions');
    assert((await resolveToolPreview(full,P))?.sheet&&!toolTarget({...compact,sheetDisplay:'bogus'})&&!toolTarget({...compact,kind:'tables'}),'Default paper or display validation changed');
    assert(toolPreviewKey(full)!==toolPreviewKey(compact),'Display variants collide');
    assert(!await resolveToolPreview({...compact,projectId:'foreign'},P)&&!await resolveToolPreview({...compact,documentId:'missing'},P),'Foreign/missing source resolved');
    assert(JSON.stringify(await db.projects.get(P))===before,'Preview mutated source');
    passed.push('Opt-in compact has native saved HP/SAN/Luck, traits and five IDs; full paper stays default, variant keys differ, invalid/foreign/missing source and reads remain honest');

    const content='<p>Host prose</p>'+block(sheet.id)+block(sheet.id,true);
    await act(async()=>{useLocaleStore.setState({locale:'en',loaded:true});root.render(<MemoryRouter><Fixture content={content}/></MemoryRouter>);await pause();});
    await waitFor(()=>host.querySelectorAll('[data-coc-summary]').length===1&&host.querySelectorAll('[data-sheet-paper]').length===1,'Actual two-mode NodeView did not mount');
    assert(editor,'real editor');const original=editor.getHTML();assert(parse(original).querySelectorAll('[data-sheet-display="compact"]').length===1,'Tiptap serializer lost compact attribute');
    const fullView=host.querySelector('[data-wh-tool-live-view]')!,select=fullView.querySelector<HTMLSelectElement>('[aria-label="Sheet display"]')!;
    await act(async()=>{select.value='compact';select.dispatchEvent(new Event('change',{bubbles:true}));await pause();});
    await waitFor(()=>host.querySelectorAll('[data-coc-summary]').length===2&&!host.querySelector('[data-sheet-paper]'),'Display selector reused stale paper');
    await act(async()=>{editor!.commands.undo();await pause();});
    await waitFor(()=>host.querySelectorAll('[data-sheet-paper]').length===1,'Undo display did not restore default paper');
    const hostBeforeRoll=editor.getHTML();
    const compactView=()=>host.querySelectorAll<HTMLElement>('[data-wh-tool-live-view]')[1];
    const difficulty=compactView().querySelector<HTMLSelectElement>('[aria-label="Summary difficulty"]')!;
    await act(async()=>{difficulty.value='hard';difficulty.dispatchEvent(new Event('change',{bubbles:true}));await pause();});
    const skill=sheet.skills.find(row=>row.id===sheet.coc!.summarySkillIds![0])!;
    const roll=compactView().querySelector<HTMLButtonElement>(`button[aria-label="Roll ${CSS.escape(skill.label)}"]`)!;assert(roll,'real featured skill roll button');
    await act(async()=>{roll.click();await pause();});
    await waitFor(()=>Boolean(compactView().querySelector('button')?.textContent==='Undo roll'||[...compactView().querySelectorAll('button')].some(button=>button.textContent==='Undo roll')),'Native roll not completed');
    let saved=(await db.projects.get(P))!.characterSheets!.find(row=>row.id===sheet.id)!;
    assert(saved.rolls.length===sheet.rolls.length+1&&saved.rolls[0].label===skill.label&&saved.rolls[0].difficulty==='hard','Compact roll did not persist in the linked native sheet');
    assert(editor.getHTML()===hostBeforeRoll&&(await flushPendingWrites()).ok,'Roll changed host prose or left pending writes');
    await act(async()=>{[...compactView().querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Undo roll')!.click();await pause();});
    await waitFor(()=>compactView().textContent?.includes('Roll undone.')===true,'Native undo not completed');
    saved=(await db.projects.get(P))!.characterSheets!.find(row=>row.id===sheet.id)!;assert(saved.rolls.length===sheet.rolls.length,'Native roll receipt did not undo');sheet=saved;
    let raceOnce=false;const stopRace=registerPendingFlusher('compact-source-race',async()=>{if(!raceOnce){raceOnce=true;sheet=await saveSheet(P,{...sheet,title:'Concurrent source'},sheet.revision);}return true;});
    try{await act(async()=>{compactView().querySelector<HTMLButtonElement>(`button[aria-label="Roll ${CSS.escape(skill.label)}"]`)!.click();await pause();});await waitFor(()=>Boolean(compactView().querySelector('[role="alert"]')),'Concurrent revision should surface native CAS conflict');}
    finally{stopRace();}
    assert((await db.projects.get(P))!.characterSheets![0].rolls.length===sheet.rolls.length,'Stale compact roll consumed/saved an action');
    passed.push('Actual two-mode Tiptap selector/Undo keeps pointers; featured skill hard roll saves via native CAS/Undo receipt and pending flush; concurrent source edit is preserved without another roll');

    await act(async()=>{root.render(<MemoryRouter><Fixture key="readonly" editable={false} content={content}/></MemoryRouter>);await pause();});
    await waitFor(()=>Boolean(host.querySelector('[data-coc-summary]')),'readonly compact missing');
    assert(!host.querySelector('[data-coc-summary] button')&&!host.querySelector('[aria-label="Summary difficulty"]')&&!host.querySelector('[aria-label="Sheet display"]'),'Readonly editor exposed writer controls');
    const reader=document.createElement('div');reader.innerHTML=content+block('missing',true)+block(sheet.id,true,'foreign');host.append(reader);stopReader=hydrateToolDocumentBlocks(reader,P,'en');
    await waitFor(()=>Boolean(reader.querySelector('[data-coc-summary]')),'Reader compact missing');
    assert(reader.querySelectorAll('[data-coc-summary]').length===1&&reader.querySelectorAll('[data-sheet-paper]').length===1&&!reader.querySelector('button'),'Reader modes collide or become interactive');
    assert(!reader.textContent?.includes('CACHED_MISSING_SECRET'),'Reader exposed unavailable cache');
    stopReader();stopReader=undefined;reader.remove();await act(async()=>{root.render(<div/>);await pause();});
    const sourceRead=await readWorldDocument({projectId:P,eraId:'past'},'character-sheets',sheet.id);assert(sourceRead,'era source');
    await saveEraDocument({projectId:P,eraId:'past'},'character-sheets',{...sourceRead.document,root:{...sourceRead.document.root,title:'ERA_NORA_ONLY'}},sourceRead.version);
    assert((await resolveToolPreview(compact,P,'en',{eraId:'past'}))?.summary?.title==='ERA_NORA_ONLY'&&(await resolveToolPreview(compact,P,'en'))?.summary?.title==='Concurrent source','Era preview crossed Base');
    const entry:CodexEntry={id:P+'-holder',projectId:P,title:'Holder',type:'custom',fields:{},tags:[],relations:[],content,createdAt:1,updatedAt:1};await db.codexEntries.put(entry);
    const captured=wikiSource(await captureWikiSnapshot({projectId:P})),options={locale:'en' as const,includeMaps:false};
    const readBefore=JSON.stringify(await db.projects.get(P));db.close();
    try{
      const exported=parse(await prepareToolDocumentBlocksForExport(content,P,'en',{source:captured}));
      const wikiData=await loadWorldWikiData(P,options,captured),wiki=parse(buildWorldWiki(wikiData,options).html);
      assert(Object.keys(wikiData.toolPreviews!.blocks).length===2,'Captured wiki cache collapsed two displays');
      for(const doc of [exported,wiki])assert(doc.querySelectorAll('[data-coc-summary]').length===1&&doc.querySelectorAll('[data-sheet-paper]').length===1&&!doc.querySelector('[data-coc-summary] button, [data-coc-summary] script')&&doc.body.textContent?.includes('FULL_PAPER_NOTES_ONLY'),'Closed-DB captured export lost mode, paper, or readonly contract');
      const key=toolPreviewKey(compact);wikiData.toolPreviews!.blocks[key].html='<script>BAD_CACHE</script><section data-coc-summary="safe" onclick="BAD_EVENT"><p>Cached semantic text</p><button>WRITE</button></section>';
      const hostile=buildWorldWiki(wikiData,options).html;assert(!hostile.includes('BAD_CACHE')&&!hostile.includes('BAD_EVENT')&&!hostile.includes('>WRITE<')&&hostile.includes('Cached semantic text'),'Wiki trusted executable cached compact HTML');
    }finally{await db.open();}
    assert(JSON.stringify(await db.projects.get(P))===readBefore,'Captured readonly export wrote live data');
    passed.push('Readonly real NodeView/Reader omit roll/display controls; era stays separate; same-source paper+compact export from captured source with DB closed and sanitized wiki cache');

    const cloneId=await importProjectData(await exportProjectData(P));clones.push(cloneId);
    const cloned=(await db.codexEntries.where('projectId').equals(cloneId).toArray())[0],clonedSheet=(await db.projects.get(cloneId))!.characterSheets![0],clonedBlocks=parse(cloned.content).querySelectorAll<HTMLElement>('[data-wh-tool-block]');
    assert(clonedBlocks.length===2&&clonedBlocks[1].dataset.sheetDisplay==='compact'&&clonedBlocks[1].dataset.projectId===cloneId&&clonedBlocks[1].dataset.documentId===clonedSheet.id&&clonedBlocks[0].dataset.sheetDisplay===undefined,'Clone remap lost display or changed default');
    assert(JSON.stringify(clonedSheet.coc!.summarySkillIds)===JSON.stringify(sheet.coc!.summarySkillIds),'Clone changed selected skill identities');
    const {blob}=await createProjectZipArchive(P);await deleteProject(P);await importProjectZip(new File([blob],'compact.zip',{type:'application/zip'}));
    const restored=(await db.codexEntries.where('projectId').equals(P).toArray())[0];assert(parse(restored.content).querySelector('[data-sheet-display="compact"]')&&(await resolveToolPreview(compact,P,'en'))?.summary?.skills.length===5,'ZIP restore lost compact attribute or source selection');
    passed.push('Real project clone remaps both source pointers without merging displays or changing skill IDs; ZIP delete/restore preserves opt-in compact and selected source skills');
    return passed;
  }finally{stopReader?.();await act(async()=>{root.unmount();await pause();});for(const id of [P,...clones])if(await db.projects.get(id))await deleteProject(id);}
}
