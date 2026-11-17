// Pure checks for the voice profile: dialogue extraction and attribution, profiles, outliers, blind test.
import assert from 'node:assert/strict';
import { extractDialogue, splitParagraph } from '@/engines/writings/voice/dialogue';
import { blindSample, buildProfiles, findOutliers, scoreBlind } from '@/engines/writings/voice/profile';

const characters = [
  { id: 'ana', name: 'Ana Ruiz', aliases: ['la capitana'] },
  { id: 'bo', name: 'Bonifacio', aliases: ['Bo'] },
];

const ana = ['Vale, vamos ya, tú primero', 'Vale, tú mira la puerta, rápido', '¡Vale! Corre, tú no te pares', 'Vale, tú tranquila, que llegamos', 'Vale, ¿tú lo has visto o qué?', 'Vale, tú calla y escucha'];
const bo = [
  'Le ruego que me escuche con atención, señora, porque usted no comprende la gravedad del asunto',
  'Usted sabe perfectamente que la prudencia nunca ha sido una debilidad en esta casa',
  'Permítame recordarle que usted firmó aquel documento con plena conciencia de sus consecuencias',
  'Considero imprescindible que usted reflexione antes de tomar cualquier decisión irreversible',
  'Le aseguro que usted encontrará en mí a un servidor leal, aunque discrepe de su criterio',
  'Usted debería descansar, la jornada de mañana exigirá de nosotros una paciencia considerable',
];
const paragraphs = [
  'La capitana subió al puente.',
  `—${ana[0]} —dijo Ana—. No hay tiempo.`,
  `—${bo[0]} —respondió Bonifacio.`,
  `—${ana[1]}.`,
  `—${bo[1]}.`,
  `—${ana[2]}.`,
  'Bo suspiró y miró al mar.',
  `—${bo[2]}.`,
  `—${ana[3]} —contestó la capitana.`,
  `—${bo[3]} —insistió Bo.`,
  `—${ana[4]} —dijo Ana.`,
  `—${bo[4]} —dijo Bo.`,
  `—${ana[5]} —dijo Ana.`,
  `—${bo[5]} —dijo Bo.`,
  // Ana speaking like Bo: an outlier closer to him.
  '—Le ruego que me escuche con atención, porque usted no comprende la gravedad del asunto —dijo Ana.',
];

export function runVoiceLogicTests(): string[] {
  const passed: string[] = [];

  assert.deepEqual(splitParagraph('—Hola —dijo Ana—. ¿Vienes?'), { speech: ['Hola', '¿Vienes?'], narration: 'dijo Ana' });
  assert.deepEqual(splitParagraph('“Come here,” said Bo, “now.”'), { speech: ['Come here,', 'now.'], narration: 'said Bo,' });
  assert.equal(splitParagraph('Nadie habló.'), null);
  passed.push('dash and quote dialogue split into speech and asides');

  const lines = extractDialogue([{ writingId: 'w1', chapter: 1, title: 'Uno', text: paragraphs.join('\n') }], characters, [{ id: 'b1', sceneId: 's1', characterId: 'bo', text: 'Usted manda, señora.' }]);
  const byParagraph = Object.fromEntries(lines.filter((l) => l.writingId).map((l) => [l.paragraph, `${l.speakerId}:${l.attribution}`]));
  assert.equal(byParagraph[1], 'ana:tag');
  assert.equal(byParagraph[2], 'bo:tag');
  assert.equal(byParagraph[3], 'ana:turn');
  assert.equal(byParagraph[7], 'bo:beat');
  assert.equal(byParagraph[8], 'ana:tag', 'alias in the aside');
  assert.equal(lines.find((l) => l.id === 'scene:b1')?.attribution, 'scene');
  assert.equal(lines.find((l) => l.paragraph === 1)?.quote, ana[0]);
  passed.push('lines are attributed by tag, alias, beat, turn order and Dialog Scene blocks');

  const profiles = buildProfiles(lines);
  const pa = profiles.find((p) => p.characterId === 'ana')!, pb = profiles.find((p) => p.characterId === 'bo')!;
  assert.equal(pa.addressForm, 'tu');
  assert.equal(pb.addressForm, 'usted');
  assert.ok(pb.sentenceMean > pa.sentenceMean);
  assert.ok(pa.distinctive.some((d) => d.word === 'vale'));
  assert.ok(pa.catchphrases.some((c) => c.phrase === 'vale'));
  assert.equal(pb.register, 'formal');
  passed.push('profiles carry sentence length, address, register, own vocabulary and catchphrases');

  const outliers = findOutliers(lines, profiles);
  const odd = outliers.find((o) => o.lineId === 'w1:14');
  assert.ok(odd, 'the line Ana says like Bo is flagged');
  assert.ok(odd!.reason === 'closer-to' ? odd!.otherId === 'bo' : odd!.reason === 'address' || odd!.reason === 'length');
  assert.ok(!outliers.some((o) => o.lineId === 'w1:1'));
  assert.deepEqual(findOutliers(lines, profiles), outliers, 'deterministic');
  passed.push('lines that sound like another character or use the other address are flagged');

  const sample = blindSample(lines, profiles, 6, 42);
  assert.equal(sample.length, 6);
  assert.deepEqual(blindSample(lines, profiles, 6, 42), sample, 'same seed, same test');
  assert.equal(new Set(sample.map((s) => s.answerId)).size, 2);
  const guesses = Object.fromEntries(sample.map((s) => [s.lineId, 'ana']));
  const result = scoreBlind(sample, guesses);
  assert.equal(result.total, 6);
  assert.equal(result.correct, sample.filter((s) => s.answerId === 'ana').length);
  assert.deepEqual(result.confusions.map((c) => `${c.actualId}>${c.guessedId}`), ['bo>ana']);
  passed.push('the blind test is seeded, mixes speakers and reports who is confused with whom');
  return passed;
}
