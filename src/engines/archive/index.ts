import { lazy } from 'react';
import { Archive } from 'lucide-react';
import { db } from '@/db';
import { registerEngine } from '@/engines/_registry';
import type { EngineDefinition } from '@/engines/_types';
import { registerBackupStrategy, readJson as readBackupJson } from '@/engines/_shared/backupRegistry';
import { registerLocaleStrings } from '@/i18n/useTranslation';
import { validateArchive } from '@/services/documentArchive/store';
import en from './locales/en';
import es from './locales/es';
registerLocaleStrings({en,es});
const ArchiveEngine=lazy(()=>import('./ArchiveEngine'));
const archiveEngine: EngineDefinition = {
  id:'archive',
  name:'Archive',
  description:'Recover deleted world documents',
  icon:Archive,
  category:'planning',
  tables: {
    documentArchives: 'id, projectId, kind, sourceId, archivedAt',
  },
  component:ArchiveEngine,
};
registerEngine(archiveEngine);
registerBackupStrategy({
  engineId:'archive',tables:['documentArchives'],
  async exportProject({zip,projectDir,projectId}) {const rows=await db.documentArchives.where('projectId').equals(projectId).toArray();zip.file(`${projectDir}/archive/documents.json`,JSON.stringify(rows));},
  async inspectImport({zip,projectDir,projectId}) {const path=`${projectDir}/archive/documents.json`;const rows=await readBackupJson<unknown>(zip,path);if(rows!==null&&!Array.isArray(rows))throw new Error('Invalid document archive');for(const row of rows??[])validateArchive(row,projectId);return [{table:'documentArchives',path,rows:rows??[]}];},
  async importProject({zip,projectDir,projectId}) {const rows=await readBackupJson<unknown[]>(zip,`${projectDir}/archive/documents.json`);for(const row of rows??[])validateArchive(row,projectId);if(rows?.length)await db.documentArchives.bulkAdd(rows as never[]);},
});
