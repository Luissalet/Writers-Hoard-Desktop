import type { ArcBeat } from './types';

// Where an arc beat lands in the story. `linkedSceneId` / `linkedBeatId` could
// be picked in the beat editor, but nothing ever opened them: the author chose
// "this happens in scene 12" and then had to go find scene 12 by hand. Same
// shape as `seeds/sourceLinks.ts` — a pure resolver the row renders and the
// tests can call without mounting anything.

export interface ArcBeatLinkCatalog {
  scenes: { id: string; title: string; sceneNumber?: number }[];
  outlineBeats: { id: string; title: string; outlineId: string }[];
  /** `Project.enabledEngines`: a link into a switched-off engine is a dead end (lesson #40). */
  enabledEngines: string[];
}

export interface ArcBeatLink {
  kind: 'scene' | 'outline';
  title: string;
  path: string;
}

export function arcBeatLinks(beat: ArcBeat, catalog: ArcBeatLinkCatalog): ArcBeatLink[] {
  const base = `/project/${encodeURIComponent(beat.projectId)}`;
  const links: ArcBeatLink[] = [];
  // A deleted target leaves the id behind on the beat; resolving against the
  // live catalog hides it instead of offering a link to nothing.
  const scene = beat.linkedSceneId ? catalog.scenes.find((entry) => entry.id === beat.linkedSceneId) : undefined;
  if (scene && catalog.enabledEngines.includes('dialog-scene')) {
    links.push({
      kind: 'scene',
      title: `${scene.sceneNumber ? `#${scene.sceneNumber} ` : ''}${scene.title}`,
      path: `${base}/dialog-scene?entity=${encodeURIComponent(scene.id)}`,
    });
  }
  const outlineBeat = beat.linkedBeatId ? catalog.outlineBeats.find((entry) => entry.id === beat.linkedBeatId) : undefined;
  if (outlineBeat && catalog.enabledEngines.includes('outline')) {
    links.push({
      kind: 'outline',
      title: outlineBeat.title,
      path: `${base}/outline?outline=${encodeURIComponent(outlineBeat.outlineId)}&beat=${encodeURIComponent(outlineBeat.id)}`,
    });
  }
  return links;
}

/** The way back: the arc editor opens this arc and expands this beat. */
export function arcBeatPath(projectId: string, arcId: string, beatId: string): string {
  return `/project/${encodeURIComponent(projectId)}/character-arc?arc=${encodeURIComponent(arcId)}&beat=${encodeURIComponent(beatId)}`;
}
