import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useLiveQuery } from 'dexie-react-hooks';
import { Mountain } from 'lucide-react';
import { db } from '@/db';
import { createInspirationImage, createProject, deleteProject } from '@/db/operations';
import WorldCoverPanel from '@/engines/worldgen/components/WorldCoverPanel';
import CollectionDashboard from '@/engines/_shared/components/CollectionDashboard';
import { generatedWorldOps } from '@/engines/worldgen/operations';
import { worldgenScopeOperations } from '@/engines/worldgen/era';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { getWorldCover, saveWorldCover } from '@/engines/worldgen/worldCover';
import { mutateEraRows } from '@/services/worldEras/store';
import { useLocaleStore } from '@/stores/localeStore';
import { useAppStore } from '@/stores/appStore';
import type { GeneratedWorld } from '@/engines/worldgen/types';

const check: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw Error(message); };
const pause = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
async function until(test: () => unknown | Promise<unknown>, label: string) {
  for (let i = 0; i < 150; i++) { if (await test()) return; await act(async () => { await pause(); }); }
  throw Error(`Cover UI did not reach ${label}`);
}
function picture(color: string) {
  const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 10;
  const context = canvas.getContext('2d'); check(context, 'QA canvas unavailable');
  context.fillStyle = color; context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}
function imageFile(image: string) {
  const bytes = Uint8Array.from(atob(image.split(',')[1]), char => char.charCodeAt(0));
  return new File([bytes], 'owned-cover.png', { type: 'image/png' });
}
function chooseFile(input: HTMLInputElement, file?: File) {
  const transfer = new DataTransfer(); if (file) transfer.items.add(file);
  input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
}
async function click(node: Element | null, label: string) {
  check(node, label); await act(async () => { (node as HTMLElement).click(); await pause(); });
}

function CoverSurface({ projectId, worldId, eraId }: { projectId: string; worldId: string; eraId?: string }) {
  const scope = { projectId, eraId };
  const worlds = useLiveQuery(() => worldgenScopeOperations(scope).worlds.getAll(projectId), [projectId, eraId]) ?? [];
  const active = worlds.find(world => world.id === worldId);
  const preview = (world: GeneratedWorld) => world.coverImage || world.thumbnail ? { src: world.coverImage || world.thumbnail!, alt: `Cover of ${world.title}` } : null;
  return <main className="mx-auto max-w-5xl space-y-6 p-4 text-text-primary" data-testid="cover-ui-surface">
    {active && <WorldCoverPanel scope={scope} world={active} />}
    <section data-testid="cover-ui-collection"><CollectionDashboard icon={Mountain} title="Owned maps" itemNoun="Map" items={worlds} activeId={worldId} onSelect={() => {}} onCreate={async () => {}} onDelete={async () => {}} preview={preview} /></section>
    <section data-testid="cover-ui-other"><CollectionDashboard icon={Mountain} title="Another collection" itemNoun="Document" items={worlds} activeId={worldId} onSelect={() => {}} onCreate={async () => {}} onDelete={async () => {}} /></section>
  </main>;
}

