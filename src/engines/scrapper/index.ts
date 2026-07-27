import { lazy } from 'react';

// ============================================
// Scrapper Engine — Registration
// ============================================

import { Globe } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerBackupStrategy, readBackupJson } from '@/engines/_shared';
import { db } from '@/db';
const ScrapperEngine = lazy(() => import('./components/ScrapperEngine'));
import { legacyLinksToSnapshots } from './legacyLinks';
import type { Snapshot } from './types';

const scrapperEngine: EngineDefinition = {
  id: 'scrapper',
  name: 'Scrapper',
  description: 'Capture and archive web content for research',
  icon: Globe,
  category: 'research',
  tables: {
    snapshots: 'id, projectId, source, status, createdAt',
  },
  component: ScrapperEngine,
};

registerEngine(scrapperEngine);

registerEntityResolver({
  engineId: 'scrapper',
  entityTypes: ['scrapper', 'snapshot'],
  resolveEntity: async (entityId: string, entityType: string) => {
    const snap = await db.snapshots.get(entityId);
    if (!snap) return null;
    return {
      id: snap.id,
      type: entityType,
      engineId: 'scrapper',
      projectId: snap.projectId,
      title: snap.title,
      subtitle: snap.url,
      thumbnail: snap.thumbnail,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const rows = await db.snapshots.filter(s => s.title.toLowerCase().includes(q)).toArray();
    return rows.map(s => ({
      id: s.id,
      type: 'snapshot',
      engineId: 'scrapper',
      projectId: s.projectId,
      title: s.title,
      subtitle: s.url,
      thumbnail: s.thumbnail,
    }));
  },
});

const SCRAPPER_ASSET_POLICY = {
  version: 1,
  included: false,
  restorePolicy: 'reset-unavailable',
  description:
    'Native media, PDF, screenshot, and HTML archive files are not included in this backup.',
} as const;

/**
 * Scrapper's large native files live outside IndexedDB. Backups are explicitly
 * metadata-only, so path fields must never cross machines while still claiming
 * that a download/archive is ready.
 */
function withoutExternalAssets(snapshot: Snapshot): Snapshot {
  const clean = { ...snapshot };
  const hadDownloadedAsset =
    Boolean(clean.localMediaPath) ||
    Boolean(clean.mediaItems?.length) ||
    clean.downloadState === 'done' ||
    clean.downloadState === 'downloading';
  const hadCapturedAsset =
    Boolean(clean.capturePdfPath) ||
    Boolean(clean.captureImagePath) ||
    Boolean(clean.captureHtmlPath) ||
    clean.captureState === 'done' ||
    clean.captureState === 'capturing';

  delete clean.localMediaPath;
  delete clean.mediaItems;
  delete clean.mediaFilename;
  delete clean.mediaSizeBytes;
  delete clean.mediaKind;
  delete clean.capturePdfPath;
  delete clean.captureImagePath;
  delete clean.captureHtmlPath;

  if (hadDownloadedAsset) {
    clean.downloadState = 'idle';
    delete clean.downloadError;
  }
  if (hadCapturedAsset) {
    clean.captureState = 'idle';
    delete clean.captureError;
  }
  return clean;
}

async function readSnapshots(
  zip: Parameters<typeof readBackupJson>[0],
  path: string,
): Promise<Snapshot[] | null> {
  const rows = await readBackupJson<unknown>(zip, path);
  if (rows !== null && !Array.isArray(rows)) {
    throw new Error(`Expected "${path}" to contain a JSON array.`);
  }
  return rows as Snapshot[] | null;
}

registerBackupStrategy({
  engineId: 'scrapper',
  tables: ['snapshots'],
  async exportProject({ zip, projectId, projectDir }) {
    const snapshots = await db.snapshots
      .where('projectId')
      .equals(projectId)
      .toArray();
    const folder = `${projectDir}/scrapper`;
    zip.file(
      `${folder}/snapshots.json`,
      JSON.stringify(snapshots.map(withoutExternalAssets), null, 2),
    );
    zip.file(
      `${folder}/external-assets.json`,
      JSON.stringify(
        {
          ...SCRAPPER_ASSET_POLICY,
          omittedSnapshotCount: snapshots.filter((snapshot) =>
            Boolean(
              snapshot.localMediaPath ||
              snapshot.mediaItems?.length ||
              snapshot.capturePdfPath ||
              snapshot.captureImagePath ||
              snapshot.captureHtmlPath,
            ),
          ).length,
        },
        null,
        2,
      ),
    );
  },
  async preflightImport({ zip, projectDir }) {
    await readSnapshots(zip, `${projectDir}/scrapper/snapshots.json`);
    const policy = await readBackupJson<unknown>(
      zip,
      `${projectDir}/scrapper/external-assets.json`,
    );
    if (policy !== null && (!policy || typeof policy !== 'object' || Array.isArray(policy))) {
      throw new Error('Invalid Scrapper external-asset metadata.');
    }
    if (
      policy !== null &&
      ((policy as { version?: unknown }).version !== SCRAPPER_ASSET_POLICY.version ||
        (policy as { included?: unknown }).included !== false ||
        (policy as { restorePolicy?: unknown }).restorePolicy !==
          SCRAPPER_ASSET_POLICY.restorePolicy)
    ) {
      throw new Error(
        'Unsupported Scrapper external-asset restore policy.',
      );
    }
  },
  async importProject({ zip, projectDir }) {
    const snapshots = await readSnapshots(
      zip,
      `${projectDir}/scrapper/snapshots.json`,
    );
    if (snapshots?.length) {
      await db.snapshots.bulkAdd(snapshots.map(withoutExternalAssets));
    }
    const legacy = await readBackupJson<unknown[]>(
      zip,
      `${projectDir}/links/links.json`,
    );
    if (legacy?.length) {
      await db.snapshots.bulkPut(
        legacyLinksToSnapshots(legacy).map(withoutExternalAssets),
      );
    }
  },
});

export { scrapperEngine };
