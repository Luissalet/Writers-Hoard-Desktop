// The dice tray (grammar, advantage, natural 20 / 1, target, sets, formulas,
// log), the name generator (13 styles, parts picked again or skipped, "make a
// card", the "/" commands in the editor) and the to-do list (status, urgency,
// due days, links, filters), in the panels and through the bridge.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { db } from '@/db';
import { addDie, describeRoll, nudgeModifier, parseDice, rollDice } from '@/engines/dice/dice';
import DiceTray from '@/engines/dice/DiceTray';
import { generateIdea, generateNames, rerollPart, skipPart } from '@/engines/names/generate';
import { ideaCard } from '@/engines/names/makeCard';
import NameGenerator from '@/engines/names/NameGenerator';
import { NAME_STYLES } from '@/engines/names/types';
import { createTodo, dayFrom, isOverdue, nextWeek, sortTodos } from '@/engines/todos/model';
import TodoPanel from '@/engines/todos/TodoPanel';
import { createSheet } from '@/engines/character-sheets/types';
import { spellcastingText } from '@/engines/character-sheets/spellcasting';
import { statBlockPaper } from '@/engines/character-sheets/statBlockPaper';
import { damageSheet, deathSaveSheet, healSheet, sheetConditions } from '@/engines/character-sheets/fiveEHealth';
import { slashMatches } from '@/components/editor/blocks/slashCommands';
import { sheetValues } from '@/engines/tables/formulas';
import { insertRow } from '@/engines/tables/tableEdits';
import type { WorldTable } from '@/engines/tables/types';
import { exportXlsx, importXlsx, moveReferences } from '@/engines/tables/xlsx';
import TablesEngine from '@/engines/tables/TablesEngine';
import { MemoryRouter } from 'react-router-dom';
import IconPicker from '@/components/common/IconPicker';
import { ICON_CATEGORIES, ICON_GENRES, inGroup, recentIcons } from '@/components/common/iconCategories';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { useLocaleStore } from '@/stores/localeStore';
import type { Project } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean | Promise<boolean>, label: string, tries = 100) { for (let i = 0; i < tries; i++) { if (await check()) return; await act(async () => { await pause(50); }); } throw new Error(`Timed out: ${label}`); }
const type = async (element: Element | null, value: string) => { assert(element, 'input'); const input = element as HTMLInputElement; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); await pause(40); }); };
const choose = async (element: Element | null, value: string) => { assert(element, 'select'); const select = element as HTMLSelectElement; await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value); select.dispatchEvent(new Event('change', { bubbles: true })); await pause(60); }); };
const click = async (element: Element | null, what: string) => { assert(element, what); await act(async () => { (element as HTMLElement).click(); await pause(150); }); };
const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
const fixed = (...values: number[]) => () => { const value = values.shift(); assert(value !== undefined, 'out of fixed dice'); return value; };