async function fixture() {
  const projectId = `cover-ui-${crypto.randomUUID()}`, worldId = projectId + '-map', otherWorldId = projectId + '-other';
  const now = Date.now(), thumbnail = picture('#637c55'), red = picture('#ab3149'), blue = picture('#3575a0');
  await createProject({ id: projectId, title: 'Owned cover UI fixture', mode: 'custom', type: 'standalone', description: '', color: '#777777', status: 'draft', enabledEngines: ['worldgen', 'gallery'], engineOrder: ['worldgen', 'gallery'], worldEras: [{ id: 'past', name: 'Past', description: '', revision: 1, createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now });
  for (const [id, title] of [[worldId, 'Own northern coast'], [otherWorldId, 'Own southern islands']]) await generatedWorldOps.create({ id, projectId, title, params: { ...DEFAULT_PARAMS, seed: id, width: 128 }, edits: '[]', thumbnail, createdAt: now, updatedAt: now });
  const imageId = projectId + '-blue';
  await createInspirationImage({ id: imageId, projectId, imageData: blue, imageDataOriginal: blue, notes: 'Own blue gallery cover', tags: [], createdAt: now });
  return { projectId, worldId, otherWorldId, thumbnail, red, blue, imageId };
}

/** Leaves a real isolated panel and collection mounted for one bounded capture round. */
export async function mountWorldCoverUiPreview() {
  const f = await fixture(), host = document.getElementById('root')!, root = createRoot(host);
  const previousLocale = useLocaleStore.getState().locale, previousMotion = useAppStore.getState().motion;
  useLocaleStore.setState({ locale: 'en' }); useAppStore.setState({ motion: 'reduce' });
  const beforeCover = await getWorldCover({ projectId: f.projectId }, f.worldId);
  await saveWorldCover({ projectId: f.projectId }, f.worldId, f.blue, beforeCover.revision, beforeCover.ownerToken);
  await act(async () => { root.render(<CoverSurface projectId={f.projectId} worldId={f.worldId} />); await pause(); });
  await until(() => host.querySelector<HTMLInputElement>('[data-testid="world-cover-file"]')?.disabled === false, 'preview ready');
  return { projectId: f.projectId, worldId: f.worldId, ready: true, cleanup: async () => { await act(async () => root.unmount()); await deleteProject(f.projectId); useLocaleStore.setState({ locale: previousLocale }); useAppStore.setState({ motion: previousMotion }); } };
}

async function worldCoverUiCases() {
  const f = await fixture(), host = document.getElementById('root')!;
  const previousLocale = useLocaleStore.getState().locale, previousMotion = useAppStore.getState().motion;
  useLocaleStore.setState({ locale: 'en' }); useAppStore.setState({ motion: 'reduce' });
  let root = createRoot(host);
  const render = async (worldId = f.worldId, eraId?: string) => {
    await act(async () => { root.render(<CoverSurface projectId={f.projectId} worldId={worldId} eraId={eraId} />); await pause(); });
    await until(() => host.querySelector<HTMLInputElement>('[data-testid="world-cover-file"]')?.disabled === false, 'loaded cover controls');
  };
  const fileInput = () => { const node = host.querySelector<HTMLInputElement>('[data-testid="world-cover-file"]'); check(node, 'Normal file input missing'); return node; };
  const cover = () => getWorldCover({ projectId: f.projectId }, f.worldId);
  const shown = () => host.querySelector<HTMLImageElement>(`[data-testid="cover-ui-collection"] [data-item-id="${f.worldId}"]`)?.src;
  try {
    await render();
    check(shown() === f.thumbnail && !host.querySelector('[data-testid="cover-ui-other"] img'), 'Preview fallback or opt-in boundary wrong');
    await act(async () => { chooseFile(fileInput(), imageFile(f.red)); await pause(); });
    await until(async () => (await cover()).coverImage === f.red && shown() === f.red, 'file cover in collection');
    check((await db.generatedWorlds.get(f.worldId))!.thumbnail === f.thumbnail, 'File selection replaced derived thumbnail');
    const galleryBefore = JSON.stringify(await db.inspirationImages.get(f.imageId));
    await click(host.querySelector('[data-testid="world-cover-gallery"]'), 'Gallery action missing');
    await until(() => document.querySelector('[role="dialog"]'), 'normal gallery picker');
    const select = [...document.querySelectorAll('[role="dialog"] button')].find(node => node.textContent?.trim() === 'Own blue gallery cover');
    await click(select ?? null, 'Owned gallery image missing');
    await until(async () => (await cover()).coverImage === f.blue && shown() === f.blue, 'gallery cover in collection');
    check(JSON.stringify(await db.inspirationImages.get(f.imageId)) === galleryBefore, 'Selecting gallery image changed its source');

    const beforeCancel = JSON.stringify(await db.generatedWorlds.get(f.worldId));
    await click(host.querySelector('[data-testid="world-cover-gallery"]'), 'Change gallery action missing');
    await until(() => document.querySelector('[role="dialog"]'), 'gallery before cancel');
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await pause(); });
    await until(() => !document.querySelector('[role="dialog"]'), 'gallery cancellation');
    await act(async () => { chooseFile(fileInput()); await pause(); });
    check(JSON.stringify(await db.generatedWorlds.get(f.worldId)) === beforeCancel, 'Cancel changed the map');

    await click(host.querySelector('[data-testid="world-cover-remove"]'), 'Remove action missing');
    await until(async () => (await cover()).coverImage === null && shown() === f.thumbnail, 'removed cover fallback');
    await click(host.querySelector('[data-testid="world-cover-undo"]'), 'Undo action missing');
    await until(async () => (await cover()).coverImage === f.blue && shown() === f.blue, 'normal UI undo');
    await act(async () => root.unmount()); root = createRoot(host); await render();
    check(shown() === f.blue && !host.querySelector('[data-testid="world-cover-undo"]'), 'Cold remount lost saved cover or fabricated local undo');

    const beforeError = JSON.stringify(await db.generatedWorlds.get(f.worldId));
    await act(async () => { chooseFile(fileInput(), new File(['not an image'], 'owned-text.txt', { type: 'text/plain' })); await pause(); });
    await until(() => host.querySelector('[role="alert"]'), 'recoverable image error');
    check(JSON.stringify(await db.generatedWorlds.get(f.worldId)) === beforeError, 'Failed image replaced cover');
    await click(host.querySelector('[data-testid="world-cover-reload"]'), 'Reload action missing');
    await until(() => !host.querySelector('[role="alert"]'), 'error recovery');

    const beforeWorldChange = JSON.stringify(await db.generatedWorlds.where('projectId').equals(f.projectId).toArray());
    await act(() => { chooseFile(fileInput(), imageFile(f.red)); root.render(<CoverSurface projectId={f.projectId} worldId={f.otherWorldId} />); });
    await until(() => fileInput().disabled === false, 'new world controls');
    await act(async () => { await pause(100); });
    check(JSON.stringify(await db.generatedWorlds.where('projectId').equals(f.projectId).toArray()) === beforeWorldChange, 'Stale file read saved after world change');
    const beforeEraChange = JSON.stringify(await db.generatedWorlds.where('projectId').equals(f.projectId).toArray());
    await act(() => { chooseFile(fileInput(), imageFile(f.red)); root.render(<CoverSurface projectId={f.projectId} worldId={f.otherWorldId} eraId="past" />); });
    await until(() => fileInput().disabled === false, 'new era controls');
    await act(async () => { await pause(100); });
    check(JSON.stringify(await db.generatedWorlds.where('projectId').equals(f.projectId).toArray()) === beforeEraChange && !await db.worldEraVariants.where('projectId').equals(f.projectId).count(), 'Stale read wrote after era change or made implicit variant');
    check(!host.querySelector('[data-testid="cover-ui-other"] img'), 'Other collection gained an automatic image');
    return ['Real file input and normal GalleryAssetPicker save exact selected bytes by normal cover operations, retaining source image and thumbnail', 'Cancel is read-only; remove falls back to thumbnail; field Undo and cold panel remount retain the chosen cover', 'A real invalid file produces a recoverable error without a write', 'Pending native FileReader is discarded on world and era changes without writing old or new owner', 'Collection preview is explicit opt-in; another collection with thumbnail-bearing items remains image-free'];
  } finally {
    await act(async () => root.unmount()); await deleteProject(f.projectId);
    useLocaleStore.setState({ locale: previousLocale }); useAppStore.setState({ motion: previousMotion });
  }
}

