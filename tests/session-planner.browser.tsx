// Session-prep outlines and the planner: the three new templates seed the right
// beats in both languages (and the old ids are untouched), an outline is marked
// as a session with date / status / prep note, the planner groups sessions and
// changes status, layouts are laid into the prep note's tool dock, the fields
// survive a ZIP backup and a project copy, and the bridge reads and writes it.
import { act, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import JSZip from 'jszip';
import { db } from '@/db';
import OutlineEngine from '@/engines/outline/components/OutlineEngine';
import { createOutlineFromTemplate } from '@/engines/outline/operations';
import { groupSessions } from '@/engines/outline/session';
import { BEAT_SHEET_TEMPLATES, SESSION_TEMPLATE_IDS } from '@/engines/outline/types';
import { readWritingToolDock } from '@/engines/writings/toolDock/store';
import { installNavigator } from '@/engines/_shared/anchoring';
import { BRIDGE_TOOLS } from '@/services/aiBridge/manifest';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { duplicateProject, previewProjectDuplicate } from '@/services/projectDuplicate/service';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { t } from '@/i18n/useTranslation';
import { useLocaleStore } from '@/stores/localeStore';
import type { Project, Writing } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean | Promise<boolean>, label: string, tries = 100) {
  for (let i = 0; i < tries; i++) { if (await check()) return; await act(async () => { await pause(50); }); }
  throw new Error(`Timed out: ${label}`);
}
const setValue = async (element: Element | null, value: string) => {
  assert(element, 'control');
  const control = element as HTMLInputElement | HTMLSelectElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(control, value);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    await pause(150);
  });
};
const click = async (element: Element | null, label: string) => { assert(element, label); await act(async () => { (element as HTMLElement).click(); await pause(200); }); };

function Routed({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => { installNavigator(navigate); }, [navigate]);
  return <><output data-testid="route">{location.pathname}{location.search}</output>{children}</>;
}

