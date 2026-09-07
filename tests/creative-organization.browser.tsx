import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import SeedsEngine from '@/engines/seeds/components/SeedsEngine';
import BiographyView from '@/engines/biography/components/BiographyView';
import WritingStatsEngine from '@/engines/writing-stats/components/WritingStatsEngine';
import { seedSourceLinks } from '@/engines/seeds/sourceLinks';
import { matchesBiographyFact } from '@/engines/biography/search';
import { validWordTarget, validGoalDate } from '@/engines/writing-stats/goalValidation';
import { installNavigator } from '@/engines/_shared/anchoring';
import { useLocaleStore } from '@/stores/localeStore';
import type { Seed } from '@/engines/seeds/types';
import type { BiographyFact } from '@/engines/biography/types';
import type { WritingGoal } from '@/engines/writing-stats/types';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

/** Real engine interactions and isolated IndexedDB rows; safe to compose in the critical harness. */
export async function testCreativeOrganizationBrowser(): Promise<string[]> {
  const passed: string[] = [];
  const priorLocale = useLocaleStore.getState().locale;
  useLocaleStore.setState({ locale: 'en' });
  const projectId = `organization-${Date.now()}`;
  const now = Date.now();
  const seed: Seed = { id: `${projectId}-seed`, projectId, title: 'The brass key', description: '', kind: 'chekhov', status: 'planted', linkedWritingId: `${projectId}-writing`, tags: [], createdAt: now, updatedAt: now };
  const bio = { id: `${projectId}-bio`, projectId, subjectName: 'Alicia', createdAt: now, updatedAt: now };
  const fact: BiographyFact = { id: `${projectId}-fact-a`, biographyId: bio.id, projectId, title: 'First expedition', content: '<p data-hidden="notvisible">Visitó Córdoba en primavera.</p>', date: '2021-04-01', category: 'travel', order: 0, tags: ['memoria'], sources: [{ type: 'interview', description: 'Entrevista personal' }], confidence: 'confirmed', createdAt: now, updatedAt: now };
  await db.projects.add({ id: projectId, title: 'Organization fixtures', description: '', type: 'standalone', status: 'draft', mode: 'custom', color: '#c4973b', enabledEngines: ['seeds', 'writings', 'outline', 'biography', 'writing-stats'], engineOrder: [], createdAt: now, updatedAt: now });
  await db.writings.add({ id: seed.linkedWritingId!, projectId, title: 'The locked room', content: '', status: 'draft', wordCount: 0, tags: [], createdAt: now, updatedAt: now });
  await db.outlines.add({ id: `${projectId}-outline`, projectId, title: 'Story', createdAt: now, updatedAt: now });
  await db.outlineBeats.add({ id: `${projectId}-beat`, outlineId: `${projectId}-outline`, projectId, title: 'The door opens', description: '', status: 'outlined', level: 'beat', order: 0, createdAt: now, updatedAt: now });
  await db.seeds.add(seed);
  await db.payoffs.add({ id: `${projectId}-payoff`, projectId, seedId: seed.id, title: 'The key fits', description: '', linkedBeatId: `${projectId}-beat`, strength: 3, createdAt: now, updatedAt: now });
  await db.biographies.add(bio);
  await db.biographyFacts.bulkAdd([fact, { ...fact, id: `${projectId}-fact-b`, title: 'Became an archivist', content: 'A new responsibility', category: 'career', tags: [], sources: [], order: 1 }]);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const pause = (ms = 25) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  const waitFor = async (condition: () => boolean, message: string) => { const end = Date.now() + 5000; while (!condition() && Date.now() < end) await act(async () => { await pause(); }); assert(condition(), message); };
  const button = (text: string, scope: ParentNode = document) => Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find((element) => element.textContent?.trim() === text || element.getAttribute('aria-label') === text || element.title === text);
  const setValue = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
    const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  };
  let path = '';
  installNavigator((next) => { path = next; });
  let failProjectGoal = true;
  const rejectGoal = (_key: unknown, goal: WritingGoal) => { if (goal.projectId === projectId && goal.type === 'project' && failProjectGoal) throw new Error('Expected goal storage failure'); };
  let hooked = false;
  try {
    await act(async () => root.render(<MemoryRouter><SeedsEngine projectId={projectId}/></MemoryRouter>));
    await waitFor(() => Boolean(host.querySelector('h3')?.textContent?.includes(seed.title)), 'seed list did not load');
    const filter = host.querySelectorAll('select')[1];
    await act(async () => setValue(filter, 'cut'));
    assert(!host.querySelector('h3'), 'seed filter returned wrong rows');
    await act(async () => button('Reset filters', host)!.click());
    assert(host.querySelector('h3')?.textContent === seed.title && filter.value === '', 'reset did not restore seeds and filters');
    await act(async () => host.querySelector('h3')!.closest('button')!.click());
    await waitFor(() => Boolean(button('Open planting: The locked room', host) && button('Open payoff: The door opens', host)), 'seed source navigation was hidden');
    await act(async () => setValue(host.querySelector('textarea')!, 'Keep this planted detail'));
    await act(async () => button('Open planting: The locked room', host)!.click());
    await waitFor(() => path.includes('/writings?writing='), 'planting did not navigate to writing');
    assert(path.endsWith(encodeURIComponent(seed.linkedWritingId!)), 'planting navigation opened wrong writing');
    assert((await db.seeds.get(seed.id))?.description === 'Keep this planted detail', 'source navigation lost the current draft');
    await act(async () => button('Open payoff: The door opens', host)!.click());
    await waitFor(() => path.includes(`/outline?outline=${projectId}-outline&beat=${projectId}-beat`), 'payoff navigation lost outline or beat identity');
    assert(seedSourceLinks(seed, { writings: [{ id: seed.linkedWritingId!, title: 'Hidden' }], scenes: [], outlineBeats: [], enabledEngines: [] }).length === 0, 'source link offered a disabled engine');
    assert(seedSourceLinks(seed, { writings: [], scenes: [], outlineBeats: [], enabledEngines: ['writings'] }).length === 0, 'source link offered a deleted record');
    passed.push('Seed filters reset; planting and payoff links open exact sources after saving drafts and hide unavailable sources');

    await act(async () => root.render(<BiographyView biography={bio} onUpdate={() => {}}/>));
    await waitFor(() => host.querySelectorAll('h4').length === 2, 'biography facts did not load');
    const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => setValue(search, 'cordoba primavera'));
    await waitFor(() => host.querySelectorAll('h4').length === 1, 'accent-insensitive body search failed');
    assert(host.querySelector('h4')?.textContent === fact.title, 'biography search chose the wrong fact');
    assert(matchesBiographyFact(fact, 'memoria entrevista') && !matchesBiographyFact(fact, 'notvisible'), 'search must include tags/sources and exclude HTML attributes');
    await act(async () => button('Career (1)', host)!.click());
    await waitFor(() => host.textContent?.includes('No facts match this search and category.') ?? false, 'combined category/search has no recovery state');
    await act(async () => button('Reset search and filters', host)!.click());
    await waitFor(() => host.querySelectorAll('h4').length === 2, 'biography reset did not restore all facts');
    assert(search.value === '', 'biography reset kept stale search');
    passed.push('Biography search matches visible text, accents, tags and sources, combines categories and recovers from no matches');

    await act(async () => root.render(<WritingStatsEngine projectId={projectId}/>));
    await waitFor(() => Boolean(button('Goals', host)), 'statistics did not load');
    await act(async () => button('Goals', host)!.click());
    await waitFor(() => Boolean(document.querySelector('#goal-daily')), 'goal form did not open');
    const daily = document.querySelector<HTMLInputElement>('#goal-daily')!;
    const project = document.querySelector<HTMLInputElement>('#goal-project')!;
    const deadline = document.querySelector<HTMLInputElement>('#goal-deadline')!;
    const form = daily.closest('form')!;
    for (const invalid of ['0', '-10', '1.5']) {
      await act(async () => { setValue(daily, invalid); });
      await act(async () => form.requestSubmit());
      assert(form.querySelector('[role="alert"]')?.textContent?.includes('greater than zero'), 'invalid word target was not explained');
      assert(await db.writingGoals.where('projectId').equals(projectId).count() === 0, 'invalid goal was persisted');
    }
    assert(!validWordTarget('Infinity') && !validWordTarget('12foo') && !validGoalDate('2026-02-30'), 'numeric/date validation accepted malformed values');
    await act(async () => { setValue(daily, '250'); setValue(deadline, '500'); });
    await act(async () => form.requestSubmit());
    assert(form.querySelector('[role="alert"]')?.textContent?.includes('valid date'), 'incomplete deadline silently discarded');
    assert(await db.writingGoals.where('projectId').equals(projectId).count() === 0, 'validation saved some goals before rejecting another');
    await act(async () => { setValue(deadline, ''); setValue(project, '5000'); });
    db.writingGoals.hook('creating', rejectGoal); hooked = true;
    await act(async () => { form.requestSubmit(); form.requestSubmit(); });
    await waitFor(() => form.querySelector('[role="alert"]')?.textContent?.includes('Some goals could not be saved') ?? false, 'partial goal failure did not keep the form');
    const partial = await db.writingGoals.where('projectId').equals(projectId).toArray();
    assert(partial.length === 1 && daily.value === '250' && project.value === '5000', 'failed goal save duplicated rows or lost input');
    failProjectGoal = false;
    await act(async () => form.requestSubmit());
    await waitFor(() => !document.querySelector('#goal-daily'), 'goal retry did not finish');
    const complete = await db.writingGoals.where('projectId').equals(projectId).toArray();
    assert(complete.length === 2 && complete.find((row) => row.type === 'daily')?.id === partial[0].id, 'retry duplicated an already saved goal');
    assert(complete.find((row) => row.type === 'project')?.targetWords === 5000, 'retry lost the pending goal');
    passed.push('Goals validate all fields before writing; partial failures retain input and retry without double-submit duplicates');
  } finally {
    if (hooked) db.writingGoals.hook('creating').unsubscribe(rejectGoal);
    await act(async () => root.unmount()); host.remove();
    useLocaleStore.setState({ locale: priorLocale });
    installNavigator((next) => { window.history.pushState({}, '', next); window.dispatchEvent(new PopStateEvent('popstate')); });
    for (const table of [db.seeds, db.payoffs, db.writings, db.outlineBeats, db.outlines, db.biographyFacts, db.biographies, db.writingGoals]) await table.where('projectId').equals(projectId).delete();
    await db.projects.delete(projectId);
  }
  return passed;
}
