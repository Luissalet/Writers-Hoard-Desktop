import { PenLine } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import {
  registerAnchorAdapter,
  htmlToText,
  navigateTo,
  getCurrentProjectIdFromUrl,
} from '@/engines/_shared/anchoring';
import { t } from '@/i18n/useTranslation';
import { db } from '@/db';
import WritingsEngine from './WritingsEngine';

const writingsEngine: EngineDefinition = {
  id: 'writings',
  name: 'Writings',
  description: 'Write and manage drafts, chapters, and manuscripts',
  icon: PenLine,
  category: 'core',
  tables: {
    writings: 'id, projectId, status, *tags, updatedAt, googleDocId',
  },
  component: WritingsEngine,
};

registerEngine(writingsEngine);

registerEntityResolver({
  engineId: 'writings',
  entityTypes: ['writings', 'writing'],
  resolveEntity: async (entityId: string, entityType: string) => {
    const writing = await db.writings.get(entityId);
    if (!writing) return null;
    return {
      id: writing.id,
      type: entityType,
      engineId: 'writings',
      title: writing.title,
      subtitle: writing.status,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const rows = await db.writings.filter(w => w.title.toLowerCase().includes(q)).toArray();
    return rows.map(w => ({
      id: w.id,
      type: 'writing',
      engineId: 'writings',
      title: w.title,
      subtitle: w.status,
    }));
  },
});

registerAnchorAdapter({
  engineId: 'writings',
  supportsTextRange: true,
  async getEntityText(entityId: string) {
    const writing = await db.writings.get(entityId);
    if (!writing) return null;
    return htmlToText(writing.content);
  },
  async getEntityTitle(entityId: string) {
    const writing = await db.writings.get(entityId);
    return writing?.title ?? null;
  },
  getEngineChipLabel: () => t('annotations.chipLabel.writings'),
  navigateToEntity(entityId: string) {
    const pid = getCurrentProjectIdFromUrl();
    if (!pid) return;
    navigateTo(`/project/${pid}/writings?writing=${encodeURIComponent(entityId)}`);
  },
});

export { writingsEngine };
