/** Observation only: preserve undefined, holes and bytes in IndexedDB comparisons. */
export async function tagged(value: any, active = new Set<object>()): Promise<any> {
  if (value === undefined) return ['undefined'];
  if (value === null) return ['null'];
  if (typeof value === 'string' || typeof value === 'boolean') return [typeof value, value];
  if (typeof value === 'number') return ['number', Object.is(value, -0) ? '-0' : String(value)];
  if (typeof value === 'bigint') return ['bigint', String(value)];
  if (typeof value !== 'object' || active.has(value)) throw Error('OBSERVER_UNSUPPORTED_VALUE');
  active.add(value);
  try {
    if (value instanceof Blob) return ['blob', value.type, value.size, [...new Uint8Array(await value.arrayBuffer())]];
    if (value instanceof Date) return ['date', value.getTime()];
    if (value instanceof ArrayBuffer) return ['buffer', [...new Uint8Array(value)]];
    if (ArrayBuffer.isView(value)) return ['view', value.constructor.name, [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)]];
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (!array && prototype !== Object.prototype && prototype !== null) throw Error('OBSERVER_UNSUPPORTED_OBJECT');
    const keys = Reflect.ownKeys(value).filter(key => !array || key !== 'length');
    if (keys.some(key => typeof key !== 'string')) throw Error('OBSERVER_SYMBOL_KEY');
    const entries = [];
    for (const key of (keys as string[]).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!('value' in descriptor)) throw Error('OBSERVER_ACCESSOR');
      entries.push([key, await tagged(descriptor.value, active)]);
    }
    return array ? ['array', value.length, entries] : ['object', prototype === null ? 'null' : 'plain', entries];
  } finally { active.delete(value); }
}
export const structural = async (value: unknown) => JSON.stringify(await tagged(value));
export const errorInfo = (error: any) => ({ name: error?.name, message: String(error), stack: error?.stack });
