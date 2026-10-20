import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { db } from '@/db';
import type { CodexEntry } from '@/types';
import ReferencePanel from '@/engines/writings/components/ReferencePanel';
import { setReferenceOpen, useReferencePrefs } from '@/engines/writings/components/referencePrefs';
import { codexDraftStore } from '@/components/codex/codexDrafts';
import { t } from '@/i18n/useTranslation';

const P = 'test-vvd-reference-edit';
const pause = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export async function testVvdReferenceEdit(): Promise<string[]> {
  const host = document.getElementById('root'); assert(host, 'Missing root');
  const manuscript = document.createElement('div'); document.body.appendChild(manuscript);
  const editor = new Editor({ element: manuscript, extensions: [StarterKit], content: '<p>La Cartógrafa regresa al puerto.</p>' });
  const originalHtml = editor.getHTML();
  const root = createRoot(host);
  const entry: CodexEntry = { id: `${P}-entry`, projectId: P, type: 'character', title: 'Lucía Torres', fields: { aliases: '["La Cartógrafa"]', origin: 'Original' }, content: '<p>Original biography.</p>', tags: [], relations: [], createdAt: 1, updatedAt: 1 };
  const passed: string[] = [];
  function Harness() {
    const prefs = useReferencePrefs();
    return <ReferencePanel projectId={P} writingId={`${P}-writing`} content={editor.getHTML()} editor={editor} prefs={prefs} narrowBreakpoint={1} />;
  }
  const waitFor = async (name: string, condition: () => boolean) => {
    const end = Date.now() + 5000;
    while (!condition() && Date.now() < end) await act(async () => { await pause(); });
    assert(condition(), `Timed out: ${name}. Active: ${document.activeElement?.outerHTML.slice(0, 350)}; editor focus ${editor.view.hasFocus()}; destroyed ${editor.isDestroyed}`);
  };
  const click = async (target: HTMLElement | null | undefined, name: string) => {
    assert(target, `Missing ${name}`);
    await act(async () => { target.click(); await pause(); });
  };
  const modal = () => document.querySelector('[role="dialog"]');
  const title = () => document.querySelector(`input[placeholder="${t('codex.entryName')}"]`) as HTMLInputElement;
  const button = (text: string, within: ParentNode = document) => [...within.querySelectorAll('button')].find(node => node.textContent?.trim() === text);
  const save = async () => click(button(t('codex.saveChanges'), modal()!), 'Save entry');
  const openEdit = async () => click(host.querySelector('[data-testid="reference-edit-entry"]'), 'Edit reference');
  try {
    codexDraftStore(P).clear(); setReferenceOpen(true); await db.codexEntries.put(entry);
    await act(async () => { root.render(<StrictMode><Harness /></StrictMode>); await pause(); });
    await waitFor('matched reference', () => !!host.querySelector('[data-testid="reference-row"]'));
    editor.commands.setTextSelection({ from: 2, to: 9 }); editor.view.focus();
    const selected = { from: editor.state.selection.from, to: editor.state.selection.to };
    await click(host.querySelector('[data-testid="reference-row"] button'), 'Reference preview');
    await openEdit();
    await act(async () => { setInput(title(), 'Lucía del Puerto'); await pause(); });
    // Dirty Escape is consumed by the editor modal, not the reference drawer.
    await act(async () => { title().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await pause(); });
    assert(modal() && host.querySelector('[data-testid="reference-preview"]'), 'Escape discarded the dirty reference edit or selected preview');
    await save();
    await waitFor('save closes modal', () => !modal());
    await waitFor('live preview rename', () => host.querySelector('[data-testid="reference-preview"] h3')?.textContent === 'Lucía del Puerto');
    assert(editor.getHTML() === originalHtml && editor.state.selection.from === selected.from && editor.state.selection.to === selected.to, 'Editing reference changed the manuscript or its selection');
    await waitFor('manuscript focus after save', () => editor.view.hasFocus());
    passed.push('Consulted Codex entries edit in place, refresh the selected preview and preserve manuscript text/focus/selection');

    await openEdit();
    await act(async () => { setInput(title(), 'Local disputed title'); await pause(); });
    const remote = await db.codexEntries.get(entry.id); assert(remote, 'Missing saved fixture');
    await db.codexEntries.put({ ...remote, title: 'Remote reviewed title', updatedAt: remote.updatedAt + 1 });
    await save();
    assert(modal()?.textContent?.includes(t('codex.conflictNotice')), 'Concurrent edits were not surfaced through the shared conflict flow');
    assert((await db.codexEntries.get(entry.id))?.title === 'Remote reviewed title', 'A conflicting local edit overwrote the remote title');
    await click(button(t('codex.keepYourVersion'), modal()!), 'Keep local version');
    await save();
    await waitFor('resolved save', () => !modal());
    assert((await db.codexEntries.get(entry.id))?.title === 'Local disputed title', 'Explicit conflict resolution did not save');
    passed.push('Reference edits respect three-way conflicts and require explicit resolution');

    await openEdit();
    await act(async () => { setInput(title(), 'Retained after failure'); await pause(); });
    const restore = await db.codexEntries.get(entry.id); assert(restore, 'Missing entry before failure');
    await db.codexEntries.delete(entry.id);
    await save();
    assert(modal() && title().value === 'Retained after failure' && modal()?.textContent?.includes(t('codex.saveError')), 'Failed save closed the reference form or lost input');
    assert(codexDraftStore(P).get(entry.id)?.title === 'Retained after failure', 'Failed save lost the recoverable draft');
    await db.codexEntries.put(restore);
    await save();
    await waitFor('retry closes modal', () => !modal());
    assert((await db.codexEntries.get(entry.id))?.title === 'Retained after failure', 'Retry did not save the retained draft');
    passed.push('Save failures retain the reference editor/input/recovery draft and support retry');

    await openEdit();
    await act(async () => { setInput(title(), 'Cancelled alternative'); await pause(); });
    await click(button(t('common.cancel'), modal()!), 'Cancel reference edit');
    await waitFor('cancel closes modal', () => !modal());
    assert(host.querySelector('[data-testid="reference-preview"]') && editor.getHTML() === originalHtml && (await db.codexEntries.get(entry.id))?.title === 'Retained after failure', 'Cancel changed saved data, selected reference or manuscript');
    await openEdit();
    assert(title().value === 'Cancelled alternative', 'Reopening the consulted entry did not restore its draft');
    passed.push('Cancelling reference edits keeps the selected reference and restores unsaved input on reopen');

    const aliasLabel = [...modal()!.querySelectorAll('label')].find(label => label.textContent === t('codex.aliases'));
    const aliasInput = document.getElementById(aliasLabel?.htmlFor ?? '');
    const aliasGroup = aliasInput?.parentElement;
    assert(aliasGroup, 'Missing aliases in reference editor');
    await click(aliasGroup.querySelector('button'), 'Remove formerly mentioned alias');
    await save();
    await waitFor('alias change saved', () => !modal());
    assert(host.querySelector('[data-testid="reference-preview"]'), 'Changed mentions discarded the selected reference preview');
    await click(host.querySelector('[data-testid="reference-preview"] button'), 'Return to reference list');
    await waitFor('mention list recomputed after edit', () => !host.querySelector('[data-testid="reference-row"]'));
    passed.push('Editing an alias recomputes manuscript mentions without discarding the selected preview');
    return passed;
  } finally {
    await act(async () => { root.unmount(); await pause(); });
    editor.destroy(); manuscript.remove();
    await db.codexEntries.where('projectId').equals(P).delete();
    codexDraftStore(P).clear(); setReferenceOpen(false);
  }
}
