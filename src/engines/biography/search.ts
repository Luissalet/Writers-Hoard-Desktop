import type { BiographyFact } from './types';
import { htmlToText } from '@/engines/_shared/anchoring';

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();

/** Search the author's visible text, never HTML markup. */
export function matchesBiographyFact(fact: BiographyFact, query: string): boolean {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  const text = normalize([fact.title, htmlToText(fact.content), fact.date, fact.endDate, ...fact.tags, ...fact.sources.map((source) => source.description)].filter(Boolean).join(' '));
  return words.every((word) => text.includes(word));
}
