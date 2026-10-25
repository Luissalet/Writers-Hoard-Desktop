import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import AssetsLibrary from '@/components/project/AssetsLibrary';
import { LocalMediaPlayer } from '@/engines/media/LocalMediaPlayer';
import { useLocaleStore } from '@/stores/localeStore';
import type { InspirationImage } from '@/types';
import { boardMediaFixture } from './board-media.browser';
import { silentWav } from './vvd-media.browser';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { deleteAssets, replaceWithCompressed } from '@/services/assetsLibrary/operations';
import { listProjectAssets } from '@/services/assetsLibrary/catalog';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { getUndoJournal, undoLast } from '@/services/undoJournal';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => unknown, message: string) {
  for (let n = 0; n < 120; n++) { if (await check()) return; await act(async () => { await pause(); }); }
  throw Error(message);
}
async function click(element: Element | null) {
  assert(element, 'Missing normal control');
  await act(async () => { (element as HTMLElement).click(); await pause(); });
}
function imageData() {
  const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 30;
  const context = canvas.getContext('2d')!; context.fillStyle = '#b74d39'; context.fillRect(0, 0, 40, 30);
  return canvas.toDataURL('image/png');
}

export async function testAssetsLibraryPreviewOpen() {
  const f = await boardMediaFixture('library-preview'), host = document.getElementById('root')!, root = createRoot(host);
  const oldLocale = useLocaleStore.getState().locale;
  const row = (id: string) => host.querySelector<HTMLElement>(`[data-testid="assets-row"][data-asset-id="${id}"]`);
  try {
    useLocaleStore.setState({ locale: 'en', loaded: true });
    // Positive control: the incumbent player really decodes the same local WAV.
    await act(async () => { root.render(<LocalMediaPlayer key="positive-player" asset={f.audio} loop={false} speed={1} fallback="Format unavailable" />); await pause(); });
    await until(() => Number.isFinite(host.querySelector('audio')?.duration), 'Existing player did not decode valid WAV');
    const originalPlayer = host.querySelector('audio')!;
    assert(Math.abs(originalPlayer.duration - 2) < .02 && originalPlayer.paused && originalPlayer.controls, 'Existing player positive metadata/no-autoplay failed');
    const imageId = f.projectId + '-image';
    await db.inspirationImages.add({ id: imageId, projectId: f.projectId, imageData: imageData(), notes: 'Own positive image', tags: [], createdAt: 1 } as InspirationImage);
    await act(async () => { root.render(<StrictMode><AssetsLibrary projectId={f.projectId} /></StrictMode>); await pause(); });
    assert(!originalPlayer.getAttribute('src'), 'Existing player positive cleanup failed');
    await until(() => row(imageId) && row(f.audio.id), 'Normal assets library did not load own assets');
    const picture = row(imageId)!.querySelector<HTMLButtonElement>('button[aria-label^="Open "]')!;
    assert(picture && !picture.disabled, 'Image preview positive missing');
    await click(picture);
    await until(() => document.querySelector('[data-testid="lightbox-image"]'), 'Image lightbox positive missing');
    await click(document.querySelector('button[aria-label="Close"]'));
    assert(row(f.audio.id)!.querySelector('[data-testid="assets-download"]') && row(f.audio.id)!.querySelector('[data-testid="assets-rename"]'), 'Normal library actions absent');
    const openAudio = row(f.audio.id)!.querySelector<HTMLButtonElement>('button[aria-label^="Open "]')!;
    await click(openAudio);
    assert(!openAudio.disabled, 'Audio preview is missing: the normal library Open action is disabled despite a valid owned WAV and existing player positive');
    await until(() => !!host.querySelector('audio[controls]'), 'Library did not present the native audio preview');
    const audio = host.querySelector('audio')!;
    await until(() => Number.isFinite(audio.duration), 'Library audio preview did not decode valid WAV');
    assert(Math.abs(audio.duration - 2) < .02 && audio.paused, 'Library preview changed media or autoplayed');
    return ['Real library image and incumbent player positives; the normal Open action previews the same owned WAV with native controls, real metadata and no autoplay'];
  } finally {
    await act(async () => { root.unmount(); await pause(); });
    useLocaleStore.setState({ locale: oldLocale }); await f.cleanup();
  }
}

