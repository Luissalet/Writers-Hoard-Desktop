import { BookOpen } from 'lucide-react';
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
import CodexEngine from './CodexEngine';

const codexEngine: EngineDefinition = {
  id: 'codex',
  name: 'Codex',
  description: 'Encyclopedia of characters, locations, items, and world details',
  icon: BookOpen,
  category: 'core',
  tables: {
    codexEntries: 'id, projectId, type, *tags, updatedAt',
  },
  component: CodexEngine,
};

registerEngine(codexEngine);

registerEntityResolver({
  engineId: 'codex',
  entityTypes: ['codex', 'codex-entry', 'character', 'location'],
  resolveEntity: async (entityId: string, entityType: string) => {
    const entry = await db.codexEntries.get(entityId);
    if (!entry) return null;
    return {
      id: entry.id,
      type: entityType,
      engineId: 'codex',
      title: entry.title,
      subtitle: entry.type,
      thumbnail: entry.avatar,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const rows = await db.codexEntries.filter(e => e.title.toLowerCase().includes(q)).toArray();
    return rows.map(e => ({
      id: e.id,
      type: e.type,
      engineId: 'codex',
      title: e.title,
      subtitle: e.type,
      thumbnail: e.avatar,
    }));
  },
});

registerAnchorAdapter({
  engineId: 'codex',
  supportsTextRange: true,
  async getEntityText(entityId: string) {
    const entry = await db.codexEntries.get(entityId);
    if (!entry) return null;
    return htmlToText(entry.content);
  },
  async getEntityTitle(entityId: string) {
    const entry = await db.codexEntries.get(entityId);
    return entry?.title ?? null;
  },
  getEngineChipLabel: () => t('annotations.chipLabel.codex'),
  navigateToEntity(entityId: string) {
    const pid = getCurrentProjectIdFromUrl();
    if (!pid) return;
    navigateTo(`/project/${pid}/codex?entry=${encodeURIComponent(entityId)}`);
  },
});

export { codexEngine };
