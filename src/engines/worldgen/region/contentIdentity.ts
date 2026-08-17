import type { HumanGeography } from '../core/settlements';
import type { WorldData } from '../core/types';
import { hashEditsString, stableStringify } from './workerProtocol';

/**
 * Stable content identities shared by worker sessions and both persistence
 * tiers. Object identity is intentionally absent: decoded worlds, pristine
 * canon sources and the two geography passes are routinely different objects.
 */

const geographyKeys = new WeakMap<HumanGeography, string>();

const mixByte = (hash: number, byte: number): number =>
  Math.imul((hash ^ (byte & 0xff)) >>> 0, 16777619) >>> 0;

function mixText(hash: number, text: string): number {
  let out = hash;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out = mixByte(out, code);
    out = mixByte(out, code >>> 8);
  }
  return out;
}

const numberBytes = new DataView(new ArrayBuffer(8));

function hashValue(
  hash: number,
  value: unknown,
  ancestors: Set<object>,
): number {
  if (value === null) return mixText(hash, 'null;');
  if (value === undefined) return mixText(hash, 'undefined;');
  if (typeof value === 'string') return mixText(mixText(hash, 's:'), `${value};`);
  if (typeof value === 'boolean') return mixText(hash, value ? 'b:1;' : 'b:0;');
  if (typeof value === 'number') {
    let out = mixText(hash, 'n:');
    numberBytes.setFloat64(0, value, true);
    for (let i = 0; i < 8; i++) out = mixByte(out, numberBytes.getUint8(i));
    return mixByte(out, 0xff);
  }
  if (typeof value === 'function' || typeof value === 'symbol') return hash;
  if (typeof value !== 'object') return mixText(hash, `${String(value)};`);

  const object = value as object;
  if (ancestors.has(object)) return mixText(hash, '[cycle];');
  ancestors.add(object);
  let out = hash;

  if (ArrayBuffer.isView(value)) {
    out = mixText(out, `typed:${value.constructor.name}:${value.byteLength}:`);
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    for (let i = 0; i < bytes.length; i++) out = mixByte(out, bytes[i]);
  } else if (Array.isArray(value)) {
    out = mixText(out, `array:${value.length}:`);
    for (const item of value) out = hashValue(out, item, ancestors);
  } else {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined && typeof record[key] !== 'function')
      .sort();
    out = mixText(out, `object:${keys.length}:`);
    for (const key of keys) {
      out = mixText(out, `${key}:`);
      out = hashValue(out, record[key], ancestors);
    }
  }
  ancestors.delete(object);
  return out;
}

export function geographyContentKey(geography: HumanGeography): string {
  const cached = geographyKeys.get(geography);
  if (cached) return cached;
  const key = (hashValue(2166136261, geography, new Set()) >>> 0).toString(36);
  geographyKeys.set(geography, key);
  return key;
}

/**
 * El SUELO, sin la revisión: qué planeta es esto.
 *
 * `worldContentKey` responde «¿es esto exactamente lo mismo?» y por eso lleva
 * la revisión — una pincelada cambia el contenido y todo lo cacheado deja de
 * valer. Pero hay una pregunta distinta que hasta ahora nadie podía hacer:
 * «¿es el MISMO SUELO con otra tinta?». La contesta esto, y de ella depende
 * que el almacén de teselas pueda seguir enseñando la versión anterior
 * mientras fabrica la nueva (`DisplayTileStore.setGeneration`) en vez de
 * dejar al lector mirando el cuarto borroso de un antepasado. La semilla NO
 * basta: reforjar con la misma semilla cambiando un parámetro es la forma
 * normal de iterar un mundo y son continentes distintos, así que el hash de
 * los parámetros entra y la revisión se queda fuera.
 */
export function worldFamilyKey(world: WorldData): string {
  return `${world.params.seed}:${world.width}x${world.height}`
    + `:p${hashEditsString(stableStringify(world.params))}`;
}

export function worldContentKey(world: WorldData): string {
  return `${worldFamilyKey(world)}:r${world.revision ?? 0}`;
}

export function mapSourceKey(
  world: WorldData,
  geography: HumanGeography,
  editsJson = '',
): string {
  return `${worldContentKey(world)}:g${geography.depth}:${geographyContentKey(geography)}`
    + `:e${hashEditsString(editsJson)}`;
}
