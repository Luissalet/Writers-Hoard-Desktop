import { db } from '@/db';
import { readJson, registerBackupStrategy, type ImportContext } from '@/engines/_shared/backupRegistry';
import { decodeEraAssets, decodeEraVariants, encodeEraValue } from './portability';
const read = async ({ zip, projectId, projectDir }: ImportContext) => {
  const assets = await decodeEraAssets(await readJson(zip, `${projectDir}/world-eras/assets.json`), projectId);
  return { assets, variants: decodeEraVariants(await readJson(zip, `${projectDir}/world-eras/variants.json`), projectId, assets) };
};
registerBackupStrategy({
  engineId: 'world-eras', tables: ['worldEraVariants', 'worldEraAssets'],
  async exportProject({ zip, projectId, projectDir }) { for (const [table, file] of [[db.worldEraVariants, 'variants'], [db.worldEraAssets, 'assets']] as const) { const rows = await table.where('projectId').equals(projectId).toArray(); if (rows.length) zip.file(`${projectDir}/world-eras/${file}.json`, JSON.stringify(await encodeEraValue(rows))); } },
  async inspectImport(context) { const rows = await read(context); return [{ table: 'worldEraVariants', path: `${context.projectDir}/world-eras/variants.json`, rows: rows.variants }, { table: 'worldEraAssets', path: `${context.projectDir}/world-eras/assets.json`, rows: rows.assets }]; },
  async preflightImport(context) { await read(context); },
  async importProject(context) { const rows = await read(context); if (rows.assets.length) await db.worldEraAssets.bulkPut(rows.assets); if (rows.variants.length) await db.worldEraVariants.bulkPut(rows.variants); },
});
