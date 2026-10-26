import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { useLocaleStore } from '@/stores/localeStore';
import EntityDetectionControls from '@/components/editor/entityDetection/EntityDetectionControls';
import type { EntityDetectionStatus } from '@/services/entityDetection/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
async function until(check: () => boolean, message: string) { for (let n = 0; n < 100; n++) { if (check()) return; await act(async () => { await pause(); }); } throw Error(message); }

/** Controlled preparation port only. Tiny Files are never model weights or inference. */
export async function testBrowserEntityControlsPreparationOwnership() {
  const projectId = 'qa-browser-entity-preparation-controls';
  const descriptor = Object.getOwnPropertyDescriptor(window, 'electronAPI');
  const locale = useLocaleStore.getState().locale;
  const host = document.getElementById('root')!, root = createRoot(host), editorHost = document.createElement('div');
  document.body.append(editorHost);
  const editor = new Editor({ element: editorHost, extensions: [StarterKit.configure({ trailingNode: false })], content: '<p>Owned preparation fixture.</p>' });
  const pending = new Map<string, { reject(cause: Error): void }>(), cancelled: string[] = [], imported: string[][] = [];
  let closed = 0, detected = 0, unmounted = false;
  const start = (jobId?: string) => new Promise<EntityDetectionStatus>((_resolve, reject) => { assert(jobId, 'UI did not choose its job ID before preparation'); pending.set(jobId, { reject }); });
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { entityDetection: {
    status: async (): Promise<EntityDetectionStatus> => ({ state: pending.size ? 'preparing' : 'missing', model: 'controlled-preparation-port-only-no-model', progress: 7 }),
    prepare: (options?: { jobId?: string }) => start(options?.jobId),
    importFiles: (files: File[], options?: { jobId?: string }) => { imported.push(files.map(file => file.name)); return start(options?.jobId); },
    detect: async () => { detected++; throw Error('Preparation-control fixture must never infer'); },
    cancel: async (jobId: string) => { cancelled.push(jobId); const job = pending.get(jobId); pending.delete(jobId); job?.reject(Error('controlled_preparation_cancelled')); return { supported: true, cancelled: Boolean(job) }; },
    close: async () => { closed++; },
  } } });
  useLocaleStore.setState({ locale: 'en', loaded: true });
  const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text);
  try {
    await db.projects.put({ id: projectId, title: 'Preparation control fixture', type: 'standalone', mode: 'custom', description: '', status: 'draft', color: '#777777', enabledEngines: ['codex'], engineOrder: ['codex'], createdAt: 1, updatedAt: 1 });
    const before = JSON.stringify(await db.projects.get(projectId)), prose = editor.getHTML();
    await act(async () => { root.render(<EntityDetectionControls editor={editor} projectId={projectId} entries={[]} preferences={{ revision: 0, detectNewEntities: true, autoLinkMentions: true, animateNewLinks: false }}/>); await pause(); });
    await until(() => Boolean(button('Prepare local classifier')), 'Preparation controls did not mount');
    host.querySelector<HTMLDetailsElement>('.wh-entity-controls')!.open = true;
    const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
    const choose = async (names: string[]) => {
      const transfer = new DataTransfer();
      for (const name of names) transfer.items.add(new File(['tiny controlled file, not a model'], name));
      await act(async () => { input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); await pause(); });
    };
    await choose(['config.json', 'tokenizer.json', 'tokenizer_config.json']);
    assert(button('Import selected files (3/4)')?.disabled && !imported.length, 'Partial file selection attempted import or discarded staged metadata');
    await choose(['model_quantized.onnx']);
    const importButton = button('Import selected files (4/4)');
    assert(importButton && !importButton.disabled, 'Multiple selections from different directories could not accumulate four files');
    assert(editor.getHTML() === prose && JSON.stringify(await db.projects.get(projectId)) === before, 'Choosing files changed authored data');
    await act(async () => { importButton.click(); await pause(); });
    assert(Number(imported.length) === 1 && imported[0].length === 4 && Number(pending.size) === 1, 'UI did not pass all four selected Files to its normal port');
    const ownImport = [...pending.keys()][0];
    await act(async () => { editor.commands.insertContent(' Typed while preparation is pending.'); await pause(); });
    assert(button('Prepare local classifier')?.disabled && button('Import selected files (4/4)')?.disabled && pending.has(ownImport), 'Editing prose cleared preparation busy or cancelled preparation as if it were scan results');
    await until(() => Boolean(button('Cancel preparation')), 'Real preparation cancellation control absent');
    await act(async () => { button('Cancel preparation')!.click(); await pause(); });
    await until(() => pending.size === 0 && !button('Import selected files (4/4)')?.disabled, 'Cancellation left own preparation stuck');
    assert(Number(cancelled.length) === 1 && cancelled[0] === ownImport && !closed, 'Preparation cancellation closed a shared runtime or targeted another owner');

    await act(async () => { button('Prepare local classifier')!.click(); await pause(); });
    const ownDownload = [...pending.keys()][0];
    assert(ownDownload && ownDownload !== ownImport, 'Retry reused a completed owner job identity');
    await act(async () => { root.unmount(); unmounted = true; await pause(); });
    assert(pending.size === 0 && cancelled.includes(ownDownload) && !cancelled.includes('foreign-owner-job') && !closed && !detected, 'Owner teardown left preparation pending, closed siblings or triggered inference');
    assert(JSON.stringify(await db.projects.get(projectId)) === before && await db.codexEntries.where('projectId').equals(projectId).count() === 0, 'Preparation plumbing wrote project/card metadata');
    return ['Controlled UI preparation port: four files accumulated across selections, no import before explicit action, typing preserves preparation busy, cancel/retry/unmount address own job only; no model or inference exercised'];
  } finally {
    if (!unmounted) await act(async () => root.unmount());
    editor.destroy(); editorHost.remove();
    for (const job of pending.values()) job.reject(Error('controlled_fixture_cleanup')); pending.clear();
    await deleteProject(projectId);
    if (descriptor) Object.defineProperty(window, 'electronAPI', descriptor); else Reflect.deleteProperty(window, 'electronAPI');
    useLocaleStore.setState({ locale });
  }
}
