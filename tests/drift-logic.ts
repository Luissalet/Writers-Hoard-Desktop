// Pure checks for plan drift: beats against their chapters, promises, proposals, unplanned chapters.
import assert from 'node:assert/strict';
import { checkDrift, openingOf } from '@/engines/writings/planDrift/drift';

const entities = [
  { id: 'ana', name: 'Ana Ruiz', aliases: ['la capitana'], type: 'character' },
  { id: 'bo', name: 'Bonifacio', aliases: ['Bo'], type: 'character' },
  { id: 'faro', name: 'El Faro', aliases: [], type: 'location' },
  { id: 'puerto', name: 'Puerto Gris', aliases: [], type: 'location' },
];
const beats = [
  { id: 'b1', outlineId: 'o', title: 'Ana llega a Puerto Gris', description: 'Se encuentra con Bonifacio.', level: 'chapter', order: 0, linkedWritingId: 'w1' },
  { id: 'b2', outlineId: 'o', title: 'Bo traiciona a Ana en El Faro', description: '', level: 'chapter', order: 1, linkedWritingId: 'w2' },
  { id: 'b3', outlineId: 'o', title: 'Desenlace', description: 'Todo arde.', level: 'chapter', order: 2 },
];
const chapters = [
  { writingId: 'w1', chapter: 1, title: 'La llegada', synopsis: '', text: 'La capitana desembarcó en Puerto Gris. Bonifacio la esperaba en el muelle con la carta sellada.' },
  { writingId: 'w2', chapter: 2, title: 'La tormenta', synopsis: 'Ana y un desconocido se refugian del temporal.', text: 'Ana corrió bajo la lluvia hasta Puerto Gris. Nadie la siguió.' },
  { writingId: 'w3', chapter: 3, title: 'Interludio', synopsis: '', text: 'Pasaron los años.' },
];
const promises = [
  { id: 's1', kind: 'seed' as const, title: 'la carta sellada', linkedBeatId: 'b1' },
  { id: 's2', kind: 'seed' as const, title: 'el cuchillo de plata', linkedBeatId: 'b2' },
];

export function runDriftLogicTests(): string[] {
  const passed: string[] = [];
  const report = checkDrift(beats, chapters, entities, promises, [], { characters: 'Personajes', places: 'Lugar' });
  const byId = Object.fromEntries(report.beats.map((b) => [b.beatId, b]));

  assert.equal(byId.b1.status, 'kept');
  assert.equal(byId.b1.score, 1);
  assert.deepEqual(byId.b1.expected.characters.sort(), ['ana', 'bo']);
  assert.equal(byId.b1.proposal, undefined);
  passed.push('a chapter that names who, where and the promise of its beat keeps it');

  assert.equal(byId.b2.status, 'drifted');
  assert.deepEqual(byId.b2.missing.characters, ['bo']);
  assert.deepEqual(byId.b2.missing.places, ['faro']);
  assert.deepEqual(byId.b2.missing.promises, ['s2']);
  assert.deepEqual(byId.b2.extra.places, ['puerto']);
  assert.ok(byId.b2.proposal);
  assert.equal(byId.b2.proposal!.title, 'La tormenta');
  assert.ok(byId.b2.proposal!.description.startsWith('Ana y un desconocido se refugian del temporal.'));
  assert.ok(byId.b2.proposal!.description.includes('Personajes: Ana Ruiz.'));
  assert.ok(byId.b2.proposal!.description.includes('Lugar: Puerto Gris.'));
  passed.push('a chapter that lost its beat drifts, says what is missing and proposes the beat from the chapter');

  assert.equal(byId.b3.status, 'unwritten');
  assert.deepEqual(report.unplanned, ['w3']);
  passed.push('beats without a chapter and chapters outside the outline are listed');

  const withEvent = checkDrift([{ ...beats[1], description: 'Bo aparece.' , title: 'Bo' }], [chapters[1]], entities, [], [{ writingId: 'w2', who: ['bo'] }]);
  assert.equal(withEvent.beats[0].status, 'kept');
  assert.equal(openingOf('Uno. Dos. Tres.'), 'Uno. Dos.');
  assert.deepEqual(checkDrift(beats, chapters, entities, promises), checkDrift(beats, chapters, entities, promises));
  passed.push('story events count as presence, and the check is deterministic');
  return passed;
}