export async function testSessionPlanner(): Promise<string[]> {
  const passed: string[] = [];
  const P = 'session-planner-test';
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const all = (id: string) => [...host.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
  const group = (status: string) => host.querySelector(`[data-testid="session-group-${status}"]`);
  const rowsIn = (status: string) => [...(group(status)?.querySelectorAll<HTMLElement>('[data-testid="session-row"]') ?? [])].map(row => row.querySelector('p')?.textContent ?? '');
  const bridge = async (name: string, args: Record<string, unknown>) => {
    const out = await runBridgeTool(name, { projectId: P, ...args });
    return out as { ok: boolean; result?: Record<string, unknown> & { __audit?: Record<string, unknown> }; error?: unknown; code?: string };
  };

  try {
    // ---- 1. Templates, both languages; old ids untouched --------------------
    assert(BEAT_SHEET_TEMPLATES.slice(0, 4).map(item => item.id).join() === 'save-the-cat,three-act,heros-journey,five-act', 'The four original template ids keep their place');
    assert(SESSION_TEMPLATE_IDS.every(id => BEAT_SHEET_TEMPLATES.some(item => item.id === id)), 'Session template ids exist');
    await db.projects.put({
      id: P, title: 'Campaña', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft',
      enabledEngines: ['outline', 'writings', 'codex', 'timeline'], engineOrder: [], createdAt: 1, updatedAt: 1,
    } as Project);
    const expected = {
      'session-prep': { n: 8, es: ['Repasar a los personajes', 'Inicio fuerte'], en: ['Review the characters', 'Strong start'] },
      'hub-and-spoke': { n: 6, es: ['El centro'], en: ['The hub'] },
      'three-act-session': { n: 8, es: ['Acto 1: La apertura', 'Inicio fuerte'], en: ['Act 1: The opening', 'Strong start'] },
    } as const;
    for (const locale of ['es', 'en'] as const) {
      useLocaleStore.setState({ locale });
      for (const [id, want] of Object.entries(expected)) {
        const outline = await createOutlineFromTemplate(P, `${id}-${locale}`, id, t);
        const beats = (await db.outlineBeats.where('outlineId').equals(outline.id).toArray()).sort((a, b) => a.order - b.order);
        assert(beats.length === want.n, `${id} seeds ${want.n} beats, got ${beats.length}`);
        assert(beats.every(beat => beat.title && !beat.title.startsWith('outline.') && beat.description && !beat.description.startsWith('outline.')), `${id}/${locale}: raw keys leaked`);
        assert(want[locale].every((title, index) => beats[index].title === title), `${id}/${locale}: titles ${beats.map(beat => beat.title).join('|')}`);
        assert(outline.kind === undefined && outline.templateId === id, `${id}: a template alone does not mark a session`);
      }
    }
    useLocaleStore.setState({ locale: 'es' });
    await db.outlines.where('projectId').equals(P).delete();
    await db.outlineBeats.where('projectId').equals(P).delete();
    passed.push('Templates: session-prep (8 steps), hub-and-spoke (6) and three-act-session (8) seed translated beats in es and en without raw keys; the four original template ids keep their place');

    // ---- 2. Mark an outline as a session in the outline screen ----------------
    const note = { id: `${P}-note`, projectId: P, title: 'Notas de la sesión 3', content: '<p>x</p>', wordCount: 1, tags: [], status: 'draft', createdAt: 1, updatedAt: 1 } as unknown as Writing;
    await db.writings.put(note);
    await db.codexEntries.put({ id: `${P}-npc`, projectId: P, title: 'Mara', type: 'character', content: '<p>x</p>', fields: {}, tags: [], relations: [], createdAt: 1, updatedAt: 1 } as never);
    const live = await bridge('wh_create_outline', { title: 'Sesión 1: El puerto', template: 'hub-and-spoke', sessionStatus: 'played', sessionDate: '2026-09-01' });
    assert(live.ok, `create session outline: ${JSON.stringify(live)}`);
    const liveId = String(live.result!.id);
    const played2 = await bridge('wh_create_outline', { title: 'Sesión 2: La torre', sessionStatus: 'live', sessionDate: '2026-10-10' });
    assert(played2.ok, 'second session');
    const plain = await bridge('wh_create_outline', { title: 'Novela', template: 'three-act' });
    assert(plain.ok && !('session' in plain.result!), 'A plain outline stays plain');
    const rejected = await bridge('wh_create_outline', { title: 'Mala', sessionDate: '2026-02-31' });
    assert(!rejected.ok, 'A date that does not exist is refused');
    const badTemplate = await bridge('wh_create_outline', { title: 'Mala', template: 'lazy-dm-nope' });
    assert(!badTemplate.ok, 'An unknown template is still refused');

    await act(async () => {
      root.render(<MemoryRouter><Routed><OutlineEngine projectId={P} /></Routed></MemoryRouter>);
      await pause(300);
    });
    await until(() => !!q('session-fields'), 'session strip');
    // Pick the plain outline's card and mark it.
    const card = all('outline-session-badge');
    assert(card.length === 2, `two session badges on the cards, got ${card.length}`);
    const novelCard = [...host.querySelectorAll<HTMLElement>('[role="button"]')].find(element => element.textContent?.includes('Novela'));
    await click(novelCard ?? null, 'open the plain outline');
    await until(() => (q('session-toggle') as HTMLInputElement | null)?.checked === false && !q('session-date'), 'plain outline shows an unchecked toggle');
    await click(q('session-toggle'), 'mark as session');
    await until(() => !!q('session-date'), 'fields appear');
    await setValue(q('session-date'), '2026-11-05');
    await setValue(q('session-status-field'), 'next');
    await setValue(q('session-note'), note.id);
    const novelId = (await db.outlines.where('projectId').equals(P).filter(row => row.title === 'Novela').first())!.id;
    await until(async () => (await db.outlines.get(novelId))?.linkedWritingId === note.id, 'note saved');
    const marked = (await db.outlines.get(novelId))!;
    assert(marked.kind === 'session' && marked.sessionStatus === 'next' && marked.sessionDate === '2026-11-05' && (marked.sessionRevision ?? 0) >= 4, `session fields stored: ${JSON.stringify(marked)}`);
    passed.push('Outline screen: a plain outline is marked as a session; date 2026-11-05, status "Siguiente" and the prep note are saved (revision bumped on each change); sessions created through the bridge show a "Sesión" badge');

    // ---- 3. Planner: groups, status change, open, new session -----------------
    await click(q('outline-view-planner'), 'planner tab');
    await until(() => !!q('session-planner'), 'planner');
    assert(rowsIn('live').join() === 'Sesión 2: La torre' && rowsIn('next').join() === 'Novela' && rowsIn('prep').length === 0 && rowsIn('played').join() === 'Sesión 1: El puerto', `groups: live=${rowsIn('live')} next=${rowsIn('next')} played=${rowsIn('played')}`);
    // Group order: En juego, Siguiente, En preparación, Jugada.
    const order = [...host.querySelectorAll<HTMLElement>('[data-testid^="session-group-"]')].map(section => section.dataset.testid);
    assert(order.join() === 'session-group-live,session-group-next,session-group-prep,session-group-played', `group order ${order}`);
    // Quick status change: the live session becomes played.
    const liveRow = all('session-row').find(row => row.textContent?.includes('La torre'))!;
    await setValue(liveRow.querySelector('[data-testid="session-status"]'), 'played');
    await until(() => rowsIn('live').length === 0 && rowsIn('played').length === 2, 'moved to played');
    assert(rowsIn('played').join() === 'Sesión 2: La torre,Sesión 1: El puerto', `played is newest first: ${rowsIn('played')}`);
    // A new session from the planner.
    await setValue(q('session-new-name'), 'Sesión 4: La cripta');
    await setValue(q('session-new-template'), 'three-act-session');
    await click(q('session-new-create'), 'create');
    await until(() => rowsIn('prep').join() === 'Sesión 4: La cripta', 'new session in prep');
    const created = (await db.outlines.where('projectId').equals(P).filter(row => row.title === 'Sesión 4: La cripta').first())!;
    assert(created.kind === 'session' && created.templateId === 'three-act-session' && (await db.outlineBeats.where('outlineId').equals(created.id).count()) === 8, 'New session seeded from its template');
    // Open.
    await click(all('session-row').find(row => row.textContent?.includes('La cripta'))!.querySelector('[data-testid="session-open"]'), 'open');
    await until(() => !!q('session-fields') && (host.querySelector('input[aria-label]') as HTMLInputElement | null)?.value === 'Sesión 4: La cripta', 'opened in the outline editor');
    assert((q('session-status-field') as HTMLSelectElement).value === 'prep', 'The opened session shows its status');
    passed.push('Planner: groups En juego / Siguiente / En preparación / Jugada in that order (played newest first); the status select moves a session between groups; "Nueva sesión" seeds a three-act-session in prep; "Abrir" opens it in the outline editor');

    // ---- 4. Tool-dock presets on the prep note ---------------------------------
    await click(q('outline-view-planner'), 'planner again');
    await until(() => !!q('session-planner'), 'planner back');
    const withNote = () => all('session-row').find(row => row.textContent?.includes('Novela'))!;
    await click(withNote().querySelector('[data-testid="session-preset-combat"]'), 'combat');
    await until(() => /ninguno de los documentos/.test(q('session-message')?.textContent ?? ''), 'combat has nothing to lay out');
    assert((await readWritingToolDock({ projectId: P }, { kind: 'writings', documentId: note.id })).layout === undefined, 'Nothing was written for an empty preset');
    await click(withNote().querySelector('[data-testid="session-preset-reference"]'), 'reference');
    await until(() => /Consulta/.test(q('session-message')?.textContent ?? '') && !!q('session-preset-undo'), 'reference applied');
    const dock = await readWritingToolDock({ projectId: P }, { kind: 'writings', documentId: note.id });
    assert(dock.layout?.blocks.length === 1 && dock.layout.blocks[0].kind === 'document' && dock.layout.blocks[0].target.kind === 'codex' && dock.layout.blocks[0].span === 2, `dock holds the codex card: ${JSON.stringify(dock.layout)}`);
    await click(q('session-preset-undo'), 'undo layout');
    await until(async () => (await readWritingToolDock({ projectId: P }, { kind: 'writings', documentId: note.id })).layout === undefined, 'layout undone');
    passed.push('Dock presets: "Combate" on a project without sheets, tables or boards says so and writes nothing; "Consulta" lays the codex card into the prep note\'s dock (full width) through the dock\'s own apply; "Deshacer disposición" restores the dock');

    await act(async () => { root.unmount(); await pause(); });

    // ---- 5. Bridge --------------------------------------------------------------
    for (const name of ['wh_session_planner', 'wh_session_set_status']) assert(BRIDGE_TOOLS.some(tool => tool.name === name), `${name} in the manifest`);
    const read = await bridge('wh_session_planner', {});
    assert(read.ok, `planner read: ${JSON.stringify(read)}`);
    const groups = read.result!.groups as Record<string, { id: string; title: string; status: string; revision: number }[]>;
    assert((read.result!.counts as Record<string, number>).played === 2 && groups.next[0].title === 'Novela' && groups.prep[0].title === 'Sesión 4: La cripta', `bridge groups ${JSON.stringify(read.result!.counts)}`);
    assert(Array.isArray(read.result!.presets) && (read.result!.presets as string[]).join() === 'combat,map,reference', 'presets listed');
    const novel = groups.next[0];
    const ahead = await bridge('wh_session_set_status', { outlineId: novel.id, status: 'live', expectedRevision: novel.revision + 7 });
    assert(!ahead.ok, 'A stale revision is refused');
    assert((await db.outlines.get(novel.id))!.sessionStatus === 'next', 'The refused write changed nothing');
    const set = await bridge('wh_session_set_status', { outlineId: novel.id, status: 'live', date: null, expectedRevision: novel.revision });
    assert(set.ok && set.result!.status === 'live' && set.result!.date === null && set.result!.revision === novel.revision + 1, `set status ${JSON.stringify(set)}`);
    assert(!(await bridge('wh_session_set_status', { outlineId: novel.id, status: 'bogus' })).ok, 'An unknown status is refused');
    assert(!(await bridge('wh_session_set_status', { outlineId: novel.id, date: '2026-13-40' })).ok, 'An impossible date is refused');
    assert(!(await bridge('wh_session_set_status', { outlineId: novel.id, linkedWritingId: 'nope' })).ok, 'A note from nowhere is refused');
    assert(!(await bridge('wh_session_set_status', { outlineId: novel.id })).ok, 'Nothing to change is refused');
    const afterSet = (await db.outlines.get(novel.id))!;
    assert(afterSet.sessionStatus === 'live' && afterSet.sessionDate === undefined && afterSet.linkedWritingId === note.id, 'Status set, date cleared, note kept');
    // A later change blocks the undo; reading again and undoing the latest works.
    const second = await bridge('wh_session_set_status', { outlineId: novel.id, status: 'played' });
    assert(second.ok, 'second change');
    let blocked = false;
    try { await undoAuditEntry({ entry: { ...set.result!.__audit!, tool: 'wh_session_set_status' } }); } catch { blocked = true; }
    assert(blocked, 'Undoing an older change over a later one is refused');
    await undoAuditEntry({ entry: { ...second.result!.__audit!, tool: 'wh_session_set_status' } });
    const latestUndone = (await db.outlines.get(novel.id))!;
    assert(latestUndone.sessionStatus === 'live' && latestUndone.sessionRevision! > Number(second.result!.revision), 'Undo restores content with a fresh revision');
    blocked = false;
    try { await undoAuditEntry({ entry: { ...set.result!.__audit!, tool: 'wh_session_set_status' } }); } catch { blocked = true; }
    assert(blocked, 'An earlier receipt stays stale after undo; revisions are never reused');
    const restoredStatus = await bridge('wh_session_set_status', { outlineId: novel.id, status: 'next', date: '2026-11-05', expectedRevision: latestUndone.sessionRevision });
    assert(restoredStatus.ok, 'The earlier values can be restored explicitly at the current revision');
    const undone = (await db.outlines.get(novel.id))!;
    assert(undone.sessionStatus === 'next' && undone.sessionDate === '2026-11-05', `restored status and date: ${JSON.stringify(undone)}`);
    // Marking a plain outline through the tool, then undoing it, removes the marker again.
    const unmarked = await bridge('wh_create_outline', { title: 'Suelto' });
    const looseId = String(unmarked.result!.id);
    const mark = await bridge('wh_session_set_status', { outlineId: looseId, status: 'next' });
    assert(mark.ok && (await db.outlines.get(looseId))!.kind === 'session', 'The tool marks a plain outline as a session');
    await undoAuditEntry({ entry: { ...mark.result!.__audit!, tool: 'wh_session_set_status' } });
    const loose = (await db.outlines.get(looseId))!;
    assert(loose.kind === undefined && loose.sessionStatus === undefined, 'Undo takes the marker off again');
    // Dock plan for the prep note.
    const plan = await bridge('wh_session_planner', { outlineId: novel.id, preset: 'reference' });
    const dockPlan = plan.result!.dockPlan as { documents: unknown[]; apply: { owner: unknown; expectedVersion: string; actions: unknown[] } | null };
    assert(plan.ok && dockPlan.documents.length === 1 && dockPlan.apply && dockPlan.apply.actions.length >= 2, `dock plan ${JSON.stringify(plan.result)}`);
    const applied = await bridge('wh_writing_tool_dock_apply', dockPlan.apply!);
    assert(applied.ok, `the plan applies through wh_writing_tool_dock_apply: ${JSON.stringify(applied)}`);
    assert(!(await bridge('wh_session_planner', { outlineId: looseId, preset: 'map' })).ok, 'A preset needs a session with a prep note');
    // Engine guard: a switched-off outline engine refuses before reading anything.
    await db.projects.update(P, { enabledEngines: ['writings'] });
    const guarded = await bridge('wh_session_set_status', {});
    assert(!guarded.ok && guarded.code === 'engine-disabled', `engine guard: ${JSON.stringify(guarded)}`);
    const stillReads = await bridge('wh_session_planner', {});
    assert(stillReads.ok, 'A read still answers with the engine off');
    await db.projects.update(P, { enabledEngines: ['outline', 'writings', 'codex', 'timeline'] });
    passed.push('Bridge: wh_session_planner groups sessions with revisions and plans a dock layout (applied through wh_writing_tool_dock_apply); wh_session_set_status refuses a stale revision, a bad status, a bad date and a foreign note, changes status/date/note, is blocked from undoing over later work, and undo restores the values (or removes the marker); a disabled outline engine answers engine-disabled; wh_create_outline takes session fields and the new template ids');

    // ---- 6. Persistence: ZIP backup and project copy -----------------------------
    const before = Object.fromEntries((await db.outlines.where('projectId').equals(P).toArray()).map(row => [row.id, row]));
    const archive = await createProjectZipArchive(P);
    const reopened = await JSZip.loadAsync(archive.blob);
    const outlinesFile = Object.values(reopened.files).find(entry => /outline\/outlines\.json$/.test(entry.name));
    assert(outlinesFile, 'The ZIP holds the outlines table');
    const stored = JSON.parse(await outlinesFile.async('string')) as { id: string; kind?: string; sessionStatus?: string; sessionDate?: string; linkedWritingId?: string }[];
    const inZip = stored.find(row => row.id === novel.id)!;
    assert(inZip.kind === 'session' && inZip.sessionStatus === 'next' && inZip.sessionDate === '2026-11-05' && inZip.linkedWritingId === note.id, 'Session fields are in the backup');
    await db.outlines.where('projectId').equals(P).delete();
    await db.outlineBeats.where('projectId').equals(P).delete();
    await db.writings.where('projectId').equals(P).delete();
    await db.codexEntries.where('projectId').equals(P).delete();
    await db.projects.delete(P);
    await importProjectZip(new File([archive.blob], archive.fileName, { type: 'application/zip' }));
    const restored = (await db.outlines.get(novel.id))!;
    assert(restored.kind === 'session' && restored.sessionStatus === before[novel.id].sessionStatus && restored.sessionDate === '2026-11-05' && restored.linkedWritingId === note.id && restored.sessionRevision === before[novel.id].sessionRevision, 'Session fields survive a ZIP restore');
    // Project copy: the prep note link follows the copied chapter.
    const preview = await previewProjectDuplicate({ projectId: P });
    const copy = await duplicateProject({ operationId: 'session-planner-copy', projectId: P, title: 'Campaña · copia', expectedSourceVersion: preview.sourceVersion });
    const copied = (await db.outlines.where('projectId').equals(copy.projectId).toArray()).filter(row => row.kind === 'session');
    const copiedNovel = copied.find(row => row.title === 'Novela')!;
    assert(copied.length === 4 && copiedNovel.id !== novel.id && copiedNovel.linkedWritingId && copiedNovel.linkedWritingId !== note.id, 'The copy keeps the sessions with a new id');
    const copiedNote = await db.writings.get(copiedNovel.linkedWritingId!);
    assert(copiedNote?.projectId === copy.projectId && copiedNote.title === note.title, 'The copied session points at the copied prep note, not the original');
    assert(copiedNovel.sessionStatus === 'next' && copiedNovel.sessionDate === '2026-11-05', 'Status and date are copied');
    const grouped = groupSessions(await db.outlines.where('projectId').equals(copy.projectId).toArray());
    assert(grouped.next.length === 1 && grouped.played.length === 2 && grouped.prep.length === 1, 'The copy groups the same way');
    await db.outlines.where('projectId').equals(copy.projectId).delete();
    passed.push('Persistence: session fields are in the project ZIP and come back after delete + restore with the same revision; a project copy keeps all four sessions with new ids and points the prep-note link at the copied chapter');
  } finally {
    try { root.unmount(); } catch { /* already unmounted */ }
  }
  return passed;
}
