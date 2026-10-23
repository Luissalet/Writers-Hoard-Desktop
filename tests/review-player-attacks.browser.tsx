import '@/engines/character-sheets/index';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {createSheet,type CharacterSheet} from '@/engines/character-sheets/types';
import {saveSheet} from '@/engines/character-sheets/operations';
import {rollFiveEAttack} from '@/engines/character-sheets/fiveEAttacks';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {hydrateToolDocumentBlocks} from '@/components/editor/toolBlocks/reading';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import CharacterSheetsEngine from '@/engines/character-sheets/CharacterSheetsEngine';
import {sheetDraftStore} from '@/engines/character-sheets/drafts';
import {useLocaleStore} from '@/stores/localeStore';

function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
function manual():CharacterSheet{
 const sheet=createSheet('5e-character','Independent manual attack');
 sheet.rows=[{id:'shared-expression',section:'Armas',name:'Rayo manual',detail:'Notas intactas',expression:'1d20+4',quantity:7,fiveEAttack:{version:1,bonus:4,damageType:'fuerza'},fiveESpell:{version:1,level:2,prepared:true}},{id:'legacy',section:'Weapons',name:'Sin adoptar',detail:'Keep generic',expression:'1d4',quantity:3}];
 return sheet;
}
async function seed(id:string){await db.projects.put({id,title:'Independent attacks',description:'',mode:'custom',type:'standalone',color:'#888',status:'draft',enabledEngines:['character-sheets'],createdAt:1,updatedAt:1});return saveSheet(id,manual(),null);}
const pause=()=>new Promise(resolve=>setTimeout(resolve,25));
async function until(check:()=>boolean,message:string){for(let i=0;i<100;i++){if(check())return;await pause();}throw Error(message);}

/** Distinguish actions even when a perfectly valid authored damage equals d20+bonus. */
export async function reviewPlayerAttackHistoryIdentity(){
 const sheet=manual(),before=JSON.stringify(sheet),attack=rollFiveEAttack(sheet,'shared-expression','attack',()=>10),damage=rollFiveEAttack(sheet,'shared-expression','damage',()=>10);
 assert(attack.total===14&&damage.total===14&&attack.expression===damage.expression,'Fixture must expose same valid expression/total');
 assert(attack.label!==damage.label,'Stored history cannot distinguish manual Attack from Damage: '+JSON.stringify({attack:{label:attack.label,expression:attack.expression,total:attack.total},damage:{label:damage.label,expression:damage.expression,total:damage.total}}));
 assert(attack.label.includes('Rayo manual')&&damage.label.includes('Rayo manual'),'Action labels lost the authored row identity');
 assert(JSON.stringify(sheet)===before&&!attack.outcome&&!damage.outcome&&attack.target===undefined&&damage.target===undefined,'Manual roll mutated sheet or adjudicated a target');
 return ['Attack and Damage remain distinguishable in saved history even for identical dice/bonus totals, retaining row identity and manual semantics'];
}

