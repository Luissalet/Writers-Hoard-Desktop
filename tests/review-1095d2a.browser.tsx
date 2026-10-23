// Fixes from the independent review of wave D2 (workspace themes, Markdown vault export, workspace
// tabs and the undo journal). One PASS line per finding.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import JSZip from 'jszip';
import type { EngineDefinition } from '@/engines/_types';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import type { CodexEntry, Project, Writing } from '@/types';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { getWorkspaceAppearance, saveWorkspaceAppearance } from '@/services/workspaceAppearance/store';
import { THEME_LIBRARY_KEY, addTheme, readThemeLibrary } from '@/services/workspaceAppearance/themeLibrary';
import { MAX_STASHED_PICTURES, PICTURE_INDEX_KEY, PICTURE_PREFIX, stashPicture } from '@/services/workspaceAppearance/pictureStash';
import WorkspaceAppearance from '@/services/workspaceAppearance/WorkspaceAppearance';
import { buildWorldMarkdownVault, estimateWorldMarkdownVault } from '@/services/worldMarkdownExport';
import { MEDIA_CONFIRM_BYTES, MEDIA_FILE_LIMIT_BYTES, MEDIA_TOTAL_LIMIT_BYTES } from '@/services/worldMarkdownExport/limits';
import { safeName } from '@/services/worldMarkdownExport/names';
import { renderTableCsv, type RenderContext } from '@/services/worldMarkdownExport/render';
import WorldMarkdownExportPanel from '@/components/project/WorldMarkdownExportPanel';
import ProjectWorkspace from '@/components/project/workspace/ProjectWorkspace';
import { freshUntouchedDocument, forgetKeptDocuments } from '@/components/project/workspace/freshDocument';
import { tabsStorageKey } from '@/components/project/workspace/workspaceTabs';
import { useEnginePane } from '@/engines/_shared/EnginePaneContext';
import { deleteLibraryDocuments } from '@/components/project/workspace/library/bulkDelete';
import { workspaceDocument } from '@/components/project/workspace/library/catalog';
import { ToastHost } from '@/components/common/toast';
import { clearUndoJournal, getUndoJournal, recordUndoable, undoEntry, UndoPartialError } from '@/services/undoJournal';
import { trackPendingWrite } from '@/services/pendingWrites';
import { useLocaleStore } from '@/stores/localeStore';
import type { WorldTable } from '@/engines/tables/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const base = (id: string, extra: Partial<Project> = {}): Project => ({ id, title: id, description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['codex', 'writings'], createdAt: 1, updatedAt: 1, ...extra } as Project);
/** A real PNG of about `size`x`size` random pixels (does not compress, so it is big and unique). */
function noisePng(size: number): string {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const context = canvas.getContext('2d')!, data = context.createImageData(size, size);
  for (let i = 0; i < data.data.length; i++) data.data[i] = i % 4 === 3 ? 255 : Math.floor(Math.random() * 256);
  context.putImageData(data, 0, 0); return canvas.toDataURL('image/png');
}
type Reply = { ok: boolean; result?: { __audit?: Record<string, unknown> } & Record<string, unknown>; error?: string; code?: string };
const auditOf = (reply: Reply, tool: string) => ({ ...reply.result!.__audit!, tool });
const rejects = async (run: () => Promise<unknown>) => { try { await run(); return ''; } catch (error) { return (error as { code?: string }).code ?? String(error); } };
const stashRows = () => db.settings.filter(row => row.key.startsWith(PICTURE_PREFIX)).toArray();

