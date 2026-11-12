import '@/engines';
import { act, forwardRef, lazy, memo, Suspense, useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import { createSourceToolDocument } from '@/engines/local/documents/store';
import { registerLocalToolModules } from '@/engines/local/registry';
import { defineLocalTool, LocalToolDocumentGate, type LocalToolProps } from '@/engines/local/sdk';
import { useLocaleStore } from '@/stores/localeStore';

type State = { note: string };
const projectId = 'source-document-loading-3015';
const projectTitle = 'Disposable Source loading QA 3015';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}

async function until(predicate: () => boolean, message: string) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (predicate()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  }
  throw Error(message);
}

function Editor({ context }: LocalToolProps<State>) {
  return <h3 data-ready-document={context?.document?.id}>{context?.document?.title}</h3>;
}

function AuthorLoading() {
  return <p data-author-loading>Loading the map layers…</p>;
}

function GateExample() {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('error');
  return <LocalToolDocumentGate status={phase} error="The first read failed" onRetry={() => setPhase('loading')}>
    <p data-gate-ready>Document data</p>
  </LocalToolDocumentGate>;
}

function createTool(namespace: string, component: ComponentType<LocalToolProps<State>>, Skeleton?: ComponentType, panelTitle?: boolean) {
  return defineLocalTool<State>({
    namespace,
    name: { en: 'Loading example', es: 'Ejemplo de carga' },
    description: { en: 'Local test document', es: 'Documento local de prueba' },
    initialState: { note: 'saved' },
    validateState: (value): value is State =>
      !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.note === 'string',
    document: { defaultTitle: { en: 'Loading example', es: 'Ejemplo de carga' } },
    codec: { version: 1, fields: { note: { kind: 'scalar' } } },
    component,
    ...(Skeleton ? { Skeleton } : {}),
    ...(panelTitle === undefined ? {} : { panelTitle }),
  });
}

function deferredTool(namespace: string, Skeleton?: ComponentType, panelTitle?: boolean) {
  let finish!: (module: { default: typeof Editor }) => void;
  const module = new Promise<{ default: typeof Editor }>(resolve => { finish = resolve; });
  return {
    definition: createTool(namespace, lazy(() => module), Skeleton, panelTitle),
    finish: () => finish({ default: Editor }),
  };
}

