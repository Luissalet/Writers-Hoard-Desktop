// ============================================================================
// Where an asset is used — read before anything is deleted.
//
// Only what the code really references is scanned (each rule below names the
// field). Pictures are copied by value into most places (avatars, boards, map
// grounds), so those are matched by identical bytes; sounds and models are
// referenced by id from soundscape strips and from blocks inside writings.
// ============================================================================

import { db } from '@/db';
import type { Project } from '@/types';
import type { LibraryAsset } from './catalog';

export type PlaceKind =
  | 'codex-avatar' | 'codex-link' | 'board-node' | 'storyboard-panel' | 'video-segment' | 'map-background'
  | 'project-cover' | 'wiki-banner' | 'visual-ref' | 'generation-ref' | 'writing-block' | 'soundscape-strip'
  | 'codex-block' | 'diary-block' | 'board-text' | 'reader-audio' | 'published-edition' | 'image-recipe' | 'map-ambience';

export interface AssetPlace { kind: PlaceKind; id: string; name: string }

const clean = (value: string | undefined, fallback: string): string => value?.replace(/\s+/g, ' ').trim() || fallback;

/** Does this writing's HTML hold a media block (`kind` 'media') or a tool block of that kind pointing at the id? */
export function htmlReferencesAsset(html: string, kind: 'media' | 'model-viewer', id: string): boolean {
  if (!html || !html.includes(id)) return false;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (kind === 'media') return [...doc.querySelectorAll('figure[data-wh-media-block]')].some(figure => figure.getAttribute('data-asset-id') === id);
  return [...doc.querySelectorAll('figure[data-wh-tool-block]')].some(figure => figure.getAttribute('data-tool-kind') === 'model-viewer' && figure.getAttribute('data-document-id') === id);
}

