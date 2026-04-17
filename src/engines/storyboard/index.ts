// ============================================
// Storyboard Engine — Registration
// ============================================

import { LayoutGrid } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerBackupStrategy, readBackupJson } from '@/engines/_shared';
import { db } from '@/db';
import StoryboardEngine from './StoryboardEngine';

const storyboardEngine: EngineDefinition = {
  id: 'storyboard',
  name: 'Storyboard',
  description: 'Visual panel sequences for planning scenes and shots',
  icon: LayoutGrid,
  category: 'planning',
  tables: {
    storyboards: 'id, projectId',
    storyboardPanels: 'id, storyboardId, projectId, order',
    storyboardConnectors: 'id, storyboardId, fromPanelId, toPanelId',
  },
  component: StoryboardEngine,
};

registerEngine(storyboardEngine);

registerEntityResolver({
  engineId: 'storyboard',
  entityTypes: ['storyboard', 'panel'],
  resolveEntity: async (entityId: string, entityType: string) => {
    const board = await db.storyboards.get(entityId);
    if (!board) return null;
    return {
      id: board.id,
      type: entityType,
      engineId: 'storyboard',
      title: board.title,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const rows = await db.storyboards.filter(b => b.title.toLowerCase().includes(q)).toArray();
    return rows.map(b => ({
      id: b.id,
      type: 'storyboard',
      engineId: 'storyboard',
      title: b.title,
    }));
  },
});

// storyboardConnectors are scoped by storyboardId, not projectId — handled
// explicitly by walking the project's boards.
registerBackupStrategy({
  engineId: 'storyboard',
  tables: ['storyboards', 'storyboardPanels', 'storyboardConnectors'],
  async exportProject({ zip, projectId, projectDir }) {
    const boards = await db.storyboards.where('projectId').equals(projectId).toArray();
    if (boards.length) zip.file(`${projectDir}/storyboard/storyboards.json`, JSON.stringify(boards, null, 2));

    const panels = await db.storyboardPanels.where('projectId').equals(projectId).toArray();
    if (panels.length) zip.file(`${projectDir}/storyboard/storyboardPanels.json`, JSON.stringify(panels, null, 2));

    const boardIds = boards.map(b => b.id);
    if (boardIds.length) {
      const connectors = await db.storyboardConnectors.where('storyboardId').anyOf(boardIds).toArray();
      if (connectors.length) zip.file(`${projectDir}/storyboard/storyboardConnectors.json`, JSON.stringify(connectors, null, 2));
    }
  },
  async importProject({ zip, projectDir }) {
    const boards = await readBackupJson<unknown[]>(zip, `${projectDir}/storyboard/storyboards.json`);
    if (boards?.length) await db.storyboards.bulkAdd(boards as never[]);

    const panels = await readBackupJson<unknown[]>(zip, `${projectDir}/storyboard/storyboardPanels.json`);
    if (panels?.length) await db.storyboardPanels.bulkAdd(panels as never[]);

    const connectors = await readBackupJson<unknown[]>(zip, `${projectDir}/storyboard/storyboardConnectors.json`);
    if (connectors?.length) await db.storyboardConnectors.bulkAdd(connectors as never[]);
  },
});

export { storyboardEngine };
