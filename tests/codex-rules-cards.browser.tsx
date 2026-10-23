// Rules cards for a sourcebook: a spell, a magic item or a creature box filled
// from a Codex card's properties through a slot mapping (guessed from the
// property names, changeable), inserted from the Codex block controls, filled
// again after the card changes, printed by every export and made by the bridge.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Editor } from '@tiptap/core';
import { Selection } from '@tiptap/pm/state';
import TiptapEditor from '@/components/editor/TiptapEditor';
import CodexBlockControls from '@/components/editor/codexBlocks/CodexBlockControls';
import { guessRulesSlots, normalizeRulesSlots, rulesCardHtml, rulesFieldNames } from '@/engines/codex/rulesCards';
import { composePublishingDocument } from '@/engines/writings/publishingDocument';
import { buildPublishingDocx } from '@/engines/writings/publishingDocx';
import { buildPublishingEpub } from '@/engines/writings/publishingEpub';
import { htmlToMarkdown } from '@/engines/writings/manuscriptExport';
import { db } from '@/db';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { useLocaleStore } from '@/stores/localeStore';
import type { CodexEntry, Project, Writing } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string, timeout = 3000) { const end = Date.now() + timeout; while (Date.now() < end) { if (check()) return; await act(async () => { await sleep(20); }); } throw new Error(`Timed out: ${label}`); }
const select = async (testId: string, value: string) => { const element = document.querySelector(`[data-testid="${testId}"]`) as HTMLSelectElement; assert(element, testId); await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('change', { bubbles: true })); await sleep(40); }); };
const click = async (element: Element | null | undefined, what: string) => { assert(element, what); await act(async () => { (element as HTMLElement).click(); await sleep(60); }); };

