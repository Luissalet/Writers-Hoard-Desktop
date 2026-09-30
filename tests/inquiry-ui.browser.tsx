import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import InquiryEngine from '@/engines/inquiry/components/InquiryEngine';
import { addHypothesis, createClaim, saveCase } from '@/engines/inquiry/operations';
import SourceGradeControls from '@/components/project/SourceGradeControls';
import { retractCitation } from '@/services/sourceGradingOps';
import { saveCitation } from '@/services/projectTools';
import { saveResearchEvidence } from '@/services/researchEvidence';
import { useLocaleStore } from '@/stores/localeStore';
import type { Project } from '@/types';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

const pause = (ms = 30) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

export async function testInquiryUi(): Promise<string[]> {
  const passed: string[] = [];
  const priorLocale = useLocaleStore.getState().locale;
  useLocaleStore.setState({ locale: 'en' });
  const projectId = `inq-ui-${Date.now()}`;
  const now = Date.now();
  const project: Project = { id: projectId, title: 'The firm', mode: 'reporter', type: 'standalone', color: '#000', description: '', status: 'draft', enabledEngines: ['codex', 'inquiry'], engineOrder: ['codex', 'inquiry'], createdAt: now, updatedAt: now };
  await db.projects.add(project);
  await db.codexEntries.bulkAdd([
    { id: `${projectId}-ana`, projectId, type: 'character', title: 'Ana Ruiz', fields: { role: '' }, content: '', tags: [], relations: [], createdAt: now, updatedAt: now },
    { id: `${projectId}-firm`, projectId, type: 'faction', title: 'Acme', fields: { name: 'Acme', type: '', founded: '', country: 'USA' }, content: '', tags: [], relations: [], createdAt: now, updatedAt: now },
  ]);
  const makeSource = async (title: string, url: string, quote: string) => {
    const citation = await saveCitation({ projectId, title, authors: [], accessedAt: '2026-05-01', url, writingIds: [], tags: [] });
    const evidence = await saveResearchEvidence(projectId, { citationId: citation.id }, { statement: title, kind: 'fact', quote, locator: '', status: 'pending', notes: '' });
    return { citation, support: { citationId: citation.id, evidenceId: evidence.id } };
  };
  const a = await makeSource('Company registry', 'https://registry.example.org/acme', 'Acme was founded in 1999.');
  const b = await makeSource('Trade paper', 'https://trade.example.net/acme', 'Founded 1999, says the paper.');
  const claimOne = await createClaim(projectId, {
    statement: 'Acme was founded in 1999.', subject: { kind: 'codex', id: `${projectId}-firm` }, predicate: 'founded_in', object: { kind: 'text', text: '1999' },
    validFrom: '1999', observedAt: '2026-04-01', supports: [a.support, b.support], tags: ['origin'],
  });
  const claimTwo = await createClaim(projectId, { statement: 'Ana Ruiz runs Acme.', subject: { kind: 'codex', id: `${projectId}-ana` }, predicate: 'ceo_of', object: { kind: 'codex', id: `${projectId}-firm` }, validFrom: '2015', validTo: '2018', supports: [a.support] });
  await saveCase(projectId, { question: 'Who founded Acme and who ran it?' });

  const host = document.createElement('div');
  document.body.append(host);
  const root: Root = createRoot(host);
  const waitFor = async (condition: () => boolean, message: string, ms = 8000) => {
    const deadline = Date.now() + ms;
    while (!condition() && Date.now() < deadline) await act(async () => { await pause(); });
    assert(condition(), message);
  };
  const tab = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(el => el.textContent?.trim() === name)!;
  const button = (text: string, scope: ParentNode = host) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent?.trim() === text || el.getAttribute('aria-label') === text);
  const card = (id: string) => host.querySelector<HTMLElement>(`[data-claim-id="${id}"]`);
  const errors: string[] = [];
  const onError = (event: ErrorEvent) => errors.push(event.message);
  window.addEventListener('error', onError);
  try {
    await act(async () => { root.render(<MemoryRouter><InquiryEngine projectId={projectId} /></MemoryRouter>); });
    await waitFor(() => Boolean(card(claimOne.id)), 'claims did not load');
    assert(card(claimOne.id)!.dataset.status === 'corroborated', 'two independent hosts read as corroborated');
    assert(card(claimOne.id)!.textContent!.includes('2 excerpts') && card(claimOne.id)!.textContent!.includes('2 independent sources'), 'counts are shown on the claim');
    assert(card(claimTwo.id)!.dataset.status === 'claimed', 'one source reads as claimed');
    assert((host.querySelector('textarea') as HTMLTextAreaElement).value === 'Who founded Acme and who ran it?', 'the research question is shown');
    assert(card(claimTwo.id)!.querySelector('[data-time="ended"]'), 'a claim whose period is over is marked ended, not stale');
    passed.push('Claims tab lists claims with derived status, counts and ended marker');

    // Filters.
    await act(async () => button('Corroborated (1)')!.click());
    assert(!card(claimTwo.id) && card(claimOne.id), 'the status filter narrows the list');
    await act(async () => button('Corroborated (1)')!.click());
    await act(async () => setValue(host.querySelector<HTMLInputElement>('input[aria-label="Search the text"]')!, 'runs'));
    assert(!card(claimOne.id) && card(claimTwo.id), 'text search narrows the list');
    await act(async () => setValue(host.querySelector<HTMLInputElement>('input[aria-label="Search the text"]')!, ''));
    passed.push('Claims filters by status and text');

    // Create a claim through the form, from a quote (creates the excerpt in the same transaction).
    await act(async () => button('New claim')!.click());
    const form = host.querySelector<HTMLFormElement>('form[aria-label="New claim"]')!;
    assert(form, 'the editor did not open');
    const submit = () => [...form.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].find(el => el.textContent?.trim() === 'Save')!;
    await act(async () => setValue(form.querySelector('textarea')!, 'Ana Ruiz was born in Lyon in 1970.'));
    assert(submit().disabled, 'a claim with no source cannot be saved');
    await act(async () => setValue(form.querySelector<HTMLSelectElement>('select[aria-label="Source"]')!, a.citation.id));
    await act(async () => setValue(form.querySelector<HTMLTextAreaElement>('textarea[aria-label="Verbatim quote"]')!, 'Ruiz, Ana, b. Lyon 1970.'));
    await act(async () => button('Add quote', form)!.click());
    await waitFor(() => !submit().disabled, 'the quote should count as a source');
    const dateInput = [...form.querySelectorAll<HTMLInputElement>('input')].find(el => el.placeholder === 'YYYY-MM-DD')!;
    await act(async () => setValue(dateInput, '2019-02-30'));
    assert(submit().disabled && form.querySelector('[role="alert"]'), 'an impossible date blocks saving and says so');
    await act(async () => setValue(dateInput, ''));
    await act(async () => submit().click());
    await waitFor(() => !host.querySelector('form[aria-label="New claim"]'), 'the form should close after saving');
    const created = (await db.inquiryClaims.where('projectId').equals(projectId).toArray()).find(row => row.statement.startsWith('Ana Ruiz was born'));
    assert(created && created.supports.length === 1, 'the claim was stored with one support');
    const evidenceRows = (await db.citations.get(a.citation.id))!.researchEvidence!;
    assert(evidenceRows.some(row => row.quote === 'Ruiz, Ana, b. Lyon 1970.'), 'the quote became an excerpt of the citation');
    await waitFor(() => Boolean(card(created.id)), 'the new claim should appear');
    passed.push('New claim form: a quote becomes an excerpt, dates are validated, a source is required');

    // Retraction cascade reaches the open view without a reload.
    const before = card(claimOne.id)!.dataset.status;
    assert(before === 'corroborated', 'precondition');
    const result = await retractCitation(projectId, a.citation.id, 'forged registry extract');
    assert(result.impact.affected === 3, 'three claims leaned on the registry');
    await waitFor(() => card(claimOne.id)!.dataset.status === 'claimed', 'a corroborated claim should fall to claimed after the retraction');
    await waitFor(() => card(claimTwo.id)!.dataset.status === 'unsupported', 'a sole-source claim should become unsupported');
    assert(card(claimOne.id)!.textContent!.includes('1 of its sources no longer count'), 'the claim says a source no longer counts');
    assert(card(claimOne.id)!.textContent!.includes('1 independent sources'), 'independence recounted');
    passed.push('Retracting a citation reshapes open claims immediately and reports the impact');

    // Claim sources with retracted source flagged.
    await act(async () => button('Show sources', card(claimOne.id)!)!.click());
    assert(card(claimOne.id)!.textContent!.includes('retracted: does not count'), 'the retracted support is labelled');
    await act(async () => button('Hide sources', card(claimOne.id)!)!.click());

    // Chronology and asOf.
    await act(async () => tab('Chronology').click());
    await waitFor(() => Boolean(host.querySelector('[data-claim-id]')), 'chronology empty');
    const asOfInput = host.querySelector<HTMLInputElement>('[data-testid="asof-bar"] input[placeholder="YYYY-MM-DD"]')!;
    await act(async () => setValue(asOfInput, '2016-06-01'));
    await waitFor(() => Boolean(host.querySelector(`[data-claim-id="${claimTwo.id}"]`)), 'the claim valid in 2016 should show');
    await act(async () => setValue(asOfInput, '2010-01-01'));
    await waitFor(() => !host.querySelector(`[data-claim-id="${claimTwo.id}"]`), 'the claim valid 2015-2018 should disappear as of 2010');
    assert(host.querySelector(`[data-claim-id="${claimOne.id}"]`), 'the claim from 1999 is in effect in 2010');
    await act(async () => setValue(asOfInput, 'soon'));
    assert(host.querySelector('[data-testid="asof-bar"] [role="alert"]'), 'an invalid asOf is reported');
    await act(async () => setValue(asOfInput, ''));
    passed.push('Chronology honours the as-of date and rejects invalid ones');

    // Graph.
    await act(async () => tab('Graph').click());
    await waitFor(() => Boolean(host.querySelector('[data-testid="inquiry-graph"] .react-flow')), 'the graph should render', 12000);
    await waitFor(() => host.querySelectorAll('.react-flow__node').length >= 2, 'graph nodes should render');
    passed.push('Graph tab renders entities as nodes');

    // Hypotheses.
    await act(async () => tab('Hypotheses').click());
    await act(async () => { await addHypothesis(projectId, 'Ana founded Acme'); await addHypothesis(projectId, 'A partner founded Acme'); });
    await waitFor(() => host.querySelectorAll('[data-hypothesis-id]').length === 2, 'hypotheses should list');
    const h = await db.inquiryHypotheses.where('projectId').equals(projectId).sortBy('order');
    await waitFor(() => Boolean(host.querySelector(`[data-testid="rate-${h[0].id}-${claimOne.id}"]`)), 'the matrix should list the corroborated claim');
    assert(!host.querySelector(`[data-testid="rate-${h[0].id}-${claimTwo.id}"]`), 'an unsupported claim is not in the matrix');
    await act(async () => setValue(host.querySelector<HTMLSelectElement>(`[data-testid="rate-${h[0].id}-${claimOne.id}"]`)!, 'CC'));
    await act(async () => setValue(host.querySelector<HTMLSelectElement>(`[data-testid="rate-${h[1].id}-${claimOne.id}"]`)!, 'II'));
    await waitFor(() => host.querySelector(`[data-testid="score-${h[1].id}"]`)?.textContent === '2', 'inconsistency points should be scored');
    const reading = host.querySelector('[data-testid="ach-reading"]')!.textContent!;
    assert(reading.includes('Least contradicted so far') && reading.includes('Ana founded Acme') && reading.includes('not proof'), 'the leader is labelled as least contradicted, never proven');
    assert(!/proven|proved/i.test(reading.replace('not proof', '')), 'nothing is called proven');
    passed.push('Hypotheses: matrix ratings score inconsistency and the leader is "least contradicted so far"');

    // Report.
    await act(async () => tab('Report').click());
    await waitFor(() => Boolean(host.querySelector('[data-testid="report-preview"]')), 'report should render');
    const report = host.querySelector('[data-testid="report-preview"]')!.textContent!;
    assert(report.includes('Who founded Acme and who ran it?') && report.includes('Acme was founded in 1999.'), 'the report has the question and claims');
    assert(report.includes('retracted: forged registry extract'), 'the retracted source appears in the source list with its reason');
    assert(report.includes('Ana Ruiz (character) — private person'), 'the report marks the private person');
    assert(host.querySelector('[data-testid="citation-check"]')?.getAttribute('data-ok') === 'false', 'the citation check flags lines without an active source');
    passed.push('Report: question, claims with markers, graded sources, private-person label and citation check');

    // Entities: privacy toggle and the enrichment flow (with a fake Wikidata bridge).
    await act(async () => tab('Entities').click());
    await waitFor(() => Boolean(host.querySelector(`[data-entry-id="${projectId}-ana"]`)), 'entities should list');
    const anaRow = host.querySelector<HTMLElement>(`[data-entry-id="${projectId}-ana"]`)!;
    assert(anaRow.textContent!.includes('Private person'), 'people start private');
    const calls: string[] = [];
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      wikidata: {
        request: async (request: { op: string; qid?: string; qids?: string[]; query?: string }) => {
          calls.push(`${request.op}:${request.query ?? request.qid ?? request.qids?.join(',')}`);
          if (request.op === 'search') return { ok: true, data: { search: [{ id: 'Q1', label: 'Acme Corporation', description: 'fictional company' }] } };
          if (request.op === 'entity') return { ok: true, data: { entities: { Q1: { id: 'Q1', labels: { en: { language: 'en', value: 'Acme Corporation' } }, descriptions: { en: { language: 'en', value: 'fictional company' } }, claims: {
            P571: [{ rank: 'normal', mainsnak: { snaktype: 'value', property: 'P571', datavalue: { type: 'time', value: { time: '+1949-00-00T00:00:00Z', precision: 9 } } } }],
            P17: [{ rank: 'normal', mainsnak: { snaktype: 'value', property: 'P17', datavalue: { type: 'wikibase-entityid', value: { id: 'Q30' } } } }],
          } } } } };
          return { ok: true, data: { entities: { Q30: { id: 'Q30', labels: { en: { language: 'en', value: 'United States' } } } } } };
        },
      },
    };
    // Re-mount so the tab notices the bridge.
    await act(async () => tab('Claims').click());
    await act(async () => tab('Entities').click());
    const enrichButtons = () => [...host.querySelectorAll<HTMLButtonElement>('button')].filter(el => el.textContent?.trim() === 'Enrich from Wikidata');
    const buttonFor = (id: string) => [...host.querySelector(`[data-entry-id="${id}"]`)!.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent?.trim() === 'Enrich from Wikidata')!;
    assert(enrichButtons().length === 2, 'both entries offer enrichment');
    assert(buttonFor(`${projectId}-ana`).disabled, 'a private person cannot be enriched');
    assert(!buttonFor(`${projectId}-firm`).disabled, 'an organisation can be enriched');
    await act(async () => buttonFor(`${projectId}-firm`).click());
    await act(async () => { button('Search', host.querySelector('[data-testid="enrich-panel"]')!)!.click(); });
    await waitFor(() => host.textContent!.includes('Acme Corporation'), 'candidates should list');
    assert(calls.length === 1 && calls[0] === 'search:Acme', 'only the typed name was sent');
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('ul[aria-label="Matches"] button')][0].click(); });
    await waitFor(() => Boolean(host.querySelector('[data-testid="enrich-preview"]')), 'preview should show');
    const previewText = host.querySelector('[data-testid="enrich-preview"]')!.textContent!;
    assert(previewText.includes('founded') && previewText.includes('1949'), 'the preview lists what will be filled');
    assert(previewText.includes('Left as you wrote them') && previewText.includes('country'), 'a field the author already wrote is listed as left alone');
    await act(async () => { button('Apply', host.querySelector('[data-testid="enrich-preview"]')!)!.click(); });
    await waitFor(() => Boolean(host.querySelector('[data-run-status="ok"]')), 'the run should be recorded');
    const enriched = (await db.codexEntries.get(`${projectId}-firm`))!;
    assert(enriched.wikidataQid === 'Q1' && enriched.fields.founded === '1949' && enriched.fields.country === 'USA' && enriched.fields.description === 'fictional company', 'fields were filled and the item id stored');
    const wikidataCitation = (await db.citations.where('projectId').equals(projectId).toArray()).find(row => row.origin === 'wikidata.org');
    assert(wikidataCitation && wikidataCitation.reliability === 'C' && wikidataCitation.credibility === 3, 'a C3 Wikidata citation was recorded');
    await act(async () => { button('Undo', host.querySelector('[data-run-status="ok"]')!)!.click(); });
    await waitFor(() => Boolean(host.querySelector('[data-run-status="undone"]')), 'the undo should be recorded');
    const restored = (await db.codexEntries.get(`${projectId}-firm`))!;
    assert(restored.wikidataQid === undefined && restored.fields.founded === '' && restored.fields.country === 'USA' && !('description' in restored.fields), 'undo restored the previous values and removed what was added');
    assert(!(await db.citations.get(wikidataCitation.id)), 'undo removed the citation it created');
    // Marking a person public lifts the guard.
    await act(async () => { host.querySelector(`[data-entry-id="${projectId}-ana"]`)!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
    await waitFor(() => !buttonFor(`${projectId}-ana`).disabled, 'a public figure can be enriched');
    assert((await db.codexEntries.get(`${projectId}-ana`))!.publicFigure === true, 'the flag is stored');
    passed.push('Entities: privacy guard, Wikidata search/preview/apply/undo with only the typed name sent');

    // Library search through the hub: a private person is taken out of the query, a hub that is down degrades.
    await act(async () => { host.querySelector(`[data-entry-id="${projectId}-ana"]`)!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
    await waitFor(() => buttonFor(`${projectId}-ana`).disabled, 'Ana is private again');
    const sent: Array<{ app: string; q: string }> = [];
    (window as unknown as { electronAPI: { family: unknown } }).electronAPI.family = {
      search: async (request: { app: string; q: string }) => {
        sent.push({ app: request.app, q: request.q });
        if (request.app === 'links') return { ok: false, code: 'hub_unreachable', error: 'no hub' };
        return { ok: true, data: { items: [{ id: 'd1', title: 'Acme: a history', excerpt: 'Founded in 1999.' }] } };
      },
    };
    await act(async () => tab('Claims').click());
    await act(async () => button('Search library')!.click());
    const librarySection = () => host.querySelector<HTMLElement>('[data-testid="library-search"]')!;
    assert(librarySection(), 'the library panel opened');
    await act(async () => setValue(librarySection().querySelector<HTMLInputElement>('input[type="text"], input:not([type])')!, 'Ana Ruiz Acme'));
    await act(async () => { button('Search', librarySection())!.click(); });
    await waitFor(() => Boolean(host.querySelector('[data-testid="library-results"]')), 'results should show');
    assert(sent.length === 2 && sent.every(row => row.q === 'Acme'), 'the private person was taken out of the query before it was sent');
    const resultsText = host.querySelector('[data-testid="library-results"]')!.textContent!;
    assert(resultsText.includes('Ana Ruiz') && resultsText.includes('not marked as public figures'), 'the writer is told who was left out');
    assert(resultsText.includes('The Hoard hub is not running'), 'an app that could not answer says why, in words');
    assert(host.querySelector('[data-app="borges"] [data-hit="hoard://borges/document/d1"]'), 'the library hit is listed');
    await act(async () => { button('Add as source', host.querySelector('[data-hit="hoard://borges/document/d1"]')!)!.click(); });
    await waitFor(() => Boolean(host.querySelector('[data-hit="hoard://borges/document/d1"]')!.textContent!.includes('Added')), 'the hit should be marked as added');
    const filedSource = (await db.citations.where('projectId').equals(projectId).toArray()).find(row => row.tags.includes('family'));
    assert(filedSource && filedSource.reliability === undefined && filedSource.notes?.includes('hoard://borges/document/d1') && filedSource.researchEvidence?.[0].status === 'pending', 'the hit became an ungraded source with a pending excerpt');
    await act(async () => { button('Close', librarySection())!.click(); });
    passed.push('Library search: private names left out and reported, a hub that is down says so, a hit is added as an ungraded source');

    // Grade and retract controls on their own.
    const fresh = (await db.citations.get(b.citation.id))!;
    const controlsHost = document.createElement('div');
    document.body.append(controlsHost);
    const controlsRoot = createRoot(controlsHost);
    await act(async () => { controlsRoot.render(<SourceGradeControls citation={fresh} />); });
    assert(controlsHost.querySelector('[data-testid="grade-badge"]')!.textContent === 'ungraded', 'an old citation reads as ungraded');
    await act(async () => { button('Grade', controlsHost)!.click(); });
    const selects = controlsHost.querySelectorAll('select');
    await act(async () => setValue(selects[0], 'B'));
    await act(async () => setValue(selects[1], '2'));
    await act(async () => { controlsHost.querySelector('form')!.requestSubmit(); });
    await act(async () => { await pause(150); });
    assert((await db.citations.get(b.citation.id))!.reliability === 'B' && (await db.citations.get(b.citation.id))!.credibility === 2, 'grade B2 stored from the control');
    await act(async () => controlsRoot.unmount());
    controlsHost.remove();
    passed.push('Source grade control stores a B2 grade');

    // Spanish.
    useLocaleStore.setState({ locale: 'es' });
    await act(async () => tab('Afirmaciones')?.click?.());
    await waitFor(() => Boolean(tab('Afirmaciones')), 'the UI should switch to Spanish');
    await act(async () => tab('Afirmaciones').click());
    await waitFor(() => Boolean(card(claimTwo.id)), 'claims should show in Spanish');
    assert(card(claimTwo.id)!.textContent!.includes('Sin respaldo'), 'statuses are translated');
    passed.push('Spanish copy is wired for tabs and statuses');

    assert(errors.length === 0, `uncaught errors: ${errors.join('; ')}`);
    return passed;
  } finally {
    window.removeEventListener('error', onError);
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    await act(async () => root.unmount());
    host.remove();
    useLocaleStore.setState({ locale: priorLocale });
    await db.enrichmentRuns.where('projectId').equals(projectId).delete();
    await db.inquiryRatings.where('projectId').equals(projectId).delete();
    await db.inquiryHypotheses.where('projectId').equals(projectId).delete();
    await db.inquiryClaims.where('projectId').equals(projectId).delete();
    await db.inquiryCases.where('projectId').equals(projectId).delete();
    await db.citations.where('projectId').equals(projectId).delete();
    await db.codexEntries.where('projectId').equals(projectId).delete();
    await db.projects.delete(projectId);
  }
}
