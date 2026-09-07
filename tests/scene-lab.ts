import {
  SCENE_VARIABLES,
  buildSceneVariantBranchPlan,
  buildSceneVariantPromotionPreview,
  createSceneVariant,
  sceneSourceFingerprint,
  toggleSceneComparison,
  updateSceneVariant,
  type SceneLabSource,
  type SceneLabStructuralTarget,
} from '../src/services/sceneLab';
import { getSceneLabCopy } from '../src/components/project/creative-lab/sceneLabCopy';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

function assertThrows(run: () => void, expected: string): void {
  try {
    run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes(expected), `unexpected error: ${message}`);
    return;
  }
  throw new Error(`expected an error containing "${expected}"`);
}

export const SCENE_LAB_SOURCE: SceneLabSource = {
  id: 'scene-source',
  projectId: 'scene-project',
  title: 'The locked platform',
  text: 'Mara waits beside the sealed train.\nThe lights go out.',
  intention: 'Force Mara to choose between the witness and the evidence.',
  tension: 6,
  voice: 'Close third; clipped, watchful sentences.',
  revision: 41,
};

export const SCENE_LAB_TARGET: SceneLabStructuralTarget = {
  kind: 'outline-beat',
  entityId: 'beat-source',
  projectId: 'scene-project',
  title: 'Mara reaches the platform',
  description: 'Mara finds the witness waiting beside the train.',
  revision: 51,
};

export function runSceneLabCoreTests(): string[] {
  const english = getSceneLabCopy('en');
  const spanish = getSceneLabCopy('es');
  assert(SCENE_VARIABLES.every((variable) => english.variables[variable].label.trim()), 'an English variable label is missing');
  assert(SCENE_VARIABLES.every((variable) => spanish.variables[variable].label.trim()), 'a Spanish variable label is missing');
  assert(english.header.title !== spanish.header.title, 'the language boundary ignored the selected locale');

  const sourceBefore = JSON.stringify(SCENE_LAB_SOURCE);
  const variants = SCENE_VARIABLES.map((variable, index) => createSceneVariant({
    id: `variant-${variable}`,
    source: SCENE_LAB_SOURCE,
    variable,
    value: `declared change ${index}`,
    createdAt: 100 + index,
  }));
  assertEqual(variants.length, 8, 'not every declared scene variable can create a take');
  assertEqual(new Set(variants.map((variant) => variant.variable.kind)).size, 8, 'scene variables collapsed together');
  assertEqual(JSON.stringify(SCENE_LAB_SOURCE), sourceBefore, 'creating variants mutated the canonical source projection');
  assert(variants.every((variant) => variant.text === SCENE_LAB_SOURCE.text), 'a local take did not start from the exact source text');
  assert(variants.every((variant) => variant.provenance.source.baselineHash === sceneSourceFingerprint(SCENE_LAB_SOURCE)), 'source identity is not reproducible');

  const edited = updateSceneVariant(variants[0], {
    intention: 'Make the cost visible before Mara chooses.',
    tension: 14,
    voice: 'First person, evasive.',
    text: 'Alternate prose that must remain local.',
  }, 500);
  assertEqual(edited.tension, 10, 'tension was not normalized to the declared scale');
  assertEqual(variants[0].tension, 6, 'editing a take mutated the previous value');
  assertEqual(edited.updatedAt, 500, 'editing did not advance the session revision');

  let comparison = toggleSceneComparison([], variants[0].id);
  comparison = toggleSceneComparison(comparison, variants[1].id);
  comparison = toggleSceneComparison(comparison, variants[2].id);
  assertEqual(comparison.join(','), `${variants[1].id},${variants[2].id}`, 'comparison did not keep the two newest takes');
  assertEqual(toggleSceneComparison(comparison, variants[1].id).join(','), variants[2].id, 'comparison cannot deselect a take');

  const preview = buildSceneVariantPromotionPreview({
    variant: edited,
    target: SCENE_LAB_TARGET,
    title: 'Mara chooses during the blackout',
    description: 'The blackout forces Mara to abandon either the witness or the evidence.',
  });
  assert(preview.canPromote, 'a real structural delta was rejected');
  assertEqual(preview.changedFields.join(','), 'title,description', 'preview did not name its exact structural changes');
  assert(!JSON.stringify(preview).includes(edited.text), 'scene prose leaked into the structural branch preview');
  assertEqual(preview.provenance.declaredVariable.kind, edited.variable.kind, 'preview lost the declared experiment');
  assertEqual(preview.provenance.source.sceneId, SCENE_LAB_SOURCE.id, 'preview lost the source scene');

  const plan = buildSceneVariantBranchPlan(preview);
  assertEqual(plan.branch.rootKind, 'outline-beat', 'branch plan targeted the wrong kernel entity');
  assertEqual(plan.branch.rootId, SCENE_LAB_TARGET.entityId, 'branch plan lost the canonical anchor');
  assertEqual(plan.delta.changes.description, preview.after.description, 'branch plan rewrote the reviewed delta');
  assert(!JSON.stringify(plan.delta).includes(edited.text), 'branch plan forced prose into a structural type');

  const noChange = buildSceneVariantPromotionPreview({
    variant: edited,
    target: SCENE_LAB_TARGET,
    title: SCENE_LAB_TARGET.title,
    description: SCENE_LAB_TARGET.description,
  });
  assert(!noChange.canPromote && noChange.changedFields.length === 0, 'an unchanged target became a promotable branch');
  assertThrows(() => buildSceneVariantBranchPlan(noChange), 'no structural change');
  assertThrows(() => buildSceneVariantPromotionPreview({
    variant: edited,
    target: { ...SCENE_LAB_TARGET, projectId: 'other-project' },
    title: 'Cross-project target',
    description: 'Must fail',
  }), 'one project');
  assertThrows(() => createSceneVariant({
    id: 'blank-variable', source: SCENE_LAB_SOURCE, variable: 'tone', value: ' ', createdAt: 1,
  }), 'Declare');

  return [
    'all eight scene variables create immutable, reproducible local takes',
    'comparison and editing remain bounded session operations',
    'promotion previews carry provenance and only structural branch deltas',
  ];
}