async function imagePlaces(projectId: string, asset: LibraryAsset): Promise<AssetPlace[]> {
  const image = await db.inspirationImages.get(asset.id);
  if (!image || image.projectId !== projectId) return [];
  const same = (shown?: string, original?: string) => Boolean((shown && shown === image.imageData) || (original && image.imageDataOriginal && original === image.imageDataOriginal));
  const places: AssetPlace[] = [];
  const [entries, nodes, boards, panels, storyboards, segments, plans, maps, project, refs, others, recipes] = await Promise.all([
    db.codexEntries.where('projectId').equals(projectId).toArray(),
    db.boardNodes.where('projectId').equals(projectId).toArray(),
    db.boards.where('projectId').equals(projectId).toArray(),
    db.storyboardPanels.where('projectId').equals(projectId).toArray(),
    db.storyboards.where('projectId').equals(projectId).toArray(),
    db.videoSegments.where('projectId').equals(projectId).toArray(),
    db.videoPlans.where('projectId').equals(projectId).toArray(),
    db.worldMaps.where('projectId').equals(projectId).toArray(),
    db.projects.get(projectId),
    db.visualRefs.where('projectId').equals(projectId).toArray(),
    db.inspirationImages.where('projectId').equals(projectId).toArray(),
    db.imageRecipes.where('projectId').equals(projectId).toArray(),
  ]);
  for (const entry of entries) if (same(entry.avatar, entry.avatarOriginal)) places.push({ kind: 'codex-avatar', id: entry.id, name: clean(entry.title, entry.id) });
  const linked = new Set([...(image.linkedEntryIds ?? []), ...(image.linkedEntryId ? [image.linkedEntryId] : [])]);
  for (const entry of entries) if (linked.has(entry.id)) places.push({ kind: 'codex-link', id: entry.id, name: clean(entry.title, entry.id) });
  const boardName = new Map(boards.map(board => [board.id, clean(board.title, board.id)]));
  for (const node of nodes) if (same(node.image, node.imageOriginal)) places.push({ kind: 'board-node', id: node.id, name: `${boardName.get(node.boardId) ?? ''} › ${clean(node.title, node.id)}`.replace(/^ › /, '') });
  const storyboardName = new Map(storyboards.map(row => [row.id, clean(row.title, row.id)]));
  for (const panel of panels) if (panel.imageRef === image.id || same(panel.imageData, panel.imageDataOriginal)) places.push({ kind: 'storyboard-panel', id: panel.id, name: `${storyboardName.get(panel.storyboardId) ?? ''} › ${clean(panel.subtitle, panel.id)}`.replace(/^ › /, '') });
  const planName = new Map(plans.map(row => [row.id, clean(row.title, row.id)]));
  for (const segment of segments) if (same(segment.visualImageData, segment.visualImageDataOriginal)) places.push({ kind: 'video-segment', id: segment.id, name: `${planName.get(segment.videoPlanId) ?? ''} › ${clean(segment.title, segment.id)}`.replace(/^ › /, '') });
  for (const map of maps) if (map.backgroundImage && map.backgroundImage === image.imageData) places.push({ kind: 'map-background', id: map.id, name: clean(map.title, map.id) });
  if (project?.coverImage && project.coverImage === image.imageData) places.push({ kind: 'project-cover', id: project.id, name: clean(project.title, project.id) });
  for (const profile of project?.wikiProfiles ?? []) if (profile.options.home?.banner && profile.options.home.banner === image.imageData) places.push({ kind: 'wiki-banner', id: profile.id, name: clean(profile.name, profile.id) });
  for (const ref of refs) {
    const ids = [...(ref.referenceImageIds ?? []), ...(ref.sheetImageIds ?? []), ...(ref.controlImageIds ?? []), ...(ref.lora?.trainedFromImageIds ?? []), ...(ref.canonicalImageId ? [ref.canonicalImageId] : [])];
    if (ids.includes(image.id)) places.push({ kind: 'visual-ref', id: ref.id, name: clean(ref.name, ref.id) });
  }
  for (const other of others) {
    const generation = other.generation;
    if (other.id !== image.id && generation && [generation.initImageId, generation.maskImageId, generation.controlImageId, ...(generation.refImageIds ?? [])].includes(image.id)) places.push({ kind: 'generation-ref', id: other.id, name: imageNameOf(other) });
  }
  // A recipe keeps the pictures it was made from (init, mask, control and reference images) by gallery id.
  for (const recipe of recipes) {
    const inputs = recipe.inputs ?? {};
    const ids = [inputs.initImage?.imageId, inputs.maskImage?.imageId, inputs.controlImage?.imageId, ...(inputs.refImages ?? []).map(item => item?.imageId)];
    if (recipe.imageId !== image.id && ids.includes(image.id)) places.push({ kind: 'image-recipe', id: recipe.id, name: (() => { const made = others.find(other => other.id === recipe.imageId); return made ? imageNameOf(made) : recipe.id.slice(0, 6); })() });
  }
  return places;
}

function imageNameOf(image: { id: string; name?: string; notes: string }): string {
  return clean(image.name, '') || clean(image.notes.slice(0, 60), '') || image.id.slice(0, 6);
}

async function writingPlaces(projectId: string, kind: 'media' | 'model-viewer', id: string): Promise<AssetPlace[]> {
  const [writings, entries, diary, nodes, project] = await Promise.all([
    db.writings.where('projectId').equals(projectId).toArray(),
    db.codexEntries.where('projectId').equals(projectId).toArray(),
    db.diaryEntries.where('projectId').equals(projectId).toArray(),
    db.boardNodes.where('projectId').equals(projectId).toArray(),
    db.projects.get(projectId),
  ]);
  const places: AssetPlace[] = [];
  for (const writing of writings) if (htmlReferencesAsset(writing.content ?? '', kind, id)) places.push({ kind: 'writing-block', id: writing.id, name: clean(writing.title, writing.id) });
  for (const entry of entries) if (htmlReferencesAsset(entry.content ?? '', kind, id)) places.push({ kind: 'codex-block', id: entry.id, name: clean(entry.title, entry.id) });
  for (const row of diary) if (htmlReferencesAsset(row.content ?? '', kind, id)) places.push({ kind: 'diary-block', id: row.id, name: clean(row.title, row.id) });
  for (const node of nodes) if (htmlReferencesAsset(node.richContent ?? '', kind, id) || htmlReferencesAsset(node.content ?? '', kind, id)) places.push({ kind: 'board-text', id: node.id, name: clean(node.title, node.id) });
  for (const edition of project?.publishedEditions ?? []) {
    if ((edition.chapters ?? []).some(chapter => htmlReferencesAsset(chapter.writing?.content ?? '', kind, id))) places.push({ kind: 'published-edition', id: edition.id, name: clean(edition.title, edition.id) });
  }
  return places;
}

