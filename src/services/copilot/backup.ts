// ============================================================================
// Copilot — backup strategy for the conversation tables
// ============================================================================
//
// Engineless tables, like the project-tools set: registered here and imported
// from engines/index.ts so the coverage guardrail sees them. Exports rows
// verbatim — messages are text and small tool cards, nothing binary — except
// for the trust fields, which never travel.

import type JSZip from 'jszip';
import { db } from '@/db/index';
import {
  makeSimpleBackupStrategy,
  readBackupJson,
  registerBackupStrategy,
} from '@/engines/_shared';
import type { AiMessage, AiProjectSettings, AiThread } from './types';

export const AI_ASSISTANT_TABLES = ['aiThreads', 'aiMessages', 'aiProjectSettings'] as const;

const FOLDER = 'ai-assistant';

const simple = makeSimpleBackupStrategy({
  engineId: 'ai-assistant',
  tables: [...AI_ASSISTANT_TABLES],
});

/**
 * Consent to a remote model and the copilot's write permission belong to the
 * person sitting at this machine, never to whoever produced the archive. They
 * are cleared on the way out AND on the way in, so an archive written by an
 * older build — or by hand — still cannot raise them for the importer.
 */
function withoutProjectTrust(row: AiProjectSettings): AiProjectSettings {
  return { ...row, defaultPolicy: 'ask', remoteConsent: false };
}

function withoutThreadTrust(row: AiThread): AiThread {
  return { ...row, policy: 'ask' };
}

/** Export side: strip the trust fields from the archive that leaves the app. */
async function clearTrustFieldsInArchive(zip: JSZip, projectDir: string): Promise<void> {
  const settingsPath = `${projectDir}/${FOLDER}/aiProjectSettings.json`;
  const settings = await readBackupJson<AiProjectSettings[]>(zip, settingsPath);
  if (settings?.length) {
    zip.file(settingsPath, JSON.stringify(settings.map(withoutProjectTrust), null, 2));
  }
  const threadsPath = `${projectDir}/${FOLDER}/aiThreads.json`;
  const threads = await readBackupJson<AiThread[]>(zip, threadsPath);
  if (threads?.length) {
    zip.file(threadsPath, JSON.stringify(threads.map(withoutThreadTrust), null, 2));
  }
}

registerBackupStrategy({
  ...simple,
  async exportProject(context) {
    await simple.exportProject(context);
    await clearTrustFieldsInArchive(context.zip, context.projectDir);
  },
  // The import sanitizes the ROWS, never the archive. Rewriting an entry here
  // would add one the restore's preloaded reader has never seen, and reading it
  // back would yield to the event loop in the middle of the restore
  // transaction — see `preloadArchive` in engines/_shared/backupRegistry.ts.
  async importProject({ zip, projectDir }) {
    const folder = `${projectDir}/${FOLDER}`;
    const threads = await readBackupJson<AiThread[]>(zip, `${folder}/aiThreads.json`);
    if (threads?.length) await db.aiThreads.bulkPut(threads.map(withoutThreadTrust));
    const messages = await readBackupJson<AiMessage[]>(zip, `${folder}/aiMessages.json`);
    if (messages?.length) await db.aiMessages.bulkPut(messages);
    const settings = await readBackupJson<AiProjectSettings[]>(
      zip,
      `${folder}/aiProjectSettings.json`,
    );
    if (settings?.length) await db.aiProjectSettings.bulkPut(settings.map(withoutProjectTrust));
  },
});
