import { Network } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import {
  registerAnchorAdapter,
  navigateTo,
  getCurrentProjectIdFromUrl,
} from '@/engines/_shared/anchoring';
import { t } from '@/i18n/useTranslation';
import { db } from '@/db';
import YarnBoardEngine from './YarnBoardEngine';

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
    const node = await db.yarnNodes.get(entityId);
    if (!node) return null;
    return {
      id: node.id,
      type: entityType,
      engineId: 'yarn-board',
      title: node.title,
      subtitle: node.type,
      thumbnail: node.image,
      color: node.color,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const rows = await db.yarnNodes.filter(n => n.title.toLowerCase().includes(q)).toArray();
    return rows.map(n => ({
      id: n.id,
      type: 'yarn-node',
      engineId: 'yarn-board',
      title: n.title,
      subtitle: n.type,
      thumbnail: n.image,
      color: n.color,
    }));
  },
});

registerAnchorAdapter({
  engineId: 'yarn-board',
  supportsTextRange: false,
  async getEntityTitle(entityId: string) {
    const node = await db.yarnNodes.get(entityId);
    return node?.title ?? null;
  },
  getEngineChipLabel: () => t('annotations.chipLabel.yarnBoard'),
  navigateToEntity(entityId: string) {
    const pid = getCurrentProjectIdFromUrl();
    if (!pid) return;
    navigateTo(`/project/${pid}/yarn-board?node=${encodeURIComponent(entityId)}`);
  },
});

export { yarnBoardEngine };
