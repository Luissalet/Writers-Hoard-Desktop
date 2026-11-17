// Pure checks for the voice profile: dialogue extraction and attribution, profiles, outliers, blind test.
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { htmlToText } from '@/engines/_shared/anchoring/htmlToText';
import { extractDialogue, readVoiceGender, splitParagraph } from '@/engines/writings/voice/dialogue';
import { findDialogueRange } from '@/engines/writings/voice/navigation';
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

  const analyze = (text: string, cast: Parameters<typeof extractDialogue>[1] = characters) =>
    extractDialogue([{ writingId: 'regression', chapter: 1, title: 'Uno', text }], cast);
  for (const paragraph of [
    '—Cierra las ventanas —Bonifacio se volvió; dijo Ana—. Ahora mismo.',
    '-Cierra las ventanas -Bonifacio se volvió; dijo Ana-. Ahora mismo.',
    '—Cierra las ventanas —Bonifacio se volvió; Ana dijo—. Ahora mismo.',
  ]) {
    const [line] = analyze(paragraph);
    assert.equal(line.speakerId, 'ana');
    assert.equal(line.attribution, 'tag');
    assert.equal(line.text, 'Cierra las ventanas Ahora mismo.');
  }
  assert.equal(analyze('“Close the windows,” said Ana while Bonifacio turned.')[0].speakerId, 'ana');
  assert.equal(analyze('—Cierra —dijo alguien a Ana.')[0].speakerId, null);
  passed.push('compound asides identify the subject of the speech verb');

  const cast = [
    { ...characters[0], gender: readVoiceGender({ Género: 'Femenino' }) },
    { ...characters[1], gender: readVoiceGender({ gender: 'Male' }) },
  ];
  const exchange = '—Abre las puertas —dijo Ana.\n—Claro —respondió Bonifacio.\n';
  assert.deepEqual(analyze(exchange + '—Ahora cierra las ventanas —dijo ella a Bonifacio.', cast).map(({ speakerId, attribution }) =>
    [speakerId, attribution]), [['ana', 'tag'], ['bo', 'tag'], ['ana', 'pronoun']]);
  assert.equal(analyze(exchange + '—Ahora las cierro —dijo él.', cast)[2].speakerId, 'bo');
  assert.equal(analyze(exchange + '—Ahora cierra —dijo ella.', characters)[2].speakerId, null);
  assert.equal(analyze(exchange + '—Ahora cierra —dijo ella.', [cast[0], { ...cast[1], gender: cast[0].gender }])[2].speakerId, null);
  assert.equal(readVoiceGender({ gender: 'Female', Género: 'Masculino' }), undefined);
  passed.push('explicit character gender resolves pronouns only in an unambiguous exchange');

  const html = '<p>—Cierra las ventanas —respondió Bonifacio.</p><p></p><p>Antes de salir:<br>—Cierra <strong>las ventanas</strong> —dijo Ana.</p>';
  const [bonifacioLine, anaLine] = analyze(htmlToText(html));
  assert.equal(bonifacioLine.quote, anaLine.quote);
  assert.equal(anaLine.speakerId, 'ana');
  const schema = new Schema({
    nodes: {
      doc: { content: 'paragraph+' },
      paragraph: { content: 'inline*' },
      text: { group: 'inline' },
      hardBreak: { inline: true, group: 'inline' },
    },
    marks: { bold: {} },
  });
  const paragraph = (...nodes: ReturnType<Schema['text']>[]) => schema.node('paragraph', null, nodes);
  const doc = schema.node('doc', null, [
    paragraph(schema.text('—Cierra las ventanas —respondió Bonifacio.')),
    paragraph(),
    paragraph(schema.text('Antes de salir:'), schema.node('hardBreak'), schema.text('—Cierra '),
      schema.text('las ventanas', [schema.mark('bold')]), schema.text(' —dijo Ana.')),
  ]);
  const anaRange = findDialogueRange(doc, anaLine.anchor!);
  const bonifacioRange = findDialogueRange(doc, bonifacioLine.anchor!);
  assert.ok(anaRange && bonifacioRange);
  assert.equal(doc.textBetween(anaRange.from, anaRange.to), anaLine.quote);
  assert.ok(anaRange.from > bonifacioRange.to);
  assert.match(doc.resolve(anaRange.to).parent.textContent, /dijo Ana/);
  assert.equal(findDialogueRange(doc, { ...anaLine.anchor!, column: 0 }), null);
  passed.push('dialogue positions select the second identical quote through editor format and line breaks');

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
