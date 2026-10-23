import { db } from '@/db';
import type { Project, Writing } from '@/types';
import { deleteWriting } from '@/engines/writings/operations';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** The archive through the bridge: list what was deleted, restore several at once (the UI's bulk choice is in its runner). */
export async function testArchiveBulk(): Promise<string[]> {
  const P = `archive-bulk-${Date.now()}`;
  try {
    await db.projects.put({ id: P, title: 'Archive', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings', 'archive'], createdAt: 1, updatedAt: 1 } satisfies Project);
    for (const [i, title] of ['Prólogo', 'La tormenta', 'Epílogo'].entries()) {
      await db.writings.put({ id: `${P}-${i}`, projectId: P, title, status: 'draft', content: `<p>${title}.</p>`, wordCount: 1, tags: [], chapter: i + 1, createdAt: 1, updatedAt: 1 } satisfies Writing);
      await deleteWriting(`${P}-${i}`);
    }
    const listed = await runBridgeTool('wh_archive_list', { projectId: P });
    const rows = (listed.result as { archived: { id: string; title: string; kind: string }[]; total: number });
    assert(listed.ok && rows.total === 3 && rows.archived.every((row) => row.kind === 'writings'), `Listed ${JSON.stringify(listed).slice(0, 300)}`);
    const found = await runBridgeTool('wh_archive_list', { projectId: P, query: 'epilogo' });
    assert((found.result as { archived: { title: string }[] }).archived.map((row) => row.title).join() === 'Epílogo', 'A title found without its accent');
    const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: ${JSON.stringify(reply).slice(0, 300)}`);
    bad(await runBridgeTool('wh_archive_restore', { projectId: P, ids: ['nope'] }), /No archived copy/, 'An unknown archive id');
    bad(await runBridgeTool('wh_archive_restore', { projectId: P, ids: [] }), /ids/, 'Nothing to restore');
    const two = rows.archived.filter((row) => row.title !== 'La tormenta').map((row) => row.id);
    const restored = await runBridgeTool('wh_archive_restore', { projectId: P, ids: two });
    assert(restored.ok && (restored.result as { restored: unknown[] }).restored.length === 2, `Restored ${JSON.stringify(restored).slice(0, 300)}`);
    const back = (await db.writings.where('projectId').equals(P).toArray()).map((w) => w.title).sort().join();
    assert(back === 'Epílogo,Prólogo' && (await db.documentArchives.where('projectId').equals(P).count()) === 1, `Back in the manuscript: ${back}`);
    return ['Bridge: wh_archive_list lists the deleted documents (titles found without their accents) and wh_archive_restore brings back several at once with their content, refusing unknown ids and an empty list; deleting forever stays in the app'];
  } finally {
    await db.writings.where('projectId').equals(P).delete();
    await db.documentArchives.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
