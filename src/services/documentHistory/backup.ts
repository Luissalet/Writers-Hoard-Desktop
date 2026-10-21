import { db } from '@/db';
import { registerBackupStrategy, readJson, type ImportContext } from '@/engines/_shared/backupRegistry';
import { decodeEraAssets, encodeEraValue } from '@/services/worldEras/portability';
import { decodeDocumentHistory } from './portability';
const read = async ({zip,projectDir,projectId}: ImportContext) => decodeDocumentHistory(await readJson(zip,`${projectDir}/document-history/versions.json`),projectId,await decodeEraAssets(await readJson(zip,`${projectDir}/world-eras/assets.json`),projectId));
registerBackupStrategy({engineId:'document-history',tables:['documentHistory'],async exportProject({zip,projectId,projectDir}){const rows=await db.documentHistory.where('projectId').equals(projectId).toArray();if(rows.length)zip.file(`${projectDir}/document-history/versions.json`,JSON.stringify(await encodeEraValue(rows)));},async inspectImport(context){return[{table:'documentHistory',path:`${context.projectDir}/document-history/versions.json`,rows:await read(context)}];},async preflightImport(context){await read(context);},async importProject(context){const rows=await read(context);if(rows.length)await db.documentHistory.bulkPut(rows);}});
