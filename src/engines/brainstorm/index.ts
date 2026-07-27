import { lazy } from 'react';

// ============================================
// Brainstorm Engine — Registration
// ============================================

import { Lightbulb } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerBackupStrategy, readBackupJson } from '@/engines/_shared';
import { db } from '@/db';
const BrainstormEngine = lazy(() => import('./components/BrainstormEngine'));

const brainstormEngine: EngineDefinition = {
  id: 'brainstorm',
  name: 'Brainstorm',
  description: 'Freeform canvas to mix ideas from every engine',
  icon: Lightbulb,
  category: 'creative',
  tables: {
    brainstormBoards: 'id, projectId',
    brainstormItems: 'id, boardId, projectId, type',
    brainstormConnections: 'id, boardId, sourceId, targetId',
  },
  component: BrainstormEngine,
};

registerEngine(brainstormEngine);

registerEntityResolver({
  engineId: 'brainstorm',
  entityTypes: ['brainstorm'],
  resolveEntity: async (entityId: string, entityType: string) => {
    const board = await db.brainstormBoards.get(entityId);
    if (!board) return null;
    return {
      id: board.id,
      type: entityType,
      engineId: 'brainstorm',
      projectId: board.projectId,
      title: board.title,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const rows = await db.brainstormBoards.filter(b => b.title.toLowerCase().includes(q)).toArray();
    return rows.map(b => ({
      id: b.id,
      type: 'brainstorm',
      engineId: 'brainstorm',
      projectId: b.projectId,
      title: b.title,
    }));
  },
});

const BRAINSTORM_TABLES = [
  'brainstormBoards',
  'brainstormItems',
  'brainstormConnections',
] as const;

async function readBrainstormRows(
  zip: Parameters<typeof readBackupJson>[0],
  path: string,
): Promise<unknown[] | null> {
  const rows = await readBackupJson<unknown>(zip, path);
  if (rows !== null && !Array.isArray(rows)) {
    throw new Error(`Expected "${path}" to contain a JSON array.`);
  }
  return rows;
}

// Connections are child-only rows: they have `boardId`, not `projectId`.
// Resolve their owning boards explicitly instead of using the simple
// project-scoped strategy.
registerBackupStrategy({
  engineId: 'brainstorm',
  tables: [...BRAINSTORM_TABLES],
  async exportProject({ zip, projectId, projectDir }) {
    const [boards, items] = await Promise.all([
      db.brainstormBoards.where('projectId').equals(projectId).toArray(),
      db.brainstormItems.where('projectId').equals(projectId).toArray(),
    ]);
    const boardIds = boards.map((board) => board.id);
    const connections = boardIds.length
      ? await db.brainstormConnections.where('boardId').anyOf(boardIds).toArray()
      : [];
    const folder = `${projectDir}/brainstorm`;
    zip.file(`${folder}/brainstormBoards.json`, JSON.stringify(boards, null, 2));
    zip.file(`${folder}/brainstormItems.json`, JSON.stringify(items, null, 2));
    zip.file(
      `${folder}/brainstormConnections.json`,
      JSON.stringify(connections, null, 2),
    );
  },
  async preflightImport({ zip, projectDir }) {
    for (const table of BRAINSTORM_TABLES) {
      await readBrainstormRows(zip, `${projectDir}/brainstorm/${table}.json`);
    }
  },
  async importProject({ zip, projectDir }) {
    const folder = `${projectDir}/brainstorm`;
    const boards = await readBrainstormRows(zip, `${folder}/brainstormBoards.json`);
    const items = await readBrainstormRows(zip, `${folder}/brainstormItems.json`);
    const connections = await readBrainstormRows(
      zip,
      `${folder}/brainstormConnections.json`,
    );
    if (boards?.length) await db.brainstormBoards.bulkAdd(boards as never[]);
    if (items?.length) await db.brainstormItems.bulkAdd(items as never[]);
    if (connections?.length) {
      await db.brainstormConnections.bulkAdd(connections as never[]);
    }
  },
});

export { brainstormEngine };
