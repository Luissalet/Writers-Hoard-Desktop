// Codex form recovery: an entry form closed before saving comes back with what
// was typed, until it is saved, discarded or its entry is deleted.
//
//   xvfb-run -a npx electron scripts/run-focused-browser-tests.cjs \
//     tests/codex-draft-recovery.browser.tsx testCodexDraftRecovery 120000 --no-sandbox
import { act, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import type { CodexEntry } from '@/types';
import { saveCodexDraft } from '@/engines/codex/operations';
import CodexEntryForm from '@/components/codex/CodexEntryForm';
import CodexEntryList from '@/components/codex/CodexEntryList';
import { codexDraftStore, restoreCodexDraft, toCodexDraft, codexFormValues } from '@/components/codex/codexDrafts';
import { clearProjectDraftStores } from '@/hooks/localDraftStore';
import { t } from '@/i18n/useTranslation';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const pause = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
const P = 'codex-draft-recovery-project';
const KEY = `wh.codex-drafts.v1.${P}`;
const fixture: CodexEntry = {
  id: 'codex-draft-fixture', projectId: P, type: 'concept', title: 'Saved idea',
  fields: { origin: 'First spark', goal: 'Explore' }, content: '<p>Saved prose</p>', tags: ['saved'], relations: [], createdAt: 1, updatedAt: 1,
};
function setText(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
const titleInput = () => [...document.querySelectorAll('input')].find(input => input.placeholder === t('codex.entryName'));
const button = (name: string, scope: ParentNode = document) => [...scope.querySelectorAll('button')].find(row => row.textContent?.trim() === name);
const topDialog = () => [...document.querySelectorAll('[role="dialog"]')].at(-1);
const storedDraft = (id: string) => {
  const stored = JSON.parse(localStorage.getItem(KEY) ?? '[]') as [string, unknown][];
  return stored.find(([key]) => key === id)?.[1] as Record<string, unknown> | undefined;
};

export async function testCodexDraftRecovery(): Promise<string[]> {
  const host = document.getElementById('root');
  assert(host, 'Missing root');
  let root: Root | null = null;
  const drafts = codexDraftStore(P);
  const unmount = async () => { await act(async () => { root?.unmount(); root = null; await pause(); }); };
  const render = async (element: ReactNode) => {
    await act(async () => { root ??= createRoot(host); root.render(<StrictMode><MemoryRouter>{element}</MemoryRouter></StrictMode>); await pause(); });
    await act(async () => { await pause(); });
  };
  const click = async (target: HTMLElement | undefined, label: string) => {
    assert(target, `Missing ${label}`);
    await act(async () => { target.click(); await pause(60); });
  };
  const passed: string[] = [];
  try {
    // --- New entry: close, reopen, remount -------------------------------
    let added: CodexEntry | null = null;
    const list = (entries: CodexEntry[], onDelete: (id: string) => Promise<unknown> = async () => {}) => (
      <CodexEntryList projectId={P} entries={entries} onAdd={async entry => { added = entry; }} onEdit={async () => {}} onDelete={onDelete} />
    );
    await render(list([]));
    await click(button(t('codex.newEntry')), 'new entry button');
    await click(button(t('common.cancel'), topDialog()!), 'untouched cancel');
    assert(!drafts.has('new') && !storedDraft('new'), 'Opening and closing an untouched form left a draft');

    await click(button(t('codex.newEntry')), 'new entry button');
    await act(async () => { setText(titleInput()!, 'Half-typed dragon'); await pause(); });
    assert(storedDraft('new')?.title === 'Half-typed dragon', 'Typing did not reach the recovery store');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await act(async () => { await pause(); });
    assert(titleInput()?.value === 'Half-typed dragon', 'Escape closed a form with unsaved input');
    await click(button(t('common.cancel'), topDialog()!), 'cancel');
    assert(!titleInput() && drafts.get('new')?.title === 'Half-typed dragon', 'Cancel did not keep the draft');
    await unmount();
    await render(list([]));
    await click(button(t('codex.newEntry')), 'new entry button');
    assert(titleInput()?.value === 'Half-typed dragon', 'Remounted form did not restore the typed title');
    assert(topDialog()?.textContent?.includes(t('codex.draftRecovered')), 'Recovered notice is missing');
    passed.push('Codex drafts: a closed or unmounted new-entry form restores its input; untouched forms leave nothing');

    await click(button(t('codex.createEntry'), topDialog()!), 'create button');
    assert(added && (added as CodexEntry).title === 'Half-typed dragon', 'Recovered draft did not save');
    assert(!drafts.has('new') && !storedDraft('new'), 'Saving did not clear the draft');
    await click(button(t('codex.newEntry')), 'new entry button');
    assert(titleInput()?.value === '' && !topDialog()?.textContent?.includes(t('codex.draftRecovered')), 'A saved draft came back');
    passed.push('Codex drafts: saving retires the recovery copy');

    // --- Discard ---------------------------------------------------------
    await act(async () => { setText(titleInput()!, 'Thought to throw away'); await pause(); });
    await unmount();
    await render(list([]));
    await click(button(t('codex.newEntry')), 'new entry button');
    await click(button(t('codex.discardDraft'), topDialog()!), 'discard notice button');
    await click(button(t('codex.discardDraft'), topDialog()!), 'discard confirmation');
    assert(titleInput()?.value === '' && !document.body.textContent?.includes(t('codex.draftRecovered')), 'Discard did not reset the form');
    await act(async () => { await pause(60); });
    assert(!drafts.has('new') && !storedDraft('new'), 'Discard did not clear the draft');
    await unmount();
    passed.push('Codex drafts: Discard (confirmed) resets the form and clears the draft');

    // --- Edit mode: recovered draft still meets the concurrent-edit merge --
    await db.codexEntries.put(fixture);
    let saves = 0;
    const form = (entry: CodexEntry) => (
      <CodexEntryForm projectId={P} entry={entry} onCancel={() => {}} onSave={async (draft, base) => { await saveCodexDraft(base!, draft); saves++; }} />
    );
    await render(form(fixture));
    await act(async () => { setText(titleInput()!, 'My local title'); await pause(); });
    await unmount();
    const remote = { ...fixture, title: 'Their remote title', fields: { ...fixture.fields, goal: 'Remote goal' }, updatedAt: 2 };
    await db.codexEntries.put(remote);
    await render(form(remote));
    assert(titleInput()?.value === 'My local title', 'Edit draft was not recovered over the newer entry');
    await click(button(t('codex.saveChanges')), 'save button');
    assert(saves === 0 && host.querySelector('[data-conflict-field="title"]') && !host.querySelector('[data-conflict-field="fields.goal"]'),
      'Recovered edit did not raise exactly the title conflict');
    await click(button(t('codex.keepYourVersion')), 'keep my version');
    await unmount();
    // The resolved base is part of the draft: remounting must not ask again.
    await render(form(remote));
    await click(button(t('codex.saveChanges')), 'save button');
    const saved = (await db.codexEntries.get(fixture.id))!;
    assert(saves === 1 && saved.title === 'My local title' && saved.fields.goal === 'Remote goal', 'Resolved recovery overwrote the remote field');
    assert(!drafts.has(fixture.id), 'Saving an edit did not clear its draft');
    await unmount();
    passed.push('Codex drafts: edit recovery keeps its base, so remote changes still conflict or merge per field');

    // --- Deleting the entry retires its draft ---------------------------
    await render(form(saved));
    await act(async () => { setText(titleInput()!, 'Doomed edit'); await pause(); });
    await unmount();
    assert(drafts.has(fixture.id), 'Edit draft missing before delete');
    let deleted = '';
    await render(list([saved], async id => { deleted = id; await db.codexEntries.delete(id); }));
    const card = [...host.querySelectorAll('button')].find(row => row.querySelector('h3')?.textContent === saved.title);
    await click(card, 'entry card');
    await click(button(t('common.delete'), topDialog()!), 'delete button');
    await click(button(t('common.delete'), topDialog()!), 'delete confirmation');
    assert(deleted === fixture.id && !drafts.has(fixture.id) && !storedDraft(fixture.id), 'Deleting the entry left its draft');
    await unmount();
    passed.push('Codex drafts: deleting the entry clears its draft');

    // --- Storage limits and project cleanup ------------------------------
    const large = `data:image/jpeg;base64,${'A'.repeat(300_000)}`;
    const small = 'data:image/jpeg;base64,AAAA';
    const heavyBase = { ...fixture, avatar: large, avatarOriginal: large };
    const untouched = toCodexDraft(codexFormValues(heavyBase), heavyBase);
    assert(JSON.stringify(untouched).length < 5_000 && untouched.baseImageOmitted, 'Large images were written to recovery');
    const restored = restoreCodexDraft(untouched, heavyBase);
    assert(restored.values.avatar === large && restored.base?.avatar === large, 'Omitted images did not come back from the entry');
    const changed = restoreCodexDraft(toCodexDraft({ ...codexFormValues(heavyBase), avatar: small, avatarOriginal: small }, heavyBase), heavyBase);
    assert(changed.values.avatar === small && changed.base?.avatar === large, 'A small new avatar was not kept apart from its base');
    drafts.set('new', toCodexDraft(codexFormValues()));
    clearProjectDraftStores(P);
    await pause();
    assert(drafts.size === 0 && localStorage.getItem(KEY) === null, 'Project deletion left codex drafts behind');
    passed.push('Codex drafts: large images stay out of localStorage and project deletion clears drafts');
    return passed;
  } finally {
    await unmount();
    drafts.clear();
    await db.codexEntries.delete(fixture.id);
  }
}
