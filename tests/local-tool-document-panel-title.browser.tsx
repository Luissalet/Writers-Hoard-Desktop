import '@/engines';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { createSourceToolDocument, readSourceToolDocument, renameSourceToolDocument } from '@/engines/local/documents/store';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import { registerLocalToolModules } from '@/engines/local/registry';
import { pinLocalToolRelease, resolveProjectLocalTool } from '@/engines/local/releases';
import { installLocalRuntimePackage } from '@/engines/local/runtimePackages';
import { canonicalRuntimeJson, runtimeBase64, runtimeBytesHash, runtimeManifestIdentity, type RuntimePackageManifest } from '@/engines/local/runtimeFormat.mjs';
import { createLocalToolClient } from '@/engines/local/storage';
import { defineLocalTool, type LocalToolProps } from '@/engines/local/sdk';
import { useLocaleStore } from '@/stores/localeStore';

type State = { note: string };
const projectId = 'source-document-panel-title';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}

function TitleTool({ context }: LocalToolProps<State>) {
  return <h3 data-author-panel-title data-author-document-id={context?.document?.id}>{context?.document?.title}</h3>;
}

function makeTool(namespace: string, panelTitle?: boolean) {
  return defineLocalTool<State>({
    namespace,
    name: { en: 'Title example', es: 'Ejemplo de título' },
    description: { en: 'Local test document', es: 'Documento local de prueba' },
    initialState: { note: '' },
    validateState: (value): value is State => !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.note === 'string',
    document: { defaultTitle: { en: 'Title example', es: 'Ejemplo de título' } },
    codec: { version: 1, fields: { note: { kind: 'scalar' } } },
    component: TitleTool,
    ...(panelTitle !== undefined ? { panelTitle } : {}),
  });
}

