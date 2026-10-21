import '@/engines';
import '@/services/aiBridge/dispatch';
import { db } from '@/db';
import { prepareDocumentImageFixture } from './document-image-fixture';
import { prepareSheetInkFixture } from './character-sheet-ink.browser';

async function prepare() {
  await db.projects.put({ id: 'transport-world', title: 'Synthetic transport QA', description: '', mode: 'custom', type: 'standalone', color: '#d5b575', status: 'draft', enabledEngines: ['codex', 'dialog-scene', 'model-viewer', 'radar', 'character-sheets'], engineOrder: ['codex', 'dialog-scene', 'model-viewer', 'radar', 'character-sheets'], createdAt: 1, updatedAt: 1 });
  await db.scenes.put({ id: 'transport-scene', projectId: 'transport-world', title: 'Harbor', order: 0, tags: [], createdAt: 1, updatedAt: 1 });
  await db.projects.update('transport-world', { enabledEngines: ['codex', 'dialog-scene', 'model-viewer', 'radar', 'character-sheets', 'writings', 'media', 'board', 'notes'] });
  await db.writings.put({ id: 'transport-chapter', projectId: 'transport-world', title: 'The crossing', content: '<p>Ágata reaches the harbor.</p><p>The boat waits.</p>', wordCount: 9, tags: [], status: 'draft', createdAt: 1, updatedAt: 1 });
  (window as unknown as { __transportImageFixture: unknown }).__transportImageFixture = await prepareDocumentImageFixture();
  (window as unknown as { __transportSheetInk: unknown }).__transportSheetInk = await prepareSheetInkFixture();
  (window as unknown as { __transportReady: boolean }).__transportReady = true;
  (window as unknown as { __transportSnapshot: () => Promise<unknown> }).__transportSnapshot = async () => ({ project: await db.projects.get('transport-world'), turns: await db.dialogBlocks.where('sceneId').equals('transport-scene').toArray() });
}
void prepare();