export async function testCodexRulesCards(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [];
  const P = 'rules-cards';
  const card = (id: string, title: string, fields: Record<string, string>, content = ''): CodexEntry => ({ id, projectId: P, type: 'item', title, content, fields, tags: [], relations: [], createdAt: 1, updatedAt: 1 } as CodexEntry);
  const fireball = card('rc-fire', 'Bola de fuego', { Nivel: '3', Escuela: 'Evocación', 'Tiempo de lanzamiento': '1 acción', Alcance: '45 m', Componentes: 'V, S, M', 'Duración': 'Instantánea', Coste: '—' }, '<p>Una esfera de llamas estalla en el punto elegido.</p>');
  const ogre = card('rc-ogre', 'Ogro del puerto', { 'Tamaño': 'Grande', Tipo: 'gigante', Alineamiento: 'caótico malvado', CA: '11', PG: '59 (7d10+21)', Velocidad: '12 m', FUE: '19', DES: '8', CON: '16', INT: '5', SAB: '7', CAR: '7', 'Desafío': '2' });

  // The mapping is guessed from the names.
  const guessed = guessRulesSlots('spell', rulesFieldNames(fireball));
  assert(guessed.level === 'Nivel' && guessed.school === 'Escuela' && guessed.castingTime === 'Tiempo de lanzamiento' && guessed.range === 'Alcance' && guessed.duration === 'Duración' && !guessed.classes, `Guess: ${JSON.stringify(guessed)}`);
  assert(JSON.stringify(normalizeRulesSlots('spell', { level: 'Nivel', bogus: 'Alcance', range: 'Nope' }, rulesFieldNames(fireball))) === '{"level":"Nivel"}', 'Unknown slots and properties dropped');
  const spell = rulesCardHtml('spell', fireball, guessed, 'es');
  assert(spell.html.startsWith('<div data-wh-rules-card="spell" data-wh-entry="rc-fire"') && spell.html.includes('<h3>Bola de fuego</h3><p><em>Nivel 3 · Evocación</em></p><p><strong>Tiempo de lanzamiento:</strong> 1 acción</p>') && spell.html.includes('Una esfera de llamas') && spell.missing.join() === 'classes', `Spell: ${spell.html}`);
  const creature = rulesCardHtml('creature', ogre, guessRulesSlots('creature', rulesFieldNames(ogre)), 'es');
  assert(creature.html.includes('<p><em>Grande gigante, caótico malvado</em></p>') && creature.html.includes('<strong>Clase de armadura:</strong> 11') && creature.html.includes('<th>FUE</th>') && creature.html.includes('<td>19 (+4)</td>') && creature.html.includes('<td>8 (−1)</td>') && creature.html.includes('<strong>Desafío:</strong> 2'), `Creature: ${creature.html}`);
  passed.push('Mapping: "Nivel", "Escuela", "Tiempo de lanzamiento", "Alcance", "Duración" fill a spell\'s slots by name (Clases left empty); CA, PG, FUE…CAR and Desafío fill a creature, the scores printed with their modifiers (19 (+4), 8 (−1))');

  // Every export prints the box.
  const doc = composePublishingDocument([{ id: 'w', projectId: P, title: 'Grimorio', status: 'draft', content: spell.html + creature.html, wordCount: 40, tags: [], createdAt: 1, updatedAt: 1 }], { projectTitle: 'Manual', includeTitlePage: false, includeSynopsis: false, chapterLabel: 'Capítulo' });
  assert(/### Bola de fuego/.test(htmlToMarkdown(spell.html)) && /\*\*Alcance:\*\* 45 m/.test(htmlToMarkdown(spell.html)), 'Markdown');
  const { default: JSZip } = await import('jszip');
  const xml = await (await JSZip.loadAsync(await (await buildPublishingDocx(doc)).arrayBuffer())).file('word/document.xml')!.async('string');
  assert(xml.includes('w:fill="F8EEDD"') && xml.includes('Bola de fuego') && xml.includes('19 (+4)'), 'DOCX box');
  const section = await (await JSZip.loadAsync(await (await buildPublishingEpub(doc)).arrayBuffer())).file('EPUB/section-1.xhtml')!.async('string');
  assert(section.includes('<div class="wh-rules-card wh-rules-card-spell">') && section.includes('<div class="wh-rules-card wh-rules-card-creature">'), `ePub: ${section.slice(0, 300)}`);
  passed.push('Exports: Markdown keeps the title and the slot lines; Word prints each card as a shaded box with the ability table inside; ePub keeps the card look');

  // The editor: Codex block → "Ficha de reglas".
  const host = document.getElementById('root'); assert(host, 'root');
  const editorHost = document.createElement('div'), controlsHost = document.createElement('div');
  host.append(editorHost, controlsHost);
  const editorRoot = createRoot(editorHost);
  let controlsRoot: Root | null = null;
  let editor: Editor | null = null;
  try {
    await act(async () => { editorRoot.render(createElement(TiptapEditor, { content: '<p>Capítulo de magia.</p><p></p>', onChange: () => {}, onEditorReady: (instance: Editor | null) => { editor = instance ?? editor; } })); await sleep(200); });
    await until(() => !!editor, 'editor');
    const ed = editor as unknown as Editor;
    await act(async () => { ed.commands.focus(); ed.view.dispatch(ed.state.tr.setSelection(Selection.atEnd(ed.state.doc))); await sleep(20); });
    controlsRoot = createRoot(controlsHost);
    const render = (entries: CodexEntry[]) => act(async () => { controlsRoot!.render(createElement(CodexBlockControls, { editor: ed as never, projectId: P, entries, locale: 'es' })); await sleep(60); });
    await render([fireball, ogre]);
    await click(controlsHost.querySelector('button[aria-label="Insertar referencia viva del Codex"]'), 'open codex controls');
    await select('codex-insert-mode', 'rules');
    await click([...controlsHost.querySelectorAll('li button')].find(button => button.textContent?.includes('Bola de fuego')), 'pick fireball');
    await until(() => !!controlsHost.querySelector('[data-testid="rules-card-panel"]'), 'mapping panel');
    assert((controlsHost.querySelector('[data-testid="rules-slot-level"]') as HTMLSelectElement).value === 'Nivel' && (controlsHost.querySelector('[data-testid="rules-slot-classes"]') as HTMLSelectElement).value === '', 'Guessed in the panel');
    assert(/Sin rellenar: Clases/.test(controlsHost.querySelector('[data-testid="rules-missing"]')?.textContent ?? ''), 'Missing listed');
    await select('rules-slot-classes', 'Coste');
    await select('rules-slot-classes', '');
    await select('rules-slot-duration', '');
    await click(controlsHost.querySelector('[data-testid="rules-insert"]'), 'insert');
    await until(() => /data-wh-rules-card="spell"/.test(ed.getHTML()), 'card inserted');
    const inserted = ed.getHTML();
    assert(inserted.includes('<h3>Bola de fuego</h3>') && inserted.includes('<strong>Alcance:</strong> 45 m') && !inserted.includes('Duración:') && /data-wh-slots="[^"]*Nivel/.test(inserted), `Inserted: ${inserted}`);
    passed.push('Editor: Codex block → Insertar como "Ficha de reglas" → Bola de fuego shows the slots with the guessed properties and what is left empty; Duración set to (vacío) is left out; "Insertar ficha" puts the box in the chapter with the card and mapping on it');

    // The card changes; the box is filled again from it.
    const changed = { ...fireball, fields: { ...fireball.fields, Alcance: '60 m' } };
    await render([changed, ogre]);
    let at = -1; ed.state.doc.descendants((node, pos) => { if (node.type.name === 'rulesCard') at = pos + 3; });
    await act(async () => { ed.commands.setTextSelection(at); await sleep(60); });
    await until(() => !!controlsHost.querySelector('[data-testid="rules-refresh"]'), 'refresh offered inside the box');
    await click(controlsHost.querySelector('[data-testid="rules-refresh"]'), 'refresh');
    const refreshed = ed.getHTML();
    assert(refreshed.includes('<strong>Alcance:</strong> 60 m') && !refreshed.includes('45 m') && (refreshed.match(/data-wh-rules-card/g) ?? []).length === 1 && !refreshed.includes('Duración:'), `Refreshed: ${refreshed}`);
    passed.push('Refresh: with the cursor in the box, "Actualizar ficha de reglas desde «Bola de fuego»" fills it again from the card (Alcance 45 m → 60 m), keeping the mapping (Duración still left out)');
  } finally {
    await act(async () => { controlsRoot?.unmount(); editorRoot.unmount(); await sleep(20); });
    editorHost.remove(); controlsHost.remove();
  }

  // The bridge.
  try {
    await db.projects.put({ id: P, title: 'Manual', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings', 'codex'], createdAt: 1, updatedAt: 1 } as Project);
    await db.codexEntries.bulkPut([fireball, ogre]);
    await db.writings.put({ id: 'rc-w', projectId: P, title: 'Bestiario', status: 'draft', content: '<p>Criaturas del puerto.</p>', wordCount: 3, tags: [], createdAt: 1, updatedAt: 1 } as Writing);
    const read = await runBridgeTool('wh_codex_rules_card', { projectId: P, entryId: 'rc-ogre', layout: 'creature' });
    const result = read.result as { slots: Record<string, string>; missing: string[]; markdown: string };
    assert(read.ok && result.slots.armor === 'CA' && result.missing.join() === 'senses,languages' && /19 \(\+4\)/.test(result.markdown), `Read: ${JSON.stringify(read).slice(0, 400)}`);
    const bad = await runBridgeTool('wh_codex_rules_card', { projectId: P, entryId: 'rc-ogre', layout: 'creature', slots: { armor: 'Armadura' } });
    assert(!bad.ok && /Properties of the card: Tamaño/.test(JSON.stringify(bad)), 'Unknown property refused with the lists');
    const added = await runBridgeTool('wh_codex_rules_card', { projectId: P, entryId: 'rc-ogre', layout: 'creature', slots: { armor: 'CA', hp: 'PG', str: 'FUE' }, writingId: 'rc-w' });
    const stored = (await db.writings.get('rc-w'))!.content;
    assert(added.ok && stored.startsWith('<p>Criaturas del puerto.</p><div data-wh-rules-card="creature"') && stored.includes('<td>19 (+4)</td>') && !stored.includes('DES'), `Added: ${stored}`);
    await undoAuditEntry({ entry: { ...(added.result as { __audit: Record<string, unknown> }).__audit, tool: 'wh_codex_rules_card', kind: 'update' } });
    assert((await db.writings.get('rc-w'))!.content === '<p>Criaturas del puerto.</p>', 'Undo takes the box out');
    passed.push('Bridge: wh_codex_rules_card returns the ogre as a creature box (CA, PG… guessed; Sentidos and Idiomas reported empty) in HTML and Markdown; an unknown property is refused listing the card\'s properties; with writingId and an explicit mapping the box is added to "Bestiario" (only CA, PG and FUE), and undo takes it out');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
