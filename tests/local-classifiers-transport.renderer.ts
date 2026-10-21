import '@/engines/codex';
import '@/engines/gallery';
import '@/engines/writings';
import '@/services/aiBridge/dispatch';
import { db } from '@/db';
import { readEraRow } from '@/services/worldEras/store';
import { searchVisualImages } from '@/services/visualSearch/search';
import type { CodexEntry } from '@/types';
const scope = window as unknown as { __classifierFixtures?: string[]; __classifiersReady?: boolean; __classifiersFailure?: string; __classifierSnapshot?: () => Promise<unknown>; __visualBytes?: () => Promise<unknown> };
async function prepare() {
  while (!scope.__classifierFixtures) await new Promise(resolve => setTimeout(resolve, 20));
  const now = Date.now();
  await db.projects.bulkPut(['classifier-world', 'classifier-foreign'].map(id => ({ id, title: 'Synthetic classifier transport', description: '', mode: 'custom' as const, type: 'standalone' as const, color: '#d5b575', status: 'draft' as const, enabledEngines: ['codex', 'gallery', 'writings'], engineOrder: [], createdAt: now, updatedAt: now, worldEras: id === 'classifier-world' ? [{ id: 'classifier-era', name: 'Synthetic future', description: '', revision: 1, createdAt: now, updatedAt: now }] : [] })));
  await db.writings.put({ id: 'classifier-prose', projectId: 'classifier-world', title: 'Untouched fixture prose', content: '<p>Manually <a href="/project/classifier-world/codex?entry=known-a">authored link</a> and original prose remain.</p>', wordCount: 9, tags: [], status: 'draft', createdAt: now, updatedAt: now });
  await db.codexEntries.bulkPut(['known-a', 'known-b'].map(id => ({ id, projectId: 'classifier-world', title: id, type: 'character', fields: { aliases: '["María García"]' }, content: '<p>Preserved known character content.</p>', tags: [], relations: [], createdAt: now, updatedAt: now })) as CodexEntry[]);
  const [map, page] = scope.__classifierFixtures;
  await db.inspirationImages.bulkPut([{ id: 'opaque-image-A', projectId: 'classifier-world', collectionId: 'collection-A', imageData: map, notes: '', tags: [], createdAt: now }, { id: 'opaque-image-B', projectId: 'classifier-world', collectionId: 'collection-B', imageData: page, notes: '', tags: [], createdAt: now }, { id: 'foreign-image', projectId: 'classifier-foreign', imageData: map, notes: '', tags: [], createdAt: now }]);
  scope.__classifierSnapshot = async () => ({ prose: await db.writings.get('classifier-prose'), base: await db.codexEntries.where('projectId').equals('classifier-world').toArray(), era: await db.worldEraVariants.where('projectId').equals('classifier-world').toArray(), eraCards: await Promise.all((await db.worldEraVariants.where('projectId').equals('classifier-world').toArray()).map(row => readEraRow({ projectId: 'classifier-world', eraId: 'classifier-era' }, 'codexEntries', row.entityId))) });
  scope.__visualBytes = async () => {
    const [a, b] = await Promise.all([window.electronAPI!.visualSearch.image(map), window.electronAPI!.visualSearch.image(page)]);
    const rows = await db.inspirationImages.where('projectId').equals('classifier-world').toArray(); let foreignRejected = false;
    try { await searchVisualImages('classifier-world', 'a map', [...rows, (await db.inspirationImages.get('foreign-image'))!]); } catch { foreignRejected = true; }
    await db.inspirationImages.update('opaque-image-A', { imageData: page });
    return { a: { hash: a.hash, cached: a.cached, model: a.model }, b: { hash: b.hash, cached: b.cached, model: b.model }, foreignRejected, metadata: rows.map(row => ({ id: row.id, notes: row.notes, tags: row.tags, derivedInRow: 'vector' in row || 'embedding' in row })) };
  };
  scope.__classifiersReady = true;
}
void prepare().catch(error => { scope.__classifiersFailure = error.stack ?? String(error); });