export async function testReview1095d2a(): Promise<string[]> {
  const passed: string[] = [];
  useLocaleStore.setState({ locale: 'es' });
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  const mount = async (node: ReactNode) => { await act(async () => { root?.unmount(); root = createRoot(host); root.render(node); await pause(200); }); };
  const unmount = async () => { await act(async () => { root?.unmount(); root = null; await pause(); }); };
  // Modals render in a portal outside the mount point, so look in the whole document.
  const q = (testId: string) => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  const click = async (testId: string, wait = 200) => { const node = q(testId); assert(node, `Missing ${testId}`); await act(async () => { node.click(); await pause(wait); }); };
  const waitFor = async (pick: () => unknown, what: string) => { for (let i = 0; i < 60; i++) { const found = pick(); if (found) return found; await act(async () => { await pause(80); }); } throw new Error(`Timed out waiting for ${what}`); };
  const toastActions = () => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="toast-action"]')];

  // ======================================================================================================
  // 1. Theme receipts: only what changed; picture bytes in a bounded side store; undo refused when gone.
  // ======================================================================================================
  const P1 = 'review-d2a-themes';
  await db.settings.where('key').equals(THEME_LIBRARY_KEY).delete();
  await db.settings.filter(row => row.key.startsWith(PICTURE_PREFIX) || row.key === PICTURE_INDEX_KEY).delete();
  await db.projects.put(base(P1));
  const big = noisePng(380);
  assert(big.length > 300_000, `The test picture is big (${big.length})`);
  const list = (await runBridgeTool('wh_workspace_theme_list', {})) as Reply & { result: { revision: number } };
  const savedBig = (await runBridgeTool('wh_workspace_theme_save', { name: 'Con foto', values: { mode: 'dark', background: '#112233', backgroundImage: big }, expectedRevision: list.result.revision })) as Reply;
  assert(savedBig.ok, JSON.stringify(savedBig).slice(0, 300));
  const savedSmall = (await runBridgeTool('wh_workspace_theme_save', { name: 'Sin foto', values: { mode: 'light' } })) as Reply;
  const saveAudit = JSON.stringify(savedSmall.result!.__audit);
  assert(saveAudit.length < 2000 && !saveAudit.includes('data:image'), `A save receipt does not carry the library (${saveAudit.length} chars)`);
  const bigAudit = JSON.stringify(savedBig.result!.__audit);
  assert(bigAudit.length < 2000 && !bigAudit.includes('data:image') && bigAudit.includes('backgroundImageRef'), `The picture is a hash in the receipt (${bigAudit.length} chars)`);
  const library = await readThemeLibrary(), bigTheme = library.themes.find(theme => theme.name === 'Con foto')!;
  const removed = (await runBridgeTool('wh_workspace_theme_delete', { themeId: bigTheme.id, expectedRevision: library.revision })) as Reply;
  const removedAudit = JSON.stringify(removed.result!.__audit);
  assert(removed.ok && removedAudit.length < 2000 && !removedAudit.includes('data:image'), `A delete receipt carries the removed theme only (${removedAudit.length} chars)`);
  await undoAuditEntry({ entry: auditOf(removed, 'wh_workspace_theme_delete') });
  const back = (await readThemeLibrary()).themes.find(theme => theme.id === bigTheme.id);
  assert(back && back.values.backgroundImage === big && back.name === 'Con foto' && back.createdAt === bigTheme.createdAt, 'Undo of a delete brings the theme back with its exact picture from the side store');
  // Bytes gone from the side store: the undo is refused (never faked).
  const lib2 = await readThemeLibrary();
  const removed2 = (await runBridgeTool('wh_workspace_theme_delete', { themeId: bigTheme.id, expectedRevision: lib2.revision })) as Reply;
  await db.settings.filter(row => row.key.startsWith(PICTURE_PREFIX)).delete();
  assert(await rejects(() => undoAuditEntry({ entry: auditOf(removed2, 'wh_workspace_theme_delete') })) === 'cannot-undo' && !(await readThemeLibrary()).themes.some(theme => theme.id === bigTheme.id), 'Undo of a delete is refused with cannot-undo when the picture bytes are gone');
  // Apply: the previous own picture goes to the side store too.
  await db.settings.filter(row => row.key.startsWith(PICTURE_PREFIX) || row.key === PICTURE_INDEX_KEY).delete();
  const rev0 = (await getWorkspaceAppearance({ projectId: P1 })).revision;
  await saveWorkspaceAppearance({ projectId: P1 }, { background: '#223344', backgroundImage: big }, rev0);
  const lightTheme = (await readThemeLibrary()).themes.find(theme => theme.name === 'Sin foto')!;
  const rev1 = (await getWorkspaceAppearance({ projectId: P1 })).revision;
  const applied = (await runBridgeTool('wh_workspace_theme_apply', { themeId: lightTheme.id, projectId: P1, expectedRevision: rev1 })) as Reply;
  const applyAudit = JSON.stringify(applied.result!.__audit);
  assert(applied.ok && applyAudit.length < 2000 && !applyAudit.includes('data:image') && (await getWorkspaceAppearance({ projectId: P1 })).own.backgroundImage === undefined, `An apply receipt keeps the previous picture out (${applyAudit.length} chars)`);
  await undoAuditEntry({ entry: auditOf(applied, 'wh_workspace_theme_apply') });
  assert((await getWorkspaceAppearance({ projectId: P1 })).own.backgroundImage === big, 'Undo of an apply restores the previous picture byte for byte');
  // The side store is bounded.
  for (let i = 0; i < MAX_STASHED_PICTURES + 4; i++) await stashPicture(`data:image/png;base64,${String(i).padStart(4, '0')}AAAA`);
  const kept = await stashRows();
  assert(kept.length <= MAX_STASHED_PICTURES && kept.length >= 1, `The picture side store keeps at most ${MAX_STASHED_PICTURES} pictures, has ${kept.length}`);
  passed.push('Theme save/delete/apply receipts hold only the added or removed theme (or the previous own values) with a picture hash, so audit lines stay under 2 KB; the bytes wait in a bounded side store and the undo is refused with cannot-undo when they are gone');

  // ======================================================================================================
  // 2. world.json: wiki editions' standalone reader html is replaced by {omitted, sha256, bytes}; the estimate counts what stays.
  // ======================================================================================================
  const P2 = 'review-d2a-wiki', html = `<html>${'<p>página con imagen inline data:image/png;base64,AAAA</p>'.repeat(6000)}</html>`;
  const withWiki = (name: string, readerHtml: string) => base(P2, { title: 'Wiki', wikiProfiles: [{ id: 'wp', name, revision: 1, createdAt: 1, updatedAt: 1, options: {}, editions: [{ id: 'ed', publishedAt: 1, profileName: name, options: {}, sourceFingerprint: 'f', reader: { html: readerHtml, filename: 'wiki.html', sha256: 'abc123', counts: { entries: 1, maps: 0 } } }] }] } as never);
  await db.projects.put(withWiki('Perfil', html));
  const vault = await buildWorldMarkdownVault(P2, { lang: 'es' }), zip = await JSZip.loadAsync(vault.blob);
  const worldText = await zip.file('world.json')!.async('string'), world = JSON.parse(worldText) as { project: { wikiProfiles: Array<{ editions: Array<{ reader: { html: { omitted: boolean; sha256: string; bytes: number }; filename: string } }> }> } };
  const reader = world.project.wikiProfiles[0].editions[0].reader;
  assert(worldText.length < 5000 && reader.html.omitted === true && reader.html.sha256 === 'abc123' && reader.html.bytes === new TextEncoder().encode(html).byteLength && reader.filename === 'wiki.html', `world.json omits the reader page (${worldText.length} chars): ${JSON.stringify(reader).slice(0, 200)}`);
  const small = await estimateWorldMarkdownVault(P2);
  await db.projects.put(withWiki('P'.repeat(150_000), html));
  const large = await estimateWorldMarkdownVault(P2);
  assert(large.textBytes - small.textBytes > 100_000, `The estimate counts the project record that stays in world.json (+${large.textBytes - small.textBytes})`);
  await db.projects.put(withWiki('Perfil', 'x'));
  assert(Math.abs((await estimateWorldMarkdownVault(P2)).textBytes - small.textBytes) < 2000, 'The omitted reader pages are not counted by the estimate');
  passed.push('world.json replaces each wiki edition\'s reader html with {omitted, sha256, bytes} (a 300 KB page leaves a world.json under 5 KB) and the estimate counts the project record that stays, not the omitted pages');

  // ======================================================================================================
  // 3. Media memory guard: per-file and total limits with warnings; the UI asks above a threshold.
  // ======================================================================================================
  assert(MEDIA_FILE_LIMIT_BYTES === 200 * 1048576 && MEDIA_TOTAL_LIMIT_BYTES === 1024 * 1048576 && MEDIA_CONFIRM_BYTES === 500 * 1048576, 'Default limits: 200 MB per file, 1 GB in all, ask above 500 MB');
  const P3 = 'review-d2a-media', now = 1791532800000;
  await db.projects.put(base(P3, { title: 'Medios' }));
  const asset = (id: string, size: number) => ({ id, projectId: P3, title: id, kind: 'audio', mime: 'audio/mpeg', blob: new Blob([new Uint8Array(size).fill(7)], { type: 'audio/mpeg' }), size, notes: '', tags: [], linkedEntryIds: [], createdAt: now, updatedAt: now });
  await db.localMediaAssets.bulkPut([asset('a1', 100), asset('a2', 3000), asset('a3', 1500), asset('a4', 1500), asset('a5', 1500), asset('a6', 1500), asset('a7', 10)] as never);
  const guarded = await buildWorldMarkdownVault(P3, { includeMedia: true, lang: 'es', mediaLimits: { perFile: 2000, total: 5000 } });
  const mediaFiles = Object.keys((await JSZip.loadAsync(guarded.blob)).files).filter(path => path.startsWith('media/') && !path.endsWith('/'));
  assert(mediaFiles.length === 4 && guarded.summary.media === 4, `Kept the 100 + 3 x 1500 byte files only (${mediaFiles.join()})`);
  assert(guarded.warnings.some(line => line.includes('a2') && line.includes('límite')) && guarded.warnings.some(line => /2 archivo\(s\) se han dejado fuera/.test(line)), `Warnings name the oversize file and the files cut by the total: ${guarded.warnings.join(' | ')}`);
  // The panel asks when the estimate with media is over the threshold, and lists the warnings.
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL, originalAnchor = HTMLAnchorElement.prototype.click;
  let downloads = 0;
  URL.createObjectURL = () => { downloads++; return 'blob:review'; }; URL.revokeObjectURL = () => {}; HTMLAnchorElement.prototype.click = function () { /* no navigation */ };
  try {
    await mount(<WorldMarkdownExportPanel projectId={P3} confirmAboveBytes={1000} mediaLimits={{ perFile: 2000, total: 5000 }} />);
    await waitFor(() => /MB/.test(q('world-md-estimate')?.textContent ?? ''), 'estimate');
    await click('world-md-start', 400);
    await waitFor(() => q('world-md-notice'), 'text-only export'); assert(!q('world-md-confirm') && downloads === 1, 'Without media there is nothing to confirm');
    await click('world-md-include-media', 50); await click('world-md-start', 100);
    assert(q('world-md-confirm') && /Con medios, el archivo pesaría/.test(q('world-md-confirm')!.textContent ?? '') && downloads === 1, 'With media over the threshold the panel asks first');
    await click('world-md-confirm-no', 50); assert(!q('world-md-confirm') && downloads === 1, 'No keeps everything as it was');
    await click('world-md-start', 100); await click('world-md-confirm-yes', 600);
    await waitFor(() => q('world-md-warnings'), 'warnings list');
    assert(downloads === 2 && /a2/.test(q('world-md-warnings')!.textContent ?? '') && q('world-md-warnings')!.querySelectorAll('li').length === 2, `Yes exports and the UI lists what was left out: ${q('world-md-warnings')?.textContent}`);
    await unmount();
  } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; HTMLAnchorElement.prototype.click = originalAnchor; }
  passed.push('Media export skips any file over the per-file limit, stops adding past the total limit, lists both as warnings in the result and in the panel, and the panel asks before exporting with media over the threshold (200 MB / 1 GB / 500 MB by default)');

  // ======================================================================================================
  // 4. renderTableCsv is linear.
  // ======================================================================================================
  const ROWS = 20_000;
  const table: WorldTable = { id: 't', title: 'Grande', mode: 'table', columns: [{ id: 'a', name: 'Nombre', kind: 'text' }, { id: 'b', name: 'Cantidad', kind: 'number' }, { id: 'c', name: 'Nota', kind: 'text' }], rows: Array.from({ length: ROWS }, (_, i) => ({ id: `r${i}`, cells: { a: `Fila ${i}`, b: String(i), c: i % 7 ? '' : 'nota, con coma' } })) } as unknown as WorldTable;
  const context = { data: { project: base('csv'), entries: [] } } as unknown as RenderContext;
  const started = performance.now(), csv = renderTableCsv(table, context), elapsed = performance.now() - started;
  const lines = csv.split('\r\n');
  assert(lines.length === ROWS + 1 && lines[1].startsWith('"Fila 0"') && lines[1].includes('nota, con coma'), `CSV shape: ${lines[1]}`);
  assert(lines[ROWS].startsWith(`"Fila ${ROWS - 1}"`), 'Last row is where it should be');
  assert(elapsed < 3000, `A 20,000-row table renders its CSV under 3 s (took ${Math.round(elapsed)} ms)`);
  passed.push(`renderTableCsv indexes columns, rows and display rows once: 20,000 rows x 3 columns in ${Math.round(elapsed)} ms with the same output shape`);

  // ======================================================================================================
  // 5. Applying a saved theme from the UI: confirm over unsaved edits, the seen revision, a Deshacer that restores.
  // ======================================================================================================
  const P5 = 'review-d2a-apply';
  await db.projects.put(base(P5));
  await db.settings.where('key').equals(THEME_LIBRARY_KEY).delete();
  const own = await saveWorkspaceAppearance({ projectId: P5 }, { mode: 'dark', background: '#112233', accent: '#aabbcc' }, 0);
  const { theme } = await addTheme({ name: 'Tema X', values: { mode: 'light', background: '#f0e8d8', accent: '#775533' } });
  clearUndoJournal();
  await mount(<><ToastHost /><WorkspaceAppearance projectId={P5} /></>);
  await act(async () => { const form = q('workspace-appearance') as HTMLDetailsElement; form.open = true; form.dispatchEvent(new Event('toggle')); await pause(300); });
  await click('theme-preset-midnight', 100);
  await click(`theme-apply-${theme.id}`, 200);
  assert(q('theme-apply-confirm') && (await getWorkspaceAppearance({ projectId: P5 })).revision === own.revision, 'Unsaved edits: the apply asks first and nothing was written');
  await click('theme-apply-confirm-no', 100);
  assert(!q('theme-apply-confirm') && (await getWorkspaceAppearance({ projectId: P5 })).revision === own.revision, 'Cancel keeps the form and the saved look');
  await click(`theme-apply-${theme.id}`, 100); await click('theme-apply-confirm-yes', 500);
  const applied5 = await getWorkspaceAppearance({ projectId: P5 });
  assert(applied5.revision === own.revision + 1 && applied5.own.background === '#f0e8d8', 'Confirmed: the theme replaced the look');
  const undo5 = toastActions().at(-1);
  assert(undo5 && undo5.textContent === 'Deshacer' && getUndoJournal().some(entry => entry.projectId === P5 && entry.kind === 'appearance'), 'The apply is in the undo journal with a Deshacer toast');
  await act(async () => { undo5.click(); await pause(500); });
  const restored5 = await getWorkspaceAppearance({ projectId: P5 });
  assert(JSON.stringify(restored5.own) === JSON.stringify(own.own) && restored5.revision === own.revision + 2, `Deshacer puts the previous own look back: ${JSON.stringify(restored5.own)}`);
  // Refused when the appearance moved after the apply.
  await click(`theme-apply-${theme.id}`, 500);
  const afterSecond = await getWorkspaceAppearance({ projectId: P5 });
  assert(afterSecond.own.background === '#f0e8d8', 'Second apply (no unsaved edits: no question)');
  const staleUndo = toastActions().at(-1)!;
  await saveWorkspaceAppearance({ projectId: P5 }, { grain: 7 }, afterSecond.revision);
  await act(async () => { staleUndo.click(); await pause(500); });
  assert((await getWorkspaceAppearance({ projectId: P5 })).own.grain === 7 && (await getWorkspaceAppearance({ projectId: P5 })).own.background === '#f0e8d8' && document.body.textContent!.includes('No se pudo deshacer: cambió desde entonces'), 'Deshacer refuses (never forces) when the look was saved after the apply');
  // The revision the person saw: a look saved elsewhere after the form loaded is not overwritten.
  const seen = await getWorkspaceAppearance({ projectId: P5 });
  await saveWorkspaceAppearance({ projectId: P5 }, { grain: 40 }, seen.revision);
  await click(`theme-apply-${theme.id}`, 300);
  assert((await getWorkspaceAppearance({ projectId: P5 })).own.grain === 40 && /ha cambiado/.test(host.textContent ?? ''), 'An apply against a revision the person did not see is refused, with the draft kept');
  await unmount();
  passed.push('Applying a saved theme in the form asks before replacing unsaved edits, writes against the revision the person saw, records the previous own look in the undo journal, and its Deshacer restores it or refuses when the look changed since');

  // ======================================================================================================
  // 6. Undo journal: a failure keeps the entry; a partial archive undo says "N de M" and the rest can be retried.
  // ======================================================================================================
  clearUndoJournal();
  let attempts = 0;
  const flaky = recordUndoable({ projectId: 'j', kind: 'rename', label: 'Flaky', undo: async () => { attempts++; if (attempts === 1) throw new Error('disk busy'); } });
  assert(await undoEntry(flaky.id) === 'failed' && getUndoJournal().some(entry => entry.id === flaky.id), 'A failed undo keeps its entry');
  assert(await undoEntry(flaky.id) === 'undone' && !getUndoJournal().some(entry => entry.id === flaky.id) && attempts === 2, 'It can be retried and then leaves the journal');
  const P6 = 'review-d2a-archive';
  await db.projects.put(base(P6));
  const card = (id: string, title: string): CodexEntry => ({ id, projectId: P6, type: 'character', title, fields: {}, content: 'Texto', tags: [], relations: [], createdAt: 1, updatedAt: 1 });
  await db.codexEntries.bulkPut([card('a-1', 'Uno'), card('a-2', 'Dos'), card('a-3', 'Tres')]);
  await deleteLibraryDocuments(['a-1', 'a-2', 'a-3'].map(id => workspaceDocument(P6, 'codex', id, id)), P6);
  const multi = getUndoJournal().find(entry => entry.projectId === P6);
  assert(multi && !(await db.codexEntries.get('a-1')), 'Three documents archived and journalled as one entry');
  await db.codexEntries.put(card('a-2', 'Ocupado por otra cosa'));
  assert(await undoEntry(multi.id) === 'partial', 'The undo reports a partial result');
  assert(!!(await db.codexEntries.get('a-1')) && (await db.codexEntries.get('a-2'))?.title === 'Ocupado por otra cosa' && !(await db.codexEntries.get('a-3')), 'Only the first was restored; the occupied one was not forced');
  assert(document.body.textContent!.includes('Se restauraron 1 de 3') || getUndoJournal().some(entry => entry.id === multi.id), 'Se restauraron 1 de 3 (entry kept)');
  assert(getUndoJournal().some(entry => entry.id === multi.id), 'The entry stays so the rest can be retried');
  await db.codexEntries.delete('a-2');
  assert(await undoEntry(multi.id) === 'undone' && !!(await db.codexEntries.get('a-2')) && !!(await db.codexEntries.get('a-3')) && !getUndoJournal().some(entry => entry.id === multi.id), 'Once the obstacle is gone the retry restores the rest without repeating the first');
  const direct = recordUndoable({ projectId: 'j', kind: 'rename', label: 'Parcial', undo: async () => { throw new UndoPartialError(2, 5, new Error('x')); } });
  assert(await undoEntry(direct.id) === 'partial', 'UndoPartialError is the explicit partial result');
  clearUndoJournal();
  passed.push('undoEntry keeps its entry after a failure, a multi-document archive undo that restores only some says "Se restauraron N de M" and the rest can be retried without redoing the first');

  // ======================================================================================================
  // 7-9. Workspace tabs: stale close, fresh-document delete, shortcut guards, exact reopen.
  // ======================================================================================================
  const PT = 'review-d2a-tabs', route = (engine: string, key: string, id: string) => `/project/${PT}/${engine}?${key}=${id}`;
  const writing = (id: string, title: string, content: string, createdAt = 1): Writing => ({ id, projectId: PT, title, status: 'draft', content, wordCount: content ? 2 : 0, tags: [], createdAt, updatedAt: createdAt });
  const entry = (id: string, title: string, extra: Partial<CodexEntry> = {}): CodexEntry => ({ id, projectId: PT, type: 'character', title, fields: {}, content: '', tags: [], relations: [], createdAt: Date.now(), updatedAt: 1, ...extra });
  const nowMs = Date.now();
  try { window.localStorage.removeItem(tabsStorageKey(PT)); } catch { /* storage may be blocked */ }
  clearUndoJournal(); forgetKeptDocuments();
  await db.projects.put(base(PT, { title: 'Pestañas' }));
  await db.writings.bulkPut([writing('w1', 'Capítulo uno', 'Había una vez', 1), writing('w2', 'Capítulo dos', 'Otro día', 1), writing('w-fresh', 'Sin título', '', nowMs), writing('w-race', 'Sin título', '', nowMs)]);
  await db.codexEntries.bulkPut([entry('c1', 'Alma', { content: 'Una capitana' }), entry('c2', 'Beta', { content: 'Otra ficha' })]);
  function Tool({ engine }: { engine: string }) {
    const pane = useEnginePane(), id = pane?.instanceId ?? 'root';
    return <div data-testid={`tool-${id}`} data-engine={engine}>
      {pane?.primary && [['w1', 'writings', 'writing'], ['w2', 'writings', 'writing'], ['c1', 'codex', 'entry'], ['c2', 'codex', 'entry'], ['w-fresh', 'writings', 'writing'], ['w-race', 'writings', 'writing']].map(([doc, eng, key]) => <button key={doc} type="button" data-testid={`beside-${doc}`} onClick={() => pane.openBeside?.(route(eng, key, doc))}>{doc}</button>)}
      {!pane?.primary && <button type="button" data-testid={`report-${id}`} onClick={() => pane?.reportTitle?.('Título nuevo')}>report</button>}
    </div>;
  }
  const engineOf = (id: string) => ({ id, name: id, description: '', category: 'core', icon: BookOpen, tables: {}, component: () => <Tool engine={id} /> }) as EngineDefinition;
  const all = ['writings', 'codex'].map(engineOf);
  const render = async (engines: EngineDefinition[]) => mount(<MemoryRouter initialEntries={[`/project/${PT}/writings?writing=main`]}><ToastHost /><ProjectWorkspace projectId={PT} engines={engines}><Tool engine="writings" /></ProjectWorkspace></MemoryRouter>);
  const tabs = () => [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
  const key = async (init: KeyboardEventInit) => { const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }); await act(async () => { window.dispatchEvent(event); await pause(200); }); return event; };
  const selectedIndex = () => tabs().findIndex(tab => tab.getAttribute('aria-selected') === 'true');
  const tabId = (index: number) => tabs()[index].id.replace('tab-', '');
  await render(all);

  // 7a. A close that waits for saving does not overwrite what landed meanwhile.
  await click('beside-w1'); await click('beside-w2');
  assert(tabs().length === 2, 'Two tabs open');
  const second = tabId(1), first = tabId(0);
  await act(async () => { void trackPendingWrite(new Promise<void>(resolve => setTimeout(resolve, 500))); await pause(10); });
  await act(async () => { q(`workspace-close-tab-${first}`)!.click(); await pause(100); });
  await act(async () => { q(`report-${second}`)!.click(); await pause(100); });
  await waitFor(() => tabs().length === 1, 'the close to finish');
  assert(tabs()[0].textContent!.includes('Título nuevo'), `The title reported while the close waited survives: ${tabs()[0].textContent}`);
  await click(`workspace-close-tab-${tabId(0)}`, 400);
  assert(tabs().length === 0, 'Closed all');

  await pause(600); await click('beside-w-race', 400);
  await waitFor(() => tabs().length === 1 && !(q(`workspace-close-tab-${tabId(0)}`) as HTMLButtonElement | null)?.disabled, 'the new tab to be ready');
  await click(`workspace-close-tab-${tabId(0)}`, 300);
  await click(`workspace-close-tab-${tabId(0)}`, 300);
  await waitFor(() => q('workspace-fresh-prompt'), 'the keep-or-delete question about the empty new document');
  await db.writings.update('w-race', { content: '<p>Escribí algo mientras decidía</p>', wordCount: 4 });
  await click('workspace-fresh-delete', 600);
  assert(await db.writings.get('w-race') && (await db.documentArchives.where('sourceId').equals('w-race').count()) === 0, 'The document written to meanwhile is kept, not deleted');
  passed.push('requestClose reads the tabs after its waits (a title reported while saving survives) and "Borrar" re-checks emptiness at delete time and keeps a document that is no longer empty');

  // 8. What counts as empty.
  const fresh = (engine: 'codex' | 'writings', id: string) => freshUntouchedDocument(PT, engine, id);
  await db.writings.bulkPut([{ ...writing('e-blank', 'Sin título', '<p></p>', nowMs), wordCount: 0 }, { ...writing('e-image', 'Sin título', '<p><img src="data:image/png;base64,AAAA"></p>', nowMs), wordCount: 0 }, { ...writing('e-embed', 'Sin título', '<aside data-wh-codex-block="true" data-entry-id="x"><p>Codex</p></aside>', nowMs), wordCount: 0 }, writing('e-title', 'Mi capítulo', '', nowMs)]);
  await db.codexEntries.bulkPut([entry('k-blank', 'Sin título'), entry('k-ref', 'Sin título', { referenceFields: { Aliado: ['c1'] } }), entry('k-title', 'Alma II'), entry('k-field', 'Sin título', { fields: { oficio: 'Capitana' } }), entry('k-avatar', 'Sin título', { avatarOriginal: 'data:image/png;base64,AAAA' })]);
  assert(await fresh('writings', 'e-blank') && await fresh('codex', 'k-blank'), 'A blank page with the default title is still fresh');
  for (const [engine, id, why] of [['writings', 'e-image', 'an image only'], ['writings', 'e-embed', 'an embedded block'], ['writings', 'e-title', 'a title the writer typed'], ['codex', 'k-ref', 'a filled reference field'], ['codex', 'k-title', 'a typed card title'], ['codex', 'k-field', 'a filled field'], ['codex', 'k-avatar', 'only an original picture']] as const) assert(!(await fresh(engine, id)), `${why} is not empty`);
  passed.push('A card or chapter with only an image, an embedded block, a typed title, a filled field or reference field, or a picture is no longer treated as empty');

  // 9. Shortcut guards (start from a layout with nothing recently closed).
  await unmount(); try { window.localStorage.removeItem(tabsStorageKey(PT)); } catch { /* storage may be blocked */ }
  await render(all);
  await click('beside-w1'); await click('beside-c1');
  assert(tabs().length === 2 && selectedIndex() === 1, 'Two tabs, the second active');
  await key({ key: '1', ctrlKey: true });
  assert(selectedIndex() === 0, 'Mod+1 jumps to the first tab');
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); document.body.appendChild(dialog);
  await key({ key: '2', ctrlKey: true });
  assert(selectedIndex() === 0, 'Mod+digit does nothing behind an open modal dialog');
  dialog.remove();
  await key({ key: '2', ctrlKey: true, repeat: true });
  assert(selectedIndex() === 0, 'A held-down key (repeat) is ignored');
  await key({ key: '2', ctrlKey: true });
  assert(selectedIndex() === 1, 'Without the dialog or repeat it works again');
  const noneYet = await key({ key: 'T', ctrlKey: true, shiftKey: true });
  assert(!noneYet.defaultPrevented && tabs().length === 2, 'Mod+Shift+T with nothing to reopen is left to the browser');
  await click(`workspace-close-tab-${tabId(1)}`, 400); await click(`workspace-close-tab-${tabId(0)}`, 400);
  assert(tabs().length === 0, 'Both closed');
  const held = await key({ key: 'T', ctrlKey: true, shiftKey: true, repeat: true });
  assert(!held.defaultPrevented && tabs().length === 0, 'A repeated Mod+Shift+T reopens nothing');
  const reopened = await key({ key: 'T', ctrlKey: true, shiftKey: true });
  assert(reopened.defaultPrevented && tabs().length === 1, 'Mod+Shift+T reopens the last closed tab and takes the keystroke');
  // Exact reopen from the list when another entry's tool is off.
  await click('beside-c2');
  await click(`workspace-close-tab-${tabId(0)}`, 400);
  assert(tabs().length === 1, 'One codex tab left; two tabs are in the recently-closed list');
  await act(async () => { root!.render(<MemoryRouter initialEntries={[`/project/${PT}/writings?writing=main`]}><ToastHost /><ProjectWorkspace projectId={PT} engines={[engineOf('codex')]}><Tool engine="writings" /></ProjectWorkspace></MemoryRouter>); await pause(200); });
  await click('workspace-tab-overview-toggle', 100);
  const reopenButtons = [0, 1].map(at => q(`workspace-overview-reopen-${at}`) as HTMLButtonElement | null);
  assert(reopenButtons[0] && reopenButtons[1] && reopenButtons[0].disabled && !reopenButtons[1].disabled, 'The entry whose tool is off cannot be reopened; the other can');
  await click('workspace-overview-reopen-1', 300);
  const savedLayout = JSON.parse(window.localStorage.getItem(tabsStorageKey(PT)) ?? '{}') as { tabs: Array<{ history: Array<{ search: string }> }>; closed: Array<{ engineId: string }> };
  assert(savedLayout.tabs.length === 2 && savedLayout.tabs.some(tab => tab.history[0].search.includes('entry=c1')) && savedLayout.closed.length === 1 && savedLayout.closed[0].engineId === 'writings', `Exactly the clicked entry came back: ${JSON.stringify(savedLayout)}`);
  passed.push('Shortcuts ignore key repeat and any open modal dialog, Mod+Shift+T is only taken when something can be reopened, and a recently-closed entry reopens exactly that entry (its button is off when its tool is off)');
  await unmount();

  // ======================================================================================================
  // 10. Reserved Windows names before any dot; the tab layout key goes with the project.
  // ======================================================================================================
  assert(safeName('con.txt') === 'con_.txt' && safeName('Aux.notes.md') === 'Aux_.notes.md' && safeName('COM1') === 'COM1_' && safeName('lpt9.log') === 'lpt9_.log' && safeName('concierto.txt') === 'concierto.txt' && safeName('console') === 'console', `Reserved names: ${safeName('con.txt')} ${safeName('Aux.notes.md')} ${safeName('COM1')}`);
  const P10 = 'review-d2a-delete';
  await db.projects.put(base(P10));
  try { window.localStorage.setItem(tabsStorageKey(P10), JSON.stringify({ tabs: [], activeId: '', closed: [] })); } catch { /* storage may be blocked */ }
  await deleteProject(P10);
  let leftover: string | null = 'unknown';
  try { leftover = window.localStorage.getItem(tabsStorageKey(P10)); } catch { leftover = null; }
  assert(leftover === null, 'Deleting a project removes its wh:workspace-tabs key');
  passed.push('safeName checks the part before the first dot against the Windows reserved names ("con.txt" becomes "con_.txt"), and deleting a project removes its wh:workspace-tabs:v1 key');

  // Cleanup of what the test made.
  for (const id of [P1, P2, P3, P5, P6, PT, 'csv']) await db.projects.delete(id);
  await db.localMediaAssets.where('projectId').equals(P3).delete();
  await db.settings.where('key').equals(THEME_LIBRARY_KEY).delete();
  await db.settings.filter(row => row.key.startsWith(PICTURE_PREFIX) || row.key === PICTURE_INDEX_KEY).delete();
  return passed;
}
