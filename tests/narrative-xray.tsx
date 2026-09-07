import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NarrativeXray, narrativeXrayCopy } from '../src/components/narrative-xray';
import type { Annotation } from '../src/engines/annotations/types';
import type { DialogBlock, Scene } from '../src/engines/dialog-scene/types';
import type { OutlineBeat } from '../src/engines/outline/types';
import type { WritingSession } from '../src/engines/writing-stats/types';
import { buildNarrativeXray, measureNarrativeText } from '../src/services/narrativeXray';
import type { EntityLink } from '../src/types/projectTools';
import type { Tag, Writing } from '../src/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

function jsonEqual(actual: unknown, expected: unknown, message: string): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message}: expected ${right}, got ${left}`);
}

const PROJECT = 'xray-project';
const OTHER = 'other-project';

function writing(id: string, title: string, content: string, chapter: number, tags: string[] = []): Writing {
  return {
    id, projectId: PROJECT, title, content, chapter, tags, status: 'draft',
    wordCount: measureNarrativeText(content).words, createdAt: chapter, updatedAt: chapter,
  };
}

const WRITING_A = writing('chapter-a', 'First', '<p>I run. You wait?</p><p>I run!</p>', 1, ['Debt', 'night']);
const WRITING_B = writing('chapter-b', 'Second', '<p>She waits for the bell. The bell waits.</p>', 2, ['debt']);
const FOREIGN_WRITING = { ...WRITING_A, id: 'foreign-writing', projectId: OTHER, title: 'LEAK' };

const SCENE: Scene = {
  id: 'scene-a', projectId: PROJECT, title: 'Platform', description: 'The platform empties.', order: 2,
  tags: ['Night'], createdAt: 10, updatedAt: 10,
};

const BLOCKS: DialogBlock[] = [
  {
    id: 'line-a', sceneId: SCENE.id, projectId: PROJECT, type: 'dialog', characterId: 'mara',
    characterName: 'Mara', characterColor: '#fff', content: 'Wait for the bell!', order: 1, createdAt: 1, updatedAt: 1,
  },
  {
    id: 'line-b', sceneId: SCENE.id, projectId: PROJECT, type: 'dialog', characterId: 'mara',
    characterName: 'Mara', characterColor: '#fff', content: 'The bell is mine?', order: 2, createdAt: 2, updatedAt: 2,
  },
  {
    id: 'action-a', sceneId: SCENE.id, projectId: PROJECT, type: 'action', characterName: '',
    characterColor: '#fff', content: 'She closes the gate.', order: 3, createdAt: 3, updatedAt: 3,
  },
];

const BEAT: OutlineBeat = {
  id: 'beat-a', outlineId: 'outline-a', projectId: PROJECT, order: 1, level: 'beat', title: 'The gate closes',
  description: 'Mara chooses the platform.', status: 'outlined', wordTarget: 800, createdAt: 1, updatedAt: 1,
};

const SESSIONS: WritingSession[] = [
  { id: 'session-a', projectId: PROJECT, date: '2026-09-06', wordCount: 300, duration: 1200, type: 'sprint', createdAt: 1 },
  { id: 'session-b', projectId: PROJECT, date: '2026-09-06', wordCount: -20, duration: 600, type: 'edit', notes: 'Cut opening.', createdAt: 2 },
];

const ANNOTATION: Annotation = {
  id: 'annotation-a', projectId: PROJECT, sourceEngineId: 'writings', sourceEntityId: WRITING_A.id,
  anchor: { type: 'text_range', start: 0, end: 1, selectedText: 'I' }, noteType: 'text', noteBody: 'Check this.',
  isOrphaned: false, position: 0, createdAt: 1, updatedAt: 1,
};

const TAGS: Tag[] = [
  { id: 'tag-debt', name: 'Debt', color: '#c4973b' },
  { id: 'tag-night', name: 'Night', color: '#7c5cbf' },
];

const LINK: EntityLink = {
  id: 'link-a', projectId: PROJECT,
  sourceEngineId: 'writings', sourceEntityType: 'writing', sourceEntityId: WRITING_A.id, sourceTitle: 'Stale first',
  targetEngineId: 'outline', targetEntityType: 'outline-beat', targetEntityId: BEAT.id, targetTitle: 'Stale beat',
  relation: 'foreshadows', notes: 'Declared by the writer.', provenance: 'manual', createdAt: 1, updatedAt: 1,
};

function model() {
  return buildNarrativeXray({
    projectId: PROJECT,
    locale: 'es',
    writings: [WRITING_B, FOREIGN_WRITING, WRITING_A],
    outlineBeats: [BEAT, { ...BEAT, id: 'foreign-beat', projectId: OTHER }],
    scenes: [SCENE, { ...SCENE, id: 'foreign-scene', projectId: OTHER }],
    dialogBlocks: [...BLOCKS, { ...BLOCKS[0], id: 'foreign-line', projectId: OTHER }],
    writingSessions: [...SESSIONS, { ...SESSIONS[0], id: 'foreign-session', projectId: OTHER }],
    annotations: [ANNOTATION, { ...ANNOTATION, id: 'foreign-note', projectId: OTHER }],
    tags: TAGS,
    entityLinks: [LINK, { ...LINK, id: 'foreign-link', projectId: OTHER }],
  });
}

function testTextMeasuresAndVoice(): void {
  const result = model();
  equal(result.coverage.writings, 2, 'foreign writing entered coverage');
  equal(result.voice.prose[0].title, 'First', 'chapters were not ordered');
  const first = result.voice.prose[0];
  jsonEqual(
    {
      words: first.measure.words,
      sentences: first.measure.sentences,
      paragraphs: first.measure.paragraphs,
      questions: first.measure.questions,
      exclamations: first.measure.exclamations,
      short: first.measure.shortSentences,
    },
    { words: 6, sentences: 3, paragraphs: 2, questions: 1, exclamations: 1, short: 3 },
    'surface text measures changed',
  );
  equal(first.referenceMarkers.firstPerson, 333.3, 'first-person marker density is wrong');
  equal(first.referenceMarkers.secondPerson, 166.7, 'second-person marker density is wrong');
  equal(result.voice.characters[0].characterName, 'Mara', 'explicit character dialogue was not grouped');
  equal(result.voice.characters[0].lineCount, 2, 'action prose entered character voice');
  const bell = result.voice.characters[0].recurringTerms.find((term) => term.term === 'bell');
  assert(bell, 'repeated dialogue term disappeared');
  assert(bell.evidence.every((item) => item.entityType === 'dialog-block'), 'dialog term points to a synthetic entity');
}

function testRhythmAndEnergyRemainDescriptive(): void {
  const result = model();
  const writingUnit = result.rhythm.narrative.find((unit) => unit.id === 'writing:chapter-a');
  equal(writingUnit?.annotationCount, 1, 'annotation density did not follow its canonical writing');
  const sceneUnit = result.rhythm.narrative.find((unit) => unit.id === 'scene:scene-a');
  equal(sceneUnit?.explicitDialogBlocks, 2, 'dialog blocks were not counted');
  equal(sceneUnit?.explicitActionBlocks, 1, 'action blocks were not counted');
  equal(result.rhythm.creation[0].words, 280, 'same-day session words were not aggregated exactly');
  equal(result.rhythm.creation[0].durationSeconds, 1800, 'same-day duration was not aggregated exactly');
  const serialized = JSON.stringify(result.energy);
  assert(!/score|quality|good|bad/i.test(serialized), 'energy smuggled in an evaluative score');
  assert(result.energy.every((unit) => unit.evidence.length > 0), 'an energy row has no navigable evidence');
}

function testThreadsAreOnlyExplicit(): void {
  const result = model();
  jsonEqual(result.threads.map((thread) => thread.id), ['tag:debt', 'tag:night', 'entity-link:foreshadows'], 'threads were inferred or ordered unstably');
  const debt = result.threads[0];
  equal(debt.entityKeys.length, 2, 'case-equivalent tags did not merge');
  equal(debt.color, '#c4973b', 'tag catalog metadata was lost');
  const relation = result.threads.at(-1)!;
  assert(relation.evidence.some((item) => item.title === 'First'), 'fresh canonical title did not replace stale link metadata');
  assert(!JSON.stringify(result).includes('LEAK'), 'foreign project data leaked into the read model');
}

function testDeterminismAndAccessibleCopyBoundary(): void {
  jsonEqual(model(), model(), 'the same rows produced a different X-ray');
  const result = model();
  const es = renderToStaticMarkup(
    <NarrativeXray model={result} copy={narrativeXrayCopy('es')} initialView="threads" onOpenEvidence={() => undefined} />,
  );
  assert(es.includes('role="tablist"'), 'view navigation is not exposed as tabs');
  assert(es.includes('role="tabpanel"'), 'active view is not exposed as a tab panel');
  assert(es.includes('Radiografía narrativa'), 'Spanish default copy did not render');
  assert(es.includes('Abrir evidencia'), 'evidence controls have no localized accessible name');
  const en = renderToStaticMarkup(
    <NarrativeXray model={result} locale="en" initialView="energy" onOpenEvidence={() => undefined} />,
  );
  assert(en.includes('Narrative X-ray'), 'English locale boundary did not render');
  assert(en.includes('does not score quality'), 'the non-evaluative contract is not visible');
}

export function runNarrativeXrayTests(): string[] {
  testTextMeasuresAndVoice();
  testRhythmAndEnergyRemainDescriptive();
  testThreadsAreOnlyExplicit();
  testDeterminismAndAccessibleCopyBoundary();
  return [
    'voice metrics are exact and dialogue evidence stays navigable',
    'rhythm and energy remain descriptive without a quality score',
    'threads come only from explicit tags and entity links',
    'the read model is deterministic and the UI has an ES/EN accessible boundary',
  ];
}
