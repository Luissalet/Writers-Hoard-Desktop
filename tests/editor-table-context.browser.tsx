import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { CellSelection } from '@tiptap/pm/tables';
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import TiptapEditor from '@/components/editor/TiptapEditor';
import { AdvancedEditorToolbar, createAdvancedExtensions, TableControls } from '@/components/editor/advanced';
import { runTableAction } from '@/components/editor/advanced/tableActions';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { getPendingWritesSnapshot } from '@/services/pendingWrites';
import { getBridgeTool } from '@/services/aiBridge/manifest';
import { TOOL_HANDLERS } from '@/services/aiBridge/tools';
import { createToolExecutor, type AuditLine } from '@/services/aiRuntime/executorCore';
import { undoAuditEntry } from '@/services/aiBridge/undo';

const seed = '<p>Before Ω</p><table><tbody><tr><td><p>AΩ</p></td><td><p>Bβ</p></td></tr><tr><td><p>C你</p></td><td><p>D🙂</p></td></tr></tbody></table><p>After 李明</p>';
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
function equal(a: unknown, b: unknown, message: string) { assert(JSON.stringify(a) === JSON.stringify(b), message + ': ' + JSON.stringify({ actual: a, expected: b })); }
const frames = async (n = 4) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise<void>(r => requestAnimationFrame(() => r())); }); };
const toolbar = () => document.querySelector<HTMLElement>('[data-table-controls]');
const button = (action: string) => { const node = toolbar()?.querySelector<HTMLButtonElement>(`[data-table-action="${action}"]`); assert(node, 'button ' + action); return node; };
function cellPositions(editor: Editor) { const out: number[] = []; editor.state.doc.descendants((node, pos) => { if (['cell', 'header_cell'].includes(node.type.spec.tableRole ?? '')) out.push(pos); }); return out; }
async function selectCell(editor: Editor, index: number) { await act(async () => { editor.commands.setTextSelection(cellPositions(editor)[index] + 2); editor.view.focus(); }); await frames(); }
async function click(action: string) { await act(async () => { const b = button(action); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1 })); b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); }); await frames(); }
async function key(node: Element, value: string, altKey = false) { let event!: KeyboardEvent; await act(async () => { event = new KeyboardEvent('keydown', { key: value, altKey, bubbles: true, cancelable: true }); node.dispatchEvent(event); }); await frames(); return event; }
const cellTexts = (editor: Editor) => [...editor.view.dom.querySelectorAll('tr')].map(row => [...row.querySelectorAll('td,th')].map(cell => cell.textContent));

/** Regression for actual focus, including a later gesture BEFORE the queued frame. */
export async function testEditorTableContextFocus(): Promise<string[]> {
  const checks: string[] = [];
  for (const mode of ['dialog', 'normal-alt', 'external', 'arrow', 'readonly'] as const) {
    const parent = mode === 'dialog' ? document.createElement('dialog') : document.createElement('div');
    parent.setAttribute('role', mode === 'dialog' ? 'dialog' : 'group'); parent.style.margin = '60px'; document.body.appendChild(parent);
    if (parent instanceof HTMLDialogElement) parent.showModal();
    const host = document.createElement('div'), controls = document.createElement('div'), outside = document.createElement('input'); parent.append(host, controls, outside);
    const root = createRoot(controls), editor = new Editor({ element: host, extensions: [StarterKit, ...createAdvancedExtensions()], content: '<table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr></tbody></table><p>After</p>' });
    const send = (target: Element, value: string, altKey = false) => { const event = new KeyboardEvent('keydown', { key: value, altKey, bubbles: true, cancelable: true }); target.dispatchEvent(event); return event; };
    try {
      await act(async () => root.render(<TableControls editor={editor} />)); await selectCell(editor, 0);
      assert(toolbar(), mode + ' health visible toolbar');
      if (mode === 'dialog' || mode === 'normal-alt') {
        let event!: KeyboardEvent; await act(async () => { event = send(editor.view.dom, 'F10', true); }); await frames();
        assert(event.defaultPrevented && toolbar()!.contains(document.activeElement), mode + ' shortcut and actual focus');
        if (mode === 'dialog') assert(parent.contains(toolbar()), 'toolbar remains in modal allowed focus region');
      } else {
        const first = button('rowBefore'); await act(async () => first.focus()); await frames(); assert(document.activeElement === first, 'real button focus health');
        await act(async () => {
          send(first, 'Enter');
          if (mode === 'external') outside.focus();
          if (mode === 'arrow') send(first, 'ArrowRight');
          if (mode === 'readonly') { editor.setEditable(false); outside.focus(); }
        }); await frames();
        if (mode === 'readonly') { await act(async () => editor.setEditable(true)); await frames(); }
        if (mode === 'arrow') equal((document.activeElement as HTMLElement).dataset.tableAction, 'row', 'later arrow wins');
        else assert(document.activeElement === outside && !toolbar(), 'later external focus wins through readonly/frame');
      }
      checks.push('focus regression ' + mode);
    } finally { await act(async () => root.unmount()); editor.destroy(); if (parent instanceof HTMLDialogElement) parent.close(); parent.remove(); }
  }
  return checks;
}

