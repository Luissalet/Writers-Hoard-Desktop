// Fixes from the independent review of the tabletop tools (task 1095, wave D1):
// Excel files keep text as text and write only real Excel errors as errors;
// odd character references and empty shared strings no longer break an import;
// ROUND follows Excel on halves and IFERROR catches overflow; whole columns,
// percents and SUMPRODUCT compute; undoing an AI edit refuses when later work
// would be lost; a live table exports the rows it shows; overlapping "listen"
// calls play each loop once; decoded sound is capped.
import JSZip from 'jszip';
import { db } from '@/db';
import { SoundscapeMixer } from '@/engines/soundscape/mixer';
import { addLibrarySound } from '@/engines/media/soundLibrary';
import { saveWorldGraphSettings } from '@/engines/codex/worldGraph/store';
import { saveTodos, readTodos } from '@/engines/todos/operations';
import { saveKanbans, readKanbans } from '@/engines/kanban/operations';
import { saveSoundscapes, readSoundscapes } from '@/engines/soundscape/operations';
import { saveEncounter, listEncounters } from '@/engines/encounters/operations';
import { logDiceRoll } from '@/engines/dice/operations';
import { rollDice } from '@/engines/dice/dice';
import { sheetValues } from '@/engines/tables/formulas';
import { exportXlsx, exportXlsxReport, importXlsx, plainNumber } from '@/engines/tables/xlsx';
import type { WorldTable } from '@/engines/tables/types';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { useLocaleStore } from '@/stores/localeStore';
import type { CodexEntry, Project } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const audit = (call: { result?: unknown }, tool: string) => ({ ...((call.result as { __audit: Record<string, unknown> }).__audit), tool, kind: 'update' });
const refused = async (run: () => Promise<unknown>) => { try { await run(); return ''; } catch (reason) { return (reason as { code?: string }).code ?? String(reason); } };
const sheet = (rows: string[][], title = 'Hoja'): WorldTable => {
  const width = Math.max(...rows.map(row => row.length)), columns = Array.from({ length: width }, (_, i) => ({ id: `c${i}`, name: String.fromCharCode(65 + i), kind: 'text' as const }));
  return { id: `s-${title}`, title, mode: 'sheet', columns, rows: rows.map((row, r) => ({ id: `r${r}`, cells: Object.fromEntries(row.map((value, i) => [`c${i}`, value]).filter(([, value]) => value !== '')) })) } as unknown as WorldTable;
};
const sheetXml = async (tables: WorldTable[], index = 1) => { const zip = await JSZip.loadAsync(await (await exportXlsx(tables)).arrayBuffer()); return zip.file(`xl/worksheets/sheet${index}.xml`)!.async('string'); };
/** A bare workbook with one sheet, for reading odd files. */
async function workbook(sheet: string, shared?: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook xmlns:r="x"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData>${sheet}</sheetData></worksheet>`);
  if (shared) zip.file('xl/sharedStrings.xml', `<sst>${shared}</sst>`);
  return zip.generateAsync({ type: 'uint8array' });
}

export async function testReview1095d1(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [];
  const P = 'review-d1', engines = ['codex', 'character-sheets', 'notes', 'writings', 'tables', 'media'];
  await db.projects.put({ id: P, title: 'Mesa', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: engines, createdAt: 1, updatedAt: 1 } as Project);

  // 1. Text stays text in the exported file.
  const texts = ['1.10', '0x1F', '1e3', '+34600123456', '12345678901234567890', '007', '42', '-0.5', '3.14'];
  const xml = await sheetXml([sheet(texts.map(text => [text]))]);
  const cell = (at: number) => new RegExp(`<c r="A${at}"[^>]*>(?:<v>([^<]*)</v>|<is><t[^>]*>([^<]*)</t></is>)`).exec(xml);
  const kept = texts.map((text, i) => { const match = cell(i + 1)!; return match[1] !== undefined ? `n:${match[1]}` : `s:${match[2]}`; });
  assert(kept.join('|') === ['s:1.10', 's:0x1F', 's:1e3', 's:+34600123456', 's:12345678901234567890', 's:007', 'n:42', 'n:-0.5', 'n:3.14'].join('|'), `Text kept as text: ${kept.join('|')}`);
  const back = await importXlsx(new Uint8Array(await (await exportXlsx([sheet(texts.map(text => [text]))])).arrayBuffer()));
  assert(back.sheets[0].rows.map(row => row[0]).join('|') === texts.join('|'), `Round trip: ${back.sheets[0].rows.map(row => row[0]).join('|')}`);
  assert(plainNumber('1.10') === undefined && plainNumber('42') === 42 && plainNumber('0.1') === 0.1 && plainNumber('1234567890123456') === undefined, 'plainNumber');
  passed.push('Excel export: "1.10", "0x1F", "1e3", "+34600123456", a 20-digit ID and "007" are written as text exactly as typed (a round trip returns them unchanged); only plain decimals such as 42, -0.5 and 3.14 become numbers');

  // 2. Only Excel's real errors are errors.
  const errors = await sheetXml([sheet([['=1/0'], ['=FOO(1)'], ['="#hola"'], ['=A1&"x"'], ['=NA()'], ['=SQRT(-1)']])]);
  const typed = (at: number) => new RegExp(`<c r="A${at}"( t="[a-z]+")?><f>[^<]*</f><v>([^<]*)</v>`).exec(errors)!;
  assert(typed(1)[1] === ' t="e"' && typed(1)[2] === '#DIV/0!', `#DIV/0!: ${typed(1)[0]}`);
  assert(typed(2)[1] === ' t="e"' && typed(2)[2] === '#VALUE!', `An own code becomes #VALUE!: ${typed(2)[0]}`);
  assert(typed(3)[1] === ' t="str"' && typed(3)[2] === '#hola', `Text starting with # is text: ${typed(3)[0]}`);
  assert(typed(4)[1] === ' t="e"' && typed(4)[2] === '#DIV/0!', `An error passes through a formula: ${typed(4)[0]}`);
  assert(typed(6)[1] === ' t="e"' && typed(6)[2] === '#NUM!', `#NUM!: ${typed(6)[0]}`);
  assert(!/t="e"[^>]*><f>[^<]*<\/f><v>#(?:FORMULA|CYCLE|DEPTH|LIMIT|ERROR)!/.test(errors), 'No app-only error code reaches the file');
  passed.push('Excel export: =1/0 is #DIV/0! and =SQRT(-1) #NUM! as errors, an unsupported function result (#FORMULA!) is written as #VALUE!, and a text result such as "#hola" is a string, so Excel no longer asks to repair the file');

  // 3. Character references that cannot exist.
  const odd = await importXlsx(await workbook('<row r="1"><c r="A1" t="inlineStr"><is><t>a&#99999999;b&#xD800;c&#0;d&#65;</t></is></c><c r="B1"><v>5</v></c></row>'));
  assert(odd.sheets[0].rows[0][0] === 'a�b�c�dA' && odd.sheets[0].rows[0][1] === '5', `Odd references: ${JSON.stringify(odd.sheets[0].rows[0])}`);
  passed.push('Excel import: &#99999999;, &#xD800; and &#0; become U+FFFD instead of aborting the import; &#65; still reads as A and the rest of the sheet comes in');

  // 4. Empty and attributed shared strings keep their place.
  const strings = await importXlsx(await workbook('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c><c r="C1" t="s"><v>3</v></c><c r="D1" t="s"><v>4</v></c></row>', '<si><t>uno</t></si><si/><si xml:space="preserve"><t> tres</t></si><si x="1"/><si><r><t>cu</t></r><r><t>atro</t></r></si>'));
  assert(strings.sheets[0].rows[0].join('|') === 'uno| tres||cuatro', `Shared strings: ${strings.sheets[0].rows[0].join('|')}`);
  passed.push('Excel import: <si/> and <si attr…> entries in the shared strings keep their index, so later texts are not shifted onto the wrong cells');

  // 5. ROUND like Excel; IFERROR catches overflow.
  const maths = sheetValues(sheet([['=ROUND(-2.5)', '=ROUND(2.5)', '=ROUND(-1.005;2)', '=ROUND(1.005;2)', '=ROUND(-0.5)'], ['=IFERROR(0^-1;7)', '=IFERROR(POWER(0;-1);7)', '=IFERROR(10^400;7)', '=IFERROR(1E308*10;7)', '=IFERROR((-8)^0.5;7)'], ['=0^-1', '=10^400', '=1E308*10', '=1/0', '=1E308+1E308']]));
  const at = (c: number, r: number) => maths.get(`${String.fromCharCode(65 + c)}${r + 1}`);
  assert(at(0, 0) === -3 && at(1, 0) === 3 && at(2, 0) === -1.01 && at(3, 0) === 1.01 && at(4, 0) === -1, `ROUND: ${[0, 1, 2, 3, 4].map(c => at(c, 0))}`);
  assert([0, 1, 2, 3, 4].every(c => at(c, 1) === 7), `IFERROR: ${[0, 1, 2, 3, 4].map(c => at(c, 1))}`);
  assert(at(0, 2) === '#DIV/0!' && at(1, 2) === '#NUM!' && at(2, 2) === '#NUM!' && at(3, 2) === '#DIV/0!' && at(4, 2) === '#NUM!', `Errors: ${[0, 1, 2, 3, 4].map(c => at(c, 2))}`);
  passed.push('Formulas: ROUND(-2.5) is -3 and ROUND(-1.005;2) -1.01 as in Excel; IFERROR(0^-1;7), IFERROR(POWER(0;-1);7) and an overflowing power or product give 7 (0^-1 is #DIV/0!, an overflow #NUM!)');

  // 9. Columns, percents, SUMPRODUCT.
  const more = sheetValues(sheet([['1', '10', '=SUM(A:A)', '=10%', '=SUMPRODUCT(A1:A3;B1:B3)', '=SUMAPRODUCTO(A1:A3;B1:B3)'], ['2', '20', '=COUNT(A:B)', '=50%*200', '=SUMPRODUCT(A1:A3)', '=SUM(Z:Z)'], ['3', 'x', '=AVERAGE(B:B)', '=200*5%+1', '=SUMPRODUCT(A1:A2;B1:B3)', '=SUM(A:A;B:B)']]));
  const get = (c: number, r: number) => more.get(`${String.fromCharCode(65 + c)}${r + 1}`);
  assert(get(2, 0) === 6 && get(2, 1) === 5 && get(2, 2) === 15, `Whole columns: ${[get(2, 0), get(2, 1), get(2, 2)]}`);
  assert(get(3, 0) === 0.1 && get(3, 1) === 100 && get(3, 2) === 11, `Percents: ${[get(3, 0), get(3, 1), get(3, 2)]}`);
  assert(get(4, 0) === 50 && get(4, 1) === 6 && get(4, 2) === '#VALUE!' && get(5, 0) === 50 && get(5, 1) === 0 && get(5, 2) === 36, `SUMPRODUCT: ${[get(4, 0), get(4, 1), get(4, 2), get(5, 0), get(5, 1), get(5, 2)]}`);
  passed.push('Formulas: SUM(A:A), COUNT(A:B), AVERAGE(B:B) and a missing column Z:Z work inside the sheet\'s rows; 10% is 0.1 and 200*5%+1 is 11; SUMPRODUCT (and SUMAPRODUCTO) multiplies ranges, skips text and refuses mismatched sizes');

  // 10. Unknown functions are reported.
  const warned = await exportXlsxReport([sheet([['=FOO(1)+SUMA(2;3)', '=BAR.BAZ(1)', '=SUM(1;2)']])]);
  assert(warned.warnings.join() === 'BAR.BAZ,FOO', `Warnings: ${warned.warnings}`);
  assert((await exportXlsxReport([sheet([['=SUM(1;2)', '=SI(1;2;3)']])])).warnings.length === 0, 'Known functions are not warned about');
  passed.push('Excel export: FOO and BAR.BAZ (which Excel would show as #NAME?) are listed in the export report\'s warnings; SUM, SUMA and IF are not');

  // 7. A live table exports the rows it shows.
  const card = (id: string, title: string, type: CodexEntry['type']) => ({ id, projectId: P, type, title, content: '', fields: {}, tags: [], relations: [], createdAt: 1, updatedAt: 1 } as CodexEntry);
  await db.codexEntries.bulkPut([card('d1c1', 'Marta', 'character'), card('d1c2', 'Puerto Sal', 'location')]);
  const view = await runBridgeTool('wh_table_create_cards_view', { projectId: P, title: 'Todas las fichas' });
  assert(view.ok, JSON.stringify(view));
  const exported = await runBridgeTool('wh_table_export_xlsx', { projectId: P, tableId: (view.result as { table: WorldTable }).table.id });
  assert(exported.ok, JSON.stringify(exported));
  const live = await importXlsx(Uint8Array.from(atob((exported.result as { base64: string }).base64), char => char.charCodeAt(0)));
  assert(live.sheets[0].rows.map(row => row.join('/')).sort().join('|') === 'Marta/character|Nombre/Tipo|Puerto Sal/location', `Live export: ${JSON.stringify(live.sheets[0].rows)}`);
  assert(Array.isArray((exported.result as { warnings: string[] }).warnings), 'The bridge result lists warnings');
  passed.push('wh_table_export_xlsx on a live view of every card writes the cards it shows (Marta, Puerto Sal with their types) under the column names, not an empty sheet; the result carries the warnings list');

  // 6. Undo refuses to erase later work.
  const todo = await runBridgeTool('wh_todo_action', { projectId: P, action: 'add', text: 'Primera' });
  assert(todo.ok, JSON.stringify(todo));
  const todo2 = await runBridgeTool('wh_todo_action', { projectId: P, action: 'add', text: 'Segunda' });
  const todoChain = await runBridgeTool('wh_todo_action', { projectId: P, action: 'add', text: 'Tercera' });
  await undoAuditEntry({ entry: audit(todoChain, 'wh_todo_action') });
  await undoAuditEntry({ entry: audit(todo2, 'wh_todo_action') });
  assert((await readTodos(P)).items.map(item => item.text).join() === 'Primera', 'Undoing in reverse order still works');
  const aiTodo = await runBridgeTool('wh_todo_action', { projectId: P, action: 'add', text: 'De la IA' });
  const mine = await readTodos(P); await saveTodos(P, [...mine.items, { ...mine.items[0], id: 'mine', text: 'Mía' }], mine.revision);
  assert(await refused(() => undoAuditEntry({ entry: audit(aiTodo, 'wh_todo_action') })) === 'cannot-undo' && (await readTodos(P)).items.some(item => item.text === 'Mía'), 'Todos: refused, user task kept');

  const board = await runBridgeTool('wh_kanban', { projectId: P, action: 'create', name: 'Tablero' });
  const kanbanId = (board.result as { boardId: string }).boardId;
  const cardAi = await runBridgeTool('wh_kanban', { projectId: P, action: 'add-card', boardId: kanbanId, column: 'Ideas', title: 'IA' });
  assert(cardAi.ok, JSON.stringify(cardAi));
  const kanbans = await readKanbans(P), mineBoards = structuredClone(kanbans.boards); mineBoards[0].columns[0].cards.push({ id: 'k-mine', title: 'Mía' });
  await saveKanbans(P, mineBoards, kanbans.revision);
  assert(await refused(() => undoAuditEntry({ entry: audit(cardAi, 'wh_kanban') })) === 'cannot-undo' && (await readKanbans(P)).boards[0].columns[0].cards.some(c => c.id === 'k-mine'), 'Kanban: refused, user card kept');

  const scape = await runBridgeTool('wh_soundscape', { projectId: P, action: 'create', name: 'Mezcla' });
  assert(scape.ok, JSON.stringify(scape));
  const scapeId = (scape.result as { soundscapeId: string }).soundscapeId;
  const loud = await runBridgeTool('wh_soundscape', { projectId: P, action: 'set', soundscapeId: scapeId, master: 0.3 });
  const sounds = await readSoundscapes(P), mineSounds = structuredClone(sounds.items); mineSounds[0].master = 0.9;
  await saveSoundscapes(P, mineSounds, sounds.revision);
  assert(await refused(() => undoAuditEntry({ entry: audit(loud, 'wh_soundscape') })) === 'cannot-undo' && (await readSoundscapes(P)).items[0].master === 0.9, 'Soundscapes: refused, user level kept');

  const fight = await runBridgeTool('wh_encounter_action', { projectId: P, action: 'create', title: 'Cripta' });
  const encounterId = (fight.result as { encounter: { id: string } }).encounter.id;
  const added = await runBridgeTool('wh_encounter_action', { projectId: P, encounterId, action: 'add', name: 'Orco', hp: 10 });
  assert(added.ok, JSON.stringify(added));
  const current = (await listEncounters(P)).find(item => item.id === encounterId)!;
  await saveEncounter(P, { ...current, title: 'Cripta honda' }, current.revision);
  assert(await refused(() => undoAuditEntry({ entry: audit(added, 'wh_encounter_action') })) === 'cannot-undo' && (await listEncounters(P))[0].title === 'Cripta honda', 'Encounter: refused, user rename kept');
  const fresh = await runBridgeTool('wh_encounter_action', { projectId: P, encounterId, action: 'add', name: 'Goblin', hp: 5 });
  await undoAuditEntry({ entry: audit(fresh, 'wh_encounter_action') });
  assert(!(await listEncounters(P))[0].combatants.some(item => item.name === 'Goblin'), 'An untouched encounter still undoes');

  const formula = await runBridgeTool('wh_dice_tray', { projectId: P, action: 'save-formula', label: 'Daño', expression: '1d8+3' });
  assert(formula.ok, JSON.stringify(formula));
  await logDiceRoll(P, rollDice('1d20'));
  assert(await refused(() => undoAuditEntry({ entry: audit(formula, 'wh_dice_tray') })) === 'cannot-undo' && (await db.projects.get(P))!.diceTray!.formulas.some(item => item.label === 'Daño'), 'Dice: refused, formula kept');

  const look = await runBridgeTool('wh_world_graph_settings', { projectId: P, action: 'display', display: { names: 'main', nodeSize: 'large' } });
  assert(look.ok, JSON.stringify(look));
  await saveWorldGraphSettings(P, { hiddenIds: ['d1c1'] });
  assert(await refused(() => undoAuditEntry({ entry: audit(look, 'wh_world_graph_settings') })) === 'cannot-undo' && (await db.projects.get(P))!.codexGraphLayout!.hiddenIds?.includes('d1c1'), 'Graph: refused, hidden card kept');
  const look2 = await runBridgeTool('wh_world_graph_settings', { projectId: P, action: 'display', display: { names: 'hover' } });
  await undoAuditEntry({ entry: audit(look2, 'wh_world_graph_settings') });
  assert((await db.projects.get(P))!.codexGraphLayout!.display?.names === 'main', 'An untouched look still undoes');
  passed.push('Undo: after an AI edit to the task list, kanban boards, soundscapes, an encounter, the dice tray or the graph look, a later change by the user makes the undo refuse with cannot-undo and keeps that work; undoing in reverse order, or with nothing changed since, still works');

  // 8 and 11. The mixer.
  const rain = await addLibrarySound(P, 'rain', 'es'), sea = await addLibrarySound(P, 'sea', 'es');
  const scene = { id: 'sc', name: 'Escena', strips: [{ id: 'a', assetId: rain.id, kind: 'loop' as const, gain: 0.5 }, { id: 'b', assetId: sea.id, kind: 'loop' as const, gain: 0.5 }] };
  const soundscape = { id: 'ss', name: 'Mezcla', master: 0.5, scenes: [scene], liveSceneId: 'sc' };
  const mixer = new SoundscapeMixer();
  try {
    await Promise.all([mixer.listen(soundscape, scene), mixer.listen(soundscape, scene), mixer.listen(soundscape, scene)]);
    assert(mixer.layers === 2, `Overlapping listen calls play each loop once: ${mixer.layers} layers`);
    await mixer.listen(soundscape, scene);
    assert(mixer.layers === 2, 'Listening again swaps, it does not add');
    const racing = mixer.listen(soundscape, scene); mixer.stop(); await racing;
    assert(mixer.layers === 0 && !mixer.listening, 'A listen overtaken by Stop starts nothing');
  } finally { mixer.stop(); }
  passed.push('Mixer: three overlapping listen() calls on one scene play two layers (not six), listening again swaps rather than adds, and a call overtaken by Stop starts no sound');
  const cached = new SoundscapeMixer();
  try {
    await cached.listen(soundscape, scene);
    assert(cached.cachedSounds === 2, `Decoded sounds are kept for replay: ${cached.cachedSounds}`);
    const { DECODED_BYTES_LIMIT } = await import('@/engines/soundscape/mixer');
    assert(DECODED_BYTES_LIMIT === 200 * 1024 * 1024, 'The decoded cache is capped at 200 MB');
  } finally { cached.stop(); }
  const lru = new SoundscapeMixer() as unknown as { remember(id: string, buffer: { length: number; numberOfChannels: number }): void; buffers: Map<string, unknown>; cachedBytes: number };
  const big = (megabytes: number) => ({ length: megabytes * 1024 * 1024 / 4, numberOfChannels: 1 });
  lru.remember('one', big(80)); lru.remember('two', big(80)); lru.remember('three', big(80));
  assert([...lru.buffers.keys()].join() === 'two,three' && lru.cachedBytes === 160 * 1024 * 1024, `Least recently used goes first: ${[...lru.buffers.keys()]}`);
  lru.remember('huge', big(300));
  assert(!lru.buffers.has('huge') && lru.buffers.size === 2, 'A sound larger than the cap is not kept');
  passed.push('Mixer: decoded sound is kept for replay up to 200 MB; past that the least recently used is dropped (80+80+80 MB keeps the last two) and a single sound over the cap is not cached');

  await db.projects.delete(P);
  return passed;
}
