import { lazy } from 'react';
import { Network } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import {
  registerAnchorAdapter,
  navigateTo,
  getCurrentProjectIdFromUrl,
} from '@/engines/_shared/anchoring';
import {
  registerBackupStrategy,
  sanitizeBackupName,
  externalizeImage,
  internalizeImage,
  readBackupJson,
} from '@/engines/_shared';
import { t } from '@/i18n/useTranslation';
import { db } from '@/db';
const YarnBoardEngine = lazy(() => import('./YarnBoardEngine'));

const yarnBoardEngine: EngineDefinition = {
  id: 'yarn-board',
  name: 'Yarn Board',
  description: 'Conceptual maps with nodes and connections',
  icon: Network,
  category: 'core',
  tables: {
    yarnBoards: 'id, projectId',
    yarnNodes: 'id, projectId, boardId',
    yarnEdges: 'id, boardId, sourceId, targetId',
  },
  component: YarnBoardEngine,
};

registerEngine(yarnBoardEngine);

registerEntityResolver({
  engineId: 'yarn-board',
  entityTypes: ['yarn-board', 'yarn-node'],
  resolveEntity: async (entityId: string, entityType: string) => {
    if (entityType === 'yarn-board') {
      const board = await db.yarnBoards.get(entityId);
      if (!board) return null;
      return {
        id: board.id,
        type: 'yarn-board',
        engineId: 'yarn-board',
        projectId: board.projectId,
        title: board.title,
      };
    }
    const node = await db.yarnNodes.get(entityId);
    if (!node) return null;
    return {
      id: node.id,
      type: 'yarn-node',
      engineId: 'yarn-board',
      projectId: node.projectId,
      title: node.title,
      subtitle: node.type,
      thumbnail: node.image,
      color: node.color,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const [boards, nodes] = await Promise.all([
      db.yarnBoards.filter((board) => board.title.toLowerCase().includes(q)).toArray(),
      db.yarnNodes.filter((node) => node.title.toLowerCase().includes(q)).toArray(),
    ]);
    return [
      ...boards.map((board) => ({
        id: board.id,
        type: 'yarn-board',
        engineId: 'yarn-board',
        projectId: board.projectId,
        title: board.title,
      })),
      ...nodes.map((node) => ({
        id: node.id,
        type: 'yarn-node',
        engineId: 'yarn-board',
        projectId: node.projectId,
        title: node.title,
        subtitle: node.type,
        thumbnail: node.image,
        color: node.color,
      })),
    ];
  },
});

registerAnchorAdapter({
  engineId: 'yarn-board',
  supportsTextRange: false,
  async getEntityTitle(entityId: string) {
    const node = await db.yarnNodes.get(entityId);
    if (node) return node.title;
    const board = await db.yarnBoards.get(entityId);
    return board?.title ?? null;
  },
  getEngineChipLabel: () => t('annotations.chipLabel.yarnBoard'),
  navigateToEntity(entityId: string) {
    const pid = getCurrentProjectIdFromUrl();
    if (!pid) return;
    navigateTo(`/project/${pid}/yarn-board?node=${encodeURIComponent(entityId)}`);
  },
});

// ============================================
// Backup strategy — preserves legacy on-disk format:
//   {projectDir}/yarn-boards/{sanitizedTitle}__{boardId}/board.json
//   {projectDir}/yarn-boards/{sanitizedTitle}__{boardId}/nodes.json
//   {projectDir}/yarn-boards/{sanitizedTitle}__{boardId}/edges.json
//   {projectDir}/yarn-boards/{sanitizedTitle}__{boardId}/node-images/{nodeId}.{ext}
// ============================================
registerBackupStrategy({
  engineId: 'yarn-board',
  tables: ['yarnBoards', 'yarnNodes', 'yarnEdges'],
  async exportProject({ zip, projectId, projectDir }) {
    const boards = await db.yarnBoards.where('projectId').equals(projectId).toArray();
    for (const board of boards) {
      const bDir = `${projectDir}/yarn-boards/${sanitizeBackupName(board.title)}__${board.id}`;
      const bNodes = await db.yarnNodes.where('boardId').equals(board.id).toArray();
      const bEdges = await db.yarnEdges.where('boardId').equals(board.id).toArray();

      const nodesMeta = bNodes.map((node) => {
        if (!node.image) return node;
        const path = externalizeImage(zip, bDir, node.image, `node-images/${node.id}`);
        return path ? { ...node, image: path } : node;
      });

      zip.file(`${bDir}/board.json`, JSON.stringify(board, null, 2));
      if (nodesMeta.length > 0) zip.file(`${bDir}/nodes.json`, JSON.stringify(nodesMeta, null, 2));
      if (bEdges.length > 0) zip.file(`${bDir}/edges.json`, JSON.stringify(bEdges, null, 2));
    }
  },
  async importProject({ zip, projectDir }) {
    const folder = `${projectDir}/yarn-boards/`;
    const dirs = new Set<string>();
    zip.forEach((path) => {
      if (path.startsWith(folder)) {
        const sub = path.slice(folder.length);
        const dir = sub.split('/')[0];
        if (dir) dirs.add(`${folder}${dir}`);
      }
    });
    for (const bDir of dirs) {
      const board = await readBackupJson<Record<string, unknown>>(zip, `${bDir}/board.json`);
      if (board) await db.yarnBoards.add(board as never);

      const nodes = await readBackupJson<Record<string, unknown>[]>(zip, `${bDir}/nodes.json`);
      if (nodes?.length) {
        for (const node of nodes) {
          if (node.image && typeof node.image === 'string' && !node.image.startsWith('data:')) {
            node.image = (await internalizeImage(zip, bDir, node.image)) || undefined;
          }
          await db.yarnNodes.add(node as never);
        }
      }

      const edges = await readBackupJson<Record<string, unknown>[]>(zip, `${bDir}/edges.json`);
      if (edges?.length) await db.yarnEdges.bulkAdd(edges as never[]);
    }
  },
});

export { yarnBoardEngine };
