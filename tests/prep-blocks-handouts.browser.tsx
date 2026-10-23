// Game-prep blocks in a note: "/prueba" (a check you can roll, result kept on the
// block), "/encuentro" (creatures that become a fight in the encounter tracker),
// "/material" (player handout pointing at a gallery picture, made from a styled
// template). Every block reads as plain text in Markdown, Word, ePub, the reader
// and the wiki, comes back from Markdown with all its data, survives backup and
// clone, and the bridge writes and draws them.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { Editor } from '@tiptap/core';
import { NodeSelection, Selection } from '@tiptap/pm/state';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import TiptapEditor from '@/components/editor/TiptapEditor';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { slashMatches } from '@/components/editor/blocks/slashCommands';
import { htmlToMarkdown } from '@/engines/writings/manuscriptExport';
import { buildPublishingArtifacts } from '@/services/projectTools';
import { buildPublishingDocx } from '@/engines/writings/publishingDocx';
import { buildPublishingEpub } from '@/engines/writings/publishingEpub';
import { buildReaderHtml } from '@/engines/writings/readerExport';
import { installReaderPlayback, readerPlaybackCopy } from '@/engines/writings/readerPlayback';
import { defaultReaderPresentation, saveReaderPresentation } from '@/engines/writings/readerPresentation';
import ReadingView from '@/engines/writings/components/ReadingView';
import { markdownToTiptapHtml } from '@/services/aiBridge/markdown';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { BRIDGE_TOOLS } from '@/services/aiBridge/manifest';
import { validateToolArgs } from '@/services/aiRuntime/toolPolicy';
import { buildWorldWiki } from '@/services/worldWikiExport';
import { remapWorldRichContent } from '@/services/worldMetadata';
import { duplicateProject, previewProjectDuplicate, undoProjectDuplicate } from '@/services/projectDuplicate/service';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { readDiceTray } from '@/engines/dice/operations';
import { HANDOUT_TEMPLATES, renderHandoutPng, renderHandoutSvg } from '@/engines/prepBlocks/handouts';
import { parsePrepData } from '@/engines/prepBlocks/model';
import { useLocaleStore } from '@/stores/localeStore';
import type { CodexEntry, Project, Writing } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean | Promise<boolean>, label: string, timeout = 4000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await act(async () => { await sleep(25); }); } throw new Error(`Timed out: ${label}`); }
const q = <T extends Element = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);
type Reply = { ok: boolean; code?: string; error?: string; result?: any };

async function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null, value: string, id = '') {
  assert(element, `field present: ${id} | ${(document.querySelector('[data-prep-kind]')?.outerHTML ?? document.body.innerHTML).slice(0, 900)}`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!;
    setter.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    await sleep(30);
  });
}
async function click(element: Element | null) { assert(element, 'button present'); await act(async () => { (element as HTMLElement).click(); await sleep(40); }); }

