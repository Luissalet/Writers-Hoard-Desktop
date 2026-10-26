import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { Editor } from '@tiptap/core';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import TiptapEditor from '@/components/editor/TiptapEditor';
import { useLocaleStore } from '@/stores/localeStore';
import { ENTITY_DETECTION_HANDLERS } from '@/services/entityDetection/bridge';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
async function until(check: () => boolean, message: string) {
  for (let index = 0; index < 160; index++) {
    if (check()) return;
    await act(async () => { await pause(); });
  }
  throw Error(message);
}

/**
 * Absence-of-port regression only: actual Tiptap + normal entity controls,
 * no Electron API, no pipeline/spans/model mock and no preparation/inference.
 * Real model/WASM/offline coverage is a distinct contract and must run later.
 */
export async function testBrowserEntityEditorPreparationPort() {
  const projectId = 'qa-browser-entity-port-project';
  const documentId = 'qa-browser-entity-port-document';
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'electronAPI');
  const previousLocale = useLocaleStore.getState().locale;
  const content = '<p>🧭 Ada Lovelace arrived in Madrid. Ada kept her own words.</p>';
  let editor: Editor | null = null;
  let changes = 0;
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
  useLocaleStore.setState({ locale: 'en', loaded: true });
  try {
    await db.projects.put({ id: projectId, title: 'Browser entity port fixture', mode: 'custom', type: 'standalone', color: '#777777', description: '', status: 'draft', enabledEngines: ['writings', 'codex'], engineOrder: ['writings', 'codex'], createdAt: 1, updatedAt: 1, entityDetectionPreferences: { revision: 0, detectNewEntities: true, autoLinkMentions: true, animateNewLinks: false } });
    await db.writings.put({ id: documentId, projectId, title: 'Owned prose fixture', content, status: 'draft', wordCount: 14, tags: [], createdAt: 1, updatedAt: 1 });
    const projectBefore = JSON.stringify(await db.projects.get(projectId));
    const writingBefore = JSON.stringify(await db.writings.get(documentId));
    await act(async () => {
      root.render(<MemoryRouter><main><TiptapEditor content={content} onChange={() => { changes++; }} onEditorReady={value => { editor = value; }} copilotIdentity={{ projectId, objectId: documentId, kind: 'writings' }} documentOwner={{ kind: 'writings', documentId }} referenceContext={{ projectId, scopeId: documentId }} entityCandidateContext={{ kind: 'writings', documentId }}/></main></MemoryRouter>);
      await pause();
    });
    await until(() => Boolean(editor && host.querySelector('.ProseMirror') && host.querySelector('.wh-entity-controls')), 'Actual Tiptap editor and normal entity controls failed to mount before Browser-port assertion');
    const current = editor as Editor | null;
    assert(current && !current.isDestroyed, 'Owned actual editor disappeared before Browser-port assertion');
    const htmlBefore = current.getHTML();
    for (const details of host.querySelectorAll<HTMLDetailsElement>('[data-editor-document-tools],.wh-entity-controls')) details.open = true;
    assert(!window.electronAPI, 'Fixture accidentally retained an Electron inference API');
    const panel = host.querySelector<HTMLElement>('.wh-entity-panel')!;
    const prepare = [...panel.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Prepare local classifier');
    assert(prepare && !prepare.disabled, 'Browser entity port missing: actual Tiptap editor cannot prepare the classifier without window.electronAPI');
    assert(!/Available in the desktop application\./.test(panel.textContent ?? ''), 'Normal Browser editor still exposes a desktop-only entity feature');
    const files = panel.querySelector<HTMLInputElement>('input[type="file"]');
    assert(files && files.multiple && !files.disabled && files.labels?.length, 'Normal Browser entity controls lack the labelled multiple-file prepared-model import');
    assert(!panel.querySelector('[data-create-entity]') && !host.querySelector('[data-wh-entity-candidate]'), 'Readiness-only Browser probe invented candidates without inference');
    assert(current.getHTML() === htmlBefore && !current.can().undo() && changes === 0, 'Readiness-only Browser controls changed authored prose or history');
    assert(JSON.stringify(await db.projects.get(projectId)) === projectBefore && JSON.stringify(await db.writings.get(documentId)) === writingBefore && await db.codexEntries.where('projectId').equals(projectId).count() === 0, 'Readiness-only Browser controls changed project/document data or created cards');
    return ['Actual Tiptap editor without Electron exposes normal prepare/import controls and preserves authored data; no model or inference exercised'];
  } finally {
    await act(async () => root.unmount());
    await deleteProject(projectId);
    if (previousApi) Object.defineProperty(window, 'electronAPI', previousApi);
    else Reflect.deleteProperty(window, 'electronAPI');
    useLocaleStore.setState({ locale: previousLocale });
  }
}

/** Normal bridge handler, no supplied candidates and no pipeline replacement. */
export async function testBrowserEntityBridgeReadinessPort() {
  const previousApi = Object.getOwnPropertyDescriptor(window, 'electronAPI');
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
  try {
    let value: unknown;
    try { value = await ENTITY_DETECTION_HANDLERS.wh_entity_detection_status(); }
    catch (cause) { throw Error(`Browser entity bridge port missing: wh_entity_detection_status failed without Electron: ${cause instanceof Error ? cause.message : String(cause)}`); }
    const status = value as { state?: unknown; model?: unknown } | undefined;
    assert(status?.state === 'missing' && typeof status.model === 'string' && status.model.includes('263e82c06569c8c2ac46238a7ae5107598934234'), `Fresh isolated Browser bridge did not report the pinned model missing without preparing/loading it: ${JSON.stringify(status)}`);
    return ['Normal entity bridge status without Electron reports a fresh Browser cache missing; no preparation/model/inference exercised'];
  } finally {
    if (previousApi) Object.defineProperty(window, 'electronAPI', previousApi);
    else Reflect.deleteProperty(window, 'electronAPI');
  }
}
