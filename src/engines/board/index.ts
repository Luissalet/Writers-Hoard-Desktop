import { lazy } from 'react';
import { Network } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import type JSZip from 'jszip';
import {
  externalizeImage,
  internalizeImage,
  readBackupJson,
  registerBackupStrategy,
  sanitizeBackupName,
} from '@/engines/_shared';
import {
  getCurrentProjectIdFromUrl,
  navigateTo,
  registerAnchorAdapter,
} from '@/engines/_shared/anchoring';
import { t } from '@/i18n/useTranslation';
import { db } from '@/db';
import type { BoardEdge, BoardLayer, BoardNode, BoardView } from './types';

const BoardEngineView = lazy(() => import('./components/BoardEngine'));

// ============================================
// Board — the fusion of the former Yarn Board and Brainstorm engines
// ============================================
//
// Both predecessors were an infinite canvas with cards and connecting lines,
// and neither modelled the connections as a graph: relation meaning lived in
// the stroke colour, groups were decorative rectangles, and half the declared
// fields were never read. This engine keeps the canvas and makes the graph
// real — typed relations, many-to-many links, links between links, layers,
// saved views, live queries and graph metrics.

const boardEngine: EngineDefinition = {
  id: 'board',
  name: 'Board',
  description: 'Infinite canvas over a real graph: typed relations, layers, views and metrics',
  icon: Network,
  category: 'core',
  tables: {
    boards: 'id, projectId',
    boardNodes: 'id, projectId, boardId, kind, *tags',
    boardEdges: 'id, projectId, boardId, sourceId, targetId, kind',
    boardLayers: 'id, projectId, boardId, order',
    boardViews: 'id, projectId, boardId, order',
  },
  component: BoardEngineView,
};

registerEngine(boardEngine);

registerEntityResolver({
  engineId: 'board',
  entityTypes: ['board', 'board-node'],
  resolveEntity: async (entityId: string, entityType: string) => {
    if (entityType === 'board') {
      const board = await db.boards.get(entityId);
      if (!board) return null;
      return {
        id: board.id,
        type: 'board',
        engineId: 'board',
        projectId: board.projectId,
        title: board.title,
      };
    }
    const node = await db.boardNodes.get(entityId);
    if (!node) return null;
    return {
      id: node.id,
      type: 'board-node',
      engineId: 'board',
      projectId: node.projectId,
      title: node.title || node.ref?.title || node.content.slice(0, 60),
      subtitle: node.role ?? node.kind,
      thumbnail: node.image,
      color: node.color,
    };
  },
  // Genuinely scoped by the projectId index when the caller knows it. The
  // comment used to claim this, but both queries were unconditional full-table
  // scans — and boardNodes carries base64 images, so every keystroke of the
  // global search deserialised every node picture in the database.
  searchEntities: async (query: string, projectId?: string) => {
    const needle = query.toLowerCase();
    const boardBase = projectId
      ? db.boards.where('projectId').equals(projectId)
      : db.boards.toCollection();
    const nodeBase = projectId
      ? db.boardNodes.where('projectId').equals(projectId)
      : db.boardNodes.toCollection();
    const [boards, nodes] = await Promise.all([
      boardBase.filter((board) => board.title.toLowerCase().includes(needle)).toArray(),
      nodeBase
        .filter(
          (node) =>
            node.title.toLowerCase().includes(needle) ||
            node.content.toLowerCase().includes(needle) ||
            node.tags.some((tag) => tag.toLowerCase().includes(needle)),
        )
        .toArray(),
    ]);
    return [
      ...boards.map((board) => ({
        id: board.id,
        type: 'board',
        engineId: 'board',
        projectId: board.projectId,
        title: board.title,
      })),
      ...nodes.map((node) => ({
        id: node.id,
        type: 'board-node',
        engineId: 'board',
        projectId: node.projectId,
        title: node.title || node.ref?.title || node.content.slice(0, 60),
        subtitle: node.role ?? node.kind,
        thumbnail: node.image,
        color: node.color,
      })),
    ];
  },
});

registerAnchorAdapter({
  engineId: 'board',
  supportsTextRange: false,
  async getEntityTitle(entityId: string) {
    const node = await db.boardNodes.get(entityId);
    if (node) return node.title || node.ref?.title || null;
    const board = await db.boards.get(entityId);
    return board?.title ?? null;
  },
  getEngineChipLabel: () => t('annotations.chipLabel.board'),
  navigateToEntity(entityId: string) {
    const projectId = getCurrentProjectIdFromUrl();
    if (!projectId) return;
    navigateTo(`/project/${projectId}/board?node=${encodeURIComponent(entityId)}`);
  },
});