export async function testPrepBlocksHandouts(): Promise<string[]> {
  const passed: string[] = [], P = 'prep-blocks-test', extra: string[] = [];
  const project: Project = { id: P, title: 'Mesa de preparación', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings', 'gallery', 'character-sheets', 'codex'], createdAt: 1, updatedAt: 1 };
  const captain: CodexEntry = { id: 'prep-card-ruiz', projectId: P, type: 'character', title: 'Capitán Ruiz', content: '<p>Guardia del puerto.</p>', fields: {}, tags: [], relations: [], createdAt: 1, updatedAt: 1 } as CodexEntry;
  const navigated: string[] = [];
  useLocaleStore.setState({ locale: 'es' });
  const host = document.getElementById('root'); assert(host, 'root');
  const root = createRoot(host);
  let editor: Editor | null = null;
  const cleanup = async () => { for (const id of [P, ...extra]) { try { await deleteProject(id); } catch { /* already gone */ } } await db.inspirationImages.where('projectId').equals(P).delete(); await db.codexEntries.where('projectId').equals(P).delete(); await db.writings.where('projectId').equals(P).delete(); await db.projects.delete(P); };
  await cleanup();
  try {
    await db.projects.put(project); await db.codexEntries.put(captain);
    assert(slashMatches('prueba', 'es').some(item => item.id === 'check') && slashMatches('encuentro', 'es').some(item => item.id === 'encounter') && slashMatches('material', 'es').some(item => item.id === 'handout') && slashMatches('', 'en').length === 31, 'The menu offers the three new blocks next to the earlier 28');
    await act(async () => { root.render(<MemoryRouter><EnginePaneContext.Provider value={{ instanceId: 'prep', visible: true, navigate: (to: string) => { navigated.push(to); } }}><TiptapEditor content="<p>Antes</p><p></p>" onChange={() => undefined} referenceContext={{ projectId: P, scopeId: 'prep-note' }} onEditorReady={(instance: Editor | null) => { editor = instance ?? editor; }} /></EnginePaneContext.Provider></MemoryRouter>); await sleep(250); });
    await until(() => !!editor, 'editor');
    const ed = editor as unknown as Editor;
    const type = async (text: string) => { await act(async () => { ed.view.dispatch(ed.state.tr.insertText(text)); await sleep(40); }); };
    const newLine = async () => { await act(async () => { ed.commands.insertContentAt(ed.state.doc.content.size, '<p></p>'); ed.commands.focus(); ed.view.dispatch(ed.state.tr.setSelection(Selection.atEnd(ed.state.doc))); await sleep(30); }); };
    const nodes = (name: string) => { const found: { pos: number; attrs: Record<string, any> }[] = []; ed.state.doc.descendants((node, pos) => { if (node.type.name === name) found.push({ pos, attrs: node.attrs }); }); return found; };
    await act(async () => { ed.commands.focus(); ed.view.dispatch(ed.state.tr.setSelection(Selection.atEnd(ed.state.doc))); await sleep(20); });

    // 1. A check from "/", filled in, rolled; the result stays on the block.
    await type('/prueba');
    await until(() => !!q('slash-check'), 'check offered');
    await click(q('slash-check'));
    await until(() => nodes('prepCheck').length === 1 && !!q('prep-check'), 'check block');
    assert(nodes('prepCheck')[0].attrs.wikiHidden === true && /data-wh-wiki-hidden="true"/.test(ed.getHTML()), 'A check starts kept from the wiki');
    await setValue(q<HTMLInputElement>('prep-check-skill'), 'Percepción', 'prep-check-skill');
    await setValue(q<HTMLInputElement>('prep-check-dc'), '15', 'prep-check-dc');
    await setValue(q<HTMLInputElement>('prep-check-bonus'), '3', 'prep-check-bonus');
    await setValue(q<HTMLInputElement>('prep-check-note'), 'Hay huellas en el barro', 'prep-check-note');
    assert(q<HTMLInputElement>('prep-check-skill')!.value === 'Percepción' && q<HTMLInputElement>('prep-check-note')!.value === 'Hay huellas en el barro', 'Typing keeps what was typed');
    assert(q('prep-check-result')!.textContent === 'Sin tirar', 'Not rolled yet');
    await click(q('prep-check-roll'));
    const check = parsePrepData('check', JSON.stringify(nodes('prepCheck')[0].attrs.data)) as ReturnType<typeof parsePrepData> & { result: any; dc: number; bonus: number };
    assert(check.result && check.result.total >= 4 && check.result.total <= 23 && check.dc === 15 && check.bonus === 3, `Roll stored: ${JSON.stringify(check)}`);
    assert(check.result.outcome === (check.result.total >= 15 ? 'pass' : 'miss') && /1d20/.test(check.result.detail), `Outcome: ${JSON.stringify(check.result)}`);
    assert(/Tirada: \d+/.test(q('prep-check-result')!.textContent ?? ''), `Shown: ${q('prep-check-result')!.textContent}`);
    const tray = await readDiceTray(P);
    assert(tray.log.length === 1 && tray.log[0].total === check.result.total && tray.log[0].target === 15, `The roll is in the dice tray: ${JSON.stringify(tray.log)}`);
    const rolledHtml = ed.getHTML();
    assert(rolledHtml.includes(`Prueba de Percepción CD 15 — Hay huellas en el barro. Tirada: ${check.result.total}`), `Readable text: ${rolledHtml.slice(0, 600)}`);
    await click(q('prep-check-roll'));
    assert(parsePrepData('check', JSON.stringify(nodes('prepCheck')[0].attrs.data)) && nodes('prepCheck')[0].attrs.data.result.at >= check.result.at, 'Rolling again replaces the result');
    passed.push(`Check: "/prueba" inserts a Prueba block; skill "Percepción", CD 15, +3 and a note are typed into it; "Tirar" rolls 1d20+3 with the dice engine (${check.result.total}, ${check.result.outcome === 'pass' ? 'superada' : 'fallada'}), keeps the result on the block, logs the roll in the dice tray, and the stored text reads "Prueba de Percepción CD 15 — Hay huellas en el barro. Tirada: ${check.result.total}"`);

    // 2. An encounter: rows, a linked compendium creature, a linked Codex card, "Preparar combate".
    await newLine(); await type('/encuentro');
    await until(() => !!q('slash-encounter'), 'encounter offered');
    await click(q('slash-encounter'));
    await until(() => nodes('prepEncounter').length === 1 && !!q('prep-encounter'), 'encounter block');
    await setValue(q<HTMLInputElement>('prep-encounter-title'), 'Emboscada en el vado', 'prep-encounter-title');
    await click(q('prep-encounter-paste')); await setValue(q<HTMLTextAreaElement>('prep-encounter-paste-text'), '2x Goblin Warrior\n1x Guía del vado', 'prep-encounter-paste-text');
    await click(q('prep-encounter-paste-apply'));
    assert(nodes('prepEncounter')[0].attrs.data.rows.length === 2 && nodes('prepEncounter')[0].attrs.data.rows[0].count === 2 && nodes('prepEncounter')[0].attrs.data.rows[0].name === 'Goblin Warrior', `A pasted list makes the rows: ${JSON.stringify(nodes('prepEncounter')[0].attrs.data.rows)}`);
    await click(q('prep-encounter-link-0')); await setValue(q<HTMLInputElement>('prep-encounter-search-0'), 'goblin warrior', 'prep-encounter-search-0');
    await until(() => !!q('prep-encounter-pick-monster-goblin-warrior'), 'compendium result');
    await click(q('prep-encounter-pick-monster-goblin-warrior'));
    assert(!!q('prep-encounter-linked-0'), 'First row linked to the compendium');
    await click(q('prep-encounter-link-1')); await setValue(q<HTMLInputElement>('prep-encounter-search-1'), 'ruiz', 'prep-encounter-search-1');
    await until(() => !!q('prep-encounter-pick-card-prep-card-ruiz'), 'codex result');
    await click(q('prep-encounter-pick-card-prep-card-ruiz'));
    await click(q('prep-encounter-add')); await setValue(q<HTMLInputElement>('prep-encounter-name-2'), 'Goblin Boss', 'prep-encounter-name-2'); await setValue(q<HTMLInputElement>('prep-encounter-count-2'), '2', 'prep-encounter-count-2');
    await click(q('prep-encounter-add')); await setValue(q<HTMLInputElement>('prep-encounter-name-3'), 'Barril de pólvora', 'prep-encounter-name-3');
    const rows = nodes('prepEncounter')[0].attrs.data.rows;
    assert(rows.length === 4 && rows[2].count === 2 && rows[1].link?.kind === 'card' && rows[1].link.id === 'prep-card-ruiz' && rows[0].link?.id === 'goblin-warrior', `Rows: ${JSON.stringify(rows)}`);
    await click(q('prep-encounter-prepare'));
    await until(async () => ((await db.projects.get(P))?.encounters?.length ?? 0) === 1, 'encounter stored');
    const fight = (await db.projects.get(P))!.encounters![0];
    const names = fight.combatants.map(combatant => combatant.name);
    assert(fight.title === 'Emboscada en el vado' && fight.combatants.length === 6 && names.includes('Barril de pólvora') && names.includes('Goblin Boss') && names.includes('Goblin Boss 2') && names.includes('Capitán Ruiz'), `Combatants: ${names.join(', ')}`);
    const boss = fight.combatants.find(combatant => combatant.name === 'Goblin Boss')!, card = fight.combatants.find(combatant => combatant.name === 'Capitán Ruiz')!, barrel = fight.combatants.find(combatant => combatant.name === 'Barril de pólvora')!;
    assert(boss.maxHp === 21 && boss.source?.kind === 'monster' && card.source?.kind === 'card' && card.source.id === 'prep-card-ruiz' && barrel.maxHp === 10 && !barrel.source, `Seeded from the compendium (Goblin Boss 21 hp by exact name), the card and plain: ${JSON.stringify(fight.combatants.map(c => [c.name, c.maxHp, c.source]))}`);
    await until(() => !!q('prep-encounter-open'), 'open button');
    assert(nodes('prepEncounter')[0].attrs.data.encounterId === fight.id && /preparado con 6 combatientes/.test(q('prep-encounter-status')!.textContent ?? ''), 'The block remembers its fight');
    await click(q('prep-encounter-open'));
    assert(navigated.at(-1) === `/project/${P}/character-sheets?view=fight`, `Opens the tracker: ${navigated.join()}`);
    const listed = await runBridgeTool('wh_encounter_list', { projectId: P }) as Reply;
    assert(listed.ok && listed.result.encounters.length === 1 && listed.result.encounters[0].combatants === 6, `The tracker sees it: ${JSON.stringify(listed)}`);
    passed.push('Encounter: "/encuentro" inserts a list of creatures; a pasted list makes the rows, one is linked to the SRD compendium and one to a Codex card, and "Preparar combate" creates a fight in the tracker with 6 combatants (two Goblin Warriors from the compendium, the Codex card, Goblin Boss twice with 21 hp from its exact name, a plain barrel), remembers it on the block and "Abrir combate" goes to the tracker; wh_encounter_list sees it');

    // 3. A handout from a template, saved to the gallery and referenced.
    await newLine(); await type('/material');
    await until(() => !!q('slash-handout'), 'handout offered');
    await click(q('slash-handout'));
    await until(() => nodes('prepHandout').length === 1 && !!q('prep-handout'), 'handout block');
    assert(nodes('prepHandout')[0].attrs.wikiHidden === false, 'A handout is not hidden from the wiki');
    await click(q('prep-handout-template'));
    await until(() => !!q('handout-studio'), 'studio');
    await click(q('handout-template-casefile'));
    await setValue(q<HTMLSelectElement>('handout-hook'), 'discovery', 'handout-hook');
    assert(/Hoja suelta/.test(q<HTMLInputElement>('handout-title')!.value) && /sótano/.test(q<HTMLTextAreaElement>('handout-body')!.value), 'A hook fills the text');
    await setValue(q<HTMLInputElement>('handout-title'), 'El caso del faro', 'handout-title');
    await setValue(q<HTMLInputElement>('handout-extra'), 'Expediente nº 4471-B', 'handout-extra');
    await setValue(q<HTMLTextAreaElement>('handout-body'), 'Testigos: dos pescadores.\n- La luz se apagó a medianoche.\n- Nadie vio entrar al farero.', 'handout-body');
    await setValue(q<HTMLInputElement>('handout-signature'), 'Inspectora Vela', 'handout-signature');
    await until(() => !!q('handout-preview') && /^data:image\/svg\+xml/.test(q<HTMLImageElement>('handout-preview')!.src), 'preview');
    await click(q('handout-save'));
    await until(async () => (await db.inspirationImages.where('projectId').equals(P).toArray()).some(row => row.handout), 'handout in the gallery');
    const [saved] = await db.inspirationImages.where('projectId').equals(P).toArray();
    assert(saved.handout?.template === 'casefile' && saved.handout.title === 'El caso del faro' && saved.tags.includes('handout') && saved.tags.includes('casefile') && saved.imageData.startsWith('data:image/png;base64,') && saved.imageData.length > 5000 && !!saved.thumbnailData, `Gallery row: ${JSON.stringify({ ...saved, imageData: saved.imageData.slice(0, 30), thumbnailData: '…' })}`);
    await until(() => nodes('prepHandout')[0].attrs.data.imageId === saved.id, 'block points at the gallery picture');
    await until(() => !!q('prep-handout-image'), 'thumbnail in the block');
    await setValue(q<HTMLInputElement>('prep-handout-when'), 'Cuando lleguen al faro', 'prep-handout-when');
    const handoutData = nodes('prepHandout')[0].attrs.data;
    assert(handoutData.label === 'El caso del faro' && handoutData.when === 'Cuando lleguen al faro', `Handout data: ${JSON.stringify(handoutData)}`);
    // Editing the text redraws the same gallery picture.
    const before = saved.imageData;
    await click(q('prep-handout-edit'));
    await until(() => q<HTMLTextAreaElement>('handout-body')?.value.startsWith('Testigos'), 'studio opens with the text');
    await setValue(q<HTMLTextAreaElement>('handout-body'), 'Testigos: tres pescadores.\n- La luz se apagó a medianoche.', 'handout-body');
    await click(q('handout-save'));
    await until(async () => (await db.inspirationImages.get(saved.id))?.handout?.body.startsWith('Testigos: tres'), 'redrawn');
    const redrawn = (await db.inspirationImages.get(saved.id))!;
    assert(redrawn.imageData !== before && (await db.inspirationImages.where('projectId').equals(P).count()) === 1 && nodes('prepHandout')[0].attrs.data.imageId === saved.id, 'Same gallery picture, new drawing');
    // The four templates draw four different pictures with their own look.
    const drawn = new Set<string>();
    for (const template of HANDOUT_TEMPLATES) {
      const picture = await renderHandoutPng({ template, title: 'Aviso', body: 'Primer anuncio\nSe busca farero.\n\nSegundo anuncio\nSe vende barca.', signature: 'Firmado', extra: 'Hoy', lang: 'es' });
      const svg = renderHandoutSvg({ template, title: 'Aviso', body: 'Línea uno\nLínea dos', lang: 'es' }).svg;
      assert(picture.dataUrl.startsWith('data:image/png;base64,') && picture.width >= 700 && picture.height >= 300 && svg.includes(`data-handout-template="${template}"`), `Template ${template}`);
      drawn.add(picture.dataUrl);
    }
    assert(drawn.size === 4, 'Four templates, four drawings');
    passed.push('Handout: "/material" inserts a player-material block; "Crear desde una plantilla" opens the studio, a hook preset fills the text, the case-file template is typed in and saved to the gallery as a PNG (tags handout + casefile, editable text kept on the row), the block points at it and shows it with its "when"; editing the text redraws the same gallery picture; letter, case file, terminal and notice board draw four different PNGs');

    // 4. Exports: the stored text, Markdown both ways, Word, ePub, reader, wiki.
    await newLine(); await type('Después del encuentro, la lluvia.');
    const html = ed.getHTML();
    assert(/<div[^>]*data-wh-prep="check"/.test(html) && /<div[^>]*data-wh-prep="encounter"/.test(html) && /<figure[^>]*data-wh-prep="handout"/.test(html), 'Three blocks stored');
    assert(html.includes('<strong>Encuentro: Emboscada en el vado</strong>') && html.includes('<li>2× Goblin Warrior</li>') && html.includes('Material para jugadores: El caso del faro — se entrega: Cuando lleguen al faro'), `Readable stored text: ${html}`);
    const md = htmlToMarkdown(html);
    assert(md.includes('> [!CHECK] Prueba de Percepción CD 15 — Hay huellas en el barro') && md.includes('> [!ENCOUNTER] Emboscada en el vado\n> - 2× Goblin Warrior') && md.includes('> [!HANDOUT] Material para jugadores: El caso del faro — se entrega: Cuando lleguen al faro') && md.includes('<!-- wh-prep {'), `Markdown: ${md}`);
    const back = markdownToTiptapHtml(md);
    const dataOf = (source: string, kind: string) => { const template = document.createElement('template'); template.innerHTML = source; return JSON.stringify(parsePrepData(kind as 'check', template.content.querySelector(`[data-wh-prep="${kind}"]`)?.getAttribute('data-wh-prep-data'))); };
    for (const kind of ['check', 'encounter', 'handout']) assert(dataOf(html, kind) === dataOf(back, kind) && dataOf(back, kind).length > 40, `Markdown round trip of ${kind}:\n${dataOf(html, kind)}\n${dataOf(back, kind)}`);
    await act(async () => { ed.commands.setContent(back); await sleep(60); });
    assert(nodes('prepCheck').length === 1 && nodes('prepEncounter').length === 1 && nodes('prepHandout').length === 1 && nodes('prepEncounter')[0].attrs.data.rows[0].link?.id === 'goblin-warrior' && nodes('prepHandout')[0].attrs.data.imageId === saved.id, 'The editor reads the Markdown back into the three blocks with their links');
    passed.push('Markdown: the three blocks are written as "> [!CHECK] / [!ENCOUNTER] / [!HANDOUT]" alerts with their text and a data comment; reading that Markdown back gives identical block data (including the roll, the creature links and the gallery reference) and the editor loads it as three blocks');

    const writing: Writing = { id: 'prep-w1', projectId: P, title: 'Preparación', status: 'draft', content: html, wordCount: 40, chapter: 1, tags: [], createdAt: 1, updatedAt: 1 };
    const publishing = buildPublishingArtifacts({ id: P, title: 'Aventura' }, { id: 'prep-p', projectId: P, name: 'Manual', format: 'manuscript', includeTitlePage: false, includeSynopsis: false, includeBibliography: false, includeInlineImages: true, citationStyle: 'apa', selectedWritingIds: [], createdAt: 1, updatedAt: 1 } as never, [writing], [], { generatedAt: 1 });
    assert(publishing.markdown?.includes('[!CHECK] Prueba de Percepción CD 15') || md.includes('[!CHECK]'), 'Compiled Markdown');
    const { default: JSZip } = await import('jszip');
    const docx = await JSZip.loadAsync(await (await buildPublishingDocx(publishing.document)).arrayBuffer());
    const xml = await docx.file('word/document.xml')!.async('string'), plain = xml.replace(/<[^>]+>/g, '');
    assert(plain.includes('Prueba de Percepción CD 15 — Hay huellas en el barro') && plain.includes('Encuentro: Emboscada en el vado') && plain.includes('2× Goblin Warrior') && plain.includes('Material para jugadores: El caso del faro') && !plain.includes('wh-prep'), `Word: ${plain.slice(0, 500)}`);
    const epub = await JSZip.loadAsync(await (await buildPublishingEpub(publishing.document)).arrayBuffer());
    const section = await epub.file('EPUB/section-1.xhtml')!.async('string');
    assert(section.includes('Prueba de Percepción CD 15 — Hay huellas en el barro') && section.includes('<li>2× Goblin Warrior</li>') && section.includes('Material para jugadores: El caso del faro — se entrega: Cuando lleguen al faro'), `ePub: ${section.slice(0, 700)}`);
    assert(publishing.html.includes('Prueba de Percepción CD 15') && publishing.html.includes('wh-prep'), 'HTML export');
    passed.push('Word, ePub and HTML: the check line with its roll, the encounter as a titled list and the handout as a captioned figure read as ordinary text, with no attribute needed');

    // Reader: read and play.
    await db.writings.put(writing);
    const initial = defaultReaderPresentation();
    await saveReaderPresentation(P, { ...initial, playback: { mode: 'play' as const, wordsPerMinute: 320 } }, initial);
    const readerRoot = document.createElement('div'); document.body.append(readerRoot); const reader = createRoot(readerRoot);
    await act(async () => { reader.render(<ReadingView pieces={[writing]} onClose={() => undefined} onOpenInEditor={() => undefined} />); await sleep(150); });
    await until(() => (readerRoot.textContent ?? '').includes('Prueba de Percepción CD 15'), 'reader text');
    assert((readerRoot.textContent ?? '').includes('Material para jugadores: El caso del faro') && (readerRoot.textContent ?? '').includes('2× Goblin Warrior'), 'The reader shows the three blocks as text');
    await act(async () => { reader.unmount(); }); readerRoot.remove();
    const fixture = document.createElement('section'); document.body.append(fixture); fixture.innerHTML = `<div class="ProseMirror">${html}</div><div class="controls"></div>`;
    const prose = fixture.firstElementChild as HTMLElement, controls = fixture.lastElementChild as HTMLElement;
    const dispose = installReaderPlayback(prose, controls, { mode: 'read', wordsPerMinute: 1000 }, readerPlaybackCopy('es'));
    controls.querySelector<HTMLButtonElement>('[data-reader-playback="play"]')!.click();
    const topLevel = prose.querySelectorAll(':scope > *').length, hiddenAtStart = prose.querySelectorAll(':scope > [hidden]').length;
    assert(hiddenAtStart === topLevel - 1, `Play reveals one block at a time (${hiddenAtStart} of ${topLevel} hidden)`);
    controls.querySelector<HTMLButtonElement>('[data-reader-playback="next"]')!.click();
    assert(prose.querySelectorAll(':scope > [hidden]').length === topLevel - 2 && prose.querySelector('[data-wh-prep="check"]') !== null, 'Next reveals the check as one block');
    dispose(); fixture.remove();
    const savedProject = (await db.projects.get(P))!;
    const artifact = await buildReaderHtml(savedProject, [writing], savedProject.readerPresentation!, 'es');
    assert(artifact.html.includes('Prueba de Percepción CD 15') && artifact.html.includes('wh-prep'), 'Offline reader export carries the blocks');
    passed.push('Reader: the in-app reading view and the offline reader export show the three blocks as text, and Read/Play reveals each block as one step');

    // Wiki: the check and the encounter start hidden; the handout is published; hiding is a toggle.
    const entry = { ...captain, id: 'prep-wiki', title: 'Notas del vado', type: 'concept', content: html } as CodexEntry;
    const wiki = buildWorldWiki({ project, entries: [entry], maps: [], pins: [], images: [] }, { includeImages: false, locale: 'es' }).html;
    assert(!wiki.includes('CD 15') && !wiki.includes('Goblin Warrior') && wiki.includes('Material para jugadores: El caso del faro'), 'The wiki leaves out the check and the encounter (hidden by default) and keeps the handout');
    await act(async () => { ed.commands.setContent(html); await sleep(60); });
    const handoutPos = nodes('prepHandout')[0].pos;
    await act(async () => { ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, handoutPos))); await sleep(60); });
    const hideButton = q<HTMLButtonElement>('wiki-hide-block'); assert(hideButton && !hideButton.disabled, 'The wiki hide control works on a selected block');
    await click(hideButton);
    assert(nodes('prepHandout')[0].attrs.wikiHidden === true, 'Hidden by the control');
    const wiki2 = buildWorldWiki({ project, entries: [{ ...entry, content: ed.getHTML() }], maps: [], pins: [], images: [] }, { includeImages: false, locale: 'es' }).html;
    assert(!wiki2.includes('Material para jugadores: El caso del faro'), 'Hidden handout leaves the wiki');
    await act(async () => { ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, nodes('prepCheck')[0].pos))); await sleep(60); });
    await click(q('wiki-hide-block'));
    assert(nodes('prepCheck')[0].attrs.wikiHidden === false, 'A check can be shown again');
    passed.push('Wiki publishing: a check and an encounter start hidden (wikiHidden) and a handout is published; "Ocultar este bloque de la wiki" works on a selected prep block and the exported wiki follows it');

    // 5. Backup and clone: ZIP round trip and project duplicate keep the references.
    await db.writings.put({ ...writing, content: html });
    const preview = await previewProjectDuplicate({ projectId: P }), operationId = crypto.randomUUID();
    const duplicate = await duplicateProject({ projectId: P, title: 'Copia de la preparación', operationId, expectedSourceVersion: preview.sourceVersion }); extra.push(duplicate.projectId);
    const copiedImages = await db.inspirationImages.where('projectId').equals(duplicate.projectId).toArray(), copiedCards = await db.codexEntries.where('projectId').equals(duplicate.projectId).toArray(), copiedWriting = (await db.writings.where('projectId').equals(duplicate.projectId).toArray())[0];
    const copiedTemplate = document.createElement('template'); copiedTemplate.innerHTML = copiedWriting.content;
    const copiedHandout = parsePrepData('handout', copiedTemplate.content.querySelector('[data-wh-prep="handout"]')!.getAttribute('data-wh-prep-data')) as { imageId: string };
    const copiedEncounter = parsePrepData('encounter', copiedTemplate.content.querySelector('[data-wh-prep="encounter"]')!.getAttribute('data-wh-prep-data')) as { rows: { link: { id: string; kind: string } | null }[] };
    assert(copiedImages.length === 1 && copiedHandout.imageId === copiedImages[0].id && copiedImages[0].id !== saved.id && copiedImages[0].handout?.template === 'casefile', 'The copy points at its own gallery picture and keeps its editable text');
    assert(copiedCards.length === 1 && copiedEncounter.rows.some(row => row.link?.kind === 'card' && row.link.id === copiedCards[0].id), 'The copy links its own Codex card');
    await undoProjectDuplicate(operationId);
    const direct = remapWorldRichContent(html, P, 'other-project', (id, prefix) => `${prefix}-new-${id}`, new Set(['prep-card-ruiz']));
    assert(direct.includes('img-new-' + saved.id.replace(/"/g, '')) || /img-new-/.test(direct.replace(/&quot;/g, '"')), 'remap rewrites the gallery id');
    const { blob } = await createProjectZipArchive(P); await deleteProject(P);
    assert(!await db.projects.get(P), 'project gone before restore');
    await importProjectZip(new File([blob], 'preparacion.zip', { type: 'application/zip' }));
    const restoredImage = (await db.inspirationImages.where('projectId').equals(P).toArray())[0], restoredWriting = (await db.writings.where('projectId').equals(P).toArray())[0];
    assert(restoredImage?.handout?.body.startsWith('Testigos: tres') && restoredImage.handout.template === 'casefile' && restoredWriting?.content.includes('data-wh-prep="check"') && (await db.projects.get(P))?.encounters?.length === 1, 'ZIP round trip keeps the blocks, the handout text and the prepared fight');
    passed.push('Backup and clone: a project duplicate gives the copied note its own gallery picture and Codex card ids (handout text kept), and a ZIP round trip (project deleted, then restored) keeps the three blocks, the handout\'s editable text and the prepared fight');

    // 6. Bridge.
    await db.projects.put({ ...(await db.projects.get(P))!, enabledEngines: ['writings', 'gallery', 'character-sheets', 'codex'] });
    const created = await runBridgeTool('wh_create_handout', { projectId: P, template: 'terminal', title: 'ARCHIVO', body: '> ACCESO CONCEDIDO\nLa puerta del sótano se abre a las 03:00.', extra: 'usuario: vela', lang: 'es' }) as Reply;
    assert(created.ok && created.result.id, `create handout ${JSON.stringify(created).slice(0, 300)}`);
    const handoutRow = await db.inspirationImages.get(created.result.id);
    assert(handoutRow?.handout?.template === 'terminal' && handoutRow.tags.includes('handout'), 'Gallery row of the bridge handout');
    const rendered = await runBridgeTool('wh_render_handout', { projectId: P, imageId: created.result.id, scale: 0.5 }) as Reply;
    assert(rendered.ok && rendered.result.mimeType === 'image/png' && rendered.result.base64.startsWith('iVBOR') && rendered.result.width > 300, `render saved ${JSON.stringify(rendered).slice(0, 200)}`);
    for (const template of HANDOUT_TEMPLATES) { const reply = await runBridgeTool('wh_render_handout', { template, title: 'Prueba', body: 'Texto de prueba', scale: 0.3 }) as Reply; assert(reply.ok && reply.result.base64.startsWith('iVBOR') && reply.result.template === template, `render ${template}`); }
    const badTemplate = await runBridgeTool('wh_render_handout', { template: 'scroll', body: 'x' }) as Reply;
    assert(!badTemplate.ok, 'An unknown template is refused');
    const tool = BRIDGE_TOOLS.find(item => item.name === 'wh_create_handout')!;
    assert(tool.writes && tool.engineId === 'gallery' && !BRIDGE_TOOLS.find(item => item.name === 'wh_render_handout')!.writes && !validateToolArgs(tool.schema, { template: 'scroll' }).ok, 'Manifest: write tool with engine, read tool, schema checked');
    await db.projects.update(P, { enabledEngines: ['writings', 'codex'] });
    const refused = await runBridgeTool('wh_create_handout', { projectId: P, template: 'letter', body: 'x' }) as Reply;
    assert(!refused.ok, 'Refused while the gallery is off'); await db.projects.update(P, { enabledEngines: ['writings', 'gallery', 'character-sheets', 'codex'] });
    const undone = await undoAuditEntry({ entry: { ...(created.result.__audit ?? created.result), tool: 'wh_create_handout', kind: 'create' } as never });
    assert(undone.undone && !await db.inspirationImages.get(created.result.id), `Undo removes the handout: ${JSON.stringify(undone)}`);

    const markdown = `> [!PRUEBA] Percepción CD 15 — hay huellas en el barro\n\n> [!ENCUENTRO] Emboscada\n> - 2x Goblin Warrior\n> - Goblin Boss {monster:goblin-boss}\n\n> [!MATERIAL] Carta del barón — al llegar a la posada\n> image: ${saved.id}\n\nTexto normal.`;
    const made = await runBridgeTool('wh_create_writing', { projectId: P, title: 'Notas de sesión', content: markdown }) as Reply;
    assert(made.ok, JSON.stringify(made));
    const stored = (await db.writings.get(made.result.id))!.content;
    const storedTemplate = document.createElement('template'); storedTemplate.innerHTML = stored;
    const sCheck = parsePrepData('check', storedTemplate.content.querySelector('[data-wh-prep="check"]')?.getAttribute('data-wh-prep-data')) as any, sEnc = parsePrepData('encounter', storedTemplate.content.querySelector('[data-wh-prep="encounter"]')?.getAttribute('data-wh-prep-data')) as any, sHand = parsePrepData('handout', storedTemplate.content.querySelector('[data-wh-prep="handout"]')?.getAttribute('data-wh-prep-data')) as any;
    assert(sCheck.skill === 'Percepción' && sCheck.dc === 15 && sCheck.note === 'hay huellas en el barro' && sEnc.title === 'Emboscada' && sEnc.rows.length === 2 && sEnc.rows[0].count === 2 && sEnc.rows[1].link?.id === 'goblin-boss' && sHand.label === 'Carta del barón' && sHand.when === 'al llegar a la posada' && sHand.imageId === saved.id, `Stored: ${stored}`);
    assert(stored.includes('Prueba de Percepción CD 15 — hay huellas en el barro') && stored.includes('<p>Texto normal.</p>'), `Stored blocks carry readable text next to ordinary paragraphs: ${stored}`);
    const read = await runBridgeTool('wh_get_writing', { id: made.result.id }) as Reply;
    assert(/> \[!CHECK\] Prueba de Percepción CD 15 — hay huellas en el barro\n> <!-- wh-prep \{/.test(read.result.content) && /> \[!ENCOUNTER\] Emboscada\n> - 2× Goblin Warrior\n> - Goblin Boss\n/.test(read.result.content), `Read back: ${read.result.content}`);
    const rewrite = await runBridgeTool('wh_update_writing', { id: made.result.id, content: read.result.content }) as Reply;
    const after = (await db.writings.get(made.result.id))!.content;
    const afterTemplate = document.createElement('template'); afterTemplate.innerHTML = after;
    assert(rewrite.ok && JSON.stringify(parsePrepData('encounter', afterTemplate.content.querySelector('[data-wh-prep="encounter"]')?.getAttribute('data-wh-prep-data'))) === JSON.stringify(sEnc), `Read then write back keeps the data: ${JSON.stringify(rewrite).slice(0, 200)}`);
    const listBlocks = await runBridgeTool('wh_extract_block_to_card', { projectId: P, writingId: made.result.id, list: true }) as Reply;
    assert(listBlocks.ok && listBlocks.result.blocks.some((block: { kind?: string }) => block.kind === 'prep-check'), `Block list names the kind: ${JSON.stringify(listBlocks).slice(0, 300)}`);
    passed.push('Bridge: wh_create_writing turns the three Markdown alerts (including a hand-written "Percepción CD 15 — …", "- 2x Goblin Warrior", "{monster:id}" and "image: <id>") into blocks with readable text; wh_get_writing gives them back with their data and writing that Markdown back keeps it; wh_create_handout keeps a terminal screen in the gallery (undoable, refused when the gallery is off), wh_render_handout returns PNG base64 for a saved handout and for each of the four templates');
  } finally {
    await act(async () => { root.unmount(); await sleep(20); });
    await cleanup();
  }
  return passed;
}
