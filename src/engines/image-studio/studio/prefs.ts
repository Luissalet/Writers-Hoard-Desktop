// ============================================================================
// What the studio remembers about a project
// ============================================================================
//
// The disclosure level is per project because a writer's projects are not the
// same kind of work: the illustrated one is a Studio project and the one they
// are only drafting is a Simple one, and having to re-pick the level on every
// visit is how a three-level panel becomes a two-level annoyance.
//
// This is browser storage, not Dexie, on purpose. It is a view preference, it
// does not belong in a backup, and this engine owns exactly one table — which
// is `visualRefs`, the part a writer built by hand over months. A remembered
// panel level is not that.

import type { StudioPass } from './passes';
import { newChain, parsePassChain, serializePassChain } from './passes';
import { isStudioLevel, type StudioLevel } from './levels';
import type { BatchSeedMode } from './seeds';

export interface StudioPrefs {
  level: StudioLevel;
  passChain: StudioPass[];
  batchSeedMode: BatchSeedMode;
  /** Expert's "show every sampler the runtime knows". */
  showAllSamplers: boolean;
}

export const DEFAULT_STUDIO_PREFS: StudioPrefs = {
  level: 'simple',
  passChain: newChain(),
  batchSeedMode: 'incremental',
  showAllSamplers: false,
};

function key(projectId: string): string {
  return `wh.imageStudio.${projectId}`;
}

/**
 * Storage can throw, not just return null: a private window, a browser with
 * site data blocked, and the packaged app's first run before the profile
 * exists all raise on access. A studio that will not open because it could not
 * remember a dropdown is a worse failure than forgetting the dropdown.
 */
export function readStudioPrefs(projectId: string): StudioPrefs {
  try {
    const raw = window.localStorage.getItem(key(projectId));
    if (!raw) return { ...DEFAULT_STUDIO_PREFS, passChain: newChain() };
    const stored = JSON.parse(raw) as Record<string, unknown>;
    return {
      level: isStudioLevel(stored.level) ? stored.level : DEFAULT_STUDIO_PREFS.level,
      passChain: parsePassChain(typeof stored.passChain === 'string' ? stored.passChain : undefined),
      batchSeedMode: stored.batchSeedMode === 'fixed' ? 'fixed' : 'incremental',
      showAllSamplers: stored.showAllSamplers === true,
    };
  } catch {
    return { ...DEFAULT_STUDIO_PREFS, passChain: newChain() };
  }
}

export function writeStudioPrefs(projectId: string, prefs: StudioPrefs): void {
  try {
    window.localStorage.setItem(key(projectId), JSON.stringify({
      level: prefs.level,
      passChain: serializePassChain(prefs.passChain),
      batchSeedMode: prefs.batchSeedMode,
      showAllSamplers: prefs.showAllSamplers,
    }));
  } catch {
    // Nothing to do and nothing worth telling the writer: the studio works
    // exactly as well, it just opens on Simple next time.
  }
}
