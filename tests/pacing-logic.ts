// Pure checks for the pacing x-ray: scene split, word shares, pace, flags.
import assert from 'node:assert/strict';
import { buildPacing, measure, paceOf, splitScenes } from '@/engines/writings/pacing/pacing';

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
  return passed;
}
