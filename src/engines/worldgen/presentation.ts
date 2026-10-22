import { db } from '@/db';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { worldgenScopeOperations } from './era';
import { worldSettingsScope } from './settingsScope';
import { normalizeMapGrid } from './cartography/mapGrid';
import { READER_STARTS } from './core/readerFog';
import { CONTOUR_INTERVAL_RANGE_M } from './cartography/contourLayer';
import type { GeneratedWorld, WorldPresentation, WorldPresentationLayer } from './types';

/**
 * How the author wants a world shown: the cartographic look, which layers are
 * drawn, the relief density and the 3D skin. Absent fields mean the built-in
 * defaults, so worlds saved before this existed open exactly as they did.
 */
export const PRESENTATION_THEMES = ['wonder', 'antique', 'relief', 'survey'] as const;
export const PRESENTATION_SKINS = ['satelite', 'dibujado', 'arcilla'] as const;
export const PRESENTATION_LAYERS: readonly WorldPresentationLayer[] = ['relief', 'forests', 'labels', 'settlements', 'roads', 'borders', 'frame', 'compass', 'scaleBar'];
export const PRESENTATION_DEFAULTS = {
  theme: 'wonder',
  skin3D: 'satelite',
  reliefAmount: 1,
  layers: { relief: true, forests: true, labels: true, settlements: true, roads: true, borders: false, frame: true, compass: true, scaleBar: true },
  grid: null,
  readerStart: 'blank',
  contours: null,
} as const satisfies Required<Omit<WorldPresentation, 'layers'>> & { layers: Record<WorldPresentationLayer, boolean> };
export const RELIEF_AMOUNT_RANGE = { min: 0.3, max: 2 } as const;

export class WorldPresentationError extends Error {
  readonly code: 'bad-value' | 'not-found' | 'conflict';
  constructor(code: 'bad-value' | 'not-found' | 'conflict', message: string) { super(message); this.code = code; }
}

/** Validates a partial presentation. Unknown keys and invalid values are refused, never silently dropped. */
export function normalizePresentationPatch(input: unknown): WorldPresentation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new WorldPresentationError('bad-value', 'Presentation must be an object.');
  const raw = input as Record<string, unknown>, out: WorldPresentation = {};
  for (const key of Object.keys(raw)) if (!['theme', 'skin3D', 'reliefAmount', 'layers', 'grid', 'readerStart', 'contours'].includes(key)) throw new WorldPresentationError('bad-value', `Unknown presentation field "${key}".`);
  if (raw.theme !== undefined) {
    if (!PRESENTATION_THEMES.includes(raw.theme as never)) throw new WorldPresentationError('bad-value', `theme must be one of ${PRESENTATION_THEMES.join(', ')}.`);
    out.theme = raw.theme as WorldPresentation['theme'];
  }
  if (raw.skin3D !== undefined) {
    if (!PRESENTATION_SKINS.includes(raw.skin3D as never)) throw new WorldPresentationError('bad-value', `skin3D must be one of ${PRESENTATION_SKINS.join(', ')}.`);
    out.skin3D = raw.skin3D as WorldPresentation['skin3D'];
  }
  if (raw.reliefAmount !== undefined) {
    const value = raw.reliefAmount;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < RELIEF_AMOUNT_RANGE.min || value > RELIEF_AMOUNT_RANGE.max) throw new WorldPresentationError('bad-value', `reliefAmount must be a number from ${RELIEF_AMOUNT_RANGE.min} to ${RELIEF_AMOUNT_RANGE.max}.`);
    out.reliefAmount = Math.round(value * 100) / 100;
  }
  if (raw.readerStart !== undefined) {
    if (!READER_STARTS.includes(raw.readerStart as never)) throw new WorldPresentationError('bad-value', `readerStart must be one of ${READER_STARTS.join(', ')}.`);
    out.readerStart = raw.readerStart as WorldPresentation['readerStart'];
  }
  if (raw.contours !== undefined) {
    const value = raw.contours;
    if (value !== null && value !== 'off' && !(typeof value === 'number' && Number.isInteger(value) && value >= CONTOUR_INTERVAL_RANGE_M.min && value <= CONTOUR_INTERVAL_RANGE_M.max)) throw new WorldPresentationError('bad-value', `contours must be null (as the look draws them), "off" or whole metres from ${CONTOUR_INTERVAL_RANGE_M.min} to ${CONTOUR_INTERVAL_RANGE_M.max}.`);
    out.contours = value as WorldPresentation['contours'];
  }
  if (raw.grid !== undefined) {
    try { out.grid = normalizeMapGrid(raw.grid); } catch (error) { throw new WorldPresentationError('bad-value', error instanceof Error ? error.message : String(error)); }
  }
  if (raw.layers !== undefined) {
    if (!raw.layers || typeof raw.layers !== 'object' || Array.isArray(raw.layers)) throw new WorldPresentationError('bad-value', 'layers must be an object of booleans.');
    const layers: Partial<Record<WorldPresentationLayer, boolean>> = {};
    for (const [key, value] of Object.entries(raw.layers as Record<string, unknown>)) {
      if (!PRESENTATION_LAYERS.includes(key as WorldPresentationLayer)) throw new WorldPresentationError('bad-value', `Unknown layer "${key}". Layers: ${PRESENTATION_LAYERS.join(', ')}.`);
      if (typeof value !== 'boolean') throw new WorldPresentationError('bad-value', `Layer "${key}" must be true or false.`);
      layers[key as WorldPresentationLayer] = value;
    }
    out.layers = layers;
  }
  return out;
}

