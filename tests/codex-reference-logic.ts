import { entryNames, entrySummary, findMentions, searchEntries } from '@/services/codexReference/matcher';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const e = (id: string, title: string, fields: Record<string, string> = {}) => ({ id, title, fields, tags: [] as string[], content: '' });

export function runCodexReferenceLogicTests(): string[] {
  const passed: string[] = [];
  const ana = e('ana', 'Ana', { Aliases: 'Anita, la Cartógrafa' });
  const anabel = e('anabel', 'Anabel');
  const anaRuiz = e('anaruiz', 'Ana Ruiz');
  const alvaro = e('alvaro', 'Álvaro', { apodo: 'El Zorro; Alvarito' });
  const faro = e('faro', 'El Faro');
  const all = [ana, anabel, anaRuiz, alvaro, faro];
  const ids = (text: string) => findMentions(text, all).map((m) => m.entryId).sort().join();

  assert(entryNames(ana).join('|') === 'Ana|Anita|la Cartógrafa', 'aliases come from the alias field, split on separators');
  assert(entryNames(e('x', 'X')).length === 0, 'one-letter names are never matched');
  passed.push('names: title plus alias fields, no one-letter names');

  assert(ids('Anabel llegó sola.') === 'anabel', '"Ana" does not match inside "Anabel"');
  assert(ids('Ana y Anabel hablaron.') === 'ana,anabel', 'both match when both appear as words');
  passed.push('word boundaries: Ana vs Anabel');

  assert(ids('Ana Ruiz cruzó la plaza.') === 'anaruiz', 'the longer name claims its span: no phantom "Ana"');
  assert(ids('Ana Ruiz vio a Ana.') === 'ana,anaruiz', 'a lone "Ana" still counts next to "Ana Ruiz"');
  passed.push('overlap: longest name wins');

  assert(ids('ALVARO miró un faro') === 'alvaro', 'case and accents are ignored, "faro" alone is not "El Faro"');
  assert(ids('Vio a álvaro y a EL FARO.') === 'alvaro,faro', 'accented entry and multi-word entry match');
  passed.push('case and accent insensitive');

  const byAlias = findMentions('Anita, Anita y Anita, la Cartógrafa, Ana.', all);
  const anaHit = byAlias.find((m) => m.entryId === 'ana');
  assert(anaHit && anaHit.count === 5 && anaHit.matchedAlias === 'Anita', 'aliases count toward the entry; the most frequent alias is reported');
  const zorro = findMentions('El Zorro, Alvarito y Álvaro', all);
  assert(zorro.length === 1 && zorro[0].entryId === 'alvaro' && zorro[0].count === 3, 'semicolon-separated aliases');
  passed.push('aliases counted per entry');

  assert(ids('Ana,Anabel;Ana-Ruiz (Ana)').includes('ana'), 'punctuation is a boundary');
  assert(ids('Banana y Canalla') === '', 'no match inside other words');
  assert(ids('') === '', 'empty text matches nothing');
  passed.push('punctuation and substrings');

  const ranked = findMentions('Anabel Anabel Ana', all);
  assert(ranked[0].entryId === 'anabel' && ranked[0].count === 2, 'sorted by count');
  passed.push('ranking by count');

  assert(searchEntries('far', all).map((x) => x.id).join() === 'faro', 'search by prefix');
  assert(searchEntries('ALVARITO', all)[0]?.id === 'alvaro', 'search finds aliases, accent-insensitive');
  assert(entrySummary({ fields: { Edad: '30' }, content: '<p>Una <b>cartógrafa</b>.</p><p>Segunda.</p>' }) === 'Una cartógrafa. Segunda.', 'summary strips tags');
  passed.push('search and summary');
  return passed;
}
