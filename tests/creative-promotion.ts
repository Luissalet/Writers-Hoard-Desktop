import { db } from '@/db';
import { promoteDevelopmentDraft } from '@/services/creativePromotion';
import type { Project } from '@/types';
import type { Note } from '@/engines/notes/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const PROJECT_ID = 'critical-creative-promotion';
const FOREIGN_PROJECT_ID = 'critical-creative-promotion-foreign';

async function clearFixtures(): Promise<void> {
  const ids = [PROJECT_ID, FOREIGN_PROJECT_ID];
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      if ('projectId' in table.schema.idxByName) {
        await table.where('projectId').anyOf(ids).delete();
      }
    }
    await db.projects.bulkDelete(ids);
  });
}

function project(id: string): Project {
  const now = Date.now();
  return {
    id,
    title: id,
    mode: 'novelist',
    type: 'standalone',
    color: '#c4973b',
    description: '',
    status: 'draft',
    enabledEngines: [],
    engineOrder: [],
    createdAt: now,
    updatedAt: now,
  };
}

function sourceNote(projectId: string, id: string): Note {
  const now = Date.now();
  return {
    id,
    projectId,
    kind: 'idea',
    text: 'An original spark',
    tags: [],
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
}

export async function testCreativePromotion(): Promise<string> {
  if (!db.isOpen()) await db.open();
  await clearFixtures();
  await db.projects.bulkAdd([project(PROJECT_ID), project(FOREIGN_PROJECT_ID)]);
  await db.notes.bulkAdd([
    sourceNote(PROJECT_ID, 'creative-source-note'),
    sourceNote(FOREIGN_PROJECT_ID, 'creative-foreign-note'),
  ]);

  const source = {
    engineId: 'notes',
    entityType: 'note',
    entityId: 'creative-source-note',
    title: 'An original spark',
  };
  const targets = ['note', 'board', 'codex', 'seed', 'outline', 'timeline', 'scene'] as const;

  try {
    for (const target of targets) {
      const result = await promoteDevelopmentDraft({
        projectId: PROJECT_ID,
        target,
        title: `Promoted ${target}`,
        text: `A grounded ${target} possibility`,
        sources: [source],
        origin: 'ideas-table',
        provenance: { sourceId: source.entityId, move: 'combine' },
      }, {
        boardTitle: 'Mesa de ideas',
        outlineTitle: 'Estructura de desarrollo',
        timelineTitle: 'Cronología de desarrollo',
      });

      assert(result.entityId && result.engineId && result.entityType, `${target} promotion returned no identity`);
      const links = await db.entityLinks
        .where('projectId').equals(PROJECT_ID)
        .filter((link) => link.targetEntityId === result.entityId)
        .toArray();
      assert(links.length === 1, `${target} promotion did not persist exactly one provenance edge`);
      assert(links[0].sourceEntityId === source.entityId, `${target} promotion lost its source`);
      assert(links[0].relation === 'developed-into', `${target} promotion used the wrong relation`);
      assert(links[0].notes?.includes('ideas-table'), `${target} promotion lost its generation trace`);
    }

    assert(await db.boards.where('projectId').equals(PROJECT_ID).count() === 1, 'board promotion made duplicate lab containers');
    assert(await db.outlines.where('projectId').equals(PROJECT_ID).count() === 1, 'outline promotion made duplicate containers');
    assert(await db.timelines.where('projectId').equals(PROJECT_ID).count() === 1, 'timeline promotion made duplicate containers');

    const beforeNotes = await db.notes.where('projectId').equals(PROJECT_ID).count();
    let rejected = false;
    try {
      await promoteDevelopmentDraft({
        projectId: PROJECT_ID,
        target: 'note',
        title: 'Must not exist',
        text: 'Foreign provenance',
        sources: [{ ...source, entityId: 'creative-foreign-note' }],
        origin: 'ideas-table',
        provenance: {},
      });
    } catch {
      rejected = true;
    }
    assert(rejected, 'promotion accepted a source from another project');
    assert(
      await db.notes.where('projectId').equals(PROJECT_ID).count() === beforeNotes,
      'rejected promotion left a partial target behind',
    );

    return 'Creative promotion: seven canonical targets are atomic, scoped and traceable';
  } finally {
    await clearFixtures();
  }
}