// ============================================
// Backup
// ============================================
//
// One folder per board, images externalised out of the JSON so a board full of
// reference photos does not balloon the archive:
//   {projectDir}/boards/{title}__{boardId}/board.json
//   {projectDir}/boards/{title}__{boardId}/{nodes,edges,layers,views}.json
//   {projectDir}/boards/{title}__{boardId}/node-images/{nodeId}.{ext}

const BOARD_TABLES = ['boards', 'boardNodes', 'boardEdges', 'boardLayers', 'boardViews'] as const;

registerBackupStrategy({
  engineId: 'board',
  tables: [...BOARD_TABLES],
  async exportProject({ zip, projectId, projectDir }) {
    const boards = await db.boards.where('projectId').equals(projectId).toArray();
    for (const board of boards) {
      const dir = `${projectDir}/boards/${sanitizeBackupName(board.title)}__${board.id}`;
      const [nodes, edges, layers, views] = await Promise.all([
        db.boardNodes.where('boardId').equals(board.id).toArray(),
        db.boardEdges.where('boardId').equals(board.id).toArray(),
        db.boardLayers.where('boardId').equals(board.id).toArray(),
        db.boardViews.where('boardId').equals(board.id).toArray(),
      ]);

      const nodesMeta = nodes.map((node) => {
        const copy: BoardNode = { ...node };
        if (copy.image) {
          const path = externalizeImage(zip, dir, copy.image, `node-images/${node.id}`);
          if (path) copy.image = path;
        }
        if (copy.imageOriginal) {
          const path = externalizeImage(zip, dir, copy.imageOriginal, `node-images/${node.id}-original`);
          if (path) copy.imageOriginal = path;
        }
        return copy;
      });

      zip.file(`${dir}/board.json`, JSON.stringify(board, null, 2));
      zip.file(`${dir}/nodes.json`, JSON.stringify(nodesMeta, null, 2));
      zip.file(`${dir}/edges.json`, JSON.stringify(edges, null, 2));
      zip.file(`${dir}/layers.json`, JSON.stringify(layers, null, 2));
      zip.file(`${dir}/views.json`, JSON.stringify(views, null, 2));
    }
  },
  async preflightImport({ zip, projectDir }) {
    for (const dir of boardDirs(zip, projectDir)) {
      for (const file of ['nodes', 'edges', 'layers', 'views']) {
        const rows = await readBackupJson<unknown>(zip, `${dir}/${file}.json`);
        if (rows !== null && !Array.isArray(rows)) {
          throw new Error(`Expected "${dir}/${file}.json" to contain a JSON array.`);
        }
      }
    }
  },
  async importProject({ zip, projectDir }) {
    for (const dir of boardDirs(zip, projectDir)) {
      const board = await readBackupJson<Record<string, unknown>>(zip, `${dir}/board.json`);
      if (board) await db.boards.add(board as never);

      const nodes = await readBackupJson<BoardNode[]>(zip, `${dir}/nodes.json`);
      if (nodes?.length) {
        for (const node of nodes) {
          if (node.image && !node.image.startsWith('data:')) {
            node.image = (await internalizeImage(zip, dir, node.image)) || undefined;
          }
          if (node.imageOriginal && !node.imageOriginal.startsWith('data:')) {
            node.imageOriginal = (await internalizeImage(zip, dir, node.imageOriginal)) || undefined;
          }
          await db.boardNodes.add(node);
        }
      }

      const edges = await readBackupJson<BoardEdge[]>(zip, `${dir}/edges.json`);
      if (edges?.length) await db.boardEdges.bulkPut(edges);
      const layers = await readBackupJson<BoardLayer[]>(zip, `${dir}/layers.json`);
      if (layers?.length) await db.boardLayers.bulkPut(layers);
      const views = await readBackupJson<BoardView[]>(zip, `${dir}/views.json`);
      if (views?.length) await db.boardViews.bulkPut(views);
    }
  },
});

function boardDirs(zip: JSZip, projectDir: string): string[] {
  const root = `${projectDir}/boards/`;
  const dirs = new Set<string>();
  zip.forEach((path) => {
    if (!path.startsWith(root)) return;
    const sub = path.slice(root.length).split('/')[0];
    if (sub) dirs.add(`${root}${sub}`);
  });
  return Array.from(dirs);
}

export { boardEngine };
