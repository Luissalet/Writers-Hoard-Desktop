import type { Seed, Payoff } from './types';

export interface SeedSourceCatalog {
  writings: { id: string; title: string }[];
  scenes: { id: string; title: string }[];
  outlineBeats: { id: string; title: string; outlineId: string }[];
  enabledEngines: string[];
}

export function seedSourceLinks(row: Seed | Payoff, catalog: SeedSourceCatalog): { title: string; path: string }[] {
  const base = `/project/${encodeURIComponent(row.projectId)}`;
  const links: { title: string; path: string }[] = [];
  const writing = catalog.writings.find((entry) => entry.id === row.linkedWritingId);
  if (writing && catalog.enabledEngines.includes('writings')) links.push({ title: writing.title, path: `${base}/writings?writing=${encodeURIComponent(writing.id)}` });
  const scene = catalog.scenes.find((entry) => entry.id === row.linkedSceneId);
  if (scene && catalog.enabledEngines.includes('dialog-scene')) links.push({ title: scene.title, path: `${base}/dialog-scene?entity=${encodeURIComponent(scene.id)}` });
  const beat = catalog.outlineBeats.find((entry) => entry.id === row.linkedBeatId);
  if (beat && catalog.enabledEngines.includes('outline')) links.push({ title: beat.title, path: `${base}/outline?outline=${encodeURIComponent(beat.outlineId)}&beat=${encodeURIComponent(beat.id)}` });
  return links;
}