/** The presentation with every default filled in; what views and exports draw. */
export function resolvePresentation(presentation: WorldPresentation | undefined): Required<Omit<WorldPresentation, 'layers'>> & { layers: Record<WorldPresentationLayer, boolean> } {
  // Field by field: one damaged stored value falls back alone, never the whole look.
  const saved: WorldPresentation = {};
  const raw = presentation && typeof presentation === 'object' ? presentation as Record<string, unknown> : {};
  for (const key of ['theme', 'skin3D', 'reliefAmount', 'grid', 'readerStart', 'contours'] as const) {
    try { Object.assign(saved, normalizePresentationPatch({ [key]: raw[key] })); } catch { /* default for this field */ }
  }
  if (raw.layers && typeof raw.layers === 'object') {
    const layers: Partial<Record<WorldPresentationLayer, boolean>> = {};
    for (const [key, value] of Object.entries(raw.layers as Record<string, unknown>)) if (PRESENTATION_LAYERS.includes(key as WorldPresentationLayer) && typeof value === 'boolean') layers[key as WorldPresentationLayer] = value;
    saved.layers = layers;
  }
  return {
    theme: saved.theme ?? PRESENTATION_DEFAULTS.theme,
    skin3D: saved.skin3D ?? PRESENTATION_DEFAULTS.skin3D,
    reliefAmount: saved.reliefAmount ?? PRESENTATION_DEFAULTS.reliefAmount,
    grid: saved.grid ?? null,
    readerStart: saved.readerStart ?? PRESENTATION_DEFAULTS.readerStart,
    contours: saved.contours ?? null,
    layers: { ...PRESENTATION_DEFAULTS.layers, ...(saved.layers ?? {}) },
  };
}

function merge(current: WorldPresentation | undefined, patch: WorldPresentation): WorldPresentation {
  const next: WorldPresentation = { ...(current ?? {}), ...patch };
  if (patch.layers) next.layers = { ...(current?.layers ?? {}), ...patch.layers };
  return next;
}

export interface PresentationReceipt {
  from?: WorldPresentation; to: WorldPresentation; revision: number;
  /** Where the change was written (Base for a world an era inherits), so undo reverts that row. */
  scope?: { projectId: string; eraId?: string };
}

/**
 * Field-merge a presentation change into the current row, in the world's own
 * era scope. Concurrent edits to other fields survive; an optional expected
 * revision refuses a stale writer instead of overwriting a newer choice.
 */