/** A deliberate normal COW can change owner without changing requested identity or cover revision. */
async function worldCoverOwnerRequestCases() {
  const f = await fixture(), host = document.getElementById('root')!, root = createRoot(host);
  const previousLocale = useLocaleStore.getState().locale, previousMotion = useAppStore.getState().motion;
  const NativeFileReader = window.FileReader;
  useLocaleStore.setState({ locale: 'en' }); useAppStore.setState({ motion: 'reduce' });
  const scope = { projectId: f.projectId, eraId: 'past' };
  const render = async (worldId: string) => {
    await act(async () => { root.render(<CoverSurface projectId={f.projectId} worldId={worldId} eraId="past" />); await pause(); });
    await until(() => host.querySelector<HTMLInputElement>('[data-testid="world-cover-file"]')?.disabled === false, 'owner-request controls');
  };
  const ownVariant = (worldId: string) => db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([f.projectId, 'past', 'worldgen', worldId]).first();
  try {
    await render(f.worldId);
    const baseBefore = JSON.stringify(await db.generatedWorlds.get(f.worldId));
    const fileStateBefore = await getWorldCover(scope, f.worldId);
    check(fileStateBefore.scope.eraId === undefined, 'File scenario did not begin inherited');
    let release: (() => void) | undefined;
    // Only defer the browser's native read; no cover handler or data implementation is replaced.
    class DeferredFileReader extends NativeFileReader {
      override readAsDataURL(blob: Blob) { release = () => super.readAsDataURL(blob); }
    }
    window.FileReader = DeferredFileReader;
    const input = host.querySelector<HTMLInputElement>('[data-testid="world-cover-file"]'); check(input, 'File input missing before COW');
    await act(() => chooseFile(input, imageFile(f.red)));
    check(release, 'Native FileReader was not deferred');
    await act(async () => { await mutateEraRows(scope, [{ table: 'generatedWorlds', id: f.worldId, changes: { title: 'Deliberately owned era map' } }]); await pause(); });
    const ownBefore = JSON.stringify(await ownVariant(f.worldId));
    check((await getWorldCover(scope, f.worldId)).scope.eraId === 'past', 'Deliberate operation did not create own root');
    check((await getWorldCover(scope, f.worldId)).revision === fileStateBefore.revision && (await ownVariant(f.worldId))?.document?.root.createdAt === JSON.parse(baseBefore).createdAt, 'File scenario changed revision or root identity instead of only owner');
    await act(async () => { release!(); await pause(); });
    await until(() => host.querySelector('[role="alert"]'), 'file owner conflict');
    check(JSON.stringify(await ownVariant(f.worldId)) === ownBefore && JSON.stringify(await db.generatedWorlds.get(f.worldId)) === baseBefore, 'Deferred file retargeted its new owner');
    window.FileReader = NativeFileReader;

    await render(f.otherWorldId);
    const galleryStateBefore = await getWorldCover(scope, f.otherWorldId);
    check(galleryStateBefore.scope.eraId === undefined, 'Gallery scenario did not begin inherited');
    const otherBaseBefore = JSON.stringify(await db.generatedWorlds.get(f.otherWorldId));
    await click(host.querySelector('[data-testid="world-cover-gallery"]'), 'Gallery action missing before COW');
    await until(() => document.querySelector('[role="dialog"]'), 'gallery request opened');
    await act(async () => { await mutateEraRows(scope, [{ table: 'generatedWorlds', id: f.otherWorldId, changes: { title: 'Deliberate gallery owner' } }]); await pause(); });
    const otherOwnBefore = JSON.stringify(await ownVariant(f.otherWorldId));
    check((await getWorldCover(scope, f.otherWorldId)).revision === galleryStateBefore.revision && (await ownVariant(f.otherWorldId))?.document?.root.createdAt === JSON.parse(otherBaseBefore).createdAt, 'Gallery scenario changed revision or root identity instead of only owner');
    const selected = [...document.querySelectorAll('[role="dialog"] button')].find(node => node.textContent?.trim() === 'Own blue gallery cover');
    await click(selected ?? null, 'Gallery image missing after COW');
    await until(() => host.querySelector('[role="alert"]'), 'gallery owner conflict');
    check(JSON.stringify(await ownVariant(f.otherWorldId)) === otherOwnBefore && JSON.stringify(await db.generatedWorlds.get(f.otherWorldId)) === otherBaseBefore, 'Gallery selection retargeted its new owner');
    return ['Deferred native FileReader preserves the deliberately created era root and Base when the resolved owner changes at the same requested world/era', 'Gallery selection retains the owner captured when opened and preserves a later deliberate own root'];
  } finally {
    window.FileReader = NativeFileReader;
    await act(async () => root.unmount()); await deleteProject(f.projectId);
    useLocaleStore.setState({ locale: previousLocale }); useAppStore.setState({ motion: previousMotion });
  }
}

/** Observe actual post-finally counts; the normal focused runner prints returned rows. */
async function withUiCleanupCounts(run: () => Promise<string[]>) {
  const results = await run();
  const counts = Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.count()])));
  check(Object.values(counts).every(count => count === 0), `Private UI fixture cleanup left observed rows: ${JSON.stringify(counts)}`);
  return [...results, `Observed post-cleanup private database counts: ${JSON.stringify(counts)}`];
}

export async function testWorldCoverUI() { return withUiCleanupCounts(worldCoverUiCases); }
export async function testWorldCoverOwnerRequests() { return withUiCleanupCounts(worldCoverOwnerRequestCases); }
