// Assets library: one list for pictures, sounds, videos and 3D models; search,
// sort, kind filter, rename, delete behind a usage warning with undo,
// "Comprimir" only with the desktop bridge (cancellable, copy or replace), the
// bridge read tools, the crop frames and the lightbox zoom.
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import AssetsLibrary from '@/components/project/AssetsLibrary';
import GalleryLightbox from '@/components/gallery/GalleryLightbox';
import ImagePreviewCrop from '@/components/common/ImagePreviewCrop';
import { importLocalMedia } from '@/engines/media/operations';
import { addModelAsset, assetFromFile } from '@/engines/model-viewer/model';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { clearUndoJournal, undoLast } from '@/services/undoJournal';
import { useLocaleStore } from '@/stores/localeStore';
import type { CodexEntry, InspirationImage, Project } from '@/types';
import { modelViewerFixture } from './model-viewer-fixture';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean | Promise<boolean>, label: string, tries = 120) { for (let i = 0; i < tries; i++) { if (await check()) return; await act(async () => { await pause(50); }); } throw new Error(`Timed out: ${label}`); }
const click = async (element: Element | null, label: string) => { assert(element, label); await act(async () => { (element as HTMLElement).click(); await pause(150); }); };
const setValue = async (element: Element | null, value: string) => { assert(element, 'control'); const control = element as HTMLInputElement | HTMLSelectElement; await act(async () => { Object.getOwnPropertyDescriptor(control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(control, value); control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause(120); }); };

function pictureUrl(color: string, width = 40, height = 30): string {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!; context.fillStyle = color; context.fillRect(0, 0, width, height);
  return canvas.toDataURL('image/png');
}

export async function testAssetsLibrary(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  clearUndoJournal();
  const passed: string[] = [], P = 'assets-test', host = document.getElementById('root')!, root = createRoot(host);
  const rows = () => [...host.querySelectorAll<HTMLElement>('[data-testid="assets-row"]')];
  const names = () => rows().map(row => row.querySelector('[data-testid="assets-name"]')?.textContent ?? '');
  const rowOf = (name: string) => rows().find(row => row.querySelector('[data-testid="assets-name"]')?.textContent === name) ?? null;
  const electronHolder = window as unknown as { electronAPI?: { media?: Record<string, unknown> } };
  const previousMedia = electronHolder.electronAPI?.media;
  try {
    // ---- seed: two pictures (one is a character's avatar), a heavy sound, a video, a model
    const red = pictureUrl('#ff0000'), blue = pictureUrl('#0000ff');
    await db.projects.put({ id: P, title: 'Saga', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['codex', 'gallery'], createdAt: 1, updatedAt: 1 } as Project);
    const image = (id: string, data: string, notes: string, createdAt: number): InspirationImage => ({ id, projectId: P, imageData: data, notes, tags: ['mapa'], createdAt } as InspirationImage);
    await db.inspirationImages.bulkPut([image('img-red', red, 'Retrato de Aria', 1000), image('img-blue', blue, 'Puerto azul', 2000)]);
    await db.codexEntries.put({ id: 'aria', projectId: P, type: 'character', title: 'Aria', avatar: red, createdAt: 1, updatedAt: 1 } as unknown as CodexEntry);
    const sound = await importLocalMedia(P, new File([new Uint8Array(9 * 1024 * 1024)], 'Tormenta.mp3', { type: 'audio/mpeg' }));
    await importLocalMedia(P, new File([new Uint8Array(2048)], 'Clip.mp4', { type: 'video/mp4' }));
    const modelAsset = await assetFromFile(new File([await modelViewerFixture()], 'Castillo.glb', { type: 'model/gltf-binary' }));
    await addModelAsset(P, modelAsset);

    // ---- list, filter, search, sort
    await act(async () => { root.render(<AssetsLibrary projectId={P} />); await pause(300); });
    await until(() => rows().length === 5, 'five assets');
    assert(['image', 'audio', 'video', 'model'].every(kind => rows().some(row => row.dataset.assetKind === kind)), 'All four kinds listed');
    await click(host.querySelector('[data-testid="assets-kind-audio"]'), 'audio filter');
    assert(names().join() === 'Tormenta.mp3', `Audio filter: ${names().join()}`);
    await click(host.querySelector('[data-testid="assets-kind-all"]'), 'all filter');
    await setValue(host.querySelector('[data-testid="assets-search"]'), 'puerto');
    assert(names().join() === 'Puerto azul', `Search: ${names().join()}`);
    await setValue(host.querySelector('[data-testid="assets-search"]'), '');
    await setValue(host.querySelector('[data-testid="assets-sort"]'), 'size-desc');
    assert(names()[0] === 'Tormenta.mp3', `Largest first: ${names().join()}`);
    await setValue(host.querySelector('[data-testid="assets-sort"]'), 'name-asc');
    assert(names()[0] === 'Castillo.glb', `Name A-Z: ${names().join()}`);
    passed.push('Library: pictures, sound, video and 3D model in one list; the sound filter shows only it, searching "puerto" leaves one picture, sorting by size puts the heavy sound first and by name starts at "Castillo.glb"');

    // ---- rename through the owning engine, then undo from the journal
    await click(rowOf('Puerto azul')!.querySelector('[data-testid="assets-rename"]'), 'rename');
    await setValue(host.querySelector('[data-testid="assets-rename-input"]'), 'Puerto de noche');
    await act(async () => { host.querySelector<HTMLInputElement>('[data-testid="assets-rename-input"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await pause(250); });
    await until(() => !!rowOf('Puerto de noche'), 'renamed picture');
    assert((await db.inspirationImages.get('img-blue'))!.name === 'Puerto de noche', 'Picture name stored on its row');
    await click(rowOf('Tormenta.mp3')!.querySelector('[data-testid="assets-rename"]'), 'rename sound');
    await setValue(host.querySelector('[data-testid="assets-rename-input"]'), 'Trueno.mp3');
    await act(async () => { host.querySelector<HTMLInputElement>('[data-testid="assets-rename-input"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await pause(250); });
    await until(() => !!rowOf('Trueno.mp3'), 'renamed sound');
    assert((await db.localMediaAssets.get(sound.id))!.title === 'Trueno.mp3', 'Sound title stored on its row');
    assert(await undoLast(P) === 'undone', 'Undo of the rename');
    await until(() => !!rowOf('Tormenta.mp3'), 'rename undone');
    passed.push('Rename: a picture and a sound renamed in their own stores; the undo journal took the sound back to "Tormenta.mp3"');

    // ---- delete: usage warning, force, undo
    await click(rowOf('Retrato de Aria')!.querySelector('[data-testid="assets-delete"]'), 'delete used picture');
    await until(() => !!host.querySelector('[data-testid="assets-delete-prompt"]'), 'delete prompt');
    const warning = host.querySelector('[data-testid="assets-usage-warning"]')?.textContent ?? '';
    assert(/Se usa en 1 sitio: Aria/.test(warning), `Usage warning: ${warning}`);
    await click(host.querySelector('[data-testid="assets-delete-cancel"]'), 'cancel');
    assert(!!(await db.inspirationImages.get('img-red')), 'Cancel keeps the picture');
    await click(rowOf('Retrato de Aria')!.querySelector('[data-testid="assets-delete"]'), 'delete again');
    await until(() => !!host.querySelector('[data-testid="assets-delete-confirm"]'), 'confirm button');
    await click(host.querySelector('[data-testid="assets-delete-confirm"]'), 'confirm');
    await until(() => !rowOf('Retrato de Aria'), 'picture gone');
    assert(!(await db.inspirationImages.get('img-red')), 'Picture deleted through its engine');
    assert(await undoLast(P) === 'undone' && !!(await db.inspirationImages.get('img-red')), 'Undo puts the picture back');
    await until(() => !!rowOf('Retrato de Aria'), 'picture back');
    await click(rowOf('Puerto de noche')!.querySelector('[data-testid="assets-delete"]'), 'delete unused picture');
    await until(() => !!host.querySelector('[data-testid="assets-delete-prompt"]'), 'second prompt');
    assert(!host.querySelector('[data-testid="assets-usage-warning"]'), 'An unused picture has no usage warning');
    await click(host.querySelector('[data-testid="assets-delete-confirm"]'), 'confirm unused');
    await until(() => !rowOf('Puerto de noche'), 'unused picture gone');
    passed.push('Delete: a picture that is a character avatar warns "Se usa en 1 sitio: Aria", cancelling keeps it, confirming deletes it and the undo restores it; an unused picture is deleted with no warning');

    // ---- multi-select
    await click(rowOf('Castillo.glb')!.querySelector('[data-testid="assets-select"]'), 'select model');
    await click(rowOf('Clip.mp4')!.querySelector('[data-testid="assets-select"]'), 'select video');
    assert(/2/.test(host.querySelector('[data-testid="assets-selection"]')?.textContent ?? ''), 'Selection bar counts two');
    await click(host.querySelector('[data-testid="assets-delete-selected"]'), 'delete selected');
    await until(() => !!host.querySelector('[data-testid="assets-delete-prompt"]'), 'bulk prompt');
    await click(host.querySelector('[data-testid="assets-delete-confirm"]'), 'confirm bulk');
    await until(() => !rowOf('Castillo.glb') && !rowOf('Clip.mp4'), 'bulk deleted');
    assert(!(await db.projects.get(P))!.modelAssets?.length, 'Model removed from the project');
    passed.push('Multi-select: a model and a video chosen together and deleted in one go');

    // ---- compress: hidden without the desktop bridge
    await until(() => !!rowOf('Tormenta.mp3'), 'sound still listed');
    assert(!host.querySelector('[data-testid="assets-compress"]'), 'No Comprimir button without the desktop bridge');
    passed.push('Compress: the "Comprimir" button is hidden when the desktop bridge is absent');

    // ---- compress with a stand-in bridge: cancel, then copy
    let cancelled = 0, pending: ((value: unknown) => void) | null = null, mode: 'hang' | 'done' = 'hang';
    const fake = {
      compressAsset: (args: { bytes: ArrayBuffer }) => mode === 'hang'
        ? new Promise(resolve => { pending = resolve; })
        : Promise.resolve({ ok: true, bytes: new Uint8Array(1024 * 1024).buffer, mime: 'audio/mp4', ext: 'm4a', beforeBytes: args.bytes.byteLength, afterBytes: 1024 * 1024 }),
      cancelCompress: async () => { cancelled++; (pending as ((value: unknown) => void) | null)?.({ ok: false, cancelled: true, error: 'Cancelled.' }); return true; },
    };
    const holder = window as unknown as { electronAPI: { media: Record<string, unknown> } };
    if (holder.electronAPI?.media) Object.assign(holder.electronAPI.media, fake);
    else (window as unknown as { electronAPI: unknown }).electronAPI = { media: fake };
    await act(async () => { root.render(<AssetsLibrary key="desktop" projectId={P} />); await pause(300); });
    await until(() => !!rowOf('Tormenta.mp3')?.querySelector('[data-testid="assets-compress"]'), 'Comprimir offered for the heavy sound');
    await click(rowOf('Tormenta.mp3')!.querySelector('[data-testid="assets-compress"]'), 'open compress');
    await click(host.querySelector('[data-testid="assets-compress-start"]'), 'start');
    await until(() => !!host.querySelector('[data-testid="assets-compress-running"]'), 'running');
    await click(host.querySelector('[data-testid="assets-compress-cancel"]'), 'cancel compress');
    await until(() => !host.querySelector('[data-testid="assets-compress-panel"]'), 'panel closed after cancel');
    assert(cancelled === 1 && rows().length === 2, `Cancelling (${cancelled}, ${rows().length})`); 
    mode = 'done';
    await click(rowOf('Tormenta.mp3')!.querySelector('[data-testid="assets-compress"]'), 'open compress again');
    await click(host.querySelector('[data-testid="assets-compress-start"]'), 'start again');
    await until(() => !!host.querySelector('[data-testid="assets-compress-result"]'), 'result');
    const summary = host.querySelector('[data-testid="assets-compress-result"]')!.textContent ?? '';
    assert(/9\.0 MB → 1\.0 MB \(89% menos\)/.test(summary), `Sizes before and after: ${summary}`);
    await click(host.querySelector('[data-testid="assets-compress-copy"]'), 'save copy');
    await until(() => rows().length === 3, 'copy listed');
    assert(names().includes('Tormenta (comprimido).m4a') && names().includes('Tormenta.mp3'), `Copy next to the original: ${names().join()}`);
    assert((await db.localMediaAssets.get(sound.id))!.size === 9 * 1024 * 1024, 'The original is untouched');
    passed.push('Compress (stand-in desktop bridge): cancel stops the job and writes nothing; a finished run shows "9.0 MB → 1.0 MB (89% menos)" and saves a new "Tormenta (comprimido).m4a" beside the untouched original');

    // ---- bridge read tools
    const list = await runBridgeTool('wh_list_assets', { projectId: P, kind: 'image', sort: 'name-asc' });
    assert(list.ok, `wh_list_assets: ${JSON.stringify(list)}`);
    const listed = list.result as { total: number; assets: Array<{ id: string; kind: string; name: string }> };
    assert(listed.total === 1 && listed.assets[0].id === 'img-red' && listed.assets[0].kind === 'image', 'wh_list_assets filters by kind');
    const used = await runBridgeTool('wh_asset_usage', { projectId: P, assetId: 'img-red' });
    assert(used.ok && (used.result as { usedIn: number; warning?: string }).usedIn === 1 && /Se usa en 1 sitio: Aria/.test((used.result as { warning: string }).warning), `wh_asset_usage: ${JSON.stringify(used)}`);
    const unused = await runBridgeTool('wh_asset_usage', { projectId: P, assetId: sound.id });
    assert(unused.ok && (unused.result as { usedIn: number }).usedIn === 0, 'A sound nobody uses reports no places');
    const missing = await runBridgeTool('wh_asset_usage', { projectId: P, assetId: 'nope' });
    assert(!missing.ok, 'An unknown asset is refused');
    passed.push('Bridge: wh_list_assets filters by kind and sorts; wh_asset_usage names Aria for the avatar picture, reports zero for an unused sound and refuses an unknown id');

    // ---- crop frames and the "too small" warning
    await act(async () => { root.unmount(); await pause(); });
    const root2 = createRoot(host);
    const small = pictureUrl('#00aa00', 240, 160);
    function CropHarness() { const [src, setSrc] = useState<string | null>(small); return <ImagePreviewCrop imageSrc={src} onCancel={() => setSrc(null)} onConfirm={() => setSrc(null)} />; }
    await act(async () => { root2.render(<CropHarness />); await pause(300); });
    await until(() => !!document.querySelector('.ReactCrop img') && !!document.querySelector('[data-testid="crop-frames"]'), 'crop dialog');
    await until(() => (document.querySelector<HTMLImageElement>('.ReactCrop img')?.complete ?? false), 'crop image');
    await act(async () => { await pause(200); });
    assert(!document.querySelector('[data-testid="crop-too-small"]'), 'The free frame gives no advice');
    await click(document.querySelector('[data-testid="crop-frame-avatar"]'), 'avatar frame');
    await until(() => !!document.querySelector('[data-testid="crop-too-small"]'), 'too small notice');
    const box = document.querySelector<HTMLElement>('.ReactCrop__crop-selection')!, shownImage = document.querySelector('.ReactCrop img')!.getBoundingClientRect();
    const percent = (name: string) => parseFloat(box.style.getPropertyValue(name)) / 100;
    const squareWidth = percent('width') * shownImage.width, squareHeight = percent('height') * shownImage.height;
    assert(squareWidth > 20 && Math.abs(squareWidth - squareHeight) < 2, `Avatar frame is square: ${squareWidth}x${squareHeight}`);
    assert(/512 × 512/.test(document.querySelector('[data-testid="crop-frame-recommended"]')?.textContent ?? ''), 'Recommended size shown');
    await click(document.querySelector('[data-testid="crop-frame-free"]'), 'free frame');
    await until(() => !document.querySelector('[data-testid="crop-too-small"]'), 'notice gone on free');
    passed.push('Crop: the avatar frame makes a square selection, advises 512 × 512 and warns that a 240 × 160 picture is too small; the free frame (default) shows no advice');
    await act(async () => { root2.unmount(); await pause(); });

    // ---- lightbox zoom
    const root3 = createRoot(host);
    const shown = (await db.inspirationImages.get('img-red'))!;
    await act(async () => { root3.render(<GalleryLightbox image={shown} linkedEntries={[]} onClose={() => {}} />); await pause(300); });
    const level = () => document.querySelector('[data-testid="lightbox-zoom-level"]')?.textContent;
    const transform = () => document.querySelector<HTMLElement>('[data-testid="lightbox-image"]')?.style.transform ?? '';
    await until(() => !!document.querySelector('[data-testid="lightbox-zoom-in"]'), 'lightbox');
    assert(level() === '100%' && /scale\(1\)/.test(transform()), 'Opens fitted at 100%');
    await click(document.querySelector('[data-testid="lightbox-zoom-in"]'), 'zoom in');
    assert(level() === '125%', `Zoom in: ${level()}`);
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true })); await pause(80); });
    assert(level() === '156%', `Keyboard +: ${level()}`);
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); await pause(80); });
    assert(/translate\(60px, 0px\)/.test(transform()), `Arrow pans while zoomed: ${transform()}`);
    await click(document.querySelector('[data-testid="lightbox-zoom-reset"]'), 'reset');
    assert(level() === '100%' && /translate\(0px, 0px\) scale\(1\)/.test(transform()), `Reset: ${transform()}`);
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true })); await pause(80); });
    assert(level() === '100%', 'Key 0 fits');
    passed.push('Lightbox: opens at 100%; the zoom button and + key zoom to 125% and 156%, an arrow pans while zoomed, the reset button and the 0 key return to the fitted view');
    await act(async () => { root3.unmount(); await pause(); });
  } finally {
    if (previousMedia && electronHolder.electronAPI?.media) {
      for (const key of ['compressAsset', 'cancelCompress']) { if (key in previousMedia) continue; delete electronHolder.electronAPI.media[key]; }
    } else if (!previousMedia) { try { delete (window as unknown as { electronAPI?: unknown }).electronAPI; } catch { /* read-only bridge */ } }
    clearUndoJournal();
  }
  return passed;
}
