import { applyEdits, deserializeEdits, worldLevels, type WorldEdit } from './edits';
import { Biome, type WorldData } from './types';
import { domainEdits, type DomainDocument, type DomainResize } from './domainDocument';
import { cellKmOf } from './geoScale';
import { domainSourceKey, sourceLatitude, validDomainBounds, type DomainBounds } from './worldDomain';

export const DOMAIN_GRIDS = ['elevation', 'plateId', 'boundary', 'temperature', 'precipitation', 'biome', 'flow', 'lake', 'lakeSurface', 'currentU', 'currentV', 'sst', 'currentSpeed', 'ice'] as const;

/** Independent materialization. Overlap is copied, never resampled or re-derived. */
export function materializeDomain(before: WorldData, bounds: DomainBounds, fill: DomainResize['fill']): WorldData {
  if (!validDomainBounds(bounds)) throw new Error('Invalid domain bounds');
  const previous = before.domain?.bounds ?? { x: 0, y: 0, width: before.width, height: before.height };
  const output: WorldData = { ...before, width: bounds.width, height: bounds.height, revision: (before.revision ?? 0) + 1, painted: undefined, rivers: [], landmarks: [], plateInfo: before.plateInfo.map(plate => ({ ...plate, seedX: plate.seedX + previous.x - bounds.x, seedY: plate.seedY + previous.y - bounds.y })) };
  const n = bounds.width * bounds.height;
  for (const key of DOMAIN_GRIDS) {
    const original = before[key];
    const values = key === 'plateId' || key === 'biome' || key === 'lake' ? new Uint8Array(n) : new Float32Array(n);
    if (key === 'elevation') values.fill(fill.kind === 'sea' ? -1.6 : 0.3);
    if (key === 'biome') values.fill(fill.kind === 'sea' ? Biome.Ocean : Biome.Grassland);
    if (key === 'precipitation' && fill.kind === 'land') values.fill(800);
    if (key === 'temperature') for (let y = 0; y < bounds.height; y++) values.fill(28 - Math.abs(sourceLatitude(before.params, y + bounds.y + 0.5)) * 0.45, y * bounds.width, (y + 1) * bounds.width);
    const x0 = Math.max(previous.x, bounds.x), x1 = Math.min(previous.x + previous.width, bounds.x + bounds.width);
    const y0 = Math.max(previous.y, bounds.y), y1 = Math.min(previous.y + previous.height, bounds.y + bounds.height);
    if (original && x1 > x0) for (let y = y0; y < y1; y++) {
      const from = (y - previous.y) * before.width + x0 - previous.x;
      values.set(original.subarray(from, from + x1 - x0), (y - bounds.y) * bounds.width + x0 - bounds.x);
    }
    // All fourteen fields have the same geometric extent, including old worlds without lakeSurface.
    Object.assign(output, { [key]: values });
  }
  const projectCell = (cell: number): number | null => {
    const x = cell % before.width + previous.x - bounds.x, y = Math.floor(cell / before.width) + previous.y - bounds.y;
    return x >= 0 && y >= 0 && x < bounds.width && y < bounds.height ? y * bounds.width + x : null;
  };
  // Split at the cropped edge; reconnecting the two retained ends would invent a river across the cut.
  for (const river of before.rivers) {
    let segment: number[] = [];
    const flush = () => { if (segment.length) output.rivers.push({ cells: Uint32Array.from(segment), flow: river.flow }); segment = []; };
    for (const cell of river.cells) {
      const mapped = projectCell(cell);
      if (mapped === null) flush();
      else { if (segment.length && Math.abs(mapped % bounds.width - segment.at(-1)! % bounds.width) > 1) flush(); segment.push(mapped); }
    }
    flush();
  }
  output.landmarks = before.landmarks.flatMap(place => {
    const x = place.x + previous.x - bounds.x, y = place.y + previous.y - bounds.y;
    return x >= 0 && y >= 0 && x < bounds.width && y < bounds.height ? [{ ...place, x, y }] : [];
  });
  return output;
}

/** Project geometry only; origin keys and text remain literal. */
export function projectDomainEdit(edit: WorldEdit, bounds: DomainBounds): WorldEdit {
  const copy = structuredClone(edit) as WorldEdit & { x?: number; y?: number; pts?: { x: number; y: number }[] };
  const point = (p: { x: number; y: number }) => ({ x: p.x - bounds.x, y: p.y - bounds.y });
  if ('stroke' in copy) copy.stroke.pts = copy.stroke.pts.map(point);
  if (copy.pts) copy.pts = copy.pts.map(point);
  if (typeof copy.x === 'number') copy.x -= bounds.x;
  if (typeof copy.y === 'number') copy.y -= bounds.y;
  return copy;
}

export function unprojectDomainEdit(edit: WorldEdit, bounds: DomainBounds): WorldEdit {
  return projectDomainEdit(edit, { ...bounds, x: -bounds.x, y: -bounds.y });
}

/** Replay one ordered journal from the fixed pristine source. Never replay a resize as a fixed-grid brush. */
export function replayDomain(source: WorldData, document: DomainDocument, revision: number): WorldData {
  if (document.catalogue.sourceKey !== domainSourceKey(source.params, document.legacy.json)) throw new Error('Domain source changed');
  let world = structuredClone(source);
  delete world.domain;
  const prefix = deserializeEdits(document.legacy.json).slice(0, document.legacy.count);
  if (prefix.length) applyEdits(world, prefix);
  world.domain = { version: 1, source: { width: source.params.width, height: source.params.width / 2, baseCellKm: cellKmOf(source.params, source.params.width), sourceKey: document.catalogue.sourceKey },
    bounds: { x: 0, y: 0, width: source.width, height: source.height }, topology: document.initial.topology, revision, catalogue: document.catalogue };
  const bind = (next: WorldData, bounds: DomainBounds) => { next.domain = { ...world.domain!, bounds, topology: document.steps.some(s => s.kind === 'resize') ? 'finite' : document.initial.topology }; world = next; };
  const initial = document.initial.bounds;
  if (initial.x || initial.y || initial.width !== world.width || initial.height !== world.height) bind(materializeDomain(world, initial, { version: 1, kind: 'sea', seaLevelM: 0 }), initial);
  let seaLevelM = worldLevels(prefix).seaLevelM;
  let pending: WorldEdit[] = [];
  const flush = () => {
    if (!pending.length) return;
    applyEdits(world, pending.map(edit => projectDomainEdit(edit, world.domain!.bounds)), seaLevelM);
    for (const edit of pending) if (edit.kind === 'seaLevel') seaLevelM = edit.m;
    pending = [];
  };
  for (const step of document.steps) {
    if (step.kind === 'resize') { flush(); bind(materializeDomain(world, step.bounds, step.fill), step.bounds); }
    else pending.push(step.edit);
  }
  flush();
  // Rebuild narrative overlays from their whole ordered authority without reapplying physical strokes.
  const narrative = domainEdits(document).map(edit => projectDomainEdit(edit, world.domain!.bounds));
  if (narrative.length) applyEdits(world, narrative, seaLevelM, true);
  return world;
}
