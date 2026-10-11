/**
 * Phrase / filler (muletilla) recurrence over manuscript prose.
 * Marks repetitions; does not auto-correct. Editable lists per locale.
 */

import { stripHtml } from '@/utils/text';

export type PhraseLocale = 'es' | 'en';

/** Default fillers — editable via tool args; not a closed style guide. */
export const DEFAULT_FILLERS: Record<PhraseLocale, string[]> = {
  es: [
    'de repente',
    'en realidad',
    'la verdad es que',
    'como si nada',
    'sin más',
    'por supuesto',
    'obviamente',
    'básicamente',
    'digamos',
    'vamos',
  ],
  en: [
    'all of a sudden',
    'in reality',
    'the truth is',
    'of course',
    'obviously',
    'basically',
    'you know',
    'kind of',
    'sort of',
    'actually',
  ],
};

export interface PhraseHit {
  phrase: string;
  count: number;
  writingIds: string[];
  /** Nearby repetition inside the same chapter (window of ~80 words). */
  nearRepeats: number;
}

export interface PhraseRecurrenceReport {
  locale: PhraseLocale;
  fillers: string[];
  exclusions: string[];
  hits: PhraseHit[];
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function countPhrase(hay: string, phrase: string): number {
  if (!phrase) return 0;
  let count = 0;
  let from = 0;
  while (from <= hay.length) {
    const at = hay.indexOf(phrase, from);
    if (at < 0) break;
    count += 1;
    from = at + Math.max(1, phrase.length);
  }
  return count;
}

function nearRepeatCount(hay: string, phrase: string, windowChars = 400): number {
  const positions: number[] = [];
  let from = 0;
  while (from <= hay.length) {
    const at = hay.indexOf(phrase, from);
    if (at < 0) break;
    positions.push(at);
    from = at + Math.max(1, phrase.length);
  }
  let near = 0;
  for (let i = 1; i < positions.length; i += 1) {
    if (positions[i] - positions[i - 1] <= windowChars) near += 1;
  }
  return near;
}

export function buildPhraseRecurrence(input: {
  locale?: PhraseLocale;
  writings: Array<{ id: string; content: string }>;
  fillers?: string[];
  exclusions?: string[];
}): PhraseRecurrenceReport {
  const locale: PhraseLocale = input.locale === 'en' ? 'en' : 'es';
  const exclusions = (input.exclusions ?? []).map((e) => fold(e.trim())).filter(Boolean);
  const exclusionSet = new Set(exclusions);
  const fillers = (input.fillers ?? DEFAULT_FILLERS[locale])
    .map((f) => f.trim())
    .filter((f) => f && !exclusionSet.has(fold(f)));

  const hits: PhraseHit[] = [];
  for (const phrase of fillers) {
    const foldedPhrase = fold(phrase);
    let total = 0;
    let near = 0;
    const writingIds: string[] = [];
    for (const writing of input.writings) {
      const hay = fold(stripHtml(writing.content));
      const count = countPhrase(hay, foldedPhrase);
      if (count === 0) continue;
      total += count;
      near += nearRepeatCount(hay, foldedPhrase);
      writingIds.push(writing.id);
    }
    if (total >= 2 || near >= 1) {
      hits.push({ phrase, count: total, writingIds, nearRepeats: near });
    }
  }
  hits.sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase));
  return { locale, fillers, exclusions, hits };
}
