import { registerPendingFlusher, trackPendingWrite } from '@/services/pendingWrites';

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
      unregister ??= registerPendingFlusher(owner, flush);
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
