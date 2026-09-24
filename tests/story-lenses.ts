import {
  buildStoryLensesReadModel,
  storyLensEntityKey,
  traceIdeaArchaeology,
  type StoryLensEntity,
} from '@/services/storyLenses';
import type { WritingSnapshot } from '@/engines/writings/snapshotTypes';
import type { EntityLink } from '@/types/projectTools';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const PROJECT_ID = 'critical-story-lenses';

export function testStoryLenses(): string {
  const entities: StoryLensEntity[] = [
    {
      projectId: PROJECT_ID,
      engineId: 'notes',
      entityType: 'note',
      entityId: 'spark',
      title: 'Mirror spark',
      tags: ['Mirror'],
      createdAt: 1,
      updatedAt: 1,
    },
    {
      projectId: PROJECT_ID,
      engineId: 'board',
      entityType: 'board-node',
      entityId: 'developed',
      title: 'Broken mirror',
      tags: ['mirror', 'guilt'],
      createdAt: 2,
      updatedAt: 2,
    },
    ...[
      { id: 'chapter-1', title: 'Arrival', tags: ['mirror'], order: 0 },
      { id: 'chapter-2', title: 'Silence', tags: [], order: 1 },
      { id: 'chapter-3', title: 'Recognition', tags: ['MIRROR'], order: 2 },
    ].map(({ id, title, tags, order }): StoryLensEntity => ({
      projectId: PROJECT_ID,
      engineId: 'writings',
      entityType: 'writing',
      entityId: id,
      title,
      tags,
      createdAt: order + 10,
      updatedAt: order + 10,
      sequence: { scopeId: 'manuscript', scopeTitle: 'Manuscript', order },
    })),
    {
      projectId: 'foreign-project',
      engineId: 'notes',
      entityType: 'note',
      entityId: 'foreign',
      title: 'Foreign mirror',
      tags: ['mirror'],
    },
  ];
  const links: EntityLink[] = [
    {
      id: 'promotion-link',
      projectId: PROJECT_ID,
      sourceEngineId: 'notes',
      sourceEntityType: 'note',
      sourceEntityId: 'spark',
      sourceTitle: 'Mirror spark',
      targetEngineId: 'board',
      targetEntityType: 'board-node',
      targetEntityId: 'developed',
      targetTitle: 'Broken mirror',
      relation: 'developed-into',
      provenance: 'manual',
      createdAt: 3,
      updatedAt: 3,
    },
    {
      id: 'surviving-link',
      projectId: PROJECT_ID,
      sourceEngineId: 'board',
      sourceEntityType: 'board-node',
      sourceEntityId: 'developed',
      sourceTitle: 'Broken mirror',
      targetEngineId: 'outline',
      targetEntityType: 'outline-beat',
      targetEntityId: 'missing-beat',
      targetTitle: 'A form that no longer survives',
      relation: 'developed-into',
      provenance: 'manual',
      createdAt: 4,
      updatedAt: 4,
    },
  ];
  const snapshots: WritingSnapshot[] = [{
    id: 'revision-1',
    writingId: 'chapter-3',
    projectId: PROJECT_ID,
    title: 'Recognition',
    content: '<p>The mirror returns.</p>',
    wordCount: 4,
    reason: 'manual',
    createdAt: 20,
  }];

  const input = {
    projectId: PROJECT_ID,
    entities,
    entityLinks: links,
    writingSnapshots: snapshots,
  };
  const model = buildStoryLensesReadModel(input);
  const mirror = model.constellation.motifs.find((motif) => motif.id === 'mirror');
  assert(mirror?.appearances.length === 4, 'explicit motif appearances were not normalised and scoped');
  assert(mirror.relatedMotifIds.includes('guilt'), 'co-occurring motifs were not connected');
  assert(
    model.constellation.gaps.some((gap) => gap.motifId === 'mirror' && gap.missingEntityKeys.length === 1),
    'ordered motif disappearance was not surfaced',
  );

  const developedKey = storyLensEntityKey({ engineId: 'board', entityId: 'developed' });
  const trail = traceIdeaArchaeology(model.archaeology, developedKey);
  assert(trail?.ancestors.some(({ node }) => node.entityId === 'spark'), 'creative origin was not traceable');
  assert(trail?.revisions.length === 0, 'an unrelated writing revision leaked into the selected trail');
  assert(
    model.archaeology.nodes.some((node) => node.entityId === 'missing-beat' && node.availability === 'reference-only'),
    'a surviving link was presented as recoverable content',
  );

  const reversed = buildStoryLensesReadModel({
    ...input,
    entities: [...entities].reverse(),
    entityLinks: [...links].reverse(),
  });
  assert(JSON.stringify(model) === JSON.stringify(reversed), 'story lenses depend on input iteration order');
  return 'Story lenses: motifs and idea trails stay explicit, scoped and deterministic';
}

/**
 * The same test for the focused runner, which awaits what it calls:
 *   electron scripts/run-focused-browser-tests.cjs tests/story-lenses.ts runStoryLensesTests
 */
export async function runStoryLensesTests(): Promise<string[]> {
  return [testStoryLenses()];
}
