import '@/engines';
import '@/services/aiBridge/dispatch';
import { db } from '@/db';
async function prepare() {
  await db.projects.put({ id: 'draft-history-native', title: 'Synthetic draft transport', description: '', mode: 'custom', type: 'standalone', color: '#777777', status: 'draft', enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: 1, updatedAt: 1 });
  await db.writings.put({ id: 'native-chapter', projectId: 'draft-history-native', title: 'Native harbor', content: '<p>Canonical fixture.</p>', wordCount: 2, status: 'draft', tags: [], createdAt: 1, updatedAt: 1 });
  Object.assign(window, { __transportReady: true });
}
void prepare();
