import { createMentionIndex } from '../src/services/codexReference/indexedMentions';
export async function testIndexedMentions() {
  const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
  const index = createMentionIndex([{ id: 'ana', title: 'Ana', fields: { aliases: 'La Sombra' } }, { id: 'ana-ruiz', title: 'Ana Ruiz' }, { id: 'alvaro', title: 'Álvaro' }, { id: 'dup1', title: 'Alex' }, { id: 'dup2', title: 'Alex' }, { id: 'hangul', title: '한글' }]);
  const text = '🗺️ ÁLVARO y A\u0301lvaro, Ana Ruiz y Ana; La\n\tSombra. Alex; 한글. anaranjado.';
  const hits = index.find(text);
  assert(hits.length === 7, `Expected seven matches, got ${JSON.stringify(hits)}`);
  assert(hits.map(hit => text.slice(hit.from, hit.to)).join('|') === 'ÁLVARO|A\u0301lvaro|Ana Ruiz|Ana|La\n\tSombra|Alex|한글', 'Original UTF-16 offsets preserve accents, combining marks, astral prefix and collapsed whitespace');
  assert(hits.find(hit => hit.matchedAlias === 'Alex')?.ambiguous && hits.find(hit => hit.matchedAlias === 'Alex')?.entryIds.length === 2, 'Shared names stay ambiguous');
  const many = createMentionIndex(Array.from({ length: 10000 }, (_, i) => ({ id: String(i), title: `Entity ${i}` })));
  const started = performance.now(); const large = many.find('Entity 9999 and Entity 1000. '.repeat(5000)); const elapsed = performance.now() - started;
  assert(large.length === 10000, 'Indexed large-name scan does not confuse numeric prefixes');
  return [`Indexed mentions: Unicode/source offsets, aliases, word boundaries, longest names and ambiguity pass`, `Indexed mentions: 10,000 patterns / ${large.length} original-offset ranges in ${Math.round(elapsed)} ms`];
}