export async function testSourceDocumentLoading() {
  let malformed = false;
  try {
    createTool('test.document-loading-invalid', Editor, 'loading' as unknown as ComponentType);
  } catch (error) {
    malformed = error instanceof Error && error.message === 'source_tool_document_invalid';
  }
  assert(malformed, 'Invalid skeleton metadata was accepted');
  let finishSkeleton!: (module: { default: typeof AuthorLoading }) => void;
  const skeletonModule = new Promise<{ default: typeof AuthorLoading }>(resolve => { finishSkeleton = resolve; });
  const wrappedLoading = memo(lazy(() => skeletonModule));
  const custom = deferredTool('test.document-loading-custom', wrappedLoading, false);
  assert(custom.definition.Skeleton === wrappedLoading, 'A memoized skeleton was rejected or replaced');
  const refLoading = forwardRef<HTMLParagraphElement>((_, ref) => <p ref={ref}>Loading with ref</p>);
  assert(createTool('test.document-loading-ref', Editor, refLoading).Skeleton === refLoading, 'A forward-ref skeleton was rejected');
  const lazyLoading = lazy(async () => ({ default: AuthorLoading }));
  assert(createTool('test.document-loading-lazy', Editor, lazyLoading).Skeleton === lazyLoading, 'A lazy skeleton was rejected');
  const standard = deferredTool('test.document-loading-default');
  registerLocalToolModules(Object.fromEntries([custom, standard].map(({ definition }) =>
    ['./installed/' + definition.namespace + '/module.tsx', { default: definition }],
  )));
  const container = document.getElementById('root');
  assert(container, 'Test root missing');
  const root = createRoot(container);
  const oldLocale = useLocaleStore.getState().locale;
  useLocaleStore.setState({ locale: 'en' });

  try {
    await db.projects.add({
      id: projectId, title: projectTitle, description: '', mode: 'custom', type: 'standalone', status: 'draft',
      color: '#334455', enabledEngines: [custom, standard].map(({ definition }) => 'local-tool-' + definition.namespace),
      createdAt: 1, updatedAt: 1,
    });
    const base = await createSourceToolDocument({ projectId }, standard.definition.namespace, 'Standard document');
    const own = await createSourceToolDocument({ projectId }, custom.definition.namespace, 'Canvas document');
    const render = (readOnly = false) => act(async () => root.render(<MemoryRouter>
      <Suspense fallback={<p data-shell-loading>Loading the workspace…</p>}>
        <LocalToolDocumentHost projectId={projectId} documentId={own.id} readOnly={readOnly} />
      </Suspense>
      <Suspense fallback={<p data-standard-loading>Loading the workspace…</p>}>
        <LocalToolDocumentHost projectId={projectId} documentId={base.id} />
      </Suspense>
    </MemoryRouter>));
    await render();
    const panel = () => container.querySelector(`[data-source-document-host="${own.id}"]`);
    await until(() => !!panel()?.querySelector('[role="status"][aria-label="Loading..."]') || !!container.querySelector('[data-shell-loading]'),
      'The deferred Source view was not reached');
    assert(panel()?.querySelector('h3')?.textContent === own.title, 'A deferred author skeleton hid the Source heading');
    assert(panel()?.checkVisibility(), 'A deferred author skeleton hid the Source panel');
    assert(panel()?.querySelector('[role="status"]')?.textContent === 'Loading...', 'A deferred author skeleton hid standard loading');
    assert([...panel()!.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Fullscreen'),
      'A deferred author skeleton hid the Source fullscreen control');
    assert(!container.querySelector('[data-shell-loading]'), 'A deferred author skeleton replaced the workspace surface');
    await act(async () => finishSkeleton({ default: AuthorLoading }));
    await until(() => !!panel()?.querySelector('[data-author-loading]'), 'The author skeleton did not replace standard loading');
    assert(container.querySelector('[data-author-loading]')?.textContent === 'Loading the map layers…', 'The Source host ignored the author skeleton');
    const ownPanel = container.querySelector(`[data-source-document-host="${own.id}"]`);
    assert(ownPanel?.querySelector('h3')?.textContent === own.title && ownPanel.querySelectorAll('h3').length === 1,
      'The loading Source lost its only document heading');
    assert(ownPanel.querySelector('[role="status"] [data-author-loading]'), 'The loading state has no status region');
    assert(!ownPanel.querySelector('[data-ready-document]'), 'The author editor appeared before it was ready');
    await until(() => !!container.querySelector('[data-standard-loading]'), 'An omitted skeleton stopped delegating to the workspace');
    await act(async () => { custom.finish(); standard.finish(); });
    await until(() => container.querySelectorAll('[data-ready-document]').length === 2, 'The Source editors did not become ready');
    assert(ownPanel.querySelector('[data-ready-document]')?.getAttribute('data-ready-document') === own.id, 'The ready Source document changed identity');
    assert(!container.querySelector('[data-author-loading],[data-standard-loading],[data-shell-loading]'), 'A loading view remained after the editor was ready');
    assert(ownPanel.querySelectorAll('h3').length === 1 && ownPanel.querySelector('h3')?.hasAttribute('data-ready-document'),
      'The author heading duplicated the loading title');
    await render(true);
    await until(() => !panel()?.querySelector('[data-ready-document]'), 'The read-only Source did not show its saved fallback');
    assert(panel()?.querySelectorAll('h3').length === 1 && panel()?.querySelector('header h3')?.textContent === own.title,
      'The read-only fallback lost the stored title');
    await act(async () => root.render(<GateExample />));
    assert(container.querySelector('[role="alert"]')?.textContent === 'The first read failed', 'The initial read error was hidden');
    assert(!container.querySelector('[data-gate-ready]'), 'The failed document exposed ready content');
    const retry = container.querySelector('button');
    assert(retry?.textContent?.trim() === 'Retry', 'Retry was unavailable');
    await act(async () => retry.click());
    assert(container.querySelector('[role="status"]')?.textContent === 'Loading...', 'Retry did not show default loading');
    assert(!container.querySelector('[role="alert"]'), 'Retry kept the old alert visible');
    await act(async () => root.render(<LocalToolDocumentGate status="ready"><p data-gate-ready>Document data</p></LocalToolDocumentGate>));
    assert(container.querySelector('[data-gate-ready]')?.textContent === 'Document data', 'Ready gate suppressed document content');
    assert(!container.querySelector('[role="status"]'), 'Ready gate retained the loading status');
    await act(async () => root.render(<LocalToolDocumentGate status="loading" locale="es" />));
    assert(container.querySelector('[role="status"]')?.textContent === 'Cargando…', 'The Spanish loading status was unavailable');
    await act(async () => root.render(<LocalToolDocumentGate status="error" locale="es" onRetry={() => {}} retrying />));
    assert(container.querySelector('[role="alert"]')?.textContent === 'No se pudo abrir el documento.', 'The Spanish read error was unavailable');
    const spanishRetry = container.querySelector('button');
    assert(spanishRetry?.disabled && spanishRetry.textContent?.trim() === 'Reintentar', 'The active Spanish retry was not disabled');
    return 'PASS Deferred Source and skeleton, single title, identity, gate retry and locale';
  } finally {
    try { await act(async () => root.unmount()); }
    finally {
      useLocaleStore.setState({ locale: oldLocale });
      const project = await db.projects.get(projectId);
      if (project?.title === projectTitle) await deleteProject(projectId);
    }
  }
}
