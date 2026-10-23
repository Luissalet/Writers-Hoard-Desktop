import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import type { Project, CodexEntry } from '@/types';
import { deleteProject } from '@/db/operations';
import { useCodexEntries } from '@/engines/codex/hooks';
import CodexEntryList from '@/components/codex/CodexEntryList';
import { createSheet } from '@/engines/character-sheets/types';
import { saveSheet } from '@/engines/character-sheets/operations';
import { useLocaleStore } from '@/stores/localeStore';
import { readWorldDocument, saveEraDocument } from '@/services/worldEras/store';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { toolBlockCopy } from '@/components/editor/toolBlocks/copy';
import { revealCopy } from '@/engines/codex/revealCopy';
import { serializeLocalToolBlock } from '@/engines/local/blocks/types';

const P='codex-read-blocks-regression',Q=P+'-foreign';
const pause=()=>new Promise(resolve=>setTimeout(resolve,40));
function assert(value:unknown,message:string):asserts value {if(!value)throw Error(message);}
const tool=(id:string,compact=false,project=P)=>`<figure data-wh-tool-block="true" data-project-id="${project}" data-tool-kind="character-sheets" data-document-id="${id}" data-label="CACHED_TOOL_SECRET"${compact?' data-sheet-display="compact"':''}><figcaption>CACHED_TOOL_SECRET</figcaption></figure>`;
const codex=(id:string,project=P)=>`<figure data-wh-codex-block="true" data-project-id="${project}" data-entry-id="${id}"><figcaption>CACHED_CODEX_SECRET</figcaption></figure>`;

