import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import RelationshipsEngine from '@/engines/relationships/components/RelationshipsEngine';
import { indexRelationships, relationshipPairKey } from '@/engines/relationships/matrix';
import { installNavigator } from '@/engines/_shared/anchoring';
import { useLocaleStore } from '@/stores/localeStore';
import type { Relationship } from '@/engines/relationships/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Full engine + IndexedDB regression. The runner must use an isolated profile. */
export async function testRelationshipsMatrixBrowser(): Promise<string[]> {
  const passed: string[] = [];
  const priorLocale = useLocaleStore.getState().locale;
  useLocaleStore.setState({ locale: 'en' });
  const projectId = `relationships-test-${Date.now()}`;
  const ids = ['a', 'b', 'c'].map((suffix) => `${projectId}-${suffix}`);
  const now = Date.now();
  await db.projects.add({ id: projectId, title: 'Relationship fixtures', description: '', type: 'standalone', status: 'draft', mode: 'custom', color: '#c4973b', enabledEngines: ['codex', 'relationships'], engineOrder: ['codex', 'relationships'], createdAt: now, updatedAt: now });
  await db.codexEntries.bulkAdd(ids.map((id, index) => ({ id, projectId, type: 'character' as const, title: ['Alicia', 'Bruno', 'Celia'][index], fields: {}, content: '', tags: [], relations: [], createdAt: now, updatedAt: now })));
  const rel: Relationship = { id: `${projectId}-r1`, projectId, entityAId: ids[0], entityAType: 'codex-entry', entityAName: 'Old Alicia name', entityBId: ids[1], entityBType: 'codex-entry', entityBName: 'Bruno', kind: 'friend', intensity: 3, label: 'Shared history', notes: 'Friends since childhood', state: 'past', directional: false, createdAt: now, updatedAt: now };
  const rival: Relationship = { ...rel, id: `${projectId}-r2`, entityAId: ids[1], entityAName: 'Bruno', entityBId: ids[0], entityBName: 'Old Alicia name', kind: 'rival', label: 'Hidden rivalry', state: 'secret', directional: true, intensity: -3, createdAt: now + 1 };
  await db.relationships.bulkAdd([rel, rival]);
  const grouped = indexRelationships([rival, rel]);
  assert(grouped.get(relationshipPairKey(ids[0], ids[1]))?.length === 2, 'reverse directional ties disappear from the pair');
  assert(grouped.get(relationshipPairKey(ids[1], ids[0]))?.[0].id === rel.id, 'pair chooser reorders when updatedAt order changes');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const pause = (ms = 25) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  const waitFor = async (condition: () => boolean, message: string) => {
    const deadline = Date.now() + 6000;
    while (!condition() && Date.now() < deadline) await act(async () => { await pause(); });
    assert(condition(), message);
  };
  const button = (text: string, scope: ParentNode = document) => Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find((element) => element.textContent?.trim() === text || element.getAttribute('aria-label') === text || element.title === text);
  const input = (value: string, element: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  let rejectCreate = true;
  const rejectFixture = (_key: unknown, value: Relationship) => {
    if (value.projectId === projectId && rejectCreate) throw new Error('Expected fixture storage failure');
  };
  let hookInstalled = false;
  try {
    await act(async () => { root.render(<MemoryRouter><RelationshipsEngine projectId={projectId} /></MemoryRouter>); });
    await waitFor(() => Boolean(host.querySelector('[data-matrix-row="0"][data-matrix-col="1"]')), 'matrix did not load');
    const pairCell = host.querySelector<HTMLButtonElement>('[data-matrix-row="0"][data-matrix-col="1"]')!;
    assert(pairCell.getAttribute('aria-label')?.startsWith('2 relationships'), 'matrix hides multiple ties');
    await act(async () => pairCell.click());
    assert(Boolean(button('Shared historyPast', host)) || host.textContent?.includes('Shared history'), 'first tie omitted from chooser');
    const rivalryButton = Array.from(host.querySelectorAll<HTMLButtonElement>('section button')).find((element) => element.textContent?.includes('Hidden rivalry'));
    assert(rivalryButton, 'second tie omitted from chooser');
    await act(async () => rivalryButton.click());
    await waitFor(() => Boolean(document.querySelector('[role="dialog"]')), 'choosing a tie did not open editor');
    assert(document.querySelector('[role="dialog"]')?.textContent?.includes('Bruno → Alicia'), 'editor did not resolve current character names/direction');
    await act(async () => button('Done', document.querySelector('[role="dialog"]')!)!.click());
    await waitFor(() => !document.querySelector('[role="dialog"]'), 'editor did not close');
    passed.push('Matrix exposes and selects every tie for a pair, including reverse direction');

    const emptyCell = host.querySelector<HTMLButtonElement>('[data-matrix-row="0"][data-matrix-col="2"]')!;
    await act(async () => emptyCell.click());
    const form = host.querySelector<HTMLFormElement>('form')!;
    assert(form, 'empty matrix cell did not offer creation');
    const selects = form.querySelectorAll('select');
    assert(selects[0].value === ids[0] && selects[1].value === ids[2], 'empty cell creation lost the chosen pair');
    const labelInput = form.querySelector<HTMLInputElement>('input')!;
    await act(async () => input('A fragile alliance', labelInput));
    db.relationships.hook('creating', rejectFixture);
    hookInstalled = true;
    await act(async () => form.requestSubmit());
    await waitFor(() => Boolean(form.querySelector('[role="alert"]')), 'failed creation did not explain recovery');
    assert(labelInput.value === 'A fragile alliance', 'failed creation discarded the draft');
    rejectCreate = false;
    await act(async () => { form.requestSubmit(); form.requestSubmit(); });
    await waitFor(() => Boolean(document.querySelector('[role="dialog"]')), 'creation retry failed');
    const created = await db.relationships.where('projectId').equals(projectId).toArray();
    assert(created.length === 3 && created.filter((row) => row.label === 'A fragile alliance').length === 1, 'double submit created duplicate relationships');
    await act(async () => button('Done', document.querySelector('[role="dialog"]')!)!.click());
    await waitFor(() => !document.querySelector('[role="dialog"]'), 'new editor did not close');
    await act(async () => button('Add another tie', host)!.click());
    const secondForm = host.querySelector<HTMLFormElement>('form')!;
    await act(async () => input('Unspoken debt', secondForm.querySelector<HTMLInputElement>('input')!));
    await act(async () => secondForm.requestSubmit());
    await waitFor(() => Boolean(document.querySelector('[role="dialog"]')), 'a second tie could not be created for the same pair');
    const pairRows = (await db.relationships.where('projectId').equals(projectId).toArray()).filter((row) => relationshipPairKey(row.entityAId, row.entityBId) === relationshipPairKey(ids[0], ids[2]));
    assert(pairRows.length === 2, 'adding another tie replaced or duplicated the existing tie');
    await act(async () => button('Done', document.querySelector('[role="dialog"]')!)!.click());
    await waitFor(() => !document.querySelector('[role="dialog"]'), 'second new editor did not close');
    passed.push('Empty cells prefill the pair; failed creation retains drafts and retry cannot double-submit');

    const keyboardCell = host.querySelector<HTMLButtonElement>('[data-matrix-row="0"][data-matrix-col="1"]')!;
    keyboardCell.focus();
    await act(async () => keyboardCell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    assert(document.activeElement === host.querySelector('[data-matrix-row="0"][data-matrix-col="2"]'), 'matrix arrow-key navigation failed');
    let navigated = '';
    installNavigator((route) => { navigated = route; });
    const profileButton = Array.from(host.querySelectorAll<HTMLButtonElement>('section button')).find((element) => element.title === 'Open Alicia in the codex');
    assert(profileButton, 'pair context has no character link');
    await act(async () => profileButton.click());
    assert(navigated === `/project/${encodeURIComponent(projectId)}/codex?entry=${encodeURIComponent(ids[0])}`, 'character link navigated to the wrong project or entry');
    passed.push('Matrix arrow navigation and contextual character links work');

    await act(async () => keyboardCell.click());
    const sharedButton = Array.from(host.querySelectorAll<HTMLButtonElement>('section button')).find((element) => element.textContent?.includes('Shared history'))!;
    await act(async () => sharedButton.click());
    await waitFor(() => Boolean(document.querySelector('input[value="Shared history"]')), 'first relationship editor was not reopened');
    let rejectUpdate = true;
    const rejectEdit = (_mods: unknown, _key: unknown, value: Relationship) => { if (rejectUpdate && value.projectId === projectId) throw new Error('Expected fixture edit failure'); };
    db.relationships.hook('updating', rejectEdit);
    try {
      const editInput = document.querySelector<HTMLInputElement>('input[value="Shared history"]')!;
      await act(async () => input('Shared history revised', editInput));
      await act(async () => button('Done', document.querySelector('[role="dialog"]')!)!.click());
      await waitFor(() => Boolean(document.querySelector('[role="dialog"] [role="alert"]')), 'save failure closed the editor or hid its recovery');
      assert(editInput.value === 'Shared history revised', 'save failure discarded edited text');
      rejectUpdate = false;
      await act(async () => button('Retry', document.querySelector('[role="dialog"]')!)!.click());
      await waitFor(() => !document.querySelector('[role="dialog"] [role="alert"]'), 'retry did not clear the saved error');
      assert((await db.relationships.get(rel.id))?.label === 'Shared history revised', 'retry saved the wrong relationship or text');
      await act(async () => button('Done', document.querySelector('[role="dialog"]')!)!.click());
      await waitFor(() => !document.querySelector('[role="dialog"]'), 'saved editor stayed stuck open');
    } finally { db.relationships.hook('updating').unsubscribe(rejectEdit); }
    passed.push('Failed editing keeps the dialog and draft; retry saves the exact relationship');

    await act(async () => root.render(null));
    await db.codexEntries.bulkDelete(ids);
    await act(async () => { root.render(<MemoryRouter><RelationshipsEngine projectId={projectId} /></MemoryRouter>); });
    await waitFor(() => Boolean(host.textContent?.includes('Shared history revised')), 'relationships disappeared when character records were removed');
    const orphanButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((element) => element.textContent?.includes('Shared history revised'))!;
    await act(async () => orphanButton.click());
    await waitFor(() => Boolean(document.querySelector('input[value="Shared history revised"]')), 'persisted relationship with missing characters cannot be edited');
    assert(document.querySelector('[role="dialog"]')?.textContent?.includes('This character record is no longer available'), 'missing endpoint was not explained');
    passed.push('Persisted relationships remain accessible and editable after their characters are removed');
    return passed;
  } finally {
    if (hookInstalled) db.relationships.hook('creating').unsubscribe(rejectFixture);
    await act(async () => root.unmount());
    host.remove();
    useLocaleStore.setState({ locale: priorLocale });
    // Restore a functional navigation bridge for any later test in the harness.
    installNavigator((route) => { window.history.pushState({}, '', route); window.dispatchEvent(new PopStateEvent('popstate')); });
    await db.relationships.where('projectId').equals(projectId).delete();
    await db.codexEntries.bulkDelete(ids);
    await db.projects.delete(projectId);
  }
}
