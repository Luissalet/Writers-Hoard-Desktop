// ============================================================================
// Tag dialect and prose dialect, and the join between them
// ============================================================================
//
// Two families of base model read two different languages. A booru-tagged base
// (SD 1.5, SDXL, Illustrious, Pony) was trained on `1girl, red coat, rain,
// cinematic lighting`; a prose base (Flux, Qwen, Z-Image) was trained on «A
// woman in a red coat stands in the rain.» Feed either one the other's text and
// it still generates something — which is exactly why this is worth writing
// down: the failure is quiet. The picture is merely worse, and the writer
// blames the model.
//
// Nothing here invents words. The conversion is punctuation and nothing else:
// a fragment's meaning belongs to the writer, and a resolver that rewrote it
// would make the "resolved prompt" disclosure a lie.

import type { PromptDialect } from '@/types/visualRef';

/** Sentence enders, kept out of the result: `.` `;` `!` `?` and their pairs. */
const SENTENCE_BREAK = /[.;!?]+(?:\s+|$)/;

/** Split a prose fragment into the clauses a tag base can read as tags. */
export function proseToTags(text: string): string {
  return text
    .split(SENTENCE_BREAK)
    .flatMap((sentence) => sentence.split(','))
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}

/** A tag list as one prose clause. The tags keep their order and their words. */
export function tagsToProse(text: string): string {
  const tags = text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (tags.length === 0) return '';
  return `${tags.join(', ')}.`;
}

/** `text`, written in `from`, rendered for a model that reads `to`. */
export function adaptDialect(text: string, from: PromptDialect, to: PromptDialect): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (from === to) return trimmed;
  return from === 'prose' ? proseToTags(trimmed) : tagsToProse(trimmed);
}

/**
 * Join the pieces of a prompt the way `dialect` expects them.
 *
 * Tags are commas all the way down. Prose is sentences, and a piece that
 * already ends in its own punctuation does not get a second full stop —
 * «in the rain.. cinematic» is the kind of detail that costs a generation.
 */
export function joinInDialect(parts: readonly string[], dialect: PromptDialect): string {
  const pieces = parts.map((part) => part.trim()).filter(Boolean);
  if (pieces.length === 0) return '';
  if (dialect === 'tags') return pieces.join(', ');
  return pieces
    .map((piece) => (/[.!?;:,]$/.test(piece) ? piece : `${piece}.`))
    .join(' ')
    .trim();
}

/**
 * The dialect a base family reads. Unknown families answer 'prose': a remote
 * API almost always wants a sentence, and a sentence sent to a tag model is
 * the less damaging of the two mistakes.
 */
export function dialectForFamily(family: string | undefined): PromptDialect {
  switch ((family ?? '').toLowerCase()) {
    case 'sd1':
    case 'sdxl':
    case 'illustrious':
    case 'pony':
    case 'noobai':
      return 'tags';
    default:
      return 'prose';
  }
}