export async function reviewPlayerAttackConcurrentCas(){
 const P='review-player-attack-cas';
 try{
  const saved=await seed(P),other=await saveSheet(P,createSheet('5e-character','Unrelated sheet'),null),baseline=JSON.stringify((await db.projects.get(P))!.characterSheets!.find(sheet=>sheet.id===other.id));
  const requests=await Promise.all(['roll-attack','roll-damage'].map(action=>runBridgeTool('wh_sheet_5e_action',{projectId:P,sheetId:saved.id,revision:saved.revision,action,rowId:'shared-expression'})));
  assert(requests.filter(reply=>reply.ok).length===1&&requests.filter(reply=>!reply.ok).length===1,'Concurrent native actions both consumed a single sheet CAS');
  const project=(await db.projects.get(P))!,current=project.characterSheets!.find(sheet=>sheet.id===saved.id)!;
  assert(current.rolls.length===1&&JSON.stringify(current.rows)===JSON.stringify(saved.rows)&&JSON.stringify(current.resources)===JSON.stringify(saved.resources)&&!current.fiveE,'Concurrent action rewrote manual resources/rows/profile or appended multiple history rows');
  assert(JSON.stringify(project.characterSheets!.find(sheet=>sheet.id===other.id))===baseline,'Attack changed another sheet in the same project');
  const before=JSON.stringify(project),refused=await runBridgeTool('wh_sheet_5e_action',{projectId:P,sheetId:saved.id,revision:current.revision,action:'roll-attack',rowId:'legacy'});
  assert(!refused.ok&&JSON.stringify(await db.projects.get(P))===before,'Unconfigured legacy row was silently adopted or wrote state');
  return ['Real concurrent MCP Attack/Damage permit exactly one write, preserve resources/manual rows/other sheets, and refuse unconfigured legacy rows without adoption'];
 }finally{await deleteProject(P);}
}

export async function reviewPlayerAttackReadonlyRefresh(){
 const P='review-player-attack-reading',root=document.getElementById('root')!;let stop=()=>{};
 try{
  const saved=await seed(P),baseline=JSON.stringify(await db.projects.get(P));
  root.innerHTML=`<figure data-wh-tool-block="true" data-project-id="${P}" data-tool-kind="character-sheets" data-document-id="${saved.id}"></figure>`;
  stop=hydrateToolDocumentBlocks(root,P,'es');
  const hasAppendix=()=>[...root.querySelectorAll('svg text')].some(node=>node.textContent==='Ataques');
  await until(hasAppendix,'Normal readonly tool hydration lost manual attack appendix');
  assert(root.querySelector('svg')&&!root.querySelector('button,input,select')&&JSON.stringify(await db.projects.get(P))===baseline,'Readonly hydration mounted controls, rolled or wrote state');
  const next=structuredClone(saved);delete next.rows[0].fiveEAttack;const changed=await saveSheet(P,next,saved.revision),after=JSON.stringify(await db.projects.get(P));
  await until(()=>!hasAppendix(),'Readonly tool projection retained a removed attack appendix');
  assert(root.textContent?.includes('Rayo manual')&&root.textContent?.includes('Notas intactas'),'Removing attack erased the coexisting spell/generic row');
  stop();stop=()=>{};root.replaceChildren();await pause();
  assert(changed.rolls.length===0&&JSON.stringify(await db.projects.get(P))===after,'Readonly disposal wrote or rolled');
  return ['Real readonly DOM hydration refreshes removal of the attack appendix, preserves spell/notes, and writes nothing at mount or disposal'];
 }finally{stop();root.replaceChildren();await deleteProject(P);}
}

