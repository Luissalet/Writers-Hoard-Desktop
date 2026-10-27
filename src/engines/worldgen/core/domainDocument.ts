import { deserializeEdits, serializeEdits, type WorldEdit } from './edits';
import type { WorldData } from './types';
import { DOMAIN_ANCHORS, domainSourceKey, resizeBounds, validDomainBounds, type DomainAnchor, type DomainBounds, type DomainCatalogue } from './worldDomain';

export interface DomainResize {
  kind: 'resize'; bounds: DomainBounds; anchor: DomainAnchor;
  fill: { version: 1; kind: 'sea' | 'land'; seaLevelM: number };
}
export interface DomainDocument {
  v: 3;
  legacy: { json: string; count: number };
  initial: { topology: 'legacy' | 'finite'; bounds: DomainBounds };
  catalogue: DomainCatalogue;
  steps: ({ kind: 'edit'; edit: WorldEdit } | DomainResize)[];
}

export function domainBounds(document: DomainDocument): DomainBounds {
  let bounds = document.initial.bounds;
  for (const step of document.steps) if (step.kind === 'resize') bounds = step.bounds;
  return bounds;
}

export function readDomainDocument(json: string): DomainDocument | null {
  let value: DomainDocument;
  try { value = JSON.parse(json) as DomainDocument; } catch { return null; }
  if (value?.v !== 3) return null;
  if (!value.legacy || typeof value.legacy.json !== 'string' || !Number.isSafeInteger(value.legacy.count) || value.legacy.count < 0
    || value.legacy.count > deserializeEdits(value.legacy.json).length || !value.initial || !['legacy', 'finite'].includes(value.initial.topology)
    || !validDomainBounds(value.initial.bounds) || value.catalogue?.version !== 1 || typeof value.catalogue.sourceKey !== 'string'
    || !Array.isArray(value.catalogue.entries) || !Array.isArray(value.steps)) throw new Error('Invalid domain journal');
  const keys = new Set<string>();
  for (const entry of value.catalogue.entries) {
    if (!entry || !['settlement', 'ruin', 'feature', 'landmark', 'realm', 'road', 'authored'].includes(entry.kind) || typeof entry.key !== 'string' || keys.has(entry.key)
      || (entry.id !== undefined && !Number.isSafeInteger(entry.id)) || (entry.name !== undefined && typeof entry.name !== 'string')
      || (entry.type !== undefined && (entry.kind !== 'ruin' || !['city', 'fort', 'tower', 'temple', 'stones', 'bridge', 'mine', 'wall'].includes(entry.type)))
      || (entry.at !== undefined && ![entry.at.x, entry.at.y].every(Number.isFinite))) throw new Error('Invalid domain catalogue');
    keys.add(entry.key);
  }
  let bounds = value.initial.bounds;
  for (const step of value.steps) {
    if (step.kind === 'resize') {
      if (!validDomainBounds(step.bounds) || !DOMAIN_ANCHORS.includes(step.anchor) || step.fill?.version !== 1 || !['sea', 'land'].includes(step.fill.kind) || !Number.isFinite(step.fill.seaLevelM)) throw new Error('Invalid domain resize');
      const expected = resizeBounds(bounds, step.bounds.width, step.bounds.height, step.anchor);
      if (expected.x !== step.bounds.x || expected.y !== step.bounds.y) throw new Error('Domain anchor does not match bounds');
      bounds = step.bounds;
    } else if (step.kind !== 'edit' || deserializeEdits(JSON.stringify({ v: 2, edits: [step.edit] })).length !== 1) throw new Error('Invalid domain edit');
  }
  return value;
}

export function serializeDomainDocument(document: DomainDocument): string {
  const json = JSON.stringify(document);
  readDomainDocument(json);
  return json;
}

export function adoptDomainDocument(source: WorldData, legacy: string, catalogue: DomainCatalogue, initial?: DomainBounds, activeCount = deserializeEdits(legacy).length): DomainDocument {
  if (catalogue.sourceKey !== domainSourceKey(source.params, legacy)) throw new Error('Catalogue belongs to another source');
  if (!Number.isSafeInteger(activeCount) || activeCount < 0 || activeCount > deserializeEdits(legacy).length) throw new Error('Invalid active legacy prefix');
  return { v: 3, legacy: { json: legacy, count: activeCount },
    initial: { topology: initial ? 'finite' : 'legacy', bounds: initial ?? { x: 0, y: 0, width: source.width, height: source.height } },
    catalogue, steps: [] };
}

export function appendDomainEdits(document: DomainDocument, edits: WorldEdit[]): DomainDocument {
  const kept = deserializeEdits(serializeEdits(edits));
  return { ...document, steps: [...document.steps, ...kept.map(edit => ({ kind: 'edit' as const, edit }))] };
}

export function appendDomainResize(document: DomainDocument, bounds: DomainBounds, anchor: DomainAnchor, fill: 'sea' | 'land', seaLevelM: number): DomainDocument {
  const result: DomainDocument = { ...document, steps: [...document.steps, { kind: 'resize', bounds, anchor, fill: { version: 1, kind: fill, seaLevelM } }] };
  serializeDomainDocument(result);
  return result;
}

export function undoDomainStep(document: DomainDocument): DomainDocument {
  if (document.steps.length) return { ...document, steps: document.steps.slice(0, -1) };
  return { ...document, legacy: { ...document.legacy, count: Math.max(0, document.legacy.count - 1) } };
}

export function domainEdits(document: DomainDocument): WorldEdit[] {
  return [...deserializeEdits(document.legacy.json).slice(0, document.legacy.count), ...document.steps.flatMap(step => step.kind === 'edit' ? [step.edit] : [])];
}
