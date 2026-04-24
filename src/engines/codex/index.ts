import { BookOpen } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import {
  registerAnchorAdapter,
  htmlToText,
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

// ============================================
// Backup strategy — preserves legacy on-disk format:
//   {projectDir}/codex/{sanitizedTitle}__{id}/entry.json
//   {projectDir}/codex/{sanitizedTitle}__{id}/avatar.{ext}
// so existing user ZIPs restore without migration. Uses the new
// `externalizeImage`/`internalizeImage` helpers from _shared.
// ============================================
registerBackupStrategy({
  engineId: 'codex',
  tables: ['codexEntries'],
  async exportProject({ zip, projectId, projectDir }) {
    const rows = await db.codexEntries.where('projectId').equals(projectId).toArray();
    for (const entry of rows) {
      const entryDir = `${projectDir}/codex/${sanitizeBackupName(entry.title)}__${entry.id}`;
      const meta: Record<string, unknown> = { ...entry };
      const avatarPath = externalizeImage(zip, entryDir, entry.avatar, 'avatar');
      if (avatarPath) meta.avatar = avatarPath;
      else if (entry.avatar && !entry.avatar.startsWith('data:')) meta.avatar = entry.avatar;
      zip.file(`${entryDir}/entry.json`, JSON.stringify(meta, null, 2));
    }
  },
  async importProject({ zip, projectDir }) {
    const codexFolder = `${projectDir}/codex/`;
    const dirs = new Set<string>();
    zip.forEach((path) => {
      if (path.startsWith(codexFolder)) {
        const sub = path.slice(codexFolder.length);
        const dir = sub.split('/')[0];
        if (dir) dirs.add(`${codexFolder}${dir}`);
      }
    });
    for (const entryDir of dirs) {
      const entry = await readBackupJson<Record<string, unknown>>(zip, `${entryDir}/entry.json`);
      if (!entry) continue;
      if (entry.avatar && typeof entry.avatar === 'string' && !entry.avatar.startsWith('data:')) {
        entry.avatar = (await internalizeImage(zip, entryDir, entry.avatar)) || undefined;
      }
      await db.codexEntries.add(entry as never);
    }
  },
});

export { codexEngine };
