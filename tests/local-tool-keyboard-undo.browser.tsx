import '@/engines';
import {act, StrictMode, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {useLocaleStore} from '@/stores/localeStore';
import {registerLocalToolModules} from '@/engines/local/registry';
import definition from '@/engines/local/examples/initiativeDefinition';
import {createSourceToolDocument, readSourceToolDocument} from '@/engines/local/documents/store';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import CodexEntryForm from '@/components/codex/CodexEntryForm';
import {saveCodexDraft} from '@/engines/codex/operations';
import {createLocalToolBlockEnvelope} from '@/engines/local/blocks/definitions';
import {serializeLocalToolBlock, findLocalToolBlocksInHtml} from '@/engines/local/blocks/types';
import {authorCard} from './fixtures/local-tools/author-data';

const assert: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw Error(message); };
const wait = async (test: () => boolean | Promise<boolean>, message: string) => {
  for (let n = 0; n < 160; n++) { if (await test()) return; await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); }
  throw Error(message);
};

export async function testLocalToolKeyboardUndo() {
  const projectId = 'local-keyboard-undo', root = createRoot(document.getElementById('root')!), passed: string[] = [];
  useLocaleStore.setState({locale: 'en', loaded: true});
  registerLocalToolModules({'./installed/examples.initiative/module.tsx': {default: definition}});
  const round = async (id: string) => ((await readSourceToolDocument({projectId}, id))!.document.data as {round: number}).round;
  const button = (scope: Element, label: string) => {
    const result = [...scope.querySelectorAll('button')].find(node => node.textContent?.trim().toLowerCase() === label.toLowerCase());
    assert(result, 'Missing button ' + label); return result;
  };
  const keys = async (target: Element, key = 'z', extra: KeyboardEventInit = {}) => {
    assert(target, 'Keyboard target missing');
    const event = new KeyboardEvent('keydown', {key, ctrlKey: true, bubbles: true, cancelable: true, ...extra});
    await act(async () => { target.dispatchEvent(event); }); return event;
  };
  try {
    await db.projects.put({id: projectId, title: 'Keyboard QA', description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#777777', enabledEngines: ['codex', 'local-tool-' + definition.namespace], engineOrder: [], createdAt: 1, updatedAt: 1});
    const a = await createSourceToolDocument({projectId}, definition.namespace, 'A'), b = await createSourceToolDocument({projectId}, definition.namespace, 'B');
    const owned = createLocalToolBlockEnvelope(definition.namespace, definition.blocks![0], 'keyboard-owned');
    const card = {...authorCard(projectId, 'Keyboard host'), id: 'keyboard-host', content: '<p>Keep this text.</p>' + serializeLocalToolBlock(projectId, owned)};
    await db.codexEntries.put(card);
    function Host() {
      const [entry, setEntry] = useState(card);
      return <><section data-test-a><LocalToolDocumentHost projectId={projectId} documentId={a.id}/></section><section data-test-b><LocalToolDocumentHost projectId={projectId} documentId={b.id}/></section><section data-test-card role="textbox"><CodexEntryForm projectId={projectId} entry={entry} onCancel={() => {}} onSave={async (draft, base) => { setEntry(await saveCodexDraft(base ?? entry, draft)); }}/></section></>;
    }
    await act(async () => { root.render(<StrictMode><MemoryRouter><Host/></MemoryRouter></StrictMode>); });
    const first = document.querySelector('[data-test-a]')!, second = document.querySelector('[data-test-b]')!;
    await wait(() => !!first.querySelector('textarea:not(:disabled)') && !!second.querySelector('textarea:not(:disabled)'), 'Tools did not load');
    await act(async () => { button(first, 'Next round').click(); });
    await wait(async () => await round(a.id) === 2 && !button(first, 'Undo').disabled, 'First edit missing');
    await act(async () => { button(second, 'Next round').click(); });
    await wait(async () => await round(b.id) === 2 && !button(second, 'Undo').disabled, 'Second edit missing');
    const undone = await keys(button(first, 'Next round'));
    await wait(async () => await round(a.id) === 1, 'Focused Ctrl+Z did not undo the source document');
    assert(undone.defaultPrevented && await round(b.id) === 2, 'Undo escaped into another pane');
    await keys(button(first, 'Next round'), 'z', {shiftKey: true});
    await wait(async () => await round(a.id) === 2, 'Ctrl+Shift+Z did not redo');
    passed.push('Focused source document uses existing receipts for keyboard Undo/Redo and leaves another pane intact under StrictMode');

    const native = await keys(first.querySelector('textarea')!);
    assert(!native.defaultPrevented && await round(a.id) === 2, 'Text-input Undo was stolen');
    const repeat = await keys(button(first, 'Next round'), 'z', {repeat: true});
    const composition = await keys(button(first, 'Next round'), 'z', {isComposing: true});
    assert(!repeat.defaultPrevented && !composition.defaultPrevented && await round(a.id) === 2, 'Repeated/composing key mutated tool');
    passed.push('Native text editing, held keys and composition retain their own keyboard behavior');

    const ownedView = () => document.querySelector('[data-source-block-id="keyboard-owned"]')!;
    await wait(() => !!ownedView()?.querySelector('textarea:not(:disabled)'), 'Owned block absent');
    await act(async () => { button(ownedView(), 'Next round').click(); });
    await wait(() => !!ownedView()?.textContent?.includes('Round 2') && !button(ownedView(), 'Undo').disabled, 'Owned edit missing');
    const localUndo = await keys(button(ownedView(), 'Next round'));
    await wait(() => !!ownedView()?.textContent?.includes('Round 1'), 'Owned block keyboard Undo failed');
    assert(localUndo.defaultPrevented, 'Parent textbox swallowed the local block shortcut');
    await keys(button(ownedView(), 'Next round'), 'z', {shiftKey: true});
    await wait(() => !!ownedView()?.textContent?.includes('Round 2'), 'Owned block keyboard Redo failed');
    await act(async () => { button(document.querySelector('[data-test-card]')!, 'Save changes').click(); });
    await wait(async () => {
      const saved = findLocalToolBlocksInHtml((await db.codexEntries.get(card.id))!.content)[0].envelope;
      return saved.scope === 'host' && (saved.data as {round: number}).round === 2;
    }, 'Owned keyboard result did not use normal parent Save');
    assert(await round(a.id) === 2 && await round(b.id) === 2, 'Owned Undo changed another document');
    passed.push('Owned rich-text block keyboard Undo/Redo stays local beneath a parent textbox and persists through normal Save');

    await keys(button(first, 'Next round'));
    await wait(async () => await round(a.id) === 1, 'Second undo missing');
    await keys(button(first, 'Next round'), 'y');
    await wait(async () => await round(a.id) === 2, 'Ctrl+Y did not redo');
    await act(async () => { root.render(<MemoryRouter><LocalToolDocumentHost projectId={projectId} documentId={a.id} readOnly/></MemoryRouter>); });
    await wait(() => !!document.querySelector('[data-source-document-host]') && !document.querySelector('[data-source-counter-view]'), 'Read-only editor remained writable');
    const readonly = await keys(document.querySelector('[data-source-document-host]')!);
    assert(!readonly.defaultPrevented && await round(a.id) === 2, 'Disposed provider retained keyboard ownership');
    passed.push('Ctrl+Y reuses redo and read-only/unmounted tools relinquish keyboard ownership');
    return passed;
  } finally { await act(async () => root.unmount()); await deleteProject(projectId); }
}
