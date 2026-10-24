import Dexie from 'dexie';
import { CURRENT_DB_VERSION, db } from '@/db';
/** This entry runs alone in the runner's new disposable Electron profile. */
export async function testManuscriptReviewMigration() {
  const schema = Object.fromEntries(db.tables.filter(table => !['manuscriptSources', 'localToolAssetFiles'].includes(table.name)).map(table => [table.name, [table.schema.primKey.src, ...table.schema.indexes.map(index => index.src)].join(', ')]));
  await db.delete();
  const previous = new Dexie(db.name); previous.version(43).stores(schema); await previous.open();
  const project = { id: 'legacy43', title: 'Existing novel', enabledEngines: ['writings'], mode: 'novelist', type: 'standalone', status: 'draft', color: '#555555', description: '', engineOrder: ['writings'], createdAt: 1, updatedAt: 1 };
  const writing = { id: 'legacy-writing', projectId: project.id, title: 'Existing chapter', content: '<p>Legacy prose intact.</p>', wordCount: 3, status: 'draft', tags: [], createdAt: 1, updatedAt: 1 };
  const history = { id: 'legacy-history', projectId: project.id, kind: 'writings', entityId: writing.id, title: writing.title, version: 'old-version', createdAt: 1, reason: 'edit', document: { root: writing, children: {} }, assetIds: [] };
  await previous.table('projects').add(project); await previous.table('writings').add(writing); await previous.table('documentHistory').add(history); previous.close();
  await db.open();
  if (db.verno !== CURRENT_DB_VERSION || JSON.stringify(await db.writings.get(writing.id)) !== JSON.stringify(writing) || JSON.stringify(await db.documentHistory.get(history.id)) !== JSON.stringify(history) || await db.manuscriptSources.count() !== 0 || await db.localToolAssetFiles.count() !== 0) throw Error(`DB43→${CURRENT_DB_VERSION} changed legacy prose/history or backfilled new tables`);
  return [`Real IndexedDB43→${CURRENT_DB_VERSION} additive upgrade preserves exact existing prose/history and starts with no sources or asset files`];
}
