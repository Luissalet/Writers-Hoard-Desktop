import type { WorldParams } from './types';
import { cellKmOf, climateLatDeg } from './geoScale';
import { stableStringify } from '../region/workerProtocol';

export interface DomainBounds { x: number; y: number; width: number; height: number }
export function localToAbsoluteCell(world: { domain?: Pick<WorldDomain, 'bounds'> }, x: number, y: number) {
  return { x: x + (world.domain?.bounds.x ?? 0), y: y + (world.domain?.bounds.y ?? 0) };
}
export function absoluteToLocalCell(world: { domain?: Pick<WorldDomain, 'bounds'> }, cell: { x: number; y: number }) {
  return { x: cell.x - (world.domain?.bounds.x ?? 0), y: cell.y - (world.domain?.bounds.y ?? 0) };
}
export function worldWaypointLocalPosition(pin: { cell?: { x: number; y: number }; u: number; v: number }, world: { width: number; height: number; domain?: WorldDomain }) {
  return pin.cell ? absoluteToLocalCell(world, pin.cell) : { x: pin.u * world.width, y: pin.v * world.height };
}
export const DOMAIN_ANCHORS = ['north-west', 'north', 'north-east', 'west', 'center', 'east', 'south-west', 'south', 'south-east'] as const;
export type DomainAnchor = typeof DOMAIN_ANCHORS[number];
export interface DomainIdentity {
  kind: 'settlement' | 'ruin' | 'feature' | 'landmark' | 'realm' | 'road' | 'authored';
  key: string;
  id?: number;
  name?: string;
  /** Ruin subtype needed to retain a source candidate after a crop. */
  type?: string;
  at?: { x: number; y: number };
  refs?: { realmKey?: string; capitalKey?: string; cultureId?: string; languageId?: string; fromKey?: string; toKey?: string };
}
export interface DomainCatalogue { version: 1; sourceKey: string; entries: DomainIdentity[] }
/** Derived runtime metadata. The durable authority is the v3 edits document. */
export interface WorldDomain {
  version: 1;
  source: { width: number; height: number; baseCellKm: number; sourceKey: string };
  bounds: DomainBounds;
  topology: 'legacy' | 'finite';
  revision: number;
  catalogue: DomainCatalogue;
}

export function validDomainBounds(value: unknown): value is DomainBounds {
  if (!value || typeof value !== 'object') return false;
  const b = value as DomainBounds;
  return [b.x, b.y, b.width, b.height].every(Number.isSafeInteger) && b.width > 0 && b.height > 0
    && Number.isSafeInteger(b.width * b.height) && Number.isSafeInteger(b.x + b.width) && Number.isSafeInteger(b.y + b.height);
}

export function resizeBounds(before: DomainBounds, width: number, height: number, anchor: DomainAnchor): DomainBounds {
  const index = DOMAIN_ANCHORS.indexOf(anchor);
  if (!validDomainBounds(before) || index < 0 || !Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) throw new Error('Invalid domain size or anchor');
  const ax = (index % 3) / 2, ay = Math.floor(index / 3) / 2;
  const result = { x: before.x + Math.round((before.width - width) * ax), y: before.y + Math.round((before.height - height) * ay), width, height };
  if (!validDomainBounds(result)) throw new Error('Domain dimensions are not representable');
  return result;
}

export function planSheetSize(widthKm: number, heightKm: number, resolution: number) {
  if (![widthKm, heightKm].every(n => Number.isFinite(n) && n > 0) || !Number.isSafeInteger(resolution) || resolution < 4 || resolution % 4 !== 0) throw new Error('Invalid sheet size or resolution');
  const cellKm = Math.max(widthKm, heightKm) / resolution;
  const width = Math.max(1, Math.round(widthKm / cellKm)), height = Math.max(1, Math.round(heightKm / cellKm));
  const sourceWidth = Math.ceil(Math.max(width, height * 2) / 4) * 4;
  const sourceHeight = sourceWidth / 2;
  const bounds = resizeBounds({ x: 0, y: 0, width: sourceWidth, height: sourceHeight }, width, height, 'center');
  if (!Number.isSafeInteger(sourceWidth * sourceHeight)) throw new Error('Source dimensions are not representable');
  return { width, height, sourceWidth, sourceHeight, sourceWidthKm: sourceWidth * cellKm, cellKm, widthKm: width * cellKm, heightKm: height * cellKm, bounds };
}

/** Absolute source latitude, including an extension outside the original carrier. */
export function sourceLatitude(params: WorldParams, absoluteY: number): number {
  const frame = params.sourceFrame;
  const latitude = frame
    ? frame.centerLatitudeDeg + (params.width / 4 - absoluteY) * cellKmOf(params, params.width) * 360 / 40075
    : climateLatDeg(absoluteY / (params.width / 2), params);
  return Math.max(-89, Math.min(89, latitude));
}

/** Stable source identity; retain the literal prefix as part of the identity. */
export function domainSourceKey(params: WorldParams, legacy: string): string {
  // Two independent 32-bit lanes avoid embedding the literal edit history again in every descriptor.
  const text = stableStringify([params, legacy]);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `domain1-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
}

export function validWorldDomain(value: unknown, params: WorldParams, width: number, height: number): value is WorldDomain {
  if (!value || typeof value !== 'object') return false;
  const domain = value as WorldDomain;
  return domain.version === 1 && validDomainBounds(domain.bounds) && domain.bounds.width === width && domain.bounds.height === height
    && ['legacy', 'finite'].includes(domain.topology) && Number.isSafeInteger(domain.revision) && domain.revision >= 0
    && domain.source?.width === params.width && domain.source.height === params.width / 2
    && domain.source.baseCellKm === cellKmOf(params, params.width) && typeof domain.source.sourceKey === 'string'
    && domain.catalogue?.version === 1 && domain.catalogue.sourceKey === domain.source.sourceKey && Array.isArray(domain.catalogue.entries);
}
