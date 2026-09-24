import { registerPendingFlusher, trackPendingWrite } from '@/services/pendingWrites';

/**
 * Los escritores con algo pendiente, por mundo. Un escritor externo que va
 * directo a la fila (el puente sin vista registrada) tiene que dejar que esto
 * llegue al disco ANTES de leer la lista: si no, el guardado retrasado de la
 * vista —que se está cerrando, o que aún no ha cargado su sesión— aterriza
 * después con la lista vieja y borra la edición externa.
 */
const dirty = new Map<string, Set<() => Promise<boolean>>>();

/** Rondas de vaciado antes de rendirse: una por escritor que aparezca mientras tanto. */
const FLUSH_ROUNDS = 8;

/**
 * Drain every pending view save for this world; false if one of them failed.
 *
 * NO BASTA UNA FOTO DEL CONJUNTO. Mientras se vacía, otro escritor del mismo
 * mundo (una vista que se remonta, la que prepara su sesión) puede programar su
 * guardado; con una sola pasada ése quedaba fuera y aterrizaba DESPUÉS del que
 * vino a vaciar, con su lista vieja. Se repite hasta que no quede nadie, con
 * techo: si nunca se calma, se contesta que no (y el llamante reintenta luego).
 */
export async function flushWorldEdits(worldId: string): Promise<boolean> {
  for (let round = 0; round < FLUSH_ROUNDS; round += 1) {
    const writers = dirty.get(worldId);
    if (!writers?.size) return true;
    const results = await Promise.all([...writers].map((flush) => flush()));
    if (!results.every(Boolean)) return false;
  }
  return !hasPendingWorldEdits(worldId);
}

/** Whether some view save for this world is scheduled or in flight right now. */
export function hasPendingWorldEdits(worldId: string): boolean {
  return !!dirty.get(worldId)?.size;
}

/** Coalesces strokes, preserves write order and survives navigation/close. */
export function createWorldEditWriter(
  worldId: string,
  save: (edits: string) => Promise<void> | void,
  delay = 900,
) {
  const owner = `worldgen-edits:${worldId}`;
  let latest: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<boolean> | undefined;
  let activeValue: string | undefined;
  const acknowledged: string[] = [];
  let unregister: (() => void) | undefined;
  const track = () => {
    const offLedger = registerPendingFlusher(owner, flush);
    const writers = dirty.get(worldId) ?? new Set<() => Promise<boolean>>();
    dirty.set(worldId, writers);
    writers.add(flush);
    return () => {
      offLedger();
      writers.delete(flush);
      if (!writers.size && dirty.get(worldId) === writers) dirty.delete(worldId);
    };
  };

  const flush = (): Promise<boolean> => {
    clearTimeout(timer);
    if (active) return active.then((ok) => ok && latest !== undefined ? flush() : ok);
    if (latest === undefined) return Promise.resolve(true);
    const value = latest;
    activeValue = value;
    const write = Promise.resolve().then(() => save(value));
    active = trackPendingWrite(write, flush, owner).then(() => {
      acknowledged.push(value);
      if (acknowledged.length > 2) acknowledged.shift();
      if (latest === value) latest = undefined;
      return true;
    }, () => false).finally(() => {
      active = undefined;
      activeValue = undefined;
      if (latest === undefined) {
        unregister?.();
        unregister = undefined;
      }
    });
    return active.then((ok) => ok && latest !== undefined ? flush() : ok);
  };

  return {
    schedule(value: string) {
      latest = value;
      unregister ??= track();
      clearTimeout(timer);
      timer = setTimeout(() => { void flush(); }, delay);
    },
    flush,
    /** Ignore our older DB echo only while a newer local value still awaits confirmation. */
    isSupersededEcho(value: string | undefined): boolean {
      return value !== undefined && latest !== undefined && value !== latest
        && (value === activeValue || acknowledged.includes(value));
    },
  };
}