export async function testTableTools(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [];

  // Dice grammar.
  const parsed = parseDice('2d6 + 1d8 − 1');
  assert(parsed.terms.length === 2 && parsed.modifier === -1 && parsed.terms[1].sides === 8, 'Parse 2d6+1d8-1');
  for (const bad of ['', 'd', '2d1', 'abc', '1d20+x', '101d6', '4d6kh5']) { let failed = false; try { parseDice(bad); } catch { failed = true; } assert(failed, `Refuse "${bad}"`); }
  const stats = rollDice('4d6kh3', { die: fixed(2, 6, 5, 1) });
  assert(stats.total === 13 && stats.terms[0].kept.join() === 'true,true,true,false', `4d6kh3 keeps 6, 5 and 2, drops the 1: ${JSON.stringify(stats.terms[0])}`);
  const kept = rollDice('4d6kh3', { die: fixed(2, 6, 5, 2) });
  assert(kept.total === 13 && kept.terms[0].kept.filter(Boolean).length === 3, 'Ties keep exactly three');
  const advantage = rollDice('1d20+5', { mode: 'advantage', target: 15, die: fixed(4, 17) });
  assert(advantage.total === 22 && advantage.outcome === 'pass' && advantage.terms[0].rolls.join() === '4,17' && !advantage.natural, 'Advantage keeps 17');
  const disadvantage = rollDice('d20+5', { mode: 'disadvantage', target: 15, die: fixed(20, 9) });
  assert(disadvantage.total === 14 && disadvantage.outcome === 'miss', 'Disadvantage keeps 9');
  const crit = rollDice('1d20-2', { target: 30, die: fixed(20) });
  assert(crit.natural === 20 && crit.outcome === 'pass', 'A natural 20 passes any target');
  const fumble = rollDice('1d20+40', { target: 5, die: fixed(1) });
  assert(fumble.natural === 1 && fumble.outcome === 'miss', 'A natural 1 misses');
  assert(!rollDice('2d20', { die: fixed(20, 1) }).natural, 'Two kept d20s are not a natural');
  assert(rollDice('d%', { die: fixed(73) }).total === 73 && rollDice('d%', { die: fixed(73) }).terms[0].sides === 100, 'd% is a d100');
  assert(describeRoll(advantage) === '↑2d20 [~~4~~, 17] + 5 = 22', `Written out: ${describeRoll(advantage)}`);
  assert(addDie('1d20', 6) === '1d20+1d6' && addDie('1d20+1d6', 6) === '1d20+2d6' && addDie('1d20+3', 8) === '1d20+1d8+3' && addDie('', 20) === '1d20', 'Adding dice to the pool');
  assert(nudgeModifier('1d20', 1) === '1d20+1' && nudgeModifier('1d20+1', -2) === '1d20-1' && nudgeModifier('1d20-1', 1) === '1d20', 'Nudging the modifier');
  passed.push('Dice: 2d6+1d8−1, 4d6kh3 (keeps the three highest, ties too), d%; advantage/disadvantage on the first d20; a target says pass or miss and a natural 20 / 1 always passes / misses; nonsense and more than 100 dice are refused; the roll is written out "↑2d20 [~~4~~, 17] + 5 = 22"');

  // Names.
  const idea = generateIdea('inn', 'seafaring', 'tide', 'es', 'llevada por una viuda junto al puerto');
  assert(idea.parts.name && idea.parts.owner && idea.parts.charm && idea.parts.knownFor && idea.parts.secret && idea.parts.trouble && !idea.parts.motto, `Inn parts: ${JSON.stringify(idea.parts)}`);
  assert(JSON.stringify(generateIdea('inn', 'seafaring', 'tide', 'es', 'llevada por una viuda junto al puerto').parts) === JSON.stringify(idea.parts), 'Same seed, same idea');
  const again = rerollPart(idea, 'secret', 'es');
  assert(again.parts.name === idea.parts.name && again.parts.owner === idea.parts.owner && again.rolls.secret === 1, 'Pick again changes only that part');
  const skipped = skipPart(idea, 'trouble');
  assert(!skipped.parts.trouble && skipPart(idea, 'name').parts.name === idea.parts.name, 'Skip leaves the name');
  for (const style of NAME_STYLES) for (const kind of ['inn', 'shop', 'person', 'village', 'house'] as const) for (const locale of ['es', 'en'] as const) {
    const made = generateIdea(kind, style, `s-${style}`, locale);
    assert(made.parts.name && /^\S/.test(made.parts.name) && !/\{name\}|undefined/.test(JSON.stringify(made.parts)), `${style} ${kind} ${locale}: ${JSON.stringify(made.parts)}`);
  }
  const person = generateIdea('person', 'northern', 'x', 'en');
  assert(/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(person.parts.name!) && person.parts.role, `A person has a given and a family name: ${person.parts.name}`);
  assert(generateIdea('house', 'grand', 'x', 'es').parts.name!.startsWith('Casa ') && generateIdea('house', 'grand', 'x', 'en').parts.name!.startsWith('House '), 'Houses');
  assert(new Set(generateNames('village', 'slavic', 'v', 'es', 8)).size === 8, 'Eight different village names');
  const card = ideaCard(skipped, 'es');
  assert(card.type === 'location' && card.title === idea.parts.name && card.fields.Clase === 'Posada' && card.fields['Su encanto'] === idea.parts.charm && !('Problema' in card.fields) && card.fields.Estilo === 'Marinero' && card.content.startsWith('<p>llevada por una viuda'), `Card: ${JSON.stringify(card)}`);
  assert(ideaCard(person, 'en').type === 'character' && ideaCard(generateIdea('house', 'grim', 'h', 'en'), 'en').type === 'faction', 'Card types');
  passed.push(`Names: inn, shop, person, village and noble house in ${NAME_STYLES.length} styles and both languages (e.g. "${idea.parts.name}", ${idea.parts.owner}); the same seed gives the same idea, "pick again" changes one part, a skipped part stays off the card; a card is a place, a character or a faction with each part as a property and the brief on top`);

  // Hit points on a 5e sheet.
  let hero = createSheet('5e-character', 'Ilse');
  const res = (id: string) => hero.resources.find(item => item.id === id)!.current;
  hero = { ...hero, resources: hero.resources.map(item => item.id === 'hp' ? { ...item, max: 12, current: 12 } : item.id === 'tempHp' ? { ...item, max: 99, current: 4 } : item) };
  hero = damageSheet(hero, 7);
  assert(res('tempHp') === 0 && res('hp') === 9, `Temp HP absorbs first: ${res('tempHp')} ${res('hp')}`);
  hero = damageSheet(hero, 20);
  assert(res('hp') === 0 && sheetConditions(hero).includes('Unconscious'), 'At 0 HP: unconscious');
  hero = deathSaveSheet(hero, 1).sheet;
  assert(res('deathFail') === 2, 'A 1 counts twice');
  hero = deathSaveSheet(hero, 12).sheet;
  assert(res('deathSuccess') === 1, 'A 12 is a success');
  const revived = deathSaveSheet(hero, 20);
  assert(revived.outcome === 'revived' && revived.sheet.resources.find(item => item.id === 'hp')!.current === 1 && !sheetConditions(revived.sheet).includes('Unconscious'), 'A 20 brings them back with 1 HP');
  assert(deathSaveSheet(hero, 5).outcome === 'dead', 'The third failure');
  hero = healSheet(hero, 50);
  assert(res('hp') === 12 && res('deathFail') === 0, 'Healing caps at the maximum and clears the saves');
  passed.push('5e sheet: damage takes temporary HP first (4 + 3 of 7), 0 HP makes Ilse unconscious; death saves count a 1 twice, a 20 brings her back with 1 HP, a third failure is death; healing stops at the maximum and clears the saves');

  // A stat block's spellcasting.
  let shaman = createSheet('5e-stat-block', 'Chamán trasgo');
  shaman = { ...shaman, numbers: { ...shaman.numbers, challenge: 1 }, traits: shaman.traits.map(trait => trait.id === 'wisdom' ? { ...trait, value: 14 } : trait), details: { ...shaman.details, spellAbility: 'wis', spellsAtWill: 'Luz, Mano de mago', spellsPerDay: '1: Sueño, Niebla; 3: Escudo' } };
  const spells = spellcastingText(shaman, 'es');
  assert(spells && /Sabiduría/.test(spells.intro) && /CD de salvación de conjuros 12/.test(spells.intro) && /\+4 para impactar/.test(spells.intro) && spells.lines.join('|') === 'A voluntad: Luz, Mano de mago|3/día: Escudo|1/día cada uno: Sueño, Niebla', `Spellcasting: ${JSON.stringify(spells)}`);
  const paper = statBlockPaper(shaman, 'es').svg;
  assert(paper.includes('Lanzamiento de conjuros') && paper.includes('1/día cada uno') && !paper.includes('spells Per Day'), 'The paper prints the spellcasting, not the raw keys');
  assert(spellcastingText(createSheet('5e-stat-block', 'x'), 'es') === null, 'No spells, no section');
  passed.push('Stat block: Wisdom 14 at CR 1 gives "CD de salvación de conjuros 12, +4 para impactar"; at will, 3/día and "1/día cada uno" lines, printed on the stat block paper; a stat block without spells has no section');

  // Slash commands.
  const commands = slashMatches('', 'es').map(item => item.id);
  assert(commands.includes('names') && commands.includes('dice') && slashMatches('nombre', 'es')[0]?.id === 'names' && slashMatches('dados', 'es')[0]?.id === 'dice', `Slash: ${commands.join()}`);
  passed.push('Editor: "/nombre" opens the name generator and "/dados" a quick roll, each inserting its result at the caret');

  // Sheet functions.
  const sheet = (rows: Record<string, string>[]): WorldTable => ({ id: 's', title: 'Mercado', mode: 'sheet', columns: ['a', 'b', 'c', 'd'].map(id => ({ id, name: id.toUpperCase(), kind: 'text' as const })), rows: rows.map((cells, i) => ({ id: `r${i}`, cells })) }) as WorldTable;
  const market = sheet([
    { a: 'Puerto', b: '10', c: '=SI(B1>15;"caro";"barato")', d: '=SUMAR.SI(A1:A3;"Puerto";B1:B3)' },
    { a: 'Sal', b: '20', c: '=IF(AND(B2>15,B2<30),"medio","otro")', d: '=COUNTIF(B1:B3,">=20")' },
    { a: 'Puerto', b: '30', c: '=BUSCARV("sal";A1:B3;2;FALSO)', d: '=VLOOKUP("Hierro",A1:B3,2,FALSE)' },
    { a: '=A1&" del norte"', b: '=SI.ERROR(1/0;"—")', c: '=AVERAGEIF(A1:A3,"Puerto",B1:B3)', d: '=CONCAT(UPPER(A2),"-",LEN(A1))' },
    { a: '=MEDIAN(B1:B3)', b: '=ROUNDUP(B1/3)', c: '=MOD(-7;3)', d: '=B1=10' },
  ]);
  const got = sheetValues(market);
  for (const [key, expected] of [['C1', 'barato'], ['D1', 40], ['C2', 'medio'], ['D2', 2], ['C3', 20], ['D3', '#N/A'], ['A4', 'Puerto del norte'], ['B4', '—'], ['C4', 20], ['D4', 'SAL-6'], ['A5', 20], ['B5', 4], ['C5', 2], ['D5', 'TRUE']] as const) assert(got.get(key) === expected, `${key}: ${got.get(key)} != ${expected}`);
  const moved = sheet([{ a: '1', b: '=CONCAT("A1 es ",A1)' }, { a: '2' }]);
  insertRow(moved, 0);
  assert(moved.rows[1].cells.b === '=CONCAT("A1 es ",A2)', `Quoted text is not a reference: ${moved.rows[1].cells.b}`);
  passed.push('Sheets: SI/IF with comparisons, Y/AND, SUMAR.SI/SUMIF, CONTAR.SI/COUNTIF, PROMEDIO.SI, BUSCARV/VLOOKUP (exact, #N/A when missing), SI.ERROR, & and CONCAT/UPPER/LEN, MEDIAN, ROUNDUP, MOD and TRUE/FALSE results, with Spanish names and ; separators; inserting a row moves A1 but not "A1" inside quotes');

  // To-do model.
  const today = dayFrom(0), yesterday = dayFrom(-1);
  const late = createTodo('Revisar capítulo 3', { urgency: 2, due: yesterday }), calm = createTodo('Buscar nombres', { due: dayFrom(5) }), done = createTodo('Mapa', { status: 'done' });
  assert(isOverdue(late, today) && !isOverdue(calm, today) && !isOverdue({ ...late, status: 'done' }, today), 'Overdue');
  assert(sortTodos([done, calm, late]).map(item => item.text).join() === 'Revisar capítulo 3,Buscar nombres,Mapa', 'Open first, by urgency');
  assert(nextWeek(new Date(2026, 9, 23)) === '2026-10-26' && nextWeek(new Date(2026, 9, 26)) === '2026-11-02', 'Next week is next Monday');
  let invalid = false; try { createTodo('x', { due: '2026-13-40' }); } catch { invalid = true; } assert(invalid, 'A bad day is refused');

  const P = 'table-tools';
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  try {
    await db.projects.put({ id: P, title: 'Mesa', description: '', mode: 'custom', type: 'standalone', color: '#3a7bd5', status: 'draft', enabledEngines: ['codex', 'character-sheets', 'notes', 'writings', 'tables'], createdAt: 1, updatedAt: 1 } as Project);
    await db.writings.put({ id: `${P}-w`, projectId: P, title: 'El puerto', content: '<p>Texto.</p>', wordCount: 1, tags: [], status: 'draft', createdAt: 1, updatedAt: 1 } as never);
    // Dice tray.
    await act(async () => { root = createRoot(host); root.render(<DiceTray projectId={P} locale="es" />); await pause(300); });
    await click(document.querySelector('[data-testid="dice-add-d6"]'), 'd6');
    await click(document.querySelector('[data-testid="dice-add-d6"]'), 'd6 again');
    await click(document.querySelector('[data-testid="dice-mod-up"]'), '+1');
    assert((document.querySelector('[data-testid="dice-expression"]') as HTMLInputElement).value === '2d6+1', `Pool: ${(document.querySelector('[data-testid="dice-expression"]') as HTMLInputElement).value}`);
    await type(document.querySelector('[data-testid="dice-expression"]'), '1d20+3');
    await choose(document.querySelector('[data-testid="dice-mode"]'), 'advantage');
    await type(document.querySelector('[data-testid="dice-target"]'), '12');
    await type(document.querySelector('[data-testid="dice-label"]'), 'Ataque con espada');
    await click(document.querySelector('[data-testid="dice-roll"]'), 'roll');
    await until(() => !!document.querySelector('[data-testid="dice-total"]'), 'a result');
    const faces = all('[data-testid="dice-face"]');
    assert(faces.length === 2 && faces.filter(face => face.dataset.kept === 'true').length === 1, 'Two d20s, one kept');
    assert(document.querySelector('[data-testid="dice-outcome"]'), 'Pass or miss shown');
    await until(async () => ((await db.projects.get(P))?.diceTray?.log.length ?? 0) === 1, 'logged');
    await click(document.querySelector('[data-testid="dice-formula-save"]'), 'save formula');
    await until(async () => (await db.projects.get(P))?.diceTray?.formulas[0]?.label === 'Ataque con espada', 'formula saved');
    await click(document.querySelector('[data-testid="dice-set-oxblood"]'), 'set');
    assert(document.querySelector('[data-testid="dice-set-oxblood"]')?.getAttribute('aria-pressed') === 'true', 'Set chosen');
    let nat = 0; for (let i = 0; i < 400 && !nat; i++) { await click(document.querySelector('[data-testid="dice-formula-Ataque con espada"]'), 'formula'); if (document.querySelector('[data-testid="dice-nat20"]')) nat = 20; else if (document.querySelector('[data-testid="dice-nat1"]')) nat = 1; }
    assert(nat, 'Within 400 rolls a natural 20 or 1 shows its callout');
    await type(document.querySelector('[data-testid="dice-expression"]'), '1d20+banana');
    await click(document.querySelector('[data-testid="dice-roll"]'), 'bad roll');
    assert(document.querySelector('[data-testid="dice-error"]'), 'A bad roll says how to write one');
    passed.push(`Dice tray: d6 twice and +1 build "2d6+1"; 1d20+3 with advantage against 12 shows two d20s (one struck out) and pass or miss; the roll is logged in the project; "Guardar fórmula" keeps "Ataque con espada" and replays it; the Oxblood set is chosen; a natural ${nat} shows its callout; a bad roll is explained`);
    await act(async () => { root?.unmount(); root = null; await pause(); });

    // Name generator.
    let inserted = '';
    await act(async () => { root = createRoot(host); root.render(<NameGenerator projectId={P} locale="es" onInsert={text => { inserted = text; }} />); await pause(300); });
    await choose(document.querySelector('[data-testid="namegen-kind"]'), 'shop');
    await choose(document.querySelector('[data-testid="namegen-style"]'), 'dwarven');
    const shopName = document.querySelector('[data-testid="namegen-name"]')?.textContent ?? '';
    assert(shopName && document.querySelector('[data-testid="namegen-owner"]')?.textContent, 'A dwarven shop with an owner');
    const secret = document.querySelector('[data-testid="namegen-secret"]')?.textContent;
    await click(document.querySelector('[data-testid="namegen-again-secret"]'), 'again');
    assert(document.querySelector('[data-testid="namegen-name"]')?.textContent === shopName, 'Pick again keeps the name');
    await click(document.querySelector('[data-testid="namegen-skip-trouble"]'), 'skip');
    assert(document.querySelector('[data-testid="namegen-trouble"]')?.textContent === '—', 'Skipped');
    await click(document.querySelector('[data-testid="namegen-more"]'), 'more');
    assert(all('[data-testid="namegen-list"] button').length >= 6, 'More names');
    await click(document.querySelector('[data-testid="namegen-insert"]'), 'insert');
    assert(inserted === shopName, 'Insert gives the name');
    await click(document.querySelector('[data-testid="namegen-card"]'), 'card');
    await until(() => !!document.querySelector('[data-testid="namegen-made"]'), 'card made');
    const madeCard = (await db.codexEntries.where('projectId').equals(P).toArray()).find(entry => entry.title === shopName);
    assert(madeCard && madeCard.type === 'location' && (madeCard.fields as Record<string, string>).Estilo === 'Enano' && !('Problema' in (madeCard.fields as Record<string, string>)), `Card in the Codex: ${JSON.stringify(madeCard?.fields)}`);
    passed.push(`Name generator: a dwarven shop "${shopName}" with owner, charm and secret (picked again: ${secret ? 'changed' : '—'}); its trouble skipped; eight more names; "Insertar en el texto" gives the name; "Crear ficha" puts a place card in the Codex with its parts and style and without the skipped part`);
    await act(async () => { root?.unmount(); root = null; await pause(); });

    // To-do list.
    await act(async () => { root = createRoot(host); root.render(<TodoPanel projectId={P} locale="es" />); await pause(300); });
    await type(document.querySelector('[data-testid="todo-new"]'), 'Revisar el capítulo del puerto');
    await click(document.querySelector('[data-testid="todo-add"]'), 'add');
    await type(document.querySelector('[data-testid="todo-new"]'), 'Nombrar la taberna');
    await click(document.querySelector('[data-testid="todo-add"]'), 'add 2');
    await until(() => all('[data-testid="todo-item"]').length === 2, 'two tasks');
    const first = () => all('[data-testid="todo-item"]').find(item => (item.querySelector('[data-testid="todo-text"]') as HTMLInputElement).value.startsWith('Revisar'))!;
    await choose(first().querySelector('[data-testid="todo-urgency"]'), '3');
    await click(first().querySelector('[data-testid="todo-due-tomorrow"]'), 'tomorrow');
    await choose(first().querySelector('[data-testid="todo-link-add"]'), `writing:${P}-w`);
    await until(() => !!first()?.querySelector('[data-testid="todo-link"]'), 'linked');
    assert(first().querySelector('[data-testid="todo-link"]')?.textContent === '@El puerto', 'Linked to the chapter');
    assert(all('[data-testid="todo-item"]')[0] === first(), 'The urgent task comes first');
    assert(/2 pendientes/.test(document.querySelector('[data-testid="todo-open-count"]')?.textContent ?? ''), 'Open count');
    await click(document.querySelector('[data-testid="todo-filter-due"]'), 'due filter');
    assert(all('[data-testid="todo-item"]').length === 1, 'Only the dated one');
    await click(document.querySelector('[data-testid="todo-filter-open"]'), 'open filter');
    const second = all('[data-testid="todo-item"]').find(item => (item.querySelector('[data-testid="todo-text"]') as HTMLInputElement).value.startsWith('Nombrar'))!;
    await click(second.querySelector('[data-testid="todo-done"]'), 'done');
    await until(() => all('[data-testid="todo-item"]').length === 1, 'done leaves the open list');
    const stored = (await db.projects.get(P))?.todos;
    assert(stored?.items.find(item => item.text.startsWith('Revisar'))?.due === dayFrom(1) && stored.items.find(item => item.text.startsWith('Nombrar'))?.status === 'done', 'Saved');
    passed.push('To-do: two tasks added; the first gets urgency Alta, "Mañana" and a link to the chapter "El puerto" and goes first; "Con fecha" shows only it; ticking the second marks it done and takes it off the open list; saved with the project');
    await act(async () => { root?.unmount(); root = null; await pause(); });

    // Excel workbooks and tabs.
    const book: WorldTable[] = [
      { id: 'x1', title: 'Mercado', mode: 'sheet', workbook: { id: 'wb', name: 'Cuentas', order: 0, color: '#c4463a' }, columns: ['a', 'b', 'c'].map(id => ({ id, name: id.toUpperCase(), kind: 'text' as const })), rows: [{ id: 'r1', cells: { a: 'Sal', b: '10', c: '=SI(B1>5;"caro";"barato")' } }, { id: 'r2', cells: { a: 'Pan', b: '3', c: '=SUMA(B1:B2)&" monedas"' } }] },
      { id: 'x2', title: 'Notas', mode: 'sheet', workbook: { id: 'wb', name: 'Cuentas', order: 1, hidden: true }, columns: [{ id: 'a', name: 'A', kind: 'text' as const }], rows: [{ id: 'r1', cells: { a: 'secreto' } }] },
    ];
    const bytes = new Uint8Array(await (await exportXlsx(book)).arrayBuffer());
    const back = await importXlsx(bytes);
    assert(back.sheets.length === 2 && back.sheets[0].color === '#c4463a' && back.sheets[1].hidden && back.sheets[0].rows[0][2] === '=IF(B1>5,"caro","barato")' && back.sheets[0].rows[1][2] === '=SUM(B1:B2)&" monedas"' && back.report.formulas === 2, `Round trip: ${JSON.stringify(back)}`);
    assert(moveReferences('A1+$B$2+B$3+"A1"', 2, 1) === 'B3+$B$2+C$3+"A1"', 'Shared formulas move relative references only');
    let refused = ''; try { await importXlsx(new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0, 0])); } catch (reason) { refused = (reason as Error).message; } assert(refused === 'xlsx_encrypted', 'A password-protected file is named as such');
    let base64 = ''; for (let i = 0; i < bytes.length; i += 0x8000) base64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); base64 = btoa(base64);
    const imported = await runBridgeTool('wh_table_import_xlsx', { projectId: P, base64, title: 'Cuentas' });
    assert(imported.ok, `xlsx import: ${JSON.stringify(imported)}`);
    const tabsMade = (imported.result as { tabs: { tableId: string; title: string; hidden?: boolean }[] }).tabs;
    assert(tabsMade.length === 2 && tabsMade[1].hidden, 'Two tabs, the second hidden');
    const firstTab = tabsMade[0].tableId;
    const computedSheet = await runBridgeTool('wh_table_get', { projectId: P, tableId: firstTab });
    assert(computedSheet.ok && (computedSheet.result as { computed: Record<string, unknown> }).computed.C1 === 'caro' && (computedSheet.result as { computed: Record<string, unknown> }).computed.C2 === '13 monedas', 'Imported formulas compute');
    await act(async () => { root = createRoot(host); root.render(<MemoryRouter><TablesEngine projectId={P} /></MemoryRouter>); await pause(400); });
    await until(() => !!document.querySelector('[data-testid="workbook-tabs"]'), 'workbook tabs');
    assert(all('nav button').filter(button => /Cuentas/.test(button.textContent ?? '')).length === 1 && /2 pestañas/.test(all('nav button').find(button => /Cuentas/.test(button.textContent ?? ''))?.textContent ?? ''), 'The workbook shows once in the list');
    assert(!document.querySelector('[data-testid="workbook-tab-Notas"]') && document.querySelector('[data-testid="workbook-show-hidden"]'), 'The hidden tab is hidden');
    await click(document.querySelector('[data-testid="workbook-add"]'), 'add tab');
    await until(() => !!document.querySelector('[data-testid="workbook-tab-Hoja 3"]'), 'Hoja 3');
    assert(document.querySelector('[data-testid="workbook-tab-Hoja 3"]')?.getAttribute('aria-selected') === 'true', 'The new tab is open');
    await click(document.querySelector('[data-testid="workbook-tab-Mercado"]'), 'back to Mercado');
    await choose(document.querySelector('[data-testid="workbook-colour"]'), '#4a9e6d');
    await until(async () => (await db.projects.get(P))?.dataTables?.find(table => table.id === firstTab)?.workbook?.color === '#4a9e6d', 'colour saved');
    passed.push('Excel: a two-tab workbook (tab colour, hidden tab, SI/SUMA formulas) goes out as .xlsx with Excel\'s IF/SUM and comes back with both tabs, the colour, the hidden state and formulas that compute ("caro", "13 monedas"); a password-protected file is named as such; in Tablas the workbook is one entry "Cuentas · 2 pestañas" with tabs under the sheet: the hidden one out of sight, "+" adds "Hoja 3" and opens it, a tab takes a colour');
    await act(async () => { root?.unmount(); root = null; await pause(); });
    const tabList = await runBridgeTool('wh_table_workbook', { projectId: P, tableId: firstTab, action: 'move', position: 2 });
    assert(tabList.ok && (tabList.result as { tabs: { title: string }[] }).tabs.map(tab => tab.title).join() === 'Notas,Hoja 3,Mercado', `Move: ${JSON.stringify(tabList)}`);
    const lastVisible = await runBridgeTool('wh_table_workbook', { projectId: P, tableId: firstTab, action: 'hide' });
    assert(lastVisible.ok, 'Hiding one of two visible tabs is fine');
    const third = (lastVisible.result as { tabs: { tableId: string; title: string }[] }).tabs.find(tab => tab.title === 'Hoja 3')!.tableId;
    const refuseHide = await runBridgeTool('wh_table_workbook', { projectId: P, tableId: third, action: 'hide' });
    assert(!refuseHide.ok, 'The last visible tab cannot be hidden');
    const exported = await runBridgeTool('wh_table_export_xlsx', { projectId: P, tableId: firstTab });
    assert(exported.ok && (exported.result as { tabs: string[]; fileName: string }).tabs.length === 3 && (exported.result as { fileName: string }).fileName === 'Cuentas.xlsx', `Export: ${JSON.stringify((exported.result as { tabs: string[] })?.tabs)}`);
    passed.push('Bridge: wh_table_import_xlsx makes the tabs and reports what came in; wh_table_get computes the imported formulas; wh_table_workbook moves "Mercado" last and hides it, refusing to hide the last visible tab; wh_table_export_xlsx writes the three tabs as Cuentas.xlsx');

    // Icon picker: categories, genres, recent.
    const weapons = ICON_CATEGORIES.find(group => group.id === 'weapons')!, scifi = ICON_GENRES.find(group => group.id === 'scifi')!;
    assert(inGroup('Swords', weapons) && inGroup('Shield', weapons) && !inGroup('Coffee', weapons) && inGroup('Rocket', scifi), 'Icon groups');
    let picked = '';
    await act(async () => { root = createRoot(host); root.render(<IconPicker value="BookOpen" onChange={name => { picked = name; }} />); await pause(200); });
    await click(host.querySelector('button[title]'), 'icon trigger');
    await until(() => !!document.querySelector('[data-testid="icon-category-weapons"]'), 'icon chips');
    await click(document.querySelector('[data-testid="icon-category-weapons"]'), 'weapons');
    await until(() => !!document.querySelector('button[title="Swords"]'), 'swords in weapons', 160);
    assert(!document.querySelector('button[title="Coffee"]'), 'Only weapons');
    await click(document.querySelector('button[title="Swords"]'), 'pick swords');
    assert(picked === 'Swords' && recentIcons()[0] === 'Swords', 'Picked and remembered');
    await click(host.querySelector('button[title]'), 'reopen');
    await until(() => !!document.querySelector('[data-testid="icon-group-recent"]'), 'recent chip');
    await click(document.querySelector('[data-testid="icon-group-recent"]'), 'recent');
    assert(document.querySelector('button[title="Swords"]'), 'Recent shows Swords');
    await click(document.querySelector('[data-testid="icon-genre-horror"]'), 'horror');
    await until(() => !!document.querySelector('button[title="Skull"]'), 'skull in horror', 160);
    passed.push('Icons: the picker offers categories (Armas shows Swords and Shield, not Coffee) and genres (Terror shows Skull, Ciencia ficción Rocket); a picked icon goes first in "Recientes" on this device');
    await act(async () => { root?.unmount(); root = null; await pause(); });

    // Bridge.
    const rolled = await runBridgeTool('wh_dice_roll', { expression: '4d6kh3', times: 6, projectId: P });
    assert(rolled.ok && (rolled.result as { rolls: { total: number }[] }).rolls.length === 6 && (rolled.result as { rolls: { total: number }[] }).rolls.every(roll => roll.total >= 3 && roll.total <= 18), 'Six ability scores');
    const badRoll = await runBridgeTool('wh_dice_roll', { expression: '1d20+fish' });
    assert(!badRoll.ok, 'Bad roll refused');
    const tray = await runBridgeTool('wh_dice_tray', { projectId: P, action: 'read' });
    assert(tray.ok && (tray.result as { log: unknown[]; formulas: { label: string }[] }).log.length >= 8 && (tray.result as { formulas: { label: string }[] }).formulas[0].label === 'Ataque con espada', 'Tray read');
    const saveFormula = await runBridgeTool('wh_dice_tray', { projectId: P, action: 'save-formula', label: 'Daño', expression: '1d8+3' });
    assert(saveFormula.ok, 'Formula through the bridge');
    await undoAuditEntry({ entry: { ...(saveFormula.result as { __audit: Record<string, unknown> }).__audit, tool: 'wh_dice_tray', kind: 'update' } });
    const afterUndo = (await db.projects.get(P))?.diceTray?.formulas.map(item => item.label) ?? [];
    assert(!afterUndo.includes('Daño'), `Undo removes the formula: ${afterUndo}`);
    const names = await runBridgeTool('wh_name_generate', { kind: 'village', style: 'northern', count: 3, seed: 'n', locale: 'en' });
    assert(names.ok && (names.result as { ideas: { name: string; motto: string }[] }).ideas.length === 3 && (names.result as { ideas: { motto: string }[] }).ideas.every(item => item.motto), 'Three villages');
    const cardMade = await runBridgeTool('wh_name_generate', { kind: 'person', style: 'fey', seed: 'p', makeCard: true, projectId: P, parts: { role: 'Cartógrafa', secret: null }, locale: 'es' });
    assert(cardMade.ok, `Card through the bridge: ${JSON.stringify(cardMade)}`);
    const personCard = await db.codexEntries.get((cardMade.result as { entryId: string }).entryId);
    assert(personCard?.type === 'character' && (personCard.fields as Record<string, string>).Oficio === 'Cartógrafa' && !('Secreto' in (personCard.fields as Record<string, string>)), `Person card: ${JSON.stringify(personCard?.fields)}`);
    const badStyle = await runBridgeTool('wh_name_generate', { kind: 'inn', style: 'cyberpunk' });
    assert(!badStyle.ok, 'Unknown style refused');
    const added = await runBridgeTool('wh_todo_action', { projectId: P, action: 'add', text: 'Dibujar el mapa del puerto', urgency: 1, due: '2026-11-02', links: [{ kind: 'writing', id: `${P}-w` }] });
    assert(added.ok, `Todo add: ${JSON.stringify(added)}`);
    const listed = await runBridgeTool('wh_todo_list', { projectId: P });
    assert(listed.ok && (listed.result as { open: number; items: { text: string }[] }).open === 2 && (listed.result as { items: { text: string }[] }).items.some(item => item.text === 'Dibujar el mapa del puerto'), 'Todo list');
    const updated = await runBridgeTool('wh_todo_action', { projectId: P, action: 'update', match: 'mapa del puerto', status: 'in_progress', due: null });
    assert(updated.ok && (updated.result as { item: { status: string; due?: string } }).item.status === 'in_progress' && !(updated.result as { item: { due?: string } }).item.due, 'Todo update by match');
    await undoAuditEntry({ entry: { ...(updated.result as { __audit: Record<string, unknown> }).__audit, tool: 'wh_todo_action', kind: 'update' } });
    assert((await db.projects.get(P))?.todos?.items.find(item => item.text.startsWith('Dibujar'))?.due === '2026-11-02', 'Undo puts the due day back');
    const badDue = await runBridgeTool('wh_todo_action', { projectId: P, action: 'add', text: 'x', due: 'mañana' });
    assert(!badDue.ok, 'A bad day refused');
    passed.push('Bridge: wh_dice_roll rolls 4d6kh3 six times into the log and refuses nonsense; wh_dice_tray reads the log and formulas and saves one (undo removes it); wh_name_generate gives three northern villages with mottos and makes a fey person card with the author\'s role and no secret, refusing an unknown style; wh_todo_action adds a task linked to a chapter, moves it by words of its text to in progress clearing the date (undo puts the date back), and refuses a bad day; wh_todo_list counts the open ones');
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
    await db.codexEntries.where('projectId').equals(P).delete();
    await db.writings.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
