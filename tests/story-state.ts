import { db } from '@/db';
import type { CodexEntry } from '@/types';
import type { Outline, OutlineBeat } from '@/engines/outline/types';
import {
  createNarrativeMoment,
  createStoryClaim,
  deleteNarrativeMoment,
  storyStateAtMoment,
  stressWorldRule,
  type StoryBeliefClaim,
  type StoryFactClaim,
  type StoryWorldRuleClaim,
} from '@/services/storyState';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const PROJECT_ID = 'critical-story-state';

async function clearFixture(): Promise<void> {
  await db.transaction('rw', [db.storyClaims, db.narrativeMoments, db.outlineBeats, db.outlines, db.codexEntries], async () => {
    await db.storyClaims.where('projectId').equals(PROJECT_ID).delete();
    await db.narrativeMoments.where('projectId').equals(PROJECT_ID).delete();
    await db.outlineBeats.where('projectId').equals(PROJECT_ID).delete();
    await db.outlines.where('projectId').equals(PROJECT_ID).delete();
    await db.codexEntries.where('projectId').equals(PROJECT_ID).delete();
  });
}

export async function testStoryStateKernel(): Promise<string> {
  if (!db.isOpen()) await db.open();
  await clearFixture();
  const now = Date.now();
  const outline: Outline = {
    id: 'state-outline', projectId: PROJECT_ID, title: 'Axis', createdAt: now, updatedAt: now,
  };
  const beats: OutlineBeat[] = [0, 1].map((order) => ({
    id: `state-beat-${order}`,
    outlineId: outline.id,
    projectId: PROJECT_ID,
    order,
    level: 'beat',
    title: order ? 'After the crossing' : 'Before the crossing',
    description: '',
    storyPosition: order * 50,
    status: 'outlined',
    createdAt: now,
    updatedAt: now,
  }));
  const character: CodexEntry = {
    id: 'state-character', projectId: PROJECT_ID, type: 'character', title: 'Mara',
    fields: {}, content: '', tags: [], relations: [], createdAt: now, updatedAt: now,
  };
  await db.transaction('rw', [db.outlines, db.outlineBeats, db.codexEntries], async () => {
    await db.outlines.add(outline);
    await db.outlineBeats.bulkAdd(beats);
    await db.codexEntries.add(character);
  });

  try {
    const before = await createNarrativeMoment({
      projectId: PROJECT_ID, anchorKind: 'beat', anchorEntityId: beats[0].id,
    });
    const after = await createNarrativeMoment({
      projectId: PROJECT_ID, anchorKind: 'beat', anchorEntityId: beats[1].id,
    });
    const duplicate = await createNarrativeMoment({
      projectId: PROJECT_ID, anchorKind: 'beat', anchorEntityId: beats[0].id,
    });
    assert(duplicate.id === before.id, 'one canonical anchor created two story moments');

    const subject = {
      engineId: 'codex', entityType: 'character', entityId: character.id, title: character.title,
    };
    await createStoryClaim<StoryFactClaim>({
      projectId: PROJECT_ID, kind: 'fact', status: 'canonical', subject,
      factType: 'location', value: 'North bank', fromMomentId: before.id,
    });
    await createStoryClaim<StoryFactClaim>({
      projectId: PROJECT_ID, kind: 'fact', status: 'canonical', subject,
      factType: 'location', value: 'South bank', fromMomentId: after.id,
    });
    await createStoryClaim<StoryBeliefClaim>({
      projectId: PROJECT_ID, kind: 'belief', status: 'canonical', actor: subject,
      proposition: 'The bridge is trapped', mode: 'suspects', acquiredAtMomentId: after.id,
      confidence: 'medium',
    });
    const rule = await createStoryClaim<StoryWorldRuleClaim>({
      projectId: PROJECT_ID, kind: 'world-rule', status: 'canonical', title: 'Names bind doors',
      condition: 'The true name is spoken', effect: 'The door opens', cost: 'A memory is lost',
      limit: 'Only once per person', exceptions: [], evidence: [], fromMomentId: before.id,
    });

    const early = await storyStateAtMoment(PROJECT_ID, before.id);
    assert(early.facts.length === 1 && early.beliefs.length === 0, 'Story State used knowledge from the future');
    assert(early.rules.length === 1 && early.contradictions.length === 0, 'early state is not the exact active slice');
    const late = await storyStateAtMoment(PROJECT_ID, after.id);
    assert(late.beliefs.length === 1, 'knowledge did not become active at its explicit moment');
    assert(late.contradictions.length === 1, 'two simultaneous canonical locations were not reported');
    assert(late.contradictions[0].values.join('|') === 'North bank|South bank', 'contradiction lost its evidence values');

    const questions = stressWorldRule(rule, 'es');
    assert(questions.length === 5, 'the world-rule lab omitted a stress scenario');
    assert(questions.every((question) => question.groundedIn.length > 0), 'a rule stress question is ungrounded');

    let refusedInterval = false;
    try {
      await createStoryClaim<StoryFactClaim>({
        projectId: PROJECT_ID, kind: 'fact', status: 'hypothesis', subject,
        factType: 'injury', value: 'Sprained wrist', fromMomentId: after.id, untilMomentId: before.id,
      });
    } catch {
      refusedInterval = true;
    }
    assert(refusedInterval, 'a fact interval ending before it starts was stored');

    let refusedDelete = false;
    try {
      await deleteNarrativeMoment(before.id);
    } catch {
      refusedDelete = true;
    }
    assert(refusedDelete, 'deleting a referenced story moment orphaned claims');

    return 'Story State: explicit axis keeps facts, knowledge and world rules temporal and distinct';
  } finally {
    await clearFixture();
  }
}
