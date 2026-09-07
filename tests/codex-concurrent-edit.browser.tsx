import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import type { CodexEntry } from '@/types';
import { CodexEditConflict, saveCodexDraft } from '@/engines/codex/operations';
import CodexEntryForm from '@/components/codex/CodexEntryForm';
import CodexEntryList from '@/components/codex/CodexEntryList';
import { t } from '@/i18n/useTranslation';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const pause = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
const fixture: CodexEntry = {
  id: 'codex-concurrent-fixture', projectId: 'codex-concurrent-project', type: 'concept', title: 'The original idea',
  fields: { origin: 'First spark', goal: 'Explore' }, content: '<p>Original prose</p>', tags: ['original'], relations: [], createdAt: 1, updatedAt: 1,
};
function setText(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

export async function testCodexConcurrentEditing(): Promise<string[]> {
  const host = document.getElementById('root');
  assert(host, 'Missing root');
  let root: Root | null = null;
  const unmount = async () => { await act(async () => { root?.unmount(); root = null; await pause(); }); };
  const render = async (element: ReactNode) => {
    await act(async () => { root ??= createRoot(host); root.render(<MemoryRouter>{element}</MemoryRouter>); await pause(); });
    await act(async () => { await pause(); });
  };
  const button = (name: string) => [...document.querySelectorAll('button')].find(row => row.textContent?.trim() === name);
  const rejectPropagation = () => { throw new Error('Injected relationship write failure'); };
  try {
    await db.codexEntries.put(fixture);
    await db.relationships.put({ id: 'codex-concurrent-link', projectId: fixture.projectId, entityAId: fixture.id, entityAType: 'codex-entry', entityAName: fixture.title, entityBId: 'other', entityBType: 'codex-entry', entityBName: 'Other', kind: 'ally', intensity: 1, label: '', notes: '', state: 'current', directional: false, createdAt: 1, updatedAt: 1 });
    const remote: CodexEntry = { ...fixture, fields: { ...fixture.fields, goal: 'Remote goal', newField: 'Remote addition' }, content: '<p>Remote prose</p>', tags: ['remote'], relations: [{ targetId: 'other', targetTitle: 'Other', type: 'ally' }], updatedAt: 2 };
    await db.codexEntries.put(remote);
    const merged = await saveCodexDraft(fixture, { ...fixture, title: 'Local name', fields: { ...fixture.fields, origin: 'Local spark' } });
    assert(merged.title === 'Local name' && merged.fields.origin === 'Local spark', 'Local edits were not saved');
    assert(merged.fields.goal === 'Remote goal' && merged.fields.newField === 'Remote addition' && merged.content === remote.content && merged.tags[0] === 'remote' && merged.relations[0]?.targetId === 'other', 'Untouched fields or relationships were overwritten');
    assert((await db.relationships.get('codex-concurrent-link'))?.entityAName === 'Local name', 'Merged rename did not propagate to relationships');
    db.relationships.hook('updating', rejectPropagation);
    let propagationRejected = false;
    try { await saveCodexDraft(merged, { ...merged, title: 'Must roll back' }); } catch { propagationRejected = true; }
    db.relationships.hook('updating').unsubscribe(rejectPropagation);
    assert(propagationRejected && (await db.codexEntries.get(fixture.id))?.title === merged.title, 'Failed propagation left a partial renamed entry');

    await db.codexEntries.put({ ...fixture, title: 'Remote name', fields: { ...fixture.fields, origin: 'Remote spark' } });
    let conflict: unknown;
    try { await saveCodexDraft(fixture, { ...fixture, title: 'My name', fields: { ...fixture.fields, origin: 'My spark', goal: 'My goal' } }); } catch (error) { conflict = error; }
    assert(conflict instanceof CodexEditConflict && conflict.conflicts.length === 2, 'Concurrent same-field changes did not report exact conflicts');
    const afterConflict = (await db.codexEntries.get(fixture.id))!;
    assert(afterConflict.title === 'Remote name' && afterConflict.fields.goal === fixture.fields.goal, 'Conflict partially saved non-conflicting changes');
    await saveCodexDraft(fixture, { ...fixture, title: 'Remote name' });
    assert((await db.codexEntries.get(fixture.id))?.title === 'Remote name', 'Identical concurrent edit was rejected');

    await db.codexEntries.delete(fixture.id);
    let missingRejected = false;
    try { await saveCodexDraft(fixture, { ...fixture, title: 'Do not resurrect' }); } catch { missingRejected = true; }
    assert(missingRejected && !await db.codexEntries.get(fixture.id), 'Saving resurrected a deleted entry');
    await db.codexEntries.put({ ...fixture, projectId: 'foreign-owner' });
    let scopeRejected = false;
    try { await saveCodexDraft(fixture, { ...fixture, title: 'Wrong owner' }); } catch { scopeRejected = true; }
    assert(scopeRejected && (await db.codexEntries.get(fixture.id))?.title === fixture.title, 'A moved entry was written in the wrong project');

    // The form keeps its baseline and draft when the same field is changed elsewhere.
    await db.codexEntries.put(fixture);
    let saves = 0;
    await render(<CodexEntryForm projectId={fixture.projectId} entry={fixture} onCancel={() => {}} onSave={async (draft, base) => { await saveCodexDraft(base!, draft); saves++; }} />);
    const title = [...host.querySelectorAll('input')].find(input => input.placeholder === t('codex.entryName'))!;
    await act(async () => { setText(title, 'My chosen name'); });
    await db.codexEntries.put({ ...fixture, title: 'Their chosen name', fields: { ...fixture.fields, goal: 'External goal' } });
    await act(async () => { button(t('codex.saveChanges'))!.click(); await pause(60); });
    assert(saves === 0 && title.value === 'My chosen name' && host.querySelector('[data-conflict-field="title"]'), 'Conflict lost draft or failed to show a choice');
    assert(host.textContent?.includes('Their chosen name'), 'The external version is not visible');
    await act(async () => { button(t('codex.keepYourVersion'))!.click(); await pause(); });
    // Another write after choosing still has to be detected, not force-overwritten.
    await db.codexEntries.update(fixture.id, { title: 'An even newer name' });
    await act(async () => { button(t('codex.saveChanges'))!.click(); await pause(60); });
    assert(saves === 0 && host.querySelector('[data-conflict-field="title"]') && host.textContent?.includes('An even newer name'), 'Conflict resolution bypassed a newer concurrent edit');
    await act(async () => { button(t('codex.keepYourVersion'))!.click(); await pause(); });
    await act(async () => { button(t('codex.saveChanges'))!.click(); await pause(60); });
    const saved = (await db.codexEntries.get(fixture.id))!;
    assert(Number(saves) === 1 && saved.title === 'My chosen name' && saved.fields.goal === 'External goal', 'Resolved conflict overwrote unrelated edits');
    await unmount();

    await render(<CodexEntryForm projectId={fixture.projectId} entry={fixture} onCancel={() => {}} onSave={async (draft, base) => { await saveCodexDraft(base!, draft); }} />);
    const nextTitle = [...host.querySelectorAll('input')].find(input => input.placeholder === t('codex.entryName'))!;
    await act(async () => { setText(nextTitle, 'Discard only this field'); });
    await act(async () => { button(t('codex.saveChanges'))!.click(); await pause(60); });
    await act(async () => { button(t('codex.useLatestVersion'))!.click(); await pause(); });
    assert(nextTitle.value === 'My chosen name', 'Use latest did not update the field');
    await unmount();

    const list = (entry: CodexEntry) => <CodexEntryList projectId={fixture.projectId} entries={[entry]} onAdd={async () => {}} onEdit={async () => {}} onDelete={() => {}} />;
    await render(list(fixture));
    const card = [...host.querySelectorAll('button')].find(row => row.querySelector('h3')?.textContent === fixture.title)!;
    await act(async () => { card.click(); await pause(); });
    const fresh = { ...fixture, title: 'Externally updated detail', content: '<p>New detail prose</p>', fields: { origin: 'Fresh origin' } };
    await render(list(fresh));
    const modal = document.querySelector('[role="dialog"]');
    assert(modal?.textContent?.includes(fresh.title) && modal.textContent.includes('New detail prose') && modal.textContent.includes('Fresh origin'), 'Open detail remained a stale snapshot');
    await act(async () => { button(t('common.edit'))!.click(); await pause(); });
    assert([...document.querySelectorAll('input')].some(input => input.value === fresh.title), 'Editing detail did not start from latest data');
    const activeTitle = [...document.querySelectorAll('input')].find(input => input.placeholder === t('codex.entryName'))!;
    await act(async () => { setText(activeTitle, 'Uncommitted thought'); });
    await render(list({ ...fresh, title: 'Another external title' }));
    assert(activeTitle.isConnected && activeTitle.value === 'Uncommitted thought', 'External refresh replaced the active draft or remounted its form');
    return ['Codex: atomic field merge preserves unrelated external edits, relationships and owner', 'Codex: conflicts preserve draft, require explicit choice and revalidate newer changes', 'Codex: detail updates by ID and editing begins from latest visible entry'];
  } finally {
    db.relationships.hook('updating').unsubscribe(rejectPropagation);
    await unmount();
    await db.codexEntries.delete(fixture.id);
    await db.relationships.delete('codex-concurrent-link');
  }
}