export async function saveWorldPresentation(requested: { projectId: string; eraId?: string }, worldId: string, patchInput: unknown, expectedRevision?: number): Promise<PresentationReceipt> {
  const patch = normalizePresentationPatch(patchInput);
  const scope = await worldSettingsScope(requested, worldId);
  const { worlds } = worldgenScopeOperations(scope);
  const receipt = await db.transaction('rw', scope.eraId ? db.tables : [db.generatedWorlds], async () => {
    const current = await worlds.getOne(worldId) as GeneratedWorld | undefined;
    if (!current || current.projectId !== scope.projectId) throw new WorldPresentationError('not-found', 'World no longer belongs to this project.');
    const revision = current.presentationRevision ?? 0;
    if (expectedRevision !== undefined && expectedRevision !== revision) throw new WorldPresentationError('conflict', `Presentation changed (revision ${revision}); read it again before saving.`);
    const next = merge(current.presentation, patch);
    if (JSON.stringify(next) === JSON.stringify(current.presentation ?? {})) return { from: current.presentation, to: next, revision, scope };
    await worlds.update(worldId, { presentation: next, presentationRevision: revision + 1, updatedAt: Date.now() });
    return { from: current.presentation, to: next, revision: revision + 1, scope };
  });
  notifyDataChanged({ source: 'other', table: 'generatedWorlds', entityId: worldId, projectId: scope.projectId });
  return receipt;
}

/**
 * Undo one recorded change without discarding later ones: each field is put
 * back only where it still holds the value this change wrote.
 */
export async function revertWorldPresentation(requested: { projectId: string; eraId?: string }, worldId: string, receipt: PresentationReceipt): Promise<{ reverted: string[]; kept: string[] }> {
  const scope = receipt.scope ?? await worldSettingsScope(requested, worldId);
  const { worlds } = worldgenScopeOperations(scope);
  const result = await db.transaction('rw', scope.eraId ? db.tables : [db.generatedWorlds], async () => {
    const current = await worlds.getOne(worldId) as GeneratedWorld | undefined;
    if (!current || current.projectId !== scope.projectId) throw new WorldPresentationError('not-found', 'World no longer belongs to this project.');
    const now: WorldPresentation = structuredClone(current.presentation ?? {}), reverted: string[] = [], kept: string[] = [];
    const from = receipt.from ?? {};
    for (const key of ['theme', 'skin3D', 'reliefAmount', 'readerStart', 'contours'] as const) {
      if (receipt.to[key] === from[key]) continue;
      if (now[key] !== receipt.to[key]) { kept.push(key); continue; }
      if (from[key] === undefined) delete now[key]; else (now as Record<string, unknown>)[key] = from[key];
      reverted.push(key);
    }
    // The grid is one value: compared and put back whole.
    const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    if (!same(receipt.to.grid, from.grid)) {
      if (!same(now.grid, receipt.to.grid)) kept.push('grid');
      else { if (from.grid === undefined) delete now.grid; else now.grid = from.grid; reverted.push('grid'); }
    }
    for (const layer of PRESENTATION_LAYERS) {
      const wrote = receipt.to.layers?.[layer], before = from.layers?.[layer];
      if (wrote === before) continue;
      if (now.layers?.[layer] !== wrote) { kept.push(`layers.${layer}`); continue; }
      const layers = { ...(now.layers ?? {}) };
      if (before === undefined) delete layers[layer]; else layers[layer] = before;
      if (Object.keys(layers).length) now.layers = layers; else delete now.layers;
      reverted.push(`layers.${layer}`);
    }
    if (reverted.length) await worlds.update(worldId, { presentation: now, presentationRevision: (current.presentationRevision ?? 0) + 1, updatedAt: Date.now() });
    return { reverted, kept };
  });
  notifyDataChanged({ source: 'undo', table: 'generatedWorlds', entityId: worldId, projectId: scope.projectId });
  return result;
}