/** Reader soundtrack: chapter audio and paragraph cues of the live presentation and of every published edition. */
function readerAudioPlaces(project: Project | undefined, assetId: string): AssetPlace[] {
  const places: AssetPlace[] = [];
  const scan = (presentation: { chapters?: Record<string, { audio?: { assetId: string }; paragraphAudio?: Array<{ track?: { assetId: string } }> }> } | undefined, id: string, name: string, kind: PlaceKind) => {
    const used = Object.values(presentation?.chapters ?? {}).some(style => style?.audio?.assetId === assetId || (style?.paragraphAudio ?? []).some(cue => cue?.track?.assetId === assetId));
    if (used) places.push({ kind, id, name });
  };
  scan(project?.readerPresentation, project?.id ?? '', clean(project?.title, 'Reader'), 'reader-audio');
  for (const edition of project?.publishedEditions ?? []) scan(edition.presentation, edition.id, clean(edition.title, edition.id), 'published-edition');
  return places;
}

/** Wiki map ambience: the map's own loop and the loops of its pins point at an audio asset by id. */
async function mapAmbiencePlaces(projectId: string, assetId: string): Promise<AssetPlace[]> {
  const [maps, pins] = await Promise.all([db.worldMaps.where('projectId').equals(projectId).toArray(), db.mapPins.where('projectId').equals(projectId).toArray()]);
  const names = new Map(maps.map(map => [map.id, clean(map.title, map.id)]));
  return [
    ...maps.filter(map => map.ambience?.assetId === assetId).map((map): AssetPlace => ({ kind: 'map-ambience', id: map.id, name: names.get(map.id)! })),
    ...pins.filter(pin => pin.ambience?.assetId === assetId).map((pin): AssetPlace => ({ kind: 'map-ambience', id: pin.id, name: `${names.get(pin.mapId) ?? ''} › ${clean(pin.name, pin.id)}`.replace(/^ › /, '') })),
  ];
}

async function mediaPlaces(projectId: string, asset: LibraryAsset): Promise<AssetPlace[]> {
  const places: AssetPlace[] = [];
  const [project, row, entries] = await Promise.all([db.projects.get(projectId), db.localMediaAssets.get(asset.id), db.codexEntries.where('projectId').equals(projectId).toArray()]);
  for (const soundscape of project?.soundscapes?.items ?? []) {
    for (const scene of soundscape.scenes) if (scene.strips.some(strip => strip.assetId === asset.id)) places.push({ kind: 'soundscape-strip', id: soundscape.id, name: `${clean(soundscape.name, soundscape.id)} › ${clean(scene.name, scene.id)}` });
  }
  const linked = new Set(row?.linkedEntryIds ?? []);
  for (const entry of entries) if (linked.has(entry.id)) places.push({ kind: 'codex-link', id: entry.id, name: clean(entry.title, entry.id) });
  places.push(...readerAudioPlaces(project, asset.id));
  places.push(...await mapAmbiencePlaces(projectId, asset.id));
  places.push(...await writingPlaces(projectId, 'media', asset.id));
  return places;
}

/** Everything in the project that points at this asset. Empty means nothing does. */
export async function findAssetUsage(projectId: string, asset: LibraryAsset): Promise<AssetPlace[]> {
  if (asset.kind === 'image') return imagePlaces(projectId, asset);
  if (asset.kind === 'model') return writingPlaces(projectId, 'model-viewer', asset.id);
  return mediaPlaces(projectId, asset);
}

/** The names that appear in the warning, without repeats. */
export function placeNames(places: readonly AssetPlace[]): string[] {
  return [...new Set(places.map(place => place.name))];
}
