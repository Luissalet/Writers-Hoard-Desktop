// ============================================
// Project presets — the one place that answers
// "which engines belong to this mode?" and
// "what would switching to it actually change?"
// ============================================
//
// `PROJECT_MODES` carried `defaultEngines` / `suggestedEngines` from the
// start, but only the creation modal ever read them, and only for the thirty
// seconds it was on screen. The Engine Manager showed a flat list with no clue
// which engines belong together. Both now group through `groupEnginesForMode`,
// so "Included with Novelist" means the same thing in both places and can only
// ever be defined once.

import {
  PROJECT_MODES,
  getAllEngines,
  getEnginesByIds,
  getEnginesForMode,
  getSuggestedEnginesForMode,
  type EngineDefinition,
  type ProjectMode,
  type ProjectModeConfig,
} from '@/engines';

/**
 * The three buckets the creation modal renders, and now the Engine Manager
 * too: what the preset switches on, what it suggests next, and everything
 * else the app can do.
 */
export interface ModeEngineGroups {
  /** `defaultEngines` — on when a project of this mode is created. */
  included: EngineDefinition[];
  /** `suggestedEngines` — the preset's natural next steps. */
  recommended: EngineDefinition[];
  /** Every other registered engine. */
  other: EngineDefinition[];
}

/**
 * Split every registered engine into the preset's three groups.
 *
 * `mode` is nullable because the creation modal calls this before the writer
 * has picked one; with no mode there is nothing to recommend, so everything
 * lands in `other`.
 */
export function groupEnginesForMode(mode: ProjectMode | null): ModeEngineGroups {
  const all = getAllEngines();
  if (!mode) return { included: [], recommended: [], other: all };

  const included = getEnginesForMode(mode);
  const includedIds = new Set(included.map(engine => engine.id));
  // A preset that lists an engine as both default and suggested should show it
  // once, in the stronger group.
  const recommended = getSuggestedEnginesForMode(mode)
    .filter(engine => !includedIds.has(engine.id));
  const claimed = new Set([...includedIds, ...recommended.map(engine => engine.id)]);

  return {
    included,
    recommended,
    other: all.filter(engine => !claimed.has(engine.id)),
  };
}

/**
 * What switching a project to a given preset would do — computed, not applied.
 *
 * Nothing here touches the database. The Engine Manager renders this so the
 * writer sees the removals by name *before* deciding, and applies it to its
 * own staged state only after they confirm.
 */
export interface PresetChange {
  mode: ProjectMode;
  config: ProjectModeConfig;
  /** Engines the preset would switch on. */
  adds: EngineDefinition[];
  /**
   * Engines the preset would switch off. Their rows are NOT deleted — a
   * disabled engine simply stops having a tab; see `EngineManager`.
   */
  removes: EngineDefinition[];
  /** Resulting `project.enabledEngines`. */
  nextEnabled: string[];
  /** Resulting `project.engineOrder`. */
  nextOrder: string[];
  /**
   * True for a preset that carries no engine list of its own (Custom). It
   * relabels the project and leaves the engine selection exactly as it is,
   * rather than emptying the workspace.
   */
  keepsCurrentEngines: boolean;
}

/** The `PROJECT_MODES` entry for a mode, or `undefined` if none matches. */
export function getModeConfig(mode: ProjectMode): ProjectModeConfig | undefined {
  return PROJECT_MODES.find(config => config.id === mode);
}

/**
 * Plan a preset switch against a project's current engine selection.
 *
 * Takes the `ProjectModeConfig` rather than a bare mode id so callers that
 * iterate `PROJECT_MODES` never need an unreachable "config not found" branch.
 *
 * Unregistered ids (an engine retired by a migration, say) are dropped from
 * the result — the same repair `ProjectDetail` already performs on load.
 */
export function planPresetChange(
  config: ProjectModeConfig,
  currentEnabled: readonly string[],
  currentOrder: readonly string[],
): PresetChange {
  const registered = new Set(getAllEngines().map(engine => engine.id));
  const enabled = [...new Set(currentEnabled)].filter(id => registered.has(id));
  const preset = [...new Set(config.defaultEngines)].filter(id => registered.has(id));

  const keepsCurrentEngines = preset.length === 0;
  const nextEnabled = keepsCurrentEngines ? enabled : preset;
  const nextEnabledSet = new Set(nextEnabled);

  // The writer's own tab arrangement survives for everything that stays; the
  // engines the preset brings in land at the end, in the preset's own order.
  const kept = [...new Set(currentOrder)].filter(id => nextEnabledSet.has(id));
  const keptSet = new Set(kept);
  const nextOrder = [...kept, ...nextEnabled.filter(id => !keptSet.has(id))];

  return {
    mode: config.id,
    config,
    adds: getEnginesByIds(nextEnabled.filter(id => !enabled.includes(id))),
    removes: getEnginesByIds(enabled.filter(id => !nextEnabledSet.has(id))),
    nextEnabled,
    nextOrder,
    keepsCurrentEngines,
  };
}