export async function testCodexReadBlocks():Promise<string[]>{
 const host=document.getElementById('root')!,root=createRoot(host),passed:string[]=[];
 let sheet=createSheet('coc7','Nora saved investigator');sheet.coc!.summarySkillIds=sheet.skills.slice(0,5).map(row=>row.id);sheet.details.notes='FULL_SHEET_DETAIL';
 const linked:CodexEntry={id:P+'-linked',projectId:P,title:'Live linked card',type:'custom',content:'<p>Public linked prose</p><p data-wh-wiki-hidden="true">LINKED_HIDDEN_PROSE</p><p data-wh-wiki-spoiler="true">LINKED_SPOILER</p>',fields:{public:'Public field',hidden:'HIDDEN_FIELD_SECRET'},revealed:{at:1},tags:[],relations:[],createdAt:1,updatedAt:1};
 const sourceBlock=serializeLocalToolBlock(P,{version:1,id:'owned-count',namespace:'qa.reader',key:'count',name:{en:'Owned source preview',es:'Fuente propia'},scope:'host',revision:0,data:{count:42},codec:{version:1,fields:{count:{kind:'scalar'}}}});
 const owner:CodexEntry={...linked,id:P+'-holder',title:'Saved holder',fields:{},content:'<p>Host prose</p>'+tool(sheet.id,true)+tool(sheet.id)+tool('missing',true)+tool(sheet.id,true,Q)+codex(linked.id)+codex(linked.id,Q)+codex('missing')+sourceBlock};
 const project:Project={id:P,title:'Codex read QA',description:'',mode:'custom',type:'standalone',status:'draft',color:'#888888',enabledEngines:['codex','character-sheets'],createdAt:1,updatedAt:1,wikiOptions:{excludedFields:['hidden']},worldEras:[{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1}]};
 function Harness({eraId}:{eraId?:string}){const {items,addItem,editItem,removeItem}=useCodexEntries(P);return <CodexEntryList projectId={P} entries={items} onAdd={addItem} onEdit={editItem} onDelete={removeItem} focusEntryId={owner.id}/>;}
 const render=async(eraId?:string)=>{await act(async()=>{root.render(<StrictMode><MemoryRouter><EnginePaneContext.Provider value={{instanceId:'codex-reader',projectId:P,eraId,visible:true}}><Harness key={eraId??'base'}/></EnginePaneContext.Provider></MemoryRouter></StrictMode>);await pause();});};
 const until=async(check:()=>boolean,message:string)=>{for(let i=0;i<100;i++){if(check())return;await act(async()=>{await pause();});}throw Error(message);};
 const reader=()=>document.querySelector<HTMLElement>('[role="dialog"] [data-testid="codex-card-faces"] [role="tabpanel"]')!;
 try{
  useLocaleStore.setState({locale:'en',loaded:true});await db.projects.bulkPut([project,{...project,id:Q,title:'FOREIGN_PROJECT_SECRET'}]);sheet=await saveSheet(P,sheet,null);await db.projects.update(Q,{characterSheets:[{...sheet,title:'FOREIGN_SHEET_SECRET'}]});await db.codexEntries.bulkPut([owner,linked]);
  const before=JSON.stringify(await db.projects.get(P)),ownerBefore=JSON.stringify(await db.codexEntries.get(owner.id));
  await render();await until(()=>Boolean(reader()?.textContent?.includes('Host prose')),'Actual Codex About did not open saved holder');
  await until(()=>Boolean(reader()?.querySelector('[data-coc-summary]')),'Actual saved Codex About only exposes the compact figure caption; no summary hydration');
  assert(reader().querySelector('[data-sheet-paper]')&&reader().textContent?.includes('FULL_SHEET_DETAIL')&&reader().textContent?.includes('Public linked prose'),'Normal About omitted full sheet or live Codex reference');
  await until(()=>reader()?.querySelector('[data-wh-source-block] [data-wh-local-tool-preview]')?.textContent?.includes('42')===true,'About omitted existing owned source-block pipeline');
  assert(!reader().querySelector('[data-coc-summary] button, [data-coc-summary] select')&&!reader().textContent?.includes('FOREIGN_SHEET_SECRET')&&!reader().textContent?.includes('CACHED_TOOL_SECRET')&&!reader().textContent?.includes('CACHED_CODEX_SECRET'),'Readonly source leaked writer controls, foreign data or cached unavailable text');
  assert(reader().textContent?.includes(toolBlockCopy.en.unavailable),'Missing tool source did not show honest fallback');
  assert(JSON.stringify(await db.projects.get(P))===before&&JSON.stringify(await db.codexEntries.get(owner.id))===ownerBefore,'Opening About wrote saved source/host');
  await act(async()=>{sheet=await saveSheet(P,{...sheet,title:'Nora live revision'},sheet.revision);await pause();});await until(()=>reader()?.querySelector('[data-coc-summary] h3')?.textContent==='Nora live revision','Source save did not refresh saved Codex About');
  await act(async()=>{document.querySelector<HTMLButtonElement>('[data-testid="codex-face-notes"]')!.click();await pause();});assert(!document.querySelector('[data-coc-summary]'),'About reader remained mounted behind Notes');
  await act(async()=>{document.querySelector<HTMLButtonElement>('[data-testid="codex-face-about"]')!.click();await pause();});await until(()=>Boolean(reader()?.querySelector('[data-coc-summary]')),'About did not rehydrate on return from Notes');
  passed.push('Real saved Codex About hydrates compact/full sheets and Codex refs readonly; missing/foreign captions cleared, live source refresh writes neither host nor sheet; Notes/About remount works');

  const read=await readWorldDocument({projectId:P,eraId:'past'},'character-sheets',sheet.id);assert(read,'era read');await saveEraDocument({projectId:P,eraId:'past'},'character-sheets',{...read.document,root:{...read.document.root,title:'ERA_NORA_ONLY'}},read.version);
  await render('past');await until(()=>reader()?.querySelector('[data-coc-summary] h3')?.textContent==='ERA_NORA_ONLY','Codex About did not resolve pane era');
  assert((await db.projects.get(P))!.characterSheets![0].title==='Nora live revision','Era reader changed Base');
  passed.push('Actual Codex About resolves selected pane era without reading or changing the Base sheet');

  await render();await until(()=>Boolean(reader()?.querySelector('[data-coc-summary]')),'Base remount');
  const playerToggle=[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()===revealCopy.en.playerView);assert(playerToggle,'player view toggle');
  await act(async()=>{playerToggle.click();await pause();});
  await act(async()=>{host.querySelector<HTMLButtonElement>(`[data-testid="codex-card"][data-entry-id="${owner.id}"]`)!.click();await pause();});
  const player=()=>document.querySelector<HTMLElement>('[data-testid="codex-player-card"]')!;
  await until(()=>Boolean(player()?.textContent?.includes('Public linked prose')),'Revealed linked Codex reference not hydrated in player view');
  assert(!player().querySelector('[data-wh-tool-block], [data-wh-source-block], [data-coc-summary]'),'Player view admitted hidden tool/source before resolution');
  assert(!/HIDDEN_FIELD_SECRET|LINKED_HIDDEN_PROSE|LINKED_SPOILER|CACHED_/.test(player().textContent??''),'Player hydrated reference leaked excluded fields, hidden prose, spoilers or cached text');
  await act(async()=>{await db.projects.update(P,{wikiOptions:{excludedFields:['hidden','public']}});await pause();});
  await until(()=>!player()?.textContent?.includes('Public field'),'Player reference did not re-evaluate updated excluded fields');
  const hostAtPlayer=JSON.stringify(await db.codexEntries.get(owner.id));
  await act(async()=>{await db.codexEntries.update(linked.id,{revealed:undefined});await pause();});
  await until(()=>!player()?.textContent?.includes('Public linked prose'),'Unrevealed linked card remained exposed after live update');
  assert(JSON.stringify(await db.codexEntries.get(owner.id))===hostAtPlayer,'Player reference refresh wrote host');
  passed.push('Actual player view removes all tool/source pointers before hydration; allowed Codex refs hide excluded fields/hidden prose/spoilers and disappear after reveal revocation without writes');
  return passed;
 }finally{await act(async()=>{root.unmount();await pause();});for(const id of [P,Q])if(await db.projects.get(id))await deleteProject(id);}
}