async function until(check: () => boolean, message: string) {
  for (let i = 0; i < 150; i++) {
    if (check()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  }
  throw Error(message);
}

export async function testSourceDocumentPanelTitle() {
  const standard = makeTool('test.panel-title-default');
  const custom = makeTool('test.panel-title-author', false);
  assert(makeTool('test.panel-title-explicit', true).panelTitle === true, 'Explicit true was not retained');
  let malformed = false;
  try {
    makeTool('test.panel-title-invalid', 'false' as unknown as boolean);
  } catch (error) {
    malformed = error instanceof Error && error.message === 'source_tool_document_invalid';
  }
  assert(malformed, 'Malformed presentation metadata was accepted');
  registerLocalToolModules({
    ['./installed/' + standard.namespace + '/module.tsx']: { default: standard },
    ['./installed/' + custom.namespace + '/module.tsx']: { default: custom },
  });
  const container = document.getElementById('root');
  assert(container, 'Test root missing');
  const root = createRoot(container);
  const locale = useLocaleStore.getState().locale;
  useLocaleStore.setState({ locale: 'en' });

  try {
    await db.projects.add({
      id: projectId, title: 'Panel title test', description: '', mode: 'custom', type: 'standalone', status: 'draft',
      color: '#334455', enabledEngines: [standard, custom].map(tool => 'local-tool-' + tool.namespace), createdAt: 1, updatedAt: 1,
    });
    const base = await createSourceToolDocument({ projectId }, standard.namespace, 'Default title');
    const own = await createSourceToolDocument({ projectId }, custom.namespace, 'Custom title');
    const render = (readOnly = false) => act(async () => root.render(<MemoryRouter>
      <EnginePaneContext.Provider value={{ instanceId: 'title-default', projectId, visible: true }}>
        <LocalToolDocumentHost projectId={projectId} documentId={base.id} />
      </EnginePaneContext.Provider>
      <EnginePaneContext.Provider value={{ instanceId: 'title-custom', projectId, visible: true }}>
        <LocalToolDocumentHost projectId={projectId} documentId={own.id} readOnly={readOnly} />
      </EnginePaneContext.Provider>
    </MemoryRouter>));
    const panel = (id: string) => container.querySelector<HTMLElement>(`[data-source-document-host="${id}"]`);
    const headerTitle = (id: string) => panel(id)?.querySelector('header h3')?.textContent;
    const authorTitle = (id: string) => panel(id)?.querySelector<HTMLElement>('[data-author-panel-title]');
    const button = (within: ParentNode, label: string) =>
      [...within.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label);
    const click = (node: HTMLButtonElement | undefined, label: string) => {
      assert(node && !node.disabled, label + ' unavailable');
      return act(async () => node.click());
    };
    await render();
    await until(() => authorTitle(own.id)?.textContent === 'Custom title' && !!authorTitle(base.id), 'Source tools did not mount');
    assert(headerTitle(base.id) === 'Default title', 'Default Source heading disappeared');
    assert(headerTitle(own.id) === undefined, 'Author title was duplicated by the Source header');
    assert(authorTitle(own.id)?.dataset.authorDocumentId === own.id, 'Editor lost the document identity');
    assert(button(panel(own.id)!, 'Share local session'), 'Custom title removed local sharing');
    const before = await readSourceToolDocument({ projectId }, own.id);
    assert(before?.document.title === 'Custom title', 'Presentation changed stored title');

    await click(button(panel(own.id)!, 'Fullscreen'), 'Fullscreen');
    await until(() => !!button(document, 'Save and return') && !!document.querySelector('[data-source-document-view="fullscreen"]'), 'Fullscreen did not open');
    assert([...document.querySelectorAll('h2')].some(heading => heading.textContent === 'Custom title'), 'Fullscreen dialog lost its title');
    await click(button(document, 'Save and return'), 'Save and return');
    await until(() => !button(document, 'Save and return'), 'Fullscreen did not close');
    assert(headerTitle(own.id) === undefined, 'Return restored the duplicate editor heading');

    await act(async () => { await renameSourceToolDocument({ projectId }, own.id, custom.namespace, 'Renamed title', before.document.revision, before.version); });
    await until(() => authorTitle(own.id)?.textContent === 'Renamed title', 'Ordinary rename did not reach the author heading');
    assert(headerTitle(own.id) === undefined, 'Rename restored the duplicate editor heading');

    await render(true);
    await until(() => headerTitle(own.id) === 'Renamed title' && !authorTitle(own.id), 'Readonly fallback lost its identifying heading');
    assert(headerTitle(base.id) === 'Default title', 'Custom flag affected the other pane');
    return ['Definition validates optional panelTitle and preserves the default editor heading', 'Author editor renders one title, retains identity, sharing and fullscreen, and follows ordinary rename', 'Readonly fallback keeps its own identifying heading'];
  } finally {
    await act(async () => root.unmount());
    useLocaleStore.setState({ locale });
    await deleteProject(projectId);
  }
}

export async function testSourceDocumentPanelTitleRuntimeRetry() {
  const projectId = 'source-document-panel-title-retry';
  const namespace = 'qa.panel-title-runtime';
  const packageNamespace = 'qa.panel-title-runtime-package';
  const title = 'Runtime document title';
  const entry = 'bundle.mjs';
  const code = `
export const runtimeVersion = 1;
export const packageNamespace = "${packageNamespace}";
export const version = "1.0.0";
export function createPackage({ React, sdk }) {
  function Tool({ client, context }) {
    const [fail, setFail] = React.useState(null);
    React.useEffect(() => {
      let active = true;
      void client.read().then(snapshot => { if (active) setFail(snapshot.data.fail); });
      return () => { active = false; };
    }, [client]);
    if (fail) throw Error("synthetic panel title render failure");
    if (fail === null) return null;
    return React.createElement("h3", {"data-runtime-author-title": ""}, context.document.title);
  }
  const definition = sdk.defineLocalTool({
    namespace: "${namespace}", name: {en:"Runtime title",es:"Título runtime"},
    description: {en:"Test runtime",es:"Prueba runtime"}, initialState: {fail:true},
    validateState: value => !!value && typeof value === "object" && typeof value.fail === "boolean",
    document: {defaultTitle:{en:"Runtime title",es:"Título runtime"}}, panelTitle: false,
    codec: {version:1,fields:{fail:{kind:"scalar"}}}, component: Tool
  });
  return {members:[{namespace:"${namespace}",version,definition}]};
}
`;
  const bytes = new TextEncoder().encode(code);
  const manifest: RuntimePackageManifest = {
    format: 'writers-hoard-local-runtime-package/1', apiVersion: 1, runtimeVersion: 1,
    namespace: packageNamespace, version: '1.0.0', entry,
    members: [{ kind: 'tool', namespace, version: '1.0.0' }],
    files: [{ path: entry, bytes: bytes.length, sha256: await runtimeBytesHash(bytes), mime: 'text/javascript' }],
    contentHash: '0'.repeat(64),
  };
  manifest.contentHash = await runtimeBytesHash(new TextEncoder().encode(runtimeManifestIdentity(manifest)));
  const packet = new TextEncoder().encode(canonicalRuntimeJson({ manifest, files: { [entry]: runtimeBase64(bytes) } }) + '\n');
  const container = document.getElementById('root');
  assert(container, 'Test root missing');
  assert(!await db.projects.get(projectId) && !await db.localToolPackages.get(manifest.contentHash), 'Use a clean synthetic fixture');
  const root = createRoot(container);
  const locale = useLocaleStore.getState().locale;
  useLocaleStore.setState({ locale: 'en' });

  try {
    const installed = await installLocalRuntimePackage({ name: 'panel-title.whpackage.json', mime: 'application/json', base64: runtimeBase64(packet) });
    assert(installed.installed && installed.manifest.contentHash === manifest.contentHash, 'Runtime package was not installed');
    await db.projects.add({
      id: projectId, title: 'Runtime title test', description: '', mode: 'custom', type: 'standalone', status: 'draft',
      color: '#334455', enabledEngines: ['local-tool-' + namespace], createdAt: 1, updatedAt: 1,
    });
    await pinLocalToolRelease(projectId, namespace, manifest.contentHash, null);
    const doc = await createSourceToolDocument({ projectId }, namespace, title);
    await act(async () => root.render(<MemoryRouter><LocalToolDocumentHost projectId={projectId} documentId={doc.id} /></MemoryRouter>));
    const retry = () => [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Retry engine');
    await until(() => !!retry(), 'Runtime render failure did not reach the normal fallback');
    assert(container.textContent?.includes(title), 'Runtime fallback lost the document title');
    assert(!container.querySelector('[data-runtime-author-title]'), 'Failed tool remained visible');
    const project = await db.projects.get(projectId);
    assert(project, 'Runtime fixture project missing');
    const definition = resolveProjectLocalTool(namespace, project);
    const client = createLocalToolClient(projectId, definition, { documentId: doc.id, releaseHash: manifest.contentHash });
    const before = await client.read();
    await client.state!.apply(before, [{ type: 'set', field: 'fail', value: false }]);
    await act(async () => retry()!.click());
    await until(() => container.querySelector('[data-runtime-author-title]')?.textContent === title, 'Runtime retry did not recover');
    assert(!retry() && !container.querySelector('header h3') && container.textContent?.split(title).length === 2, 'Recovery duplicated the author title');
    assert((await client.read()).document?.id === doc.id, 'Retry changed the Source document');
    return ['Installed runtime fallback identifies the Source document, and Retry returns to the one author title'];
  } finally {
    await act(async () => root.unmount());
    useLocaleStore.setState({ locale });
    await deleteProject(projectId);
    await db.localToolPackages.delete(manifest.contentHash);
  }
}
