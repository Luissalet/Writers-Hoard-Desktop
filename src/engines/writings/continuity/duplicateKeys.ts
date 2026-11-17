// A duplicated project gives its worlds, characters and chapters new ids. Two
// continuity records name them inside text: the keys of "intended" marks
// (travel legs and state findings) and the story events kept in a world's edit
// list. These rewrite both with the duplicate's id lookups; an id the lookup
// does not know stays as it is.

export interface DuplicateIdLookups {
  /** Old world id -> new one, or undefined when it is not part of the copy. */
  world: (id: string) => string | undefined;
  codex: (id: string) => string | undefined;
  writing: (id: string) => string | undefined;
}

const FINDING_KINDS = ['after-death', 'item-not-carried', 'knows-before-learning', 'two-places'];

/** Story-event appearance ids (`event:<worldId>:<eventId>`) inside a key. */
function remapEventIds(text: string, ids: DuplicateIdLookups): string {
  return text.replace(/event:([^:>]+):/g, (match, worldId: string) => {
    const next = ids.world(worldId);
    return next ? `event:${next}:` : match;
  });
}

/**
 * The key of an "intended" mark: a leg (`<appearance>><appearance>`) or a state
 * finding (`<kind>:<characterId>:<line ids>`). Ledger line ids are local to the
 * card and stay as they are.
 */
export function remapIntentionalKey(key: string, ids: DuplicateIdLookups): string {
  const kind = FINDING_KINDS.find((k) => key.startsWith(`${k}:`));
  if (kind) {
    const rest = key.slice(kind.length + 1);
    const split = rest.indexOf(':');
    if (split > 0) {
      const characterId = rest.slice(0, split);
      return `${kind}:${ids.codex(characterId) ?? characterId}:${remapEventIds(rest.slice(split + 1), ids)}`;
    }
  }
  return remapEventIds(key, ids);
}

export function remapIntentionalMarks(marks: unknown, ids: DuplicateIdLookups): unknown {
  if (!marks || typeof marks !== 'object' || Array.isArray(marks)) return marks;
  return Object.fromEntries(Object.entries(marks as Record<string, unknown>).map(([key, note]) => [remapIntentionalKey(key, ids), note]));
}

/**
 * A world's serialized edit list with each story event's `who` (Codex cards) and
 * `writingId` (manuscript chapter) rewritten. Every stored shape is walked,
 * including a nested legacy list; text that is not JSON is returned untouched.
 */
export function remapStoryEditsJson(json: string, ids: DuplicateIdLookups): string {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return json; }
  let changed = false;
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (record.kind === 'story') {
      if (Array.isArray(record.who)) {
        const who = record.who.map((id) => (typeof id === 'string' ? ids.codex(id) ?? id : id));
        if (who.some((id, i) => id !== (record.who as unknown[])[i])) { record.who = who; changed = true; }
      }
      if (typeof record.writingId === 'string') {
        const next = ids.writing(record.writingId);
        if (next && next !== record.writingId) { record.writingId = next; changed = true; }
      }
      return;
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === 'json' && typeof child === 'string') {
        const next = remapStoryEditsJson(child, ids);
        if (next !== child) { record[key] = next; changed = true; }
      } else walk(child);
    }
  };
  walk(parsed);
  return changed ? JSON.stringify(parsed) : json;
}
