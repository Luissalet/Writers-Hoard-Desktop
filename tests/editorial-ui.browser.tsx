import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import ProjectToolsPanel, { type ProjectToolView } from '@/components/project/ProjectToolsPanel';
import { useLocaleStore } from '@/stores/localeStore';
import { clearProjectDraftStores } from '@/hooks/localDraftStore';
import { flushPendingWrites } from '@/services/pendingWrites';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 25));

export async function testEditorialUi(): Promise<string[]> {
  const projectId = `editorial-ui-${crypto.randomUUID()}`;
  const otherId = `${projectId}-other`;
  const citationId = `${projectId}-citation`;
  const oldLocale = useLocaleStore.getState().locale;
  const consoleErrors: string[] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => { consoleErrors.push(args.map(String).join(' ')); originalConsoleError(...args); };
  useLocaleStore.setState({ locale: 'en' });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const waitFor = async (predicate: () => unknown | Promise<unknown>, message: string) => {
    for (let i = 0; i < 120; i++) {
      await act(pause);
      if (await predicate()) return;
    }
    throw new Error(`${message}. Visible text: ${host.textContent?.slice(0, 1200)}`);
  };
  const render = async (view: ProjectToolView, id = projectId) => {
    await act(async () => { root.render(<MemoryRouter><ProjectToolsPanel projectId={id} view={view} /></MemoryRouter>); });
  };
  const section = (name: string) => {
    const result = [...host.querySelectorAll('section')].find(node => node.getAttribute('aria-label') === name || node.querySelector('h3')?.textContent === name);
    assert(result, `Missing section: ${name}`);
    return result;
  };
  const field = (scope: Element, name: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement => {
    const label = [...scope.querySelectorAll('label')].find(node => node.textContent?.trim().startsWith(name));
    const input = label?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select');
    assert(input, `Missing field: ${name}`);
    return input;
  };
  const fill = async (input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
    await act(async () => {
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    });
  };
  const click = async (scope: Element, text: string) => {
    const button = [...scope.querySelectorAll('button')].find(node => node.textContent?.trim() === text);
    assert(button && !button.disabled, `Missing or disabled button: ${text}`);
    await act(async () => { button.click(); });
  };
  try {
    for (const id of [projectId, otherId]) await db.projects.put({
      id, title: id, description: '', mode: 'reporter', type: 'standalone', color: '#123456', status: 'draft',
      enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: 1, updatedAt: 1,
    });
    await db.citations.put({ id: citationId, projectId, title: 'Interview with transport inspector', authors: ['Ana'],
      accessedAt: '2026-09-07', url: 'https://example.org/interview', writingIds: [], tags: [], createdAt: 1, updatedAt: 1 });

    await render('ai');
    await waitFor(() => host.querySelector('section[aria-label="Voice and context"] textarea'), 'Editorial profile did not load');
    await fill(field(section('Voice and context'), 'Author voice'), 'Precise reporting with concrete examples.');
    await click(section('Voice and context'), 'Save profile');
    await waitFor(async () => (await db.projects.get(projectId))?.editorialProfile?.voice === 'Precise reporting with concrete examples.', 'Profile save did not persist');
    await render('research');
    await render('ai');
    await waitFor(() => host.querySelector('section[aria-label="Voice and context"] textarea'), 'Saved profile did not reopen');
    assert(field(section('Voice and context'), 'Author voice').value === 'Precise reporting with concrete examples.', 'Reopening lost the saved voice');
    await fill(field(section('Voice and context'), 'Author voice'), 'Unsaved author revision.');
    await render('ai', otherId);
    await waitFor(() => host.querySelector('section[aria-label="Voice and context"] textarea') && field(section('Voice and context'), 'Author voice').value === '', 'Draft leaked into another project');
    await render('ai');
    await waitFor(() => host.querySelector('section[aria-label="Voice and context"] textarea') && field(section('Voice and context'), 'Author voice').value === 'Unsaved author revision.', 'Navigation lost the unsaved profile draft');
    assert((await db.projects.get(projectId))?.editorialProfile?.voice === 'Precise reporting with concrete examples.', 'A recovery draft silently replaced the saved profile');

    await render('workflows');
    await waitFor(() => host.querySelector('section[aria-label="Writing workflows"]'), 'Writing workflows did not load');
    await fill(field(section('Writing workflows'), 'Workflow name'), 'Transit report');
    await click(section('Writing workflows'), 'Create workflow');
    await waitFor(() => section('Writing workflows').textContent?.includes('Your text'), 'Workflow creation did not open its steps');
    await fill(field(section('Writing workflows'), 'Your text'), 'Two buses arrived at the inspection point.');
    await click(section('Writing workflows'), 'Save workflow');
    await waitFor(async () => (await db.projects.get(projectId))?.writingWorkflows?.[0]?.steps[0].output === 'Two buses arrived at the inspection point.', 'Manual workflow output was not saved');
    await render('research');
    await render('workflows');
    await waitFor(() => host.querySelector('section[aria-label="Writing workflows"] textarea'), 'Workflow did not reopen');
    assert(field(section('Writing workflows'), 'Your text').value === 'Two buses arrived at the inspection point.', 'Reopening lost the saved workflow output');
    await fill(field(section('Writing workflows'), 'Your text'), 'A recovered manual draft about the two buses.');
    await render('research');
    await render('workflows');
    await waitFor(() => host.querySelector('section[aria-label="Writing workflows"] textarea'), 'Draft workflow did not reopen');
    assert(field(section('Writing workflows'), 'Your text').value === 'A recovered manual draft about the two buses.', 'Navigation lost the unsaved workflow output');
    await click(section('Writing workflows'), 'Create writing');
    await waitFor(async () => (await db.writings.where('projectId').equals(projectId).count()) === 1, 'Workflow output did not become a writing');
    const writing = (await db.writings.where('projectId').equals(projectId).toArray())[0];
    assert(writing.content.includes('A recovered manual draft about the two buses.'), 'Created writing lost the manual workflow text');
    assert((await db.projects.get(projectId))?.writingWorkflows?.[0]?.steps[0].output.includes('recovered manual draft'), 'Exporting destroyed the source workflow');

    await render('research');
    await waitFor(() => host.textContent?.includes('Add claim'), 'Research sources did not load');
    await click(section('Claims and sources'), 'Add claim');
    await fill(field(section('Claims and sources'), 'Claim'), 'Two buses arrived.');
    await fill(field(section('Claims and sources'), 'Project source'), `citation:${citationId}`);
    await fill(field(section('Claims and sources'), 'Verbatim excerpt'), 'The inspector said: “I saw two buses.”');
    await fill(field(section('Claims and sources'), 'Page, section or timestamp'), 'Interview 02:31');
    await fill(field(section('Claims and sources'), 'Status'), 'reviewed');
    await click(section('Claims and sources'), 'Save claim');
    await waitFor(async () => (await db.citations.get(citationId))?.researchEvidence?.length === 1, 'Claim form did not save the evidence');
    await render('ai');
    await render('research');
    await waitFor(() => host.querySelector('blockquote')?.textContent === 'The inspector said: “I saw two buses.”', 'Saved evidence did not reopen with its literal excerpt');
    await click(section('Claims and sources'), 'Edit claim');
    assert(field(section('Claims and sources'), 'Project source').value === `citation:${citationId}`, 'Reopened evidence lost its source');
    assert(field(section('Claims and sources'), 'Status').value === 'reviewed', 'Reopened evidence lost its human review status');
    assert(field(section('Claims and sources'), 'Page, section or timestamp').value === 'Interview 02:31', 'Reopened evidence lost the source locator');
    assert(consoleErrors.length === 0, `Editorial UI emitted console errors: ${consoleErrors.join('\n')}`);
    return [
      'Profile form saves and reopens; unsaved edits survive navigation and stay in their own project',
      'Manual writing workflows save, recover drafts and create writings while preserving source output',
      'Research form saves and reopens source-linked evidence with literal quotation, locator and human review status',
    ];
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
    clearProjectDraftStores(projectId); clearProjectDraftStores(otherId);
    await flushPendingWrites();
    await db.writings.where('projectId').equals(projectId).delete();
    await db.citations.delete(citationId);
    await db.projects.bulkDelete([projectId, otherId]);
    useLocaleStore.setState({ locale: oldLocale });
    console.error = originalConsoleError;
  }
}
