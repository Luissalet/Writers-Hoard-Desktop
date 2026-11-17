// Pure checks for the pacing x-ray: scene split, word shares, pace, flags.
import assert from 'node:assert/strict';
import { buildPacing, curveValue, measure, paceOf, sceneAnchor, splitScenes } from '@/engines/writings/pacing/pacing';

const repeat = (s: string, n: number) => Array.from({ length: n }, () => s).join('\n');
const still = 'La casa era vieja y las paredes estaban cubiertas de musgo que brillaba bajo la luna.';
const fight = 'Ana corrió, saltó la valla, golpeó al guardia y huyó.';
const talk = '—No pienso volver —dijo Ana—. Nunca.';

export function runPacingLogicTests(): string[] {
  const passed: string[] = [];

  assert.deepEqual(splitScenes('Uno.\n***\nDos.\n* * *\n\nTres.\n#\nCuatro.').map((s) => s.length), [1, 1, 1, 1]);
  assert.deepEqual(splitScenes('***\nUno.\nDos.'), [['Uno.', 'Dos.']]);
  passed.push('chapters split into scenes at scene-break lines');

  const d = measure([still]);
  assert.ok(d.description > 0.9 && d.dialogue === 0);
  const a = measure([fight]);
  assert.ok(a.action > 20 && a.narration > 0.9);
  const t = measure([talk]);
  assert.ok(t.dialogue > 0.6);
  assert.ok(paceOf(a) > paceOf(d) && paceOf(t) > paceOf(d));
  passed.push('description, action and dialogue are told apart and move the pace');

  const report = buildPacing([
    { writingId: 'w1', chapter: 1, title: 'Uno', text: [repeat(still, 12), '***', repeat('—No pienso volver nunca, de verdad.', 30), '***', repeat(fight, 3)].join('\n') },
    { writingId: 'w2', chapter: 2, title: 'Dos', text: [repeat(fight, 3), '***', repeat(fight, 3), '***', repeat(fight, 3), '***', repeat(fight, 3)].join('\n') },
  ]);
  assert.equal(report.scenes.length, 7);
  assert.ok(report.scenes.every((s, i, all) => i === 0 || s.at > all[i - 1].at));
  assert.equal(report.chapters.length, 2);
  const kinds = report.flags.map((f) => f.kind);
  assert.ok(kinds.includes('description-heavy'));
  assert.ok(kinds.includes('dialogue-only'));
  const flat = report.flags.find((f) => f.kind === 'flat');
  assert.ok(flat && flat.sceneIds.length >= 4 && flat.sceneIds.includes('w2#0'));
  assert.equal(report.scenes[0].quote.startsWith('La casa era vieja'), true);
  assert.deepEqual(buildPacing([{ writingId: 'w1', chapter: 1, title: 'Uno', text: repeat(fight, 3) }]).flags, []);
  passed.push('the report places scenes on the manuscript axis and flags flat and lopsided stretches');

  const reviewSource = {
    writingId: 'review', chapter: 1, title: 'La muralla',
    text: [
      'La vieja muralla de piedra gris cubría por entero aquel largo camino hasta el mar.',
      'La silenciosa muralla de piedra cubría todo el camino gris.',
      'La ladera silenciosa tenía una sombra gris.',
      'La sala oscura tenía cortinas de lana.',
      'El patio silencioso tenía un arco bajo.',
    ].join('\n***\n'),
  };
  const review = buildPacing([reviewSource]);
  assert.deepEqual(review.scenes.map(curveValue), [0.10, 0.13, 0.15, 0.15, 0.15]);
  assert.deepEqual(review.flags.filter((f) => f.kind === 'flat').map((f) => f.sceneIds), [['review#1', 'review#2', 'review#3', 'review#4']]);
  passed.push('a short initial run cannot hide the four nearly equal scenes that follow it');

  const manual = buildPacing([{ ...reviewSource, sceneTension: [
    { ...review.scenes[2].anchor, value: 0.8 },
    { ...review.scenes[4].anchor, value: 0 },
  ] }]);
  assert.deepEqual(manual.scenes.map(curveValue), [0.10, 0.13, 0.8, 0.15, 0]);
  assert.deepEqual(manual.scenes.map((s) => s.pace), review.scenes.map((s) => s.pace));
  assert.deepEqual(manual.chapters, review.chapters);
  assert.equal(manual.flags.some((f) => f.kind === 'flat'), false);
  passed.push('manual tension includes explicit zero and drives the curve without replacing measured pace');

  const reordered = buildPacing([{
    ...reviewSource,
    text: ['Escena nueva.', ...splitScenes(reviewSource.text).reverse().map((p) => p.join('\n'))].join('\n***\n'),
    sceneTension: [{ ...review.scenes[2].anchor, value: 0.8 }],
  }]);
  assert.deepEqual(reordered.scenes.map((s) => s.tension), [undefined, undefined, undefined, 0.8, undefined, undefined]);
  const edited = buildPacing([{
    ...reviewSource,
    text: 'Una escena añadida.\n***\nComienzo reescrito.\nFin de la escena.',
    sceneTension: [{ ...sceneAnchor(['Comienzo anterior.', 'Fin de la escena.'], 0), value: 0.8 }],
  }]);
  assert.deepEqual(edited.scenes.map((s) => s.tension), [undefined, 0.8]);
  passed.push('manual tension follows reordered scenes and survives rewriting one boundary');

  const overlap = buildPacing([{
    ...reviewSource,
    text: Array.from({ length: 7 }, () => still).join('\n***\n'),
    sceneTension: [0.10, 0.10, 0.10, 0.13, 0.14, 0.16, 0.16].map((value, index) => ({ ...sceneAnchor([still], index), value })),
  }]);
  assert.deepEqual(overlap.flags.map((f) => f.sceneIds), [
    ['review#0', 'review#1', 'review#2', 'review#3', 'review#4'],
    ['review#3', 'review#4', 'review#5', 'review#6'],
  ]);
  passed.push('flat stretches can overlap and include the full spread of 0.04');

  return passed;
}