export async function reviewPlayerAttackSpanishDraft(){
 const P='review-player-attack-spanish',root=createRoot(document.getElementById('root')!);
 const click=async(label:string)=>{const node=[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()===label);assert(node,'Missing Spanish action '+label);await act(async()=>{node.click();await pause();});};
 try{
  useLocaleStore.setState({locale:'es',loaded:true});const saved=await seed(P),baseline=JSON.stringify(await db.projects.get(P));
  await act(async()=>{root.render(<MemoryRouter><CharacterSheetsEngine projectId={P}/></MemoryRouter>);await pause();});
  for(let i=0;i<100&&!document.querySelector('#sheet-tab-rows');i++)await act(async()=>{await pause();});
  const tab=document.querySelector<HTMLButtonElement>('#sheet-tab-rows');assert(tab,'Rows tab unavailable');await act(async()=>{tab.click();await pause();});
  await click('Tirar ataque');await click('Tirar daño');
  const draft=sheetDraftStore(P).get(saved.id)!.sheet,attack=draft.rolls[1],damage=draft.rolls[0];
  assert(attack.label!==damage.label&&/ataque/i.test(attack.label)&&/daño/i.test(damage.label),'Spanish normal UI did not retain localized action identity in draft history');
  assert(damage.label.includes('fuerza')&&JSON.stringify(draft.rows)===JSON.stringify(saved.rows)&&!draft.fiveE,'Damage label lost authored type or actions rewrote manual rows/profile');
  await click('Quitar configuración de ataque');const cleared=sheetDraftStore(P).get(saved.id)!.sheet;
  assert(!Object.hasOwn(cleared.rows[0],'fiveEAttack')&&JSON.stringify(cleared.rows[0].fiveESpell)===JSON.stringify(saved.rows[0].fiveESpell)&&cleared.rows[0].quantity===7,'Clearing attack removed spell or quantity');
  assert(JSON.stringify(await db.projects.get(P))===baseline,'Unsaved attack draft wrote persisted project state');
  const cancel=async(dialog:Element)=>{const node=[...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()==='Cancelar');assert(node,'Dialog cancel missing');await act(async()=>{node.click();await pause();});};
  await click('Descartar cambios');let dialog=document.querySelector('[role="dialog"]');assert(dialog&&dialog.querySelector('h2')?.textContent==='Descartar cambios'&&[...dialog.querySelectorAll('button')].some(button=>button.textContent==='Descartar cambios'),'Discard dialog uses Delete or an unrelated confirmation label');
  await cancel(dialog);assert(sheetDraftStore(P).get(saved.id),'Cancel discarded the unsaved draft');await click('Descartar cambios');dialog=document.querySelector('[role="dialog"]')!;const discard=[...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Descartar cambios')!;await act(async()=>{discard.click();await pause();});
  assert(!sheetDraftStore(P).get(saved.id)&&JSON.stringify(await db.projects.get(P))===baseline,'Confirmed discard modified saved content instead of removing only draft');
  await click('Eliminar ficha');dialog=document.querySelector('[role="dialog"]');assert(dialog&&[...dialog.querySelectorAll('button')].some(button=>button.textContent==='Eliminar'),'Actual sheet deletion lost its Delete confirmation');await cancel(dialog);
  assert(JSON.stringify(await db.projects.get(P))===baseline,'Cancelling actual Delete changed the saved sheet');
  return ['Normal Spanish UI stores distinct action/type context; clear preserves spell/quantity, Discard uses contextual labels and supports cancel/confirm without saving, while actual Delete retains its own confirmation'];
 }finally{await act(async()=>root.unmount());sheetDraftStore(P).clear();localStorage.removeItem(`wh.character-sheets.v1.${P}`);await deleteProject(P);}
}

export async function reviewPlayerAttackLongContext(){
 const P='review-player-attack-long';
 try{
  let saved=await seed(P);const draft=structuredClone(saved);draft.rows[0].name='N'.repeat(100000);draft.rows[0].fiveEAttack!.damageType='T'.repeat(100000);saved=await saveSheet(P,draft,saved.revision);
  for(const action of ['roll-attack','roll-damage']){
   const reply=await runBridgeTool('wh_sheet_5e_action',{projectId:P,sheetId:saved.id,revision:saved.revision,action,rowId:'shared-expression'});
   assert(reply.ok,'Valid maximum-length authored context made '+action+' fail: '+JSON.stringify(reply));
   const next=(await db.projects.get(P))!.characterSheets!.find(sheet=>sheet.id===saved.id)!;
   assert(next.rolls.length===saved.rolls.length+1&&next.rolls[0].label.length<=100000&&JSON.stringify(next.rows)===JSON.stringify(saved.rows),'Roll label overflow or truncation changed authored row data');saved=next;
  }
  assert(saved.rolls[0].label!==saved.rolls[1].label,'Bounded history lost action identity');
  return ['Native Attack/Damage accept valid maximum-length name/type, keep history labels within the existing contract and preserve the complete authored row'];
 }finally{await deleteProject(P);}
}
