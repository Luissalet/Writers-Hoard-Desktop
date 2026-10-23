// Revealing Codex cards to the players: the marker, the card dialog / editor / Consult panel buttons,
// badge and filter, the player view, the "only what is revealed" wiki policy, backup and clone, and
// the wh_set_revealed bridge tool (undo, stale-undo refusal, engine-off refusal).
import '@/engines';
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { db } from '@/db';
import { createProject, deleteProject, exportProjectData, importProjectData, updateProject } from '@/db/operations';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import type { CodexEntry, Project, WorldMap } from '@/types';
import WikiExportControl from '@/engines/codex/WikiExportControl';
import CodexEngine from '@/engines/codex/CodexEngine';
import ReferencePanel from '@/engines/writings/components/ReferencePanel';
import { setReferenceOpen, useReferencePrefs } from '@/engines/writings/components/referencePrefs';
import { codexDraftStore } from '@/components/codex/codexDrafts';
import { saveCodexTemplate } from '@/engines/codex/templates';
import { isRevealed, readReveal } from '@/engines/codex/revealModel';
import { revealCopy } from '@/engines/codex/revealCopy';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { BRIDGE_TOOLS } from '@/services/aiBridge/manifest';
import { saveWikiProfile, getWikiProfile, publishWikiProfile, getWikiEdition } from '@/services/wikiProfiles/store';
import { wikiProfileChanges } from '@/services/wikiProfiles/changes';
import { validateWikiOptions } from '@/services/wikiProfiles/validation';
import { buildWorldWiki, loadWorldWikiData } from '@/services/worldWikiExport';
import { saveWorldEra, readWorldDocument } from '@/services/worldEras/store';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { useLocaleStore } from '@/stores/localeStore';
import type { WorldWikiOptions } from '@/types/worldWiki';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
const P = 'codex-reveal-main';
const SECRET_BLOCK = 'SECRETPLOTBLOCK', SPOILER = 'TWISTSPOILERTEXT', SECRET_FIELD = 'FIELDSECRETVALUE', PRIVATE_TYPE_CARD = 'PrivateTypeVault';
const card = (id: string, title: string, extra: Partial<CodexEntry> = {}): CodexEntry => ({ id: `${P}-${id}`, projectId: P, type: 'character', title, fields: {}, content: `<p>${title} public line.</p>`, tags: [], relations: [], createdAt: 10, updatedAt: 10, ...extra });
const build = async (options: WorldWikiOptions) => { const o = { locale: 'en' as const, ...options }; return buildWorldWiki(await loadWorldWikiData(P, o), o).html; };
const plain = (html: string) => html.replace(/nonce[-=]"?[0-9a-f]{36}/g, 'nonce-N').replace(/(<script[^>]*>)([\s\S]*?)(<\/script>)/g, (_all, open: string, body: string, close: string) => open + body.replace(/\b([A-Za-z_]+)\d+\b/g, '$1N') + close);

export async function testCodexReveal(): Promise<string[]> {
  const passed: string[] = [], host = document.getElementById('root'); assert(host, 'Missing root');
  const root = createRoot(host), es = revealCopy.es, en = revealCopy.en;
  useLocaleStore.setState({ locale: 'es', loaded: true });
  const render = async (node: React.ReactNode) => { await act(async () => { root.render(<StrictMode><MemoryRouter>{node}</MemoryRouter></StrictMode>); await pause(120); }); await act(async () => { await pause(); }); };
  const until = async (check: () => unknown | Promise<unknown>, label: string, tries = 120) => { for (let i = 0; i < tries; i++) { if (await check()) return; await act(async () => { await pause(50); }); } throw new Error('Timed out: ' + label); };
  const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const qa = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
  const click = async (element: Element | null | undefined, label: string) => { assert(element, 'Missing ' + label); await act(async () => { (element as HTMLElement).click(); await pause(); }); await act(async () => { await pause(); }); };
  const type = async (input: HTMLInputElement | null, value: string) => { assert(input, 'Missing input'); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); await pause(); }); };
  const titles = () => qa('codex-card').map(node => node.querySelector('h3')?.textContent ?? '');
  const row = (id: string) => db.codexEntries.get(`${P}-${id}`);
  const cleanup = async () => { for (const id of [P, P + '-clone', P + '-zip', P + '-off']) { codexDraftStore(id).clear(); await db.codexEntries.where('projectId').equals(id).delete(); await db.worldMaps.where('projectId').equals(id).delete(); await db.projects.delete(id); } };
  const cloneIds: string[] = [];
  try {
    await cleanup();
    const project: Project = { id: P, title: 'Reveal', description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#c4973b', enabledEngines: ['codex', 'writings'], engineOrder: ['codex', 'writings'], createdAt: 1, updatedAt: 1, wikiOptions: { excludedFields: ['hiddenfield'] } };
    await db.projects.put(project);
    const privateType = await saveCodexTemplate(P, { id: 'private-type', name: 'Vault', category: 'custom', fields: {}, content: '', revision: 0, createdAt: 1, updatedAt: 1, privateType: true }, null);
    await db.codexEntries.bulkPut([
      card('vane', 'Lord Vane', { fields: { role: 'Chancellor', hiddenfield: SECRET_FIELD }, content: `<p>Public line about Vane.</p><p data-wh-wiki-hidden="true">${SECRET_BLOCK}</p><p>Before <span data-wh-wiki-spoiler="true">${SPOILER}</span> after.</p>` }),
      card('harbour', 'Harbour Town', { type: 'location' }),
      card('tower', 'Old Tower', { type: 'location', revealed: { at: 1000, moment: 'Session 1' } }),
      card('vault', PRIVATE_TYPE_CARD, { type: 'custom', templateId: privateType.id, revealed: { at: 2000 } }),
    ]);
    await db.worldMaps.put({ id: P + '-map', projectId: P, title: 'Sea chart', createdAt: 1, updatedAt: 1 } as WorldMap);

    // 0. The marker is read defensively.
    assert(!isRevealed({}) && !isRevealed({ revealed: 'yes' }) && !isRevealed({ revealed: { at: 'x' } }) && !isRevealed({ revealed: [] }) && isRevealed({ revealed: { at: 5 } }), 'Malformed markers must read as not revealed');
    assert(readReveal({ at: 5, note: '  hi  ', moment: ' ' })!.note === 'hi' && readReveal({ at: 5, moment: ' ' })!.moment === undefined, 'Marker text is trimmed and empty text dropped');
    passed.push('Marker: absent, malformed and non-object values read as not revealed; note and moment are trimmed');

    // 1. Card dialog: badge, reveal with a moment, hide again.
    await render(<CodexEngine projectId={P} />);
    await until(() => titles().length === 4, 'four cards listed');
    assert(qa('codex-revealed-badge').length === 2, 'Only the two pre-revealed cards carry the badge, got ' + qa('codex-revealed-badge').length);
    assert(qa('codex-card').find(node => node.dataset.entryId === `${P}-tower`)?.querySelector('[data-testid="codex-revealed-badge"]')?.textContent?.includes(es.badge), 'Badge reads "Revelada"');
    await click(qa('codex-card').find(node => node.dataset.entryId === `${P}-harbour`), 'Harbour card');
    await until(() => q('codex-reveal-toggle'), 'reveal button in the card dialog');
    assert(q('codex-reveal-toggle')!.textContent?.trim() === es.reveal && q('codex-reveal')!.dataset.revealed === 'false', 'Unrevealed card offers "Revelar a los jugadores"');
    await type(q('codex-reveal-moment') as HTMLInputElement, 'Sesión 3');
    await click(q('codex-reveal-toggle'), 'reveal');
    await until(async () => (await row('harbour'))?.revealed, 'harbour revealed in the database');
    const marker = (await row('harbour'))!.revealed!;
    assert(typeof marker.at === 'number' && marker.moment === 'Sesión 3' && !marker.note, 'The marker stores the time and the moment typed');
    await until(() => q('codex-reveal')?.dataset.revealed === 'true' && q('codex-reveal-toggle')?.textContent?.trim() === es.hide, 'dialog shows the hide button');
    assert(q('codex-reveal-state')!.textContent!.includes('Sesión 3'), 'The state shows where it happened');
    await click(q('codex-reveal-toggle'), 'hide again');
    await until(async () => !isRevealed((await row('harbour'))!), 'harbour hidden again');
    assert(!('revealed' in (await row('harbour'))!), 'Hiding removes the marker from the record instead of leaving an empty key');
    await click(q('codex-reveal-toggle'), 'reveal again (no moment)');
    await until(async () => (await row('harbour'))?.revealed, 'harbour revealed again');
    assert((await row('harbour'))!.revealed!.moment === undefined, 'A second reveal without a moment carries none');
    passed.push('Card dialog: "Revelar a los jugadores" stores {at, moment}, "Ocultar de nuevo" removes the key, the state names the moment');

    // 2. Badge and filter in the list.
    document.querySelector<HTMLElement>('[role="dialog"] button[aria-label], [role="dialog"] button')?.blur();
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await pause(150); });
    await until(() => !document.querySelector('[role="dialog"]'), 'dialog closed');
    await until(() => qa('codex-revealed-badge').length === 3, 'badge on the freshly revealed card');
    await click(q('codex-reveal-filter-revealed'), 'filter revealed');
    assert(titles().sort().join('|') === ['Harbour Town', 'Old Tower', PRIVATE_TYPE_CARD].sort().join('|'), 'Only revealed cards after "Solo reveladas": ' + titles());
    await click(q('codex-reveal-filter-unrevealed'), 'filter unrevealed');
    assert(titles().join('|') === 'Lord Vane', 'Only unrevealed cards after "Sin revelar": ' + titles());
    assert(q('codex-reveal-filter-unrevealed')!.textContent === es.filterUnrevealed && q('codex-reveal-filter-revealed')!.textContent === es.filterRevealed, 'Filter labels are the Spanish copy');
    await click(q('codex-reveal-filter-all'), 'filter all');
    assert(titles().length === 4, 'All cards again');
    passed.push('List: badge "Revelada" on revealed cards, filter Solo reveladas / Sin revelar / Todas');

    // 3. Player view.
    await click(q('codex-player-view'), 'player view on');
    await until(() => qa('codex-card').length === 2, 'player view lists two cards');
    assert(titles().sort().join('|') === 'Harbour Town|Old Tower', 'Player view lists only revealed cards of a public type: ' + titles());
    assert(!qa('codex-revealed-badge').length && q('codex-reveal-filter')?.hidden === true, 'Player view shows no DM controls');
    // Reveal Lord Vane behind the scenes: his hidden block, spoiler and excluded field must still stay out.
    await db.codexEntries.update(`${P}-vane`, { revealed: { at: 3000 } });
    await act(async () => { notifyDataChanged({ source: 'other', projectId: P, table: 'codexEntries' }); await pause(200); });
    await until(() => titles().includes('Lord Vane'), 'Lord Vane appears once revealed');
    await click(qa('codex-card').find(node => node.dataset.entryId === `${P}-vane`), 'Vane in player view');
    await until(() => q('codex-player-card'), 'player card');
    const dialog = document.querySelector('[role="dialog"]')!.textContent!;
    assert(dialog.includes('Public line about Vane') && dialog.includes('Chancellor'), 'Player card shows the public line and a public field');
    assert(!dialog.includes(SECRET_BLOCK) && !dialog.includes(SPOILER) && !dialog.includes(SECRET_FIELD), 'Player card hides the wiki-hidden block, the spoiler text and the excluded field');
    assert(!q('codex-reveal-toggle') && ![...document.querySelectorAll('[role="dialog"] button')].some(b => b.textContent?.trim() === 'Editar'), 'Player card has no reveal, edit or delete controls');
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await pause(150); });
    await click(q('codex-player-view'), 'player view off');
    await until(() => titles().length === 4, 'all cards after leaving the player view');
    await click(qa('codex-card').find(node => node.dataset.entryId === `${P}-vane`), 'Vane as author');
    await until(() => document.querySelector('[role="dialog"]')?.textContent?.includes(SECRET_BLOCK) || document.querySelector('[role="dialog"]')?.textContent?.includes('Chancellor'), 'author view still shows everything');
    assert(document.querySelector('[role="dialog"]')!.textContent!.includes(SECRET_FIELD), 'The author sees the secret field');
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await pause(150); });
    passed.push('Player view: only revealed cards of public types; hidden blocks, spoiler text and excluded fields never reach the page; no edit controls; the author view is unchanged');

    // 4. Card editor header: reveal from the form, and saving the form keeps the marker.
    await db.codexEntries.update(`${P}-vane`, { revealed: undefined });
    await act(async () => { notifyDataChanged({ source: 'other', projectId: P, table: 'codexEntries' }); await pause(200); });
    await until(() => qa('codex-card').find(node => node.dataset.entryId === `${P}-vane`) && !qa('codex-card').find(node => node.dataset.entryId === `${P}-vane`)!.querySelector('[data-testid="codex-revealed-badge"]'), 'Vane unrevealed in the list');
    await click(qa('codex-card').find(node => node.dataset.entryId === `${P}-vane`), 'Vane card');
    await click([...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.textContent?.trim() === 'Editar'), 'Edit');
    await until(() => document.querySelector('[role="dialog"] [data-testid="codex-reveal-toggle"]'), 'reveal button in the editor header');
    await click(q('codex-reveal-toggle'), 'reveal from the editor');
    await until(async () => (await row('vane'))?.revealed, 'revealed from the editor');
    const titleInput = document.querySelector<HTMLInputElement>(`input[placeholder="${(await import('@/i18n/useTranslation')).t('codex.entryName')}"]`);
    await type(titleInput, 'Lord Vane the Elder');
    await click([...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => /Guardar/.test(b.textContent ?? '')), 'Save the form');
    await until(async () => (await row('vane'))?.title === 'Lord Vane the Elder', 'form saved');
    assert(isRevealed((await row('vane'))!), 'Saving the editor form does not wipe the reveal marker');
    passed.push('Card editor: the header button reveals, and saving the form afterwards keeps the marker');
    await db.codexEntries.update(`${P}-vane`, { title: 'Lord Vane', revealed: undefined });

    // 5. English copy on the same control.
    useLocaleStore.setState({ locale: 'en', loaded: true });
    await until(() => document.body.textContent?.includes(en.filterRevealed) || q('codex-reveal-filter-revealed')?.textContent === en.filterRevealed, 'English filter labels');
    assert(q('codex-reveal-filter-unrevealed')!.textContent === en.filterUnrevealed && q('codex-player-view')!.textContent!.includes(en.playerView), 'English labels present');
    useLocaleStore.setState({ locale: 'es', loaded: true });
    await render(<></>);
    passed.push('Both languages: the filter and the player-view toggle switch with the app language');

    // 6. Consult panel.
    const manuscript = document.createElement('div'); document.body.appendChild(manuscript);
    const editor = new Editor({ element: manuscript, extensions: [StarterKit], content: '<p>Lord Vane sailed to Harbour Town.</p>' });
    function Harness() { const prefs = useReferencePrefs(); return <ReferencePanel projectId={P} writingId={`${P}-writing`} content={editor.getHTML()} editor={editor} prefs={prefs} narrowBreakpoint={1} />; }
    setReferenceOpen(true);
    await render(<Harness />);
    await until(() => host.querySelectorAll('[data-testid="reference-row"]').length >= 1, 'consult rows');
    const vaneRow = [...host.querySelectorAll<HTMLElement>('[data-testid="reference-row"]')].find(node => node.dataset.entryId === `${P}-vane`);
    await click(vaneRow?.querySelector('button'), 'open Vane in the panel');
    await until(() => host.querySelector('[data-testid="reference-preview"] [data-testid="codex-reveal-toggle"]'), 'reveal button in the panel');
    await click(host.querySelector('[data-testid="codex-reveal-toggle"]'), 'reveal from the panel');
    await until(async () => (await row('vane'))?.revealed, 'revealed from the panel');
    await until(() => host.querySelector('[data-testid="codex-reveal"]')?.getAttribute('data-revealed') === 'true' && host.querySelector('[data-testid="codex-reveal-toggle"]')?.textContent?.trim() === es.hide, 'panel offers hide again');
    await click(host.querySelector('[data-testid="codex-reveal-toggle"]'), 'hide from the panel');
    await until(async () => !isRevealed((await row('vane'))!), 'hidden from the panel');
    editor.destroy(); manuscript.remove(); setReferenceOpen(false);
    await render(<></>);
    passed.push('Consult panel: Revelar a los jugadores / Ocultar de nuevo on the previewed card writes the same marker');

    // 7. Wiki: "only what is revealed" is a policy, off by default.
    await db.codexEntries.update(`${P}-vane`, { revealed: { at: 3000 } });
    const noPolicy = await saveWikiProfile(P, { name: 'Everything', options: { locale: 'en', excludedFields: ['hiddenfield'] } }, null);
    const before = await publishWikiProfile(P, noPolicy.id, noPolicy.revision);
    const beforeEdition = before.editions![0], beforeHtml = beforeEdition.reader.html;
    assert(!beforeHtml.includes(PRIVATE_TYPE_CARD) && beforeHtml.includes('Harbour Town') && beforeHtml.includes('Sea chart'), 'Without the policy the wiki keeps its usual contents (cards of a private type stay out, maps stay in)');
    const everythingBefore = plain(await build({ excludedFields: ['hiddenfield'] }));
    const onlyOptions: WorldWikiOptions = { locale: 'en', onlyRevealed: true, excludedFields: ['hiddenfield'] };
    validateWikiOptions(onlyOptions);
    let refused = false; try { validateWikiOptions({ onlyRevealed: 'yes' }); } catch { refused = true; } assert(refused, 'onlyRevealed must be a boolean');
    const html = await build(onlyOptions);
    assert(html.includes('Lord Vane') && html.includes('Old Tower') && html.includes('Harbour Town'), 'Revealed cards are published');
    assert(!html.includes('Sea chart'), 'Maps are left out while the policy is on');
    assert(!html.includes(PRIVATE_TYPE_CARD), 'A revealed card of a private type is still never published');
    assert(!html.includes(SECRET_BLOCK) && !html.includes(SECRET_FIELD), 'Hidden blocks and excluded fields stay out of a revealed card (the E13/E22 guarantees hold)');
    await db.codexEntries.update(`${P}-vane`, { revealed: undefined });
    const htmlWithoutVane = await build(onlyOptions);
    assert(!htmlWithoutVane.includes('Lord Vane') && htmlWithoutVane.includes('Old Tower'), 'An unrevealed card is not published');
    await db.codexEntries.update(`${P}-harbour`, { revealed: undefined });
    assert(!(await build(onlyOptions)).includes('Harbour Town'), 'Nothing unrevealed enters the wiki');
    assert(plain(await build({ excludedFields: ['hiddenfield'] })) === everythingBefore, 'A profile without the policy exports the same bytes whatever the reveal markers are');
    let profile = await saveWikiProfile(P, { name: 'Players', options: { ...onlyOptions } }, null);
    profile = await publishWikiProfile(P, profile.id, profile.revision);
    const edition = await getWikiEdition(P, profile.id, profile.editions![0].id);
    assert(edition.options.onlyRevealed === true && edition.reader.counts.entries === 1 && edition.reader.counts.maps === 0 && edition.reader.html.includes('Old Tower') && !edition.reader.html.includes('Harbour Town'), 'The edition froze only the revealed card: ' + JSON.stringify(edition.reader.counts));
    // The older edition and its profile are untouched by all the reveals above.
    const old = await getWikiEdition(P, noPolicy.id, beforeEdition.id);
    assert(old.reader.sha256 === beforeEdition.reader.sha256 && old.reader.html === beforeHtml && old.options.onlyRevealed === undefined, 'An earlier edition is byte-identical and carries no policy');
    assert((await wikiProfileChanges(P, noPolicy.id)).count === 0, 'A profile without the policy reports no changes after cards were revealed and hidden');
    const changesNow = await wikiProfileChanges(P, profile.id);
    assert(changesNow.count === 0, 'The policy profile has nothing waiting right after publishing');
    await db.codexEntries.update(`${P}-harbour`, { revealed: { at: 4000 } });
    const waiting = await wikiProfileChanges(P, profile.id);
    assert(waiting.count === 1 && waiting.changes[0].title === 'Harbour Town' && waiting.changes[0].change === 'added', 'Revealing a card shows up as a change waiting to publish: ' + JSON.stringify(waiting.changes));
    const saved = await runBridgeTool('wh_wiki_profile_save', { projectId: P, name: 'Bridge players', options: { onlyRevealed: true }, expectedRevision: null });
    assert(saved.ok && (saved.result as { options: WorldWikiOptions }).options.onlyRevealed === true, 'wh_wiki_profile_save accepts onlyRevealed: ' + JSON.stringify(saved));
    const exported = await runBridgeTool('wh_wiki_export', { projectId: P, onlyRevealed: true, locale: 'en' });
    assert(exported.ok && String((exported.result as { html: string }).html).includes('Old Tower') && !String((exported.result as { html: string }).html).includes('Sea chart'), 'wh_wiki_export honours onlyRevealed');
    assert(BRIDGE_TOOLS.find(t => t.name === 'wh_wiki_profile_save')!.schema.properties.options && JSON.stringify(BRIDGE_TOOLS.find(t => t.name === 'wh_wiki_profile_save')!.schema).includes('onlyRevealed'), 'The profile schema documents onlyRevealed');
    await getWikiProfile(P, noPolicy.id);
    passed.push('Wiki: "solo lo revelado" admits only revealed cards (no maps, no private types, secrets still removed); profiles without it and their editions are byte-identical; the change count notices a reveal; profile save and wiki export accept it');

    // 7b. The export panel carries the policy for the project's own preferences.
    useLocaleStore.setState({ locale: 'en', loaded: true });
    await render(<WikiExportControl projectId={P} entries={await db.codexEntries.where('projectId').equals(P).toArray()} />);
    await until(() => document.querySelector('summary'), 'export panel');
    await click(document.querySelector('summary'), 'open the export panel');
    const policy = q('wiki-only-revealed') as HTMLInputElement | null;
    assert(policy && !policy.checked && policy.closest('label')?.textContent === en.onlyRevealed, 'The export panel offers "Publish only what is revealed", off by default');
    await click(policy, 'turn the policy on');
    await click([...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Save preferences'), 'save preferences');
    await until(async () => (await db.projects.get(P))?.wikiOptions?.onlyRevealed === true, 'preference saved');
    assert(((await db.projects.get(P))!.wikiOptions!.excludedFields ?? []).includes('hiddenfield'), 'Saving the policy keeps the other preferences');
    await click(q('wiki-only-revealed'), 'turn the policy off');
    await click([...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Save preferences'), 'save preferences again');
    await until(async () => !(await db.projects.get(P))?.wikiOptions?.onlyRevealed, 'preference cleared');
    useLocaleStore.setState({ locale: 'es', loaded: true });
    await render(<></>);
    passed.push('Export panel: the "Publish only what is revealed" checkbox is off by default and saves into the project preferences');

    // 8. Backup, clone, ZIP.
    await db.codexEntries.update(`${P}-vane`, { revealed: { at: 5000, note: 'Told at the gate', moment: 'Session 3' } });
    const data = await exportProjectData(P);
    assert(JSON.stringify(data).includes('Told at the gate'), 'The JSON backup carries the marker');
    const cloneId = await importProjectData(data); cloneIds.push(cloneId);
    const markers = async (projectId: string) => Object.fromEntries((await db.codexEntries.where('projectId').equals(projectId).toArray()).map(c => [c.title, JSON.stringify(c.revealed ?? null)]).sort(([a], [b]) => a.localeCompare(b)));
    const original = await markers(P), cloned = await markers(cloneId);
    assert(JSON.stringify(original) === JSON.stringify(cloned) && original['Lord Vane'].includes('Told at the gate') && original['Old Tower'] !== 'null' && original['Harbour Town'] !== 'null', 'The clone keeps every marker as it was: ' + JSON.stringify(cloned));
    const zip = await createProjectZipArchive(P);
    await db.codexEntries.where('projectId').equals(P).modify(entry => { delete entry.revealed; });
    assert(Object.values(await markers(P)).every(value => value === 'null'), 'Markers wiped before the restore');
    await importProjectZip(new File([zip.blob], 'reveal.zip', { type: 'application/zip' }), { replaceProjectIds: [P] });
    assert(JSON.stringify(await markers(P)) === JSON.stringify(original), 'The ZIP restore brings every marker back: ' + JSON.stringify(await markers(P)));
    const cloneProfiles = (await db.projects.get(cloneId))!.wikiProfiles ?? [];
    assert(cloneProfiles.some(p2 => p2.options.onlyRevealed === true), 'The clone keeps the policy on its profiles');
    passed.push('Backup and clone: JSON export/import, ZIP and project clone keep every marker (time, note, moment) and the profile policy');

    // 9. Bridge tool.
    await db.codexEntries.where('projectId').equals(P).modify(entry => { delete entry.revealed; });
    const call = (name: string, args: Record<string, unknown>) => runBridgeTool(name, { projectId: P, ...args });
    const tool = BRIDGE_TOOLS.find(t => t.name === 'wh_set_revealed')!;
    assert(tool.writes && tool.engineId === 'codex' && tool.schema.required?.includes('entryIds') && tool.schema.properties.eraId, 'The tool is a codex write with an era option');
    const bad = await call('wh_set_revealed', { entryIds: [`${P}-vane`, 'nope'], revealed: true });
    assert(!bad.ok && bad.code === 'not-found' && !isRevealed((await row('vane'))!), 'An unknown id refuses the whole call before anything is written');
    const noNote = await call('wh_set_revealed', { entryIds: [`${P}-vane`], revealed: false, note: 'x' });
    assert(!noNote.ok && noNote.code === 'bad-args', 'A note only goes with revealed:true');
    const first = await call('wh_set_revealed', { entryIds: [`${P}-vane`, `${P}-harbour`], revealed: true, note: 'Told at the gate', moment: 'Session 2' });
    assert(first.ok, 'reveal failed: ' + JSON.stringify(first));
    const r1 = first.result as { changed: { id: string; revealed: boolean }[]; unchanged: string[]; __audit: Record<string, unknown> };
    assert(r1.changed.length === 2 && r1.changed.every(c => c.revealed) && !r1.unchanged.length, 'Two cards revealed');
    assert((await row('vane'))!.revealed!.note === 'Told at the gate' && (await row('harbour'))!.revealed!.moment === 'Session 2', 'Markers carry note and moment');
    const listed = (await call('wh_list_codex', {})).result as { entries: { id: string; revealed: boolean }[] };
    assert(listed.entries.find(e => e.id === `${P}-vane`)!.revealed === true && listed.entries.find(e => e.id === `${P}-tower`)!.revealed === false, 'wh_list_codex exposes revealed');
    const onlyRevealedList = (await call('wh_list_codex', { revealed: true })).result as { entries: { id: string }[] };
    assert(onlyRevealedList.entries.length === 2, 'wh_list_codex revealed:true filters');
    const got = (await call('wh_get_codex_entry', { id: `${P}-vane` })).result as { revealed: boolean; reveal: { moment: string } };
    assert(got.revealed === true && got.reveal.moment === 'Session 2', 'wh_get_codex_entry exposes revealed and the marker');
    const again = await call('wh_set_revealed', { entryIds: [`${P}-vane`], revealed: true });
    assert(again.ok && (again.result as { unchanged: string[] }).unchanged.length === 1 && !(again.result as Record<string, unknown>).__audit, 'Revealing an already revealed card is a no-op without an audit line');
    // Undo restores both, once.
    const undone = await undoAuditEntry({ entry: { ...r1.__audit, kind: 'update', tool: 'wh_set_revealed' } });
    assert(undone.undone && !isRevealed((await row('vane'))!) && !isRevealed((await row('harbour'))!), 'Undo hides both again');
    // Stale undo: edited after the reveal.
    const second = await call('wh_set_revealed', { entryIds: [`${P}-vane`, `${P}-harbour`], revealed: true });
    const r2 = second.result as { __audit: Record<string, unknown> };
    await db.codexEntries.update(`${P}-harbour`, { title: 'Harbour Town (renamed)', updatedAt: Date.now() + 5 });
    let staleCode = '';
    try { await undoAuditEntry({ entry: { ...r2.__audit, kind: 'update', tool: 'wh_set_revealed' } }); } catch (error) { staleCode = (error as { code?: string }).code ?? String(error); }
    assert(staleCode === 'cannot-undo' && isRevealed((await row('vane'))!) && isRevealed((await row('harbour'))!), 'Undo is refused whole when one card changed since, and nothing is forced: ' + staleCode);
    // Stale undo: hidden by someone else first.
    const third = await call('wh_set_revealed', { entryIds: [`${P}-tower`], revealed: true, moment: 'Session 4' });
    const r3 = third.result as { __audit: Record<string, unknown> };
    await call('wh_set_revealed', { entryIds: [`${P}-tower`], revealed: false });
    let staleCode2 = '';
    try { await undoAuditEntry({ entry: { ...r3.__audit, kind: 'update', tool: 'wh_set_revealed' } }); } catch (error) { staleCode2 = (error as { code?: string }).code ?? String(error); }
    assert(staleCode2 === 'cannot-undo' && !isRevealed((await row('tower'))!), 'Undo is refused when the card was hidden by a later call');
    passed.push('Bridge: wh_set_revealed reveals and hides several cards (all or nothing), is a no-op when nothing changes, shows in wh_list_codex / wh_get_codex_entry, undoes cleanly and refuses a stale undo');

    // 10. Era scope.
    await saveWorldEra(P, { id: 'later', name: 'Later age', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    await db.codexEntries.update(`${P}-tower`, { revealed: undefined });
    const eraCall = await call('wh_set_revealed', { entryIds: [`${P}-tower`], revealed: true, eraId: 'later' });
    assert(eraCall.ok, 'era reveal failed: ' + JSON.stringify(eraCall));
    assert(!isRevealed((await row('tower'))!), 'An era reveal leaves Base untouched');
    assert(isRevealed((await readWorldDocument({ projectId: P, eraId: 'later' }, 'codex', `${P}-tower`))!.document.root as unknown as CodexEntry), 'The era carries the marker');
    const eraUndo = await undoAuditEntry({ entry: { ...(eraCall.result as { __audit: object }).__audit, kind: 'update', tool: 'wh_set_revealed', eraId: 'later' } });
    assert(eraUndo.undone && !isRevealed((await readWorldDocument({ projectId: P, eraId: 'later' }, 'codex', `${P}-tower`))!.document.root as unknown as CodexEntry), 'An era reveal undoes');
    passed.push('Era scope: wh_set_revealed with eraId writes the era copy only and undoes there');

    // 11. Engine off.
    const offId = P + '-off', now = Date.now();
    await createProject({ id: offId, title: 'Off', mode: 'custom', type: 'standalone', enabledEngines: ['codex'], engineOrder: ['codex'], createdAt: now, updatedAt: now });
    await db.codexEntries.put({ ...card('off', 'Off card'), id: offId + '-card', projectId: offId });
    await updateProject(offId, { enabledEngines: [] });
    const offState = JSON.stringify(await db.codexEntries.get(offId + '-card'));
    const off = await runBridgeTool('wh_set_revealed', { projectId: offId, entryIds: [offId + '-card'], revealed: true });
    assert(!off.ok && off.code === 'engine-disabled' && JSON.stringify(await db.codexEntries.get(offId + '-card')) === offState, 'A switched-off Codex refuses before touching the card');
    const offBare = await runBridgeTool('wh_set_revealed', { projectId: offId });
    assert(!offBare.ok && offBare.code === 'engine-disabled', 'The guard answers before argument validation, as the self-test expects');
    await deleteProject(offId);
    passed.push('Engine off: wh_set_revealed refuses with engine-disabled and changes nothing');
    return passed;
  } finally {
    await act(async () => { root.unmount(); await pause(); });
    useLocaleStore.setState({ locale: 'es', loaded: true });
    for (const id of cloneIds) { try { await deleteProject(id); } catch { /* already gone */ } }
    await cleanup();
  }
}