async function setup(suffix: string) {
  const f = await boardMediaFixture('library-' + suffix);
  const imageId = f.projectId + '-image';
  await db.inspirationImages.add({ id: imageId, projectId: f.projectId, imageData: imageData(), notes: 'Own image preview', tags: [], createdAt: 1 } as InspirationImage);
  return { ...f, imageId };
}
const rowFor = (id: string) => document.querySelector<HTMLElement>(`[data-testid="assets-row"][data-asset-id="${id}"]`);
const openFor = (id: string) => rowFor(id)?.querySelector<HTMLButtonElement>('button[aria-label^="Open "],button[aria-label^="Abrir "]') ?? null;
async function setSearch(value: string) {
  const input = document.querySelector<HTMLInputElement>('[data-testid="assets-search"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); await pause(); });
}
function trackUrls() {
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const created = new Set<string>(), revoked = new Set<string>();
  URL.createObjectURL = blob => { const url = originalCreate.call(URL, blob); created.add(url); return url; };
  URL.revokeObjectURL = url => { revoked.add(url); originalRevoke.call(URL, url); };
  return { created, revoked, restore() { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; } };
}
function released(player: HTMLMediaElement, url: string, urls: ReturnType<typeof trackUrls>) {
  assert(!player.getAttribute('src') && player.paused && urls.revoked.has(url), 'Prior real player source was not paused, removed and revoked');
}
async function ready(kind: 'audio' | 'video') {
  await until(() => Number.isFinite(document.querySelector<HTMLMediaElement>(`[data-testid="assets-media-preview"] ${kind}`)?.duration), `${kind} did not decode`);
  return document.querySelector<HTMLMediaElement>(`[data-testid="assets-media-preview"] ${kind}`)!;
}
function holdRead(table: typeof db.localMediaAssets | typeof db.inspirationImages, id: string) {
  const prototype = Object.getPrototypeOf(table), original = prototype.get;
  let entered = false, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  prototype.get = async function(this: { name: string }, key: string) { if (this.name === table.name && key === id) { entered = true; await gate; } return original.call(this, key); };
  return { get entered() { return entered; }, release, restore() { prototype.get = original; release(); } };
}
async function snapshot(projectId: string) {
  const media = await db.localMediaAssets.where('projectId').equals(projectId).sortBy('id');
  return JSON.stringify({ project: await db.projects.get(projectId),
    media: await Promise.all(media.map(async row => ({ ...row, blob: Array.from(new Uint8Array(await row.blob.arrayBuffer())) }))),
    images: await db.inspirationImages.where('projectId').equals(projectId).sortBy('id'),
    boards: await db.boards.where('projectId').equals(projectId).sortBy('id'),
    undo: getUndoJournal().filter(row => row.projectId === projectId) });
}

export async function testAssetsLibraryPreviewLifecycle() {
  const f = await setup('lifecycle'), root = createRoot(document.getElementById('root')!), urls = trackUrls();
  let visible = true;
  const render = () => root.render(<StrictMode><EnginePaneContext.Provider value={{ instanceId: 'assets-preview', projectId: f.projectId, visible }}><AssetsLibrary projectId={f.projectId} /></EnginePaneContext.Provider></StrictMode>);
  try {
    useLocaleStore.setState({ locale: 'en', loaded: true }); await act(async () => { render(); await pause(); });
    await until(() => rowFor(f.audio.id) && rowFor(f.video.id), 'Lifecycle assets absent');
    const before = await snapshot(f.projectId);
    await click(openFor(f.audio.id)); const audio = await ready('audio'), audioUrl = audio.src;
    assert(audio.paused && !audio.autoplay && audio.controls && Math.abs(audio.duration - 2) < .02, 'Audio initial state wrong');
    audio.volume = .1; await audio.play(); await until(() => audio.currentTime > .02, 'Real audio clock did not advance'); audio.pause();
    assert(audio.paused, 'Audio pause failed'); audio.currentTime = .5; await until(() => Math.abs(audio.currentTime - .5) < .02, 'Audio seek failed');
    await click(openFor(f.video.id)); const video = await ready('video'), videoUrl = video.src; released(audio, audioUrl, urls);
    assert(video.paused && video.controls && Math.abs(video.duration - 2) < .02, 'Video initial state wrong');
    video.volume = .1; await video.play(); await until(() => video.currentTime > .02, 'Real video clock did not advance'); video.pause();
    await click(document.querySelector('[data-testid="assets-preview-close"]')); released(video, videoUrl, urls);
    assert(!document.querySelector('[data-testid="assets-media-preview"]'), 'Explicit close retained preview');
    await click(openFor(f.audio.id)); const filtered = await ready('audio'), filteredUrl = filtered.src;
    await setSearch('NO_MATCH_OWN'); await until(() => !document.querySelector('audio'), 'Filtering retained playback'); released(filtered, filteredUrl, urls);
    await setSearch(''); assert(!document.querySelector('[data-testid="assets-media-preview"]'), 'Clearing filter resurrected preview');
    await click(rowFor(f.audio.id)!.querySelector('[data-testid="assets-select"]')); await setSearch('two tones');
    await click(openFor(f.audio.id)); const hidden = await ready('audio'), hiddenUrl = hidden.src;
    await act(async () => { visible = false; render(); await pause(); }); released(hidden, hiddenUrl, urls);
    await act(async () => { visible = true; render(); await pause(); });
    assert(!document.querySelector('[data-testid="assets-media-preview"]') && document.querySelector<HTMLInputElement>('[data-testid="assets-search"]')?.value === 'two tones' && rowFor(f.audio.id)!.querySelector<HTMLInputElement>('[data-testid="assets-select"]')!.checked, 'Pane hide restored preview or reset filter/selection');
    await setSearch(''); await click(openFor(f.audio.id)); const unmounted = await ready('audio'), unmountedUrl = unmounted.src;
    assert(await snapshot(f.projectId) === before, 'Open/play/close/filter/hide wrote project/media/images or Undo');
    await act(async () => { root.unmount(); await pause(); }); released(unmounted, unmountedUrl, urls);
    assert([...urls.created].every(url => urls.revoked.has(url)), 'StrictMode left an owned URL alive');
    return ['Native audio/video decode, real play/clock/pause/seek and no autoplay; switching, close, filter, pane hide and StrictMode unmount revoke actual URLs with unchanged stored bytes and receipt journal'];
  } finally { if (document.querySelector('[data-testid="assets-library"]')) await act(async () => { root.unmount(); await pause(); }); urls.restore(); await f.cleanup(); }
}

export async function testAssetsLibraryPreviewRaces() {
  const f = await setup('races'), other = await setup('other'), root = createRoot(document.getElementById('root')!), urls = trackUrls();
  let projectId = f.projectId, pending: ReturnType<typeof holdRead> | undefined;
  const render = () => root.render(<StrictMode><AssetsLibrary projectId={projectId} /></StrictMode>);
  try {
    useLocaleStore.setState({ locale: 'en', loaded: true }); await act(async () => { render(); await pause(); });
    await until(() => rowFor(f.imageId)?.querySelector('img') && rowFor(f.audio.id), 'Race positive rows absent');
    pending = holdRead(db.inspirationImages, f.imageId);
    await click(openFor(f.imageId)); await until(() => pending!.entered, 'Image read was not retained');
    assert(document.querySelector('[data-testid="assets-image-preview-pending"] [data-testid="assets-preview-close"]'), 'Pending image has no Close');
    await click(openFor(f.audio.id)); await ready('audio'); pending.restore(); pending = undefined; await act(async () => { await pause(200); });
    assert(!document.querySelector('[data-testid="lightbox-image"]') && document.querySelector('audio'), 'Late image displaced chosen media');
    await click(document.querySelector('[data-testid="assets-preview-close"]'));
    pending = holdRead(db.inspirationImages, f.imageId); await click(openFor(f.imageId)); await until(() => pending!.entered, 'Second image read not held');
    await click(document.querySelector('[data-testid="assets-preview-close"]')); pending.restore(); pending = undefined; await act(async () => { await pause(150); });
    assert(!document.querySelector('[data-testid="lightbox-image"],[data-testid="assets-image-preview-pending"]'), 'Closed image resolved late');
    pending = holdRead(db.inspirationImages, f.imageId); await click(openFor(f.imageId)); await until(() => pending!.entered, 'Filter image read not held');
    await setSearch('two tones'); pending.restore(); pending = undefined; await act(async () => { await pause(150); }); await setSearch('');
    assert(!document.querySelector('[data-testid="lightbox-image"],[data-testid="assets-image-preview-pending"]'), 'Filter removal revived pending image');
    pending = holdRead(db.localMediaAssets, f.audio.id); await click(openFor(f.audio.id)); await until(() => pending!.entered, 'Media read not held');
    await click(document.querySelector('[data-testid="assets-preview-close"]')); pending.restore(); pending = undefined; await act(async () => { await pause(150); });
    assert(!document.querySelector('audio,[data-testid="assets-media-preview"]'), 'Closed media resolved late');
    pending = holdRead(db.localMediaAssets, f.audio.id); await click(openFor(f.audio.id)); await until(() => pending!.entered, 'Owner media read not held');
    await act(async () => { projectId = other.projectId; render(); await pause(); });
    await until(() => rowFor(other.video.id), 'Other owner did not mount'); await click(openFor(other.video.id)); const video = await ready('video'), url = video.src;
    pending.restore(); pending = undefined; await act(async () => { await pause(150); });
    assert(!document.querySelector('audio') && document.querySelector('video') === video && video.src === url, 'Retired owner result adopted another preview');
    await act(async () => { projectId = f.projectId; render(); await pause(); }); released(video, url, urls);
    await until(() => rowFor(f.audio.id), 'Original owner did not return'); assert(!document.querySelector('audio,video,[data-testid="assets-media-preview"]'), 'A-B-A resurrected old request');
    return ['Shared generation rejects late image after media, close and filter, and late media after close or actual A-B-A owner remount without adopting another target'];
  } finally { pending?.restore(); await act(async () => { root.unmount(); await pause(); }); urls.restore(); await f.cleanup(); await other.cleanup(); }
}

export async function testAssetsLibraryPreviewVersionsAndData() {
  const f = await setup('versions'), root = createRoot(document.getElementById('root')!), urls = trackUrls();
  let restoreError: (() => void) | undefined;
  try {
    useLocaleStore.setState({ locale: 'en', loaded: true }); await act(async () => { root.render(<StrictMode><AssetsLibrary projectId={f.projectId} /></StrictMode>); await pause(); });
    await until(() => rowFor(f.audio.id), 'Version assets absent');
    const before = await snapshot(f.projectId), listed = await runBridgeTool('wh_list_assets', { projectId: f.projectId, kind: 'audio' });
    assert(listed.ok && (listed.result as { assets: { id: string; kind: string }[] }).assets.some(asset => asset.id === f.audio.id && asset.kind === 'audio'), 'Actual MCP catalog disagrees with preview row');
    const usage = await runBridgeTool('wh_asset_usage', { projectId: f.projectId, assetId: f.audio.id });
    assert(usage.ok && (usage.result as { usedIn: number }).usedIn === 0, 'Preview fixture unexpectedly has persistent usages');
    await click(openFor(f.audio.id)); const first = await ready('audio'), firstUrl = first.src;
    assert(await snapshot(f.projectId) === before, 'Readonly preview or bridge changed bytes/metadata/journal');
    const target = (await listProjectAssets(f.projectId)).find(asset => asset.id === f.audio.id)!;
    await replaceWithCompressed(f.projectId, target, { bytes: silentWav(), mime: 'audio/wav', ext: 'wav' });
    await until(() => document.querySelector('audio') !== first && Number.isFinite(document.querySelector('audio')?.duration), 'Same-id replacement retained old immutable player');
    const replacement = await ready('audio'); released(first, firstUrl, urls);
    assert(Math.abs(replacement.duration - .1) < .015 && replacement.paused, 'Replacement did not decode new bytes paused');
    assert(await undoLast(f.projectId) === 'undone', 'Replacement public Undo failed');
    await until(() => document.querySelector('audio') !== replacement && Math.abs((document.querySelector('audio')?.duration ?? 0) - 2) < .02, 'Undo did not restore real original bytes');
    assert(document.querySelector('audio')!.paused, 'Undo autoplayed');
    const deleting = document.querySelector('audio')!, deletingUrl = deleting.src;
    await click(rowFor(f.audio.id)!.querySelector('[data-testid="assets-delete"]')); await until(() => document.querySelector('[data-testid="assets-delete-prompt"]'), 'Normal delete prompt absent');
    await click(document.querySelector('[data-testid="assets-delete-cancel"]')); assert(await db.localMediaAssets.get(f.audio.id) && document.querySelector('audio') === deleting, 'Cancel changed source');
    await deleteAssets(f.projectId, [(await listProjectAssets(f.projectId)).find(asset => asset.id === f.audio.id)!], { force: true });
    await until(() => !document.querySelector('audio'), 'Deleted source kept playing'); released(deleting, deletingUrl, urls);
    assert(await undoLast(f.projectId) === 'undone', 'Delete public Undo failed');
    await until(() => rowFor(f.audio.id), 'Undo did not restore row'); assert(!document.querySelector('audio'), 'Undo resurrected withdrawn selection');
    await click(openFor(f.audio.id)); await ready('audio'); await click(document.querySelector('[data-testid="assets-preview-close"]'));
    const stored = (await db.localMediaAssets.get(f.audio.id))!;
    await db.localMediaAssets.put({ ...stored, blob: new Blob([new Uint8Array([0, 1, 2])], { type: 'audio/wav' }), size: 3, updatedAt: stored.updatedAt + 1 });
    await click(openFor(f.audio.id)); await until(() => document.querySelector('[data-testid="assets-media-preview"]')?.textContent?.includes('Your system cannot play this format'), 'Corrupt file lacked specific playback fallback');
    assert(rowFor(f.audio.id)!.querySelector('[data-testid="assets-download"]'), 'Codec failure removed download'); await click(document.querySelector('[data-testid="assets-preview-close"]'));
    const prototype = Object.getPrototypeOf(db.localMediaAssets), originalGet = prototype.get;
    prototype.get = async function(this: { name: string }, id: string) { if (this.name === 'localMediaAssets' && id === f.audio.id) throw Error('PRIVATE_QUERY_ERROR'); return originalGet.call(this, id); };
    restoreError = () => { prototype.get = originalGet; };
    await click(openFor(f.audio.id)); await until(() => document.querySelector('[data-preview-state="error"]'), 'Read error did not settle to local error state');
    assert(!document.body.textContent?.includes('PRIVATE_QUERY_ERROR') && document.querySelector('[data-testid="assets-preview-close"]'), 'Read error leaked diagnostics or removed Close');
    restoreError(); restoreError = undefined; await click(document.querySelector('[data-testid="assets-preview-close"]'));
    await db.localMediaAssets.put({ ...stored, projectId: 'FOREIGN_OWNER' });
    await click(openFor(f.audio.id)); await until(() => document.querySelector('[data-preview-state="missing"]'), 'Foreign row did not become unavailable');
    assert(!document.querySelector('audio'), 'Foreign row obtained player');
    await db.localMediaAssets.put(stored);
    const finalUsage = await runBridgeTool('wh_asset_usage', { projectId: f.projectId, assetId: f.audio.id });
    assert(finalUsage.ok && (finalUsage.result as { usedIn: number }).usedIn === 0, 'Ephemeral preview added persistent usage');
    return ['Canonical Base version releases same-id replacement bytes and restores real bytes through existing Undo; delete/cancel/Undo, corrupted format/query error and foreign owner remain scoped, with existing MCP IDs/usage and no preview persistence'];
  } finally { restoreError?.(); await act(async () => { root.unmount(); await pause(); }); urls.restore(); await f.cleanup(); }
}

export async function testAssetsLibraryMediaPreview() {
  const locale = useLocaleStore.getState().locale;
  try { return [...await testAssetsLibraryPreviewOpen(), ...await testAssetsLibraryPreviewLifecycle(), ...await testAssetsLibraryPreviewRaces(), ...await testAssetsLibraryPreviewVersionsAndData()]; }
  finally { useLocaleStore.setState({ locale }); }
}

const capture = window as unknown as { __want: unknown; __sizeAck?: number; __shot: unknown; __shotDone?: string };
export async function testAssetsLibraryMediaPreviewVisual() {
  const f = await setup('visual'), root = createRoot(document.getElementById('root')!), old = useLocaleStore.getState().locale;
  try {
    await db.localMediaAssets.update(f.audio.id, { title: 'QA — Quiet two-tone harbour signal, kept in the project without copying it to another tool.wav' });
    await db.localMediaAssets.update(f.video.id, { title: 'QA — Prueba de color del puerto: archivo local de vídeo conservado en su biblioteca.mp4' });
    await act(async () => { root.render(<AssetsLibrary projectId={f.projectId} />); await pause(); });
    await until(() => rowFor(f.audio.id) && rowFor(f.video.id), 'Visual library absent');
    let n = 0;
    for (const locale of ['en', 'es'] as const) {
      await act(async () => { useLocaleStore.getState().setLocale(locale); await pause(); });
      for (const width of [1280, 390]) {
        const id = ++n; capture.__want = { w: width, h: 1000, n: id };
        await until(() => capture.__sizeAck === id, 'Visual size handshake absent');
        await click(openFor(locale === 'en' ? f.audio.id : f.video.id));
        const player = await ready(locale === 'en' ? 'audio' : 'video');
        if (locale === 'es') { player.currentTime = .4; await until(() => Math.abs(player.currentTime - .4) < .02 && player.readyState >= 2, 'Visual video frame absent'); }
        const panel = document.querySelector<HTMLElement>('[data-testid="assets-media-preview"]')!, bounds = panel.getBoundingClientRect();
        assert(getComputedStyle(panel).opacity === '1' && bounds.width > 0 && bounds.left >= 0 && bounds.right <= innerWidth + 1, 'Visual preview not settled/contained');
        assert(document.documentElement.scrollWidth <= innerWidth + 1 && panel.querySelector('h4')!.scrollWidth <= panel.querySelector('h4')!.clientWidth + 1, 'Visual name/page overflow');
        assert(panel.querySelector('[data-testid="assets-preview-close"]') && player.paused, 'Visual lacks Close or autoplayed');
        const name = `assets-preview-${locale}-${width}`; capture.__shot = { name, forcePaint: true };
        await until(() => capture.__shotDone === name, 'Visual capture handshake absent');
        await click(panel.querySelector('[data-testid="assets-preview-close"]'));
      }
    }
    return ['One settled EN audio/ES video screenshot batch at 1280/390 with actual product CSS, full long names, native controls and Close; warm first frames excluded'];
  } finally { await act(async () => { root.unmount(); await pause(); }); useLocaleStore.getState().setLocale(old); await f.cleanup(); }
}
