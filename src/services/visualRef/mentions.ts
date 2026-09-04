// ============================================================================
// `@Elena` — turning what the writer typed into the refs it names
// ============================================================================
//
// The cast column inserts these by drag, but the writer will type them too, and
// a mention that silently resolves to nothing is the worst outcome: the
// generation runs, the character is absent, and nothing says why. So the parser
// reports what it could NOT match as well as what it could, and the composer
// shows the unknown names.

import type { VisualRef } from '@/types/visualRef';

/** `@` followed by letters, digits, `_`, `-`, and inner spaces inside `{}`. */
const MENTION = /@(?:\{([^}]+)\}|([\p{L}\p{N}_-]+))/gu;

export interface ParsedMentions {
  /** The refs named, in the order they appear, each at most once. */
  refs: VisualRef[];
  /** Names that matched nothing, so the composer can say so. */
  unknown: string[];
  /** The subject text with every mention removed — what is left to say. */
  rest: string;
}

function fold(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** The refs a subjects slot names. Pure; case and accents are folded. */
export function parseMentions(text: string, available: readonly VisualRef[]): ParsedMentions {
  const byName = new Map<string, VisualRef>();
  for (const ref of available) {
    const key = fold(ref.name);
    // First writer wins: two refs sharing a name is the user's problem to fix,
    // but it must not make the mention resolve differently on each keystroke.
    if (key && !byName.has(key)) byName.set(key, ref);
  }
  const refs: VisualRef[] = [];
  const seen = new Set<string>();
  const unknown: string[] = [];
  const rest = text.replace(MENTION, (_match, braced: string | undefined, bare: string | undefined) => {
    const raw = (braced ?? bare ?? '').trim();
    const hit = byName.get(fold(raw));
    if (!hit) {
      if (raw && !unknown.includes(raw)) unknown.push(raw);
      return '';
    }
    if (!seen.has(hit.id)) {
      seen.add(hit.id);
      refs.push(hit);
    }
    return '';
  });
  return { refs, unknown, rest: rest.replace(/\s{2,}/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '') };
}

/** The token the cast column inserts. Braced when the name has a space in it. */
export function mentionToken(ref: Pick<VisualRef, 'name'>): string {
  return /[\s]/.test(ref.name) ? `@{${ref.name}}` : `@${ref.name}`;
}
