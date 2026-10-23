import '@/engines/character-sheets/index';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import CharacterSheetsEngine from '@/engines/character-sheets/CharacterSheetsEngine';
import { createSheet, validateSheet, type CharacterSheet } from '@/engines/character-sheets/types';
import { saveSheet, deleteSheet } from '@/engines/character-sheets/operations';
import { sheetDraftStore } from '@/engines/character-sheets/drafts';
import { sheetPaper } from '@/engines/character-sheets/paper';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { createToolExecutor, type AuditLine } from '@/services/aiRuntime/executorCore';
import { useLocaleStore } from '@/stores/localeStore';
import { rollFiveEAttack } from '@/engines/character-sheets/fiveEAttacks';
import { SHEET_HANDLERS } from '@/engines/character-sheets/bridge';
import { undoSheetChange } from '@/engines/character-sheets/sheetUndo';
import { saveWorldEra, getEraProject, readWorldDocument } from '@/services/worldEras/store';
import { exportProjectData, importProjectData } from '@/db/operations';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { exportSheet, parseSheetImport } from '@/engines/character-sheets/types';
import { duplicateProject, previewProjectDuplicate } from '@/services/projectDuplicate/service';
import { restoreArchivedDocument } from '@/services/documentArchive/store';
import { resolveToolPreview, prepareToolDocumentBlocksForExport } from '@/components/editor/toolBlocks/preview';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const P = 'qa-player-attacks', ROW = 'qa-spear';
const pause = () => new Promise(resolve => setTimeout(resolve, 70));
function manualSheet(): CharacterSheet {
  const sheet = createSheet('5e-character', 'Manual spear');
  sheet.rows = [{ id: ROW, section: 'Weapons', name: 'QA Spear', detail: 'Keep the authored notes', expression: '1d6+2', quantity: 2, fiveESpell: { version: 1, level: 1, prepared: true } }, { id: 'rope', section: 'Inventory', name: 'Rope', detail: 'Generic row', expression: '1d4', quantity: 1 }];
  sheet.ink={version:1,surface:'paper-v1',width:1000,strokes:[{id:'prior-ink',tool:'pen',color:'#272b2b',width:3,points:[{x:100,y:100},{x:120,y:130}]}]};
  return sheet;
}
async function seed() {
  await db.projects.put({ id: P, title: 'Manual attacks QA', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['character-sheets'], createdAt: 1, updatedAt: 1 });
  return saveSheet(P, manualSheet(), null);
}
async function clean(projectId=P) { sheetDraftStore(projectId).clear(); localStorage.removeItem(`wh.character-sheets.v1.${projectId}`); for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(projectId).delete(); await db.projects.delete(projectId); }
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === name) ?? null;
const click = async (node: Element | null) => { assert(node, 'Missing UI action'); await act(async () => { (node as HTMLElement).click(); await pause(); }); };
const fill = async (label:string,value:string) => {const node=document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);assert(node,`Missing ${label}`);await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));await pause();});};
const refused=async(run:()=>unknown|Promise<unknown>)=>{let failed=false;try{await run();}catch{failed=true;}assert(failed,'Expected refusal');};
export async function testPlayerAttackEntry(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'en' }); const root = createRoot(document.getElementById('root')!);
  try {
    const original = await seed();
    await act(async () => { root.render(<MemoryRouter><CharacterSheetsEngine projectId={P} /></MemoryRouter>); await pause(); });
    for (let i = 0; i < 30 && !document.querySelector('#sheet-tab-rows'); i++) await act(async () => { await pause(); });
    await click(document.querySelector('#sheet-tab-rows'));
    const adopt = document.querySelector(`[data-testid="sheet-use-attack-${ROW}"]`);
    assert(adopt, 'Normal manual player row has no explicit attack configuration');
    assert(!sheetDraftStore(P).get(original.id), 'Opening rows adopted or changed the legacy sheet');
    await click(adopt);
    assert(document.querySelector('[aria-label="Attack bonus · QA Spear"]') && document.querySelector('[aria-label="Damage type · QA Spear"]'), 'Attack fields are not split and labelled');
    await fill('Attack bonus · QA Spear','4');await fill('Damage type · QA Spear','piercing');
    await click(button('Save sheet'));
    const saved=(await db.projects.get(P))!.characterSheets!.find(item=>item.id===original.id)!;
    assert(saved.rows[0].fiveEAttack?.bonus===4&&saved.rows[0].fiveEAttack.damageType==='piercing'&&!saved.fiveE,'UI save lost attack fields or adopted profile');
    assert(JSON.stringify(saved.rows[0].fiveESpell)===JSON.stringify(original.rows[0].fiveESpell)&&JSON.stringify(saved.rows[1])===JSON.stringify(original.rows[1]),'UI save rewrote spell or generic metadata');
    await act(async()=>{root.render(<MemoryRouter/>);await pause();});await act(async()=>{root.render(<MemoryRouter><CharacterSheetsEngine projectId={P}/></MemoryRouter>);await pause();});for(let i=0;i<30&&!document.querySelector('#sheet-tab-rows');i++)await act(async()=>{await pause();});await click(document.querySelector('#sheet-tab-rows'));
    assert(document.querySelector<HTMLInputElement>('[aria-label="Attack bonus · QA Spear"]')?.value==='4'&&document.querySelector<HTMLInputElement>('[aria-label="Damage type · QA Spear"]')?.value==='piercing','Reopened sheet did not read saved attack fields');
    await click(button('Roll attack'));await click(button('Roll damage'));await click(button('Save sheet'));
    const rolled=(await db.projects.get(P))!.characterSheets![0];
    assert(rolled.rolls.length===2&&rolled.rolls[0].expression==='1d6+2'&&rolled.rolls[1].expression==='1d20+4'&&JSON.stringify(rolled.resources)===JSON.stringify(saved.resources)&&rolled.rows[0].quantity===2,'UI rolls spent or lost data');
    assert(rolled.rolls[0].label==='Damage · QA Spear · piercing'&&rolled.rolls[1].label==='Attack · QA Spear','UI history lost action/damage type context');
    await click(button('Remove attack configuration'));await click(button('Save sheet'));
    const cleared=(await db.projects.get(P))!.characterSheets![0];assert(!Object.hasOwn(cleared.rows[0],'fiveEAttack')&&JSON.stringify(cleared.rows)===JSON.stringify(original.rows),'Clearing attack changed generic/spell content');
    await click(button('Add attack'));assert(sheetDraftStore(P).get(original.id)!.sheet.rows.at(-1)?.fiveEAttack?.bonus===0,'Add attack did not explicitly configure new row');
    await click(button('Discard changes'));const discardDialog=document.querySelector('[role="dialog"]');assert(discardDialog,'Discard confirmation missing');assert(discardDialog.querySelector('h2')?.textContent==='Discard changes','Discard draft confirmation is labelled as deletion');await click([...discardDialog.querySelectorAll('button')].find(node=>node.textContent?.trim()==='Discard changes')??null);assert(!sheetDraftStore(P).get(original.id)&&JSON.stringify((await db.projects.get(P))!.characterSheets![0].rows)===JSON.stringify(original.rows),'Discarded new attack leaked into saved sheet');
    return ['Normal manual 5e row opts into separate attack bonus and damage type without adopting a class profile or rewriting legacy rows'];
  } finally { await act(async () => { root.unmount(); await pause(); }); await clean(); }
}
export async function testPlayerAttackContract(): Promise<string[]> {
  try {
    const original = await seed(), draft = structuredClone(original);
    Object.assign(draft.rows[0], { fiveEAttack: { version: 1, bonus: 4, damageType: 'piercing' } });
    const lines:AuditLine[]=[];const execute = createToolExecutor({ writesEnabled: async () => true, relay: runBridgeTool, audit: async line => lines.push(line)-1 });
    const changed = await execute({ tool: 'wh_sheet_update', args: { projectId: P, sheetId: draft.id, revision: draft.revision, sheet: draft } }, { origin: 'bridge', projectId: P });
    assert(changed.ok, 'Manual update failed');
    const saved = (changed.result as { sheet: CharacterSheet }).sheet;
    const rolled = await execute({ tool: 'wh_sheet_5e_action', args: { projectId: P, sheetId: saved.id, revision: saved.revision, action: 'roll-attack', rowId: ROW } }, { origin: 'bridge', projectId: P });
    assert(rolled.ok, `Native row attack action is absent: ${JSON.stringify(rolled)}`);
    const row = (rolled.result as { sheet: CharacterSheet }).sheet;
    assert(row.rolls.length === 1 && row.rolls[0].expression.includes('d20') && JSON.stringify(row.resources) === JSON.stringify(original.resources), 'Attack did not append just one independent roll');
    const undo=await runBridgeTool('__undo',{entry:lines.at(-1)});assert(undo.ok&&(await db.projects.get(P))!.characterSheets![0].rolls.length===0,'Native dispatcher audit Undo did not restore row attack history');
    return ['Normal MCP update and row attack action preserve the split metadata and append one roll without spending resources'];
  } finally { await clean(); }
}
export async function testPlayerAttackValidation(): Promise<string[]> {
  const legacy = manualSheet(), before = JSON.stringify(legacy); validateSheet(legacy); assert(JSON.stringify(legacy) === before, 'Validation migrated legacy');
  for (const invalid of [{ version: 2, bonus: 4, damageType: 'piercing' }, { version: 1, bonus: 0.5, damageType: 'piercing' }, { version: 1, bonus: Number.POSITIVE_INFINITY, damageType: '' }, { version: 1, bonus: 4, damageType: [] }]) {
    const sheet = structuredClone(legacy); Object.assign(sheet.rows[0], { fiveEAttack: invalid });
    let refused = false; try { validateSheet(sheet); } catch { refused = true; }
    assert(refused, 'Invalid optional attack metadata is silently accepted');
  }
  for(const preset of ['5e-stat-block','coc7','custom'] as const){const sheet=createSheet(preset);sheet.rows=structuredClone(legacy.rows);for(const row of sheet.rows)delete row.fiveESpell;validateSheet(sheet);sheet.rows[0].fiveEAttack={version:1,bonus:4,damageType:'piercing'};let refused=false;try{validateSheet(sheet);}catch{refused=true;}assert(refused,'Foreign preset accepted player attack metadata');}
  return ['New optional attack data is validated while the absent legacy state remains byteexact'];
}
export async function testPlayerAttackPaper(): Promise<string[]> {
  const legacy = manualSheet(); legacy.ink = { version: 1, surface: 'paper-v1', width: 1000, strokes: [{ id: 'annotation', tool: 'pen', color: '#272b2b', width: 3, points: [{ x: 100, y: 7000 }, { x: 300, y: 7000 }] }] };
  const prior = new DOMParser().parseFromString(sheetPaper(legacy).svg, 'image/svg+xml'), next = structuredClone(legacy);
  Object.assign(next.rows[0], { fiveEAttack: { version: 1, bonus: 4, damageType: 'piercing<&' } });
  const after = new DOMParser().parseFromString(sheetPaper(next).svg, 'image/svg+xml');
  const originalText = [...prior.querySelectorAll('text')].map(node => node.outerHTML), currentText = [...after.querySelectorAll('text')];
  assert(originalText.every((text, index) => currentText[index]?.outerHTML === text), 'New attack data shifted prior paper anchors');
  assert(currentText.slice(originalText.length).some(node => node.textContent === 'Attacks' && Number(node.getAttribute('y')) > 7000) && after.documentElement.textContent?.includes('piercing<&'), 'Complete attack appendix is absent or overlaps the existing ink plane');
  assert(after.querySelector('[data-sheet-ink-stroke]')?.getAttribute('d') === prior.querySelector('[data-sheet-ink-stroke]')?.getAttribute('d'), 'Attack paper moved existing ink');
  return ['Attack appendix follows existing content and ink, escapes manual text and preserves prior paper/ink anchors'];
}
export async function testPlayerAttackDepth():Promise<string[]> {
  const clones:string[]=[],operationId=crypto.randomUUID();
  try{
    const original=await seed(),draft=structuredClone(original);draft.rows[0].fiveEAttack={version:1,bonus:4,damageType:'piercing'};
    const saved=await saveSheet(P,draft,original.revision),read=async()=>(await db.projects.get(P))!.characterSheets!.find(item=>item.id===saved.id)!;
    const action=(sheet:CharacterSheet,kind:string,eraId?:string,rowId=ROW)=>SHEET_HANDLERS.wh_sheet_5e_action({projectId:P,eraId,sheetId:sheet.id,revision:sheet.revision,action:kind,rowId});
    const receipt=(value:unknown)=>(value as {__audit:{before:{__sheetReceipt:string}}}).__audit.before.__sheetReceipt;
    const attack=rollFiveEAttack(saved,ROW,'attack',()=>20),damage=rollFiveEAttack(saved,ROW,'damage',()=>6);
    assert(attack.total===24&&attack.expression==='1d20+4'&&!attack.outcome&&attack.target===undefined&&damage.total===8,'Shared manual roll assumes target or critical rule');
    assert(attack.label==='Attack · QA Spear'&&damage.label==='Damage · QA Spear · piercing','Canonical history lacks action/type context');
    for(const bonus of [0,-4,1000001]){const sheet=structuredClone(saved);sheet.rows[0].fiveEAttack!.bonus=bonus;const rolled=rollFiveEAttack(sheet,ROW,'attack',()=>1);assert(rolled.total===bonus+1&&!rolled.outcome,'Manual signed/zero/large bonus changes semantics');}
    const overflow=structuredClone(saved);overflow.rows[0].fiveEAttack!.bonus=Number.MAX_SAFE_INTEGER;await refused(()=>rollFiveEAttack(overflow,ROW,'attack',()=>20));
    const rolled=await action(saved,'roll-damage');assert(rolled.sheet.rolls[0].expression==='1d6+2'&&JSON.stringify(rolled.sheet.rows)===JSON.stringify(saved.rows),'Damage action rewrites row');
    await refused(()=>action(saved,'roll-attack'));await refused(()=>action(rolled.sheet,'roll-attack',undefined,'rope'));
    await undoSheetChange({projectId:P},receipt(rolled));await refused(()=>undoSheetChange({projectId:P},receipt(rolled)));assert((await read()).rolls.length===0,'Receipt Undo did not restore history');
    const beforeBad=await read(),bad=structuredClone(beforeBad);bad.rows[0].expression='1d6 + dragon';const badSaved=await saveSheet(P,bad,beforeBad.revision),badBytes=JSON.stringify(await read());await refused(()=>action(badSaved,'roll-damage'));assert(JSON.stringify(await read())===badBytes,'Invalid damage wrote history');
    const good=await saveSheet(P,{...badSaved,rows:structuredClone(saved.rows)},badSaved.revision);
    for(const eraId of ['later','own']){
      await saveWorldEra(P,{id:eraId,name:eraId,description:'',revision:0,createdAt:1,updatedAt:1},null);
      if(eraId==='own'){const own=structuredClone(good);own.details.notes='Era authored';await saveSheet(P,own,good.revision,eraId);}
      const scope={projectId:P,eraId},before=(await getEraProject(scope))!.characterSheets!.find(item=>item.id===saved.id)!,beforeDoc=(await readWorldDocument(scope,'character-sheets',saved.id))!,baseBytes=JSON.stringify(await read());
      const edit=await action(before,'roll-attack',eraId);assert(edit.sheet.rolls.length===1&&JSON.stringify(await read())===baseBytes,'Era attack wrote Base');
      await refused(()=>undoSheetChange({projectId:P},receipt(edit)));await undoSheetChange(scope,receipt(edit));
      const restored=(await readWorldDocument(scope,'character-sheets',saved.id))!;assert(restored.provenance===beforeDoc.provenance&&JSON.stringify(restored.document.root.rows)===JSON.stringify(beforeDoc.document.root.rows)&&JSON.stringify(restored.document.root.rolls)===JSON.stringify(beforeDoc.document.root.rolls),'Era Undo lost provenance/rows/history');
    }
    let abortedReceipt='';const beforeAbort=await read();await refused(()=>db.transaction('rw',db.tables,async()=>{const edit=await action(beforeAbort,'roll-attack');abortedReceipt=receipt(edit);throw Error('deliberate attack abort');}));assert(JSON.stringify(await read())===JSON.stringify(beforeAbort),'Outer rollback leaked attack');await refused(()=>undoSheetChange({projectId:P},abortedReceipt));
    const edited=await action(await read(),'roll-attack'),counter=await action(edited.sheet,'roll-damage');await refused(()=>undoSheetChange({projectId:P},receipt(edited)));assert((await read()).rolls.length===2,'Stale Undo changed later history');await undoSheetChange({projectId:P},receipt(counter));
    const beforeExport=await read();assert(JSON.stringify(parseSheetImport(exportSheet(beforeExport)).rows)===JSON.stringify(beforeExport.rows),'Standalone export lost attack/spell coexistence');
    const beforeRead=JSON.stringify(await read()),preview=await resolveToolPreview({projectId:P,kind:'character-sheets',documentId:saved.id},P,'en',{page:true});assert(preview?.sheet?.rows[0].fiveEAttack?.damageType==='piercing'&&sheetPaper(preview.sheet).svg.includes('piercing')&&JSON.stringify(await read())===beforeRead,'Readonly preview lost manual attack payload or wrote a revision');
    const projected=await prepareToolDocumentBlocksForExport(`<figure data-wh-tool-block="true" data-project-id="${P}" data-tool-kind="character-sheets" data-document-id="${saved.id}"></figure>`,P,'en',{page:true});assert(projected.includes('data-sheet-paper')&&projected.includes('Attacks')&&projected.includes('piercing')&&JSON.stringify(await read())===beforeRead,'Normal read/export projection lost attack table or wrote');
    const duplicatePreview=await previewProjectDuplicate({projectId:P}),duplicate=await duplicateProject({projectId:P,title:'Manual attack copy',operationId,expectedSourceVersion:duplicatePreview.sourceVersion});clones.push(duplicate.projectId);assert(JSON.stringify((await db.projects.get(duplicate.projectId))!.characterSheets![0].rows)===JSON.stringify(beforeExport.rows),'Native Duplicate lost attack/spell metadata');
    const cloneId=await importProjectData(await exportProjectData(P));clones.push(cloneId);const clone=(await db.projects.get(cloneId))!.characterSheets![0];assert(clone.id!==beforeExport.id&&JSON.stringify(clone.rows)===JSON.stringify(beforeExport.rows)&&JSON.stringify(clone.rolls)===JSON.stringify(beforeExport.rolls),'Project clone lost attacks/history');
    const archive=await createProjectZipArchive(P);await importProjectZip(new File([archive.blob],'manual-attacks.zip'),{replaceProjectIds:[P]});assert(JSON.stringify((await read()).rows)===JSON.stringify(beforeExport.rows)&&JSON.stringify((await read()).rolls)===JSON.stringify(beforeExport.rolls),'ZIP lost manual attacks/history');
    const beforeArchive=await read();await deleteSheet(P,saved.id,beforeArchive.revision);const archived=(await db.documentArchives.where('projectId').equals(P).toArray()).find(item=>item.sourceId===saved.id)!;await restoreArchivedDocument(P,archived.id);assert(JSON.stringify((await read()).rows)===JSON.stringify(beforeArchive.rows)&&JSON.stringify((await read()).ink)===JSON.stringify(beforeArchive.ink),'Archive/restore lost attacks/spell/ink');
    return ['Manual d20/damage share kernel, signed bonuses including zero, no target or critical adjudication, safe total overflow refusal','Real CAS, missing-row and malformed-damage refusal, Base/era receipt Undo, single-use/scope checks, stale Undo and outer abort rollback','Read/export projection has full paper without writes; standalone JSON, project clone, native Duplicate, ZIP and archive/restore retain attacks, spell coexistence, ink and roll history'];
  }finally{for(const id of clones)await clean(id);await clean();await db.settings.delete(`projectDuplicate.operation.${operationId}`);}
}
export async function testPlayerAttackSpanishHistory():Promise<string[]> {
  useLocaleStore.setState({locale:'es'});const root=createRoot(document.getElementById('root')!);
  try{
    const original=await seed(),draft=structuredClone(original);draft.rows[0].expression='1d20+4';draft.rows[0].fiveEAttack={version:1,bonus:4,damageType:'perforante'};await saveSheet(P,draft,original.revision);
    await act(async()=>{root.render(<MemoryRouter><CharacterSheetsEngine projectId={P}/></MemoryRouter>);await pause();});for(let i=0;i<30&&!document.querySelector('#sheet-tab-rows');i++)await act(async()=>{await pause();});await click(document.querySelector('#sheet-tab-rows'));
    await click(button('Tirar ataque'));await click(button('Tirar daño'));const rolls=sheetDraftStore(P).get(original.id)!.sheet.rolls;
    assert(rolls[0].label==='Daño · QA Spear · perforante'&&rolls[1].label==='Ataque · QA Spear'&&rolls[0].expression===rolls[1].expression,'Spanish row UI leaves the two identical expressions indistinguishable');
    assert((await db.projects.get(P))!.characterSheets![0].rolls.length===0,'Draft rolls wrote without Save');
    return ['Spanish normal row controls append distinct Ataque/Daño labels with authored row name and damage type, without changing existing saved history'];
  }finally{await act(async()=>{root.unmount();await pause();});await clean();useLocaleStore.setState({locale:'en'});}
}
export async function testPlayerAttackConfirmations():Promise<string[]> {
  useLocaleStore.setState({locale:'en'});const root=createRoot(document.getElementById('root')!);
  const dialog=()=>document.querySelector('[role="dialog"]');
  const dialogClick=async(name:string)=>click([...dialog()!.querySelectorAll('button')].find(node=>node.textContent?.trim()===name)??null);
  try{
    const original=await seed();await act(async()=>{root.render(<MemoryRouter><CharacterSheetsEngine projectId={P}/></MemoryRouter>);await pause();});for(let i=0;i<30&&!document.querySelector('#sheet-tab-rows');i++)await act(async()=>{await pause();});await click(document.querySelector('#sheet-tab-rows'));
    await click(document.querySelector(`[data-testid="sheet-use-attack-${ROW}"]`));await click(button('Discard changes'));assert(dialog()?.querySelector('h2')?.textContent==='Discard changes','Discard is titled as deletion');await dialogClick('Cancel');assert(sheetDraftStore(P).has(original.id),'Cancel discarded draft');
    const external=structuredClone(original);external.details.notes='A newer saved version';await saveSheet(P,external,original.revision);await click(button('Save sheet'));assert(document.querySelector('[role="alert"]'),'Stale draft did not show conflict');
    const beforeReload=JSON.stringify(await db.projects.get(P));await click(button('Reload saved sheet'));assert(dialog()?.querySelector('h2')?.textContent==='Reload saved sheet','Reload is titled as deletion');await dialogClick('Cancel');assert(sheetDraftStore(P).has(original.id),'Cancel reload discarded draft');
    await click(button('Reload saved sheet'));await dialogClick('Reload saved sheet');assert(!sheetDraftStore(P).has(original.id)&&JSON.stringify(await db.projects.get(P))===beforeReload,'Reload wrote or lost saved content');
    await click(button('Delete sheet'));assert(dialog()?.querySelector('h2')?.textContent==='Delete'&&[...dialog()!.querySelectorAll('button')].some(node=>node.textContent?.trim()==='Delete'),'Actual deletion lost Delete label');await dialogClick('Cancel');assert((await db.projects.get(P))!.characterSheets!.some(item=>item.id===original.id),'Cancel deletion removed saved sheet');
    return ['Normal Discard and stale-conflict Reload use their own title/action; cancel preserves draft, reload preserves saved version, and actual deletion retains Delete'];
  }finally{await act(async()=>{root.unmount();await pause();});await clean();}
}
export async function testPlayerAttackUnicodeContext():Promise<string[]> {
  const sheet=manualSheet();sheet.rows[0].name='🧭'.repeat(50000);sheet.rows[0].fiveEAttack={version:1,bonus:4,damageType:'🗡️'.repeat(30000)};const before=JSON.stringify(sheet);validateSheet(sheet);
  for(const kind of ['attack','damage'] as const){const roll=rollFiveEAttack(sheet,ROW,kind,()=>10);encodeURIComponent(roll.label);validateSheet({...sheet,rolls:[roll]});assert(roll.label.length<=100000,'Derived Unicode context exceeded label contract');}
  assert(JSON.stringify(sheet)===before,'Long context modified row');return ['Clipped derived history context retains valid Unicode, the existing label limit and complete authored rows'];
}