/** Real PM selection and layout, plus a mounted incumbent TiptapEditor and registered handler. */
export async function testEditorTableContext(): Promise<string[]> {
  const checks: string[] = [], projectId = 'table-context-' + crypto.randomUUID(), editors: Editor[] = [];
  Reflect.set(window, '__tableContextChecks', checks);
  assert(db.tables.length === 89 && (await Promise.all(db.tables.map(table => table.count()))).every(n => n === 0), 'fresh private library');
  const style = document.createElement('style');
  // Geometry fixtures, not product CSS or a visual-design acceptance.
  style.textContent = '.context-test{width:520px;margin:70px 20px 20px}.context-test table{border-collapse:collapse;width:500px}.context-test td,.context-test th{border:1px solid;padding:8px;min-width:100px}.context-test [contenteditable]{outline:none}[data-table-controls]{display:flex;flex-wrap:wrap;gap:4px;padding:4px;background:white}[data-table-controls] button{height:32px;min-width:32px;display:inline-flex;align-items:center;justify-content:center}';
  document.head.appendChild(style);
  const surface = document.createElement('div'); surface.className = 'context-test tiptap-editor'; surface.style.overflow = 'hidden'; document.body.appendChild(surface);
  const host = document.createElement('div'), controls = document.createElement('div'); surface.append(host, controls);
  const root = createRoot(controls), outside = document.createElement('input'); document.body.appendChild(outside);
  const editor = new Editor({ element: host, extensions: [StarterKit, ...createAdvancedExtensions()], content: seed }); editors.push(editor);
  let normalRoot: ReturnType<typeof createRoot> | undefined, normalHost: HTMLElement | undefined;
  try {
    await act(async () => root.render(<StrictMode><TableControls editor={editor} /><AdvancedEditorToolbar editor={editor} /></StrictMode>));
    const pristine = editor.getHTML(), undoBefore = editor.can().undo();
    await selectCell(editor, 0);
    assert(toolbar()?.getAttribute('role') === 'toolbar' && toolbar()?.getAttribute('aria-label') === 'Controles de tabla', 'Spanish contextual toolbar mounted');
    assert(!surface.contains(toolbar()), 'portal escapes overflow-hidden editor');
    equal(editor.getHTML(), pristine, 'open/measure/can do not edit HTML'); equal(editor.can().undo(), undoBefore, 'open/measure/can do not add history');
    checks.push('real table caret opens contextual portal without writes or history');
    for (const [action, target, expected] of [
      ['rowBefore', 2, [['AΩ', 'Bβ'], ['', ''], ['C你', 'D🙂']]],
      ['row', 2, [['AΩ', 'Bβ'], ['C你', 'D🙂'], ['', '']]],
      ['columnBefore', 1, [['AΩ', '', 'Bβ'], ['C你', '', 'D🙂']]],
      ['column', 1, [['AΩ', 'Bβ', ''], ['C你', 'D🙂', '']]],
    ] as const) {
      await selectCell(editor, target); await click(action); equal(cellTexts(editor), expected, action + ' actual placement');
      await act(async () => { assert(editor.commands.undo(), action + ' undo'); }); await frames(); equal(editor.getHTML(), pristine, action + ' single Undo exact');
      checks.push(action + ' preserves sentinels and one Undo restores exact HTML');
    }
    await selectCell(editor, 0); assert(button('merge').disabled && button('split').disabled, 'single ordinary cell cannot merge or split');
    await act(async () => { const cells = cellPositions(editor); editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[0], cells[1]))); editor.view.focus(); }); await frames();
    assert(!button('merge').disabled, 'real two-cell selection enables merge');
    await key(editor.view.dom, 'F10', true); assert(toolbar()?.contains(document.activeElement), 'AltF10 gives real toolbar focus');
    await key(document.activeElement!, 'Home');
    for (let i = 0; i < 5; i++) await key(document.activeElement!, 'ArrowRight');
    equal((document.activeElement as HTMLElement).dataset.tableAction, 'merge', 'arrows reach merge');
    await key(document.activeElement!, 'Enter');
    assert(editor.getHTML().includes('colspan="2"') && editor.getHTML().includes('AΩ') && editor.getHTML().includes('Bβ'), 'keyboard merge uses preserved CellSelection');
    assert(toolbar()?.contains(document.activeElement), 'command keeps actual toolbar focus');
    await act(async () => { assert(editor.commands.undo(), 'Undo merge'); }); await frames(); equal(editor.getHTML(), pristine, 'keyboard merge Undo exact');
    checks.push('real toolbar focus and keyboard merge preserve CellSelection');
    await selectCell(editor, 0); await key(editor.view.dom, 'F10', true); await key(document.activeElement!, 'End'); await key(document.activeElement!, 'Home');
    await key(document.activeElement!, ' '); equal(cellTexts(editor), [['', ''], ['AΩ', 'Bβ'], ['C你', 'D🙂']], 'Space activates focused row-before');
    await act(async () => { assert(editor.commands.undo(), 'Undo Space action'); }); await frames(); equal(editor.getHTML(), pristine, 'Space action one Undo');
    checks.push('Space activates toolbar action without moving the caret to another cell');
    await selectCell(editor, 0); await click('header'); assert(editor.view.dom.querySelectorAll('th').length === 2, 'header command affects same table');
    await act(async () => { assert(editor.commands.undo(), 'Undo header'); }); await frames(); equal(editor.getHTML(), pristine, 'header Undo');
    await selectCell(editor, 2); await click('deleteRow'); equal(cellTexts(editor), [['AΩ', 'Bβ']], 'delete exact row');
    await act(async () => { assert(editor.commands.undo(), 'Undo delete row'); }); await frames(); equal(editor.getHTML(), pristine, 'delete row Undo');
    await selectCell(editor, 1); await click('deleteColumn'); equal(cellTexts(editor), [['AΩ'], ['C你']], 'delete exact column');
    await act(async () => { assert(editor.commands.undo(), 'Undo delete column'); }); await frames(); equal(editor.getHTML(), pristine, 'delete column Undo');
    await selectCell(editor, 0); await click('deleteTable'); assert(!editor.view.dom.querySelector('table') && !toolbar(), 'delete table closes toolbar');
    assert(editor.getText().includes('Before Ω') && editor.getText().includes('After 李明'), 'outside text survives table deletion');
    await act(async () => { assert(editor.commands.undo(), 'Undo delete table'); }); await frames(); equal(editor.getHTML(), pristine, 'delete table Undo');
    checks.push('header and all deletions share original table/history and preserve neighbours');
    await selectCell(editor, 0);
    const c = cellPositions(editor); await act(async () => { editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, c[0], c[1]))); }); await frames();
    await click('merge'); await click('split'); assert(!editor.getHTML().includes('colspan="2"'), 'split real merged cell');
    await act(async () => { assert(editor.commands.undo(), 'Undo split'); }); await frames(); assert(editor.getHTML().includes('colspan="2"'), 'one Undo only reverses split');
    await act(async () => { assert(editor.commands.undo(), 'Undo merge again'); }); await frames(); equal(editor.getHTML(), pristine, 'second Undo only reverses merge');
    checks.push('split has its own undo boundary');
    await selectCell(editor, 0); const beforeEscape = editor.getHTML(); await key(editor.view.dom, 'F10', true); await key(document.activeElement!, 'Escape');
    assert(!toolbar() && editor.view.dom.contains(document.activeElement), 'Escape closes bar and restores editor focus');
    await act(async () => { window.dispatchEvent(new Event('resize')); document.dispatchEvent(new Event('scroll')); }); await frames(); assert(!toolbar(), 'geometry does not reopen dismissed bar');
    equal(editor.getHTML(), beforeEscape, 'Escape is readonly');
    outside.focus(); const unowned = await key(outside, 'F10', true); assert(!unowned.defaultPrevented && !toolbar(), 'outside shortcut untouched');
    await selectCell(editor, 0); await key(editor.view.dom, 'F10', true); const stale = button('row');
    await act(async () => editor.setEditable(false)); await frames(); assert(!toolbar(), 'readonly removes focused toolbar');
    stale.click(); assert(!runTableAction(editor, 'row'), 'readonly executor rejects'); equal(editor.getHTML(), pristine, 'readonly cannot edit');
    await act(async () => editor.setEditable(true)); await selectCell(editor, 0);
    checks.push('Escape/outside shortcuts/readonly transition preserve document');
    const rect = toolbar()!.getBoundingClientRect(); assert(rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1, 'toolbar stays within viewport');
    surface.style.height = '90px'; surface.style.overflow = 'auto'; surface.scrollTop = 160; surface.dispatchEvent(new Event('scroll')); await frames(); assert(!toolbar(), 'clipped anchor removes portal');
    surface.scrollTop = 0; surface.style.height = ''; await selectCell(editor, 0);
    await act(async () => root.render(<StrictMode><TableControls editor={editor} locale="en" /><AdvancedEditorToolbar editor={editor} locale="en" /></StrictMode>)); await frames();
    assert(button('rowBefore').getAttribute('aria-label') === 'Add row above', 'English contextual label');
    const select = controls.querySelector<HTMLSelectElement>('[aria-label="Table"]')!;
    assert(select && [...select.options].some(option => option.value === 'row' && option.text === 'Add row') && [...select.options].some(option => option.value === 'rowBefore'), 'incumbent labels/values and new before coexist');
    await act(async () => { select.value = 'row'; select.dispatchEvent(new Event('change', { bubbles: true })); }); await frames();
    assert(cellTexts(editor).length === 3, 'incumbent menu still runs same action'); await act(async () => { editor.commands.undo(); }); await frames(); equal(editor.getHTML(), pristine, 'incumbent menu Undo exact');
    checks.push('viewport/clipping and unchanged select ES/EN remain functional');
    const editor2Host = document.createElement('div'); surface.appendChild(editor2Host); const second = new Editor({ element: editor2Host, extensions: [StarterKit, ...createAdvancedExtensions()], content: seed }); editors.push(second);
    await act(async () => root.render(<><TableControls editor={editor} /><TableControls editor={second} /></>));
    await selectCell(second, 0); equal(document.querySelectorAll('[data-table-controls]').length, 1, 'only focused editor publishes a toolbar');
    await key(second.view.dom, 'F10', true); await key(document.activeElement!, ' ');
    equal(cellTexts(second), [['', ''], ['AΩ', 'Bβ'], ['C你', 'D🙂']], 'second editor owns keyboard action'); equal(editor.getHTML(), pristine, 'first editor untouched by second toolbar');
    await act(async () => { assert(second.commands.undo(), 'second editor Undo'); }); await frames(); equal(second.getHTML(), pristine, 'second editor own history');
    let focusEvents = 0; const observedFocus = () => { focusEvents++; }; document.addEventListener('focusin', observedFocus, true);
    await selectCell(editor, 0); document.removeEventListener('focusin', observedFocus, true);
    equal(document.querySelectorAll('[data-table-controls]').length, 1, 'focus returns a single toolbar to first editor ' + JSON.stringify({ documentFocused: document.hasFocus(), focusEvents, inA: editor.view.dom.contains(document.activeElement), inB: second.view.dom.contains(document.activeElement), active: document.activeElement?.tagName, bars: [...document.querySelectorAll<HTMLElement>('[data-table-controls]')].map(node => ({ visibility: getComputedStyle(node).visibility, focused: node.contains(document.activeElement), left: node.style.left, top: node.style.top })) }));
    checks.push('two simultaneous editors keep independent toolbar selection and history');
    const foreign = button('row'); await act(async () => root.render(<TableControls editor={second} />)); await frames();
    assert(!toolbar(), 'retarget does not publish old position'); foreign.click(); equal(second.getHTML(), pristine, 'retired button cannot change successor'); equal(editor.getHTML(), pristine, 'retired button cannot change old editor');
    await selectCell(second, 0); assert(toolbar(), 'successor owns new toolbar');
    await act(async () => root.unmount()); await frames(); assert(!toolbar(), 'unmount removes portal');
    await act(async () => { window.dispatchEvent(new Event('resize')); document.dispatchEvent(new Event('scroll')); }); await frames(); assert(!toolbar(), 'no post-unmount portal revival');
    checks.push('retarget and StrictMode/unmount retire old portal and controls');
    checks.push(...await testEditorTableContextFocus());

    normalHost = document.createElement('div'); normalHost.className = 'context-test'; document.body.appendChild(normalHost); normalRoot = createRoot(normalHost);
    const ready: { current: Editor | null } = { current: null }; let emitted = '';
    const onReady = (value: Editor | null) => { ready.current = value; };
    await act(async () => normalRoot!.render(<MemoryRouter><TiptapEditor key="A" content={seed} onChange={html => { emitted = html; }} onEditorReady={onReady} /></MemoryRouter>)); await frames(6);
    assert(ready.current, 'normal TiptapEditor ready'); const original = ready.current.getHTML();
    const beforeScroll = ready.current.view.dom.getBoundingClientRect();
    await act(async () => ready.current!.view.dom.scrollIntoView({ block: 'center' })); await frames();
    Reflect.set(window, '__tableContextIntegrationLayout', { beforeScroll: { top: beforeScroll.top, bottom: beforeScroll.bottom }, afterScroll: ready.current.view.dom.getBoundingClientRect().toJSON(), viewport: { width: innerWidth, height: innerHeight } });
    await selectCell(ready.current, 0); assert(toolbar(), 'normal editor actually mounts controls'); await click('rowBefore');
    assert(emitted.includes('AΩ') && cellTexts(ready.current).length === 3, 'normal onChange receives same editor table');
    await act(async () => { assert(ready.current!.commands.undo(), 'normal Undo'); }); await frames(); equal(ready.current.getHTML(), original, 'normal Undo exact');
    const old = ready.current; await act(async () => normalRoot!.render(<MemoryRouter><TiptapEditor key="B" content="<p>Other document</p>" onEditorReady={onReady} /></MemoryRouter>)); await frames(6);
    assert(old.isDestroyed && !toolbar(), 'keyed normal document switch closes old controls');
    assert(ready.current!.getText() === 'Other document', 'normal document B intact');
    await act(async () => normalRoot!.unmount()); normalRoot = undefined; normalHost.remove(); normalHost = undefined;
    checks.push('normal TiptapEditor integration/onChange/Undo/keyed document lifecycle');

    await db.projects.add({ id: projectId, title: 'Own table context QA', description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#777', enabledEngines: ['writings'], createdAt: 1, updatedAt: 1 });
    await db.writings.add({ id: projectId + '-W', projectId, title: 'Own table', content: seed, wordCount: 8, status: 'draft', tags: [], createdAt: 1, updatedAt: 1 });
    assert(getBridgeTool('wh_edit_writing_document')?.description.includes('toggleHeaderRow') && TOOL_HANDLERS.wh_edit_writing_document, 'header discoverable on registered existing tool');
    const audit: AuditLine[] = []; let enabled = true;
    // Normal executor/registered handler; controlled local relay/audit, NOT Native/MCP transport.
    const execute = createToolExecutor({ writesEnabled: async () => enabled, audit: async line => { audit.push(line); return audit.length - 1; }, relay: async (name, args) => { try { return { ok: true, result: await TOOL_HANDLERS[name](args) }; } catch (error) { return { ok: false, code: (error as { code?: string }).code, error: String(error) }; } } });
    const args = { projectId, id: projectId + '-W' }, ctx = { origin: 'bridge' as const, clientLabel: 'controlled-header-test' };
    const read = await TOOL_HANDLERS.wh_get_writing_document(args) as { html: string; cells: { from: number }[]; updatedAt: number };
    const headerArgs = { ...args, operation: 'toggleHeaderRow', from: read.cells[0].from + 2, expectedUpdatedAt: read.updatedAt };
    const changed = await execute({ tool: 'wh_edit_writing_document', args: headerArgs }, ctx); assert(changed.ok && typeof changed.auditIndex === 'number', 'registered header executor succeeds with audit');
    const saved = await db.writings.get(args.id); assert(saved?.content.includes('<th'), 'header durable HTML saved');
    const beforeReject = JSON.stringify(saved), snapshots = await db.writingSnapshots.count();
    const rejected = await execute({ tool: 'wh_edit_writing_document', args: headerArgs }, ctx); assert(!rejected.ok && rejected.code === 'conflict', 'stale CAS rejected');
    equal(JSON.stringify(await db.writings.get(args.id)), beforeReject, 'stale CAS exact row'); equal(await db.writingSnapshots.count(), snapshots, 'stale CAS no snapshot');
    const undone = await undoAuditEntry({ entry: audit[changed.auditIndex!] }); assert(undone.undone, 'normal audit Undo');
    equal((await TOOL_HANDLERS.wh_get_writing_document(args) as { html: string }).html, read.html, 'audit Undo restores table HTML');
    enabled = false; assert(!(await execute({ tool: 'wh_edit_writing_document', args: { ...headerArgs, expectedUpdatedAt: undefined } }, ctx)).ok, 'existing global writes switch respected');
    checks.push('registered header handler/manifest, durable write, CAS and normal audit Undo');
    return checks;
  } finally {
    if (normalRoot) await act(async () => normalRoot!.unmount()); normalHost?.remove();
    // React permits unmount on an already-unmounted root; all owned editors are retired.
    await act(async () => root.unmount());
    for (const value of editors) if (!value.isDestroyed) value.destroy();
    surface.remove(); outside.remove(); style.remove();
    if (await db.projects.get(projectId)) await deleteProject(projectId);
    await db.settings.clear();
    const rows = await Promise.all(db.tables.map(table => table.count())), ledger = getPendingWritesSnapshot();
    Reflect.set(window, '__tableContextCleanup', { tables: rows.length, rows: rows.reduce((a, b) => a + b, 0), ledger, editorsDestroyed: editors.every(value => value.isDestroyed), portals: document.querySelectorAll('[data-table-controls]').length });
    assert(rows.length === 89 && rows.every(n => n === 0), 'private89zero cleanup'); assert(!ledger.pending && !ledger.failed && !ledger.dirty && !toolbar(), 'ledger/portal cleanup');
    db.close();
  }
}
