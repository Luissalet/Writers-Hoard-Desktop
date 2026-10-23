import { db } from '@/db';
import type { Project, Writing } from '@/types';
import { placeChapter } from '@/engines/writings/chapterOrder';
import { resolvePublishingWritings } from '@/services/projectTools';
import { composePublishingDocument } from '@/engines/writings/publishingDocument';
import type { PublishingProfile } from '@/types/projectTools';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** Chapters put in a place: the plan a drag makes, and wh_move_chapter. */
export async function testChapterPlace(): Promise<string[]> {
  const P = `chapter-place-${Date.now()}`;
  try {
    const rows = [{ id: 'a', chapter: 1 }, { id: 'b', chapter: 2 }, { id: 'c', chapter: 5 }, { id: 'd', chapter: 6 }, { id: 'x' }];
    const plan = placeChapter(rows, 'd', 0);
    assert(JSON.stringify(plan) === JSON.stringify([{ id: 'd', chapter: 1 }, { id: 'a', chapter: 2 }, { id: 'b', chapter: 5 }, { id: 'c', chapter: 6 }]), `Drag the last to the top: ${JSON.stringify(plan)}`);
    assert(placeChapter(rows, 'a', 0).length === 0 && placeChapter(rows, 'x', 0).length === 0 && placeChapter(rows, 'nope', 1).length === 0, 'A drop where it is, an unnumbered writing or an unknown id change nothing');
    assert(JSON.stringify(placeChapter(rows, 'a', 99)) === JSON.stringify([{ id: 'b', chapter: 1 }, { id: 'c', chapter: 2 }, { id: 'd', chapter: 5 }, { id: 'a', chapter: 6 }]), 'Past the end is last; the gaps stay');
    // ---- the bridge ---------------------------------------------------------------------------------
    await db.projects.put({ id: P, title: 'Chapters', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings'], createdAt: 1, updatedAt: 1 } satisfies Project);
    const write = (id: string, title: string, chapter?: number) => db.writings.put({ id, projectId: P, title, status: 'draft', content: '<p>x</p>', wordCount: 1, tags: [], ...(chapter !== undefined ? { chapter } : {}), createdAt: 1, updatedAt: 1 } satisfies Writing);
    await write('w1', 'Uno', 1); await write('w2', 'Dos', 2); await write('w3', 'Tres', 3); await write('w4', 'Cuatro', 4); await write('loose', 'Idea suelta');
    const order = async () => (await db.writings.where('projectId').equals(P).toArray()).filter((w) => w.chapter !== undefined).sort((a, b) => a.chapter! - b.chapter!).map((w) => w.title).join(' ');
    const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: ${JSON.stringify(reply).slice(0, 300)}`);
    const first = await runBridgeTool('wh_move_chapter', { projectId: P, id: 'w4', position: 1 });
    assert(first.ok && (first.result as { position: number }).position === 1 && await order() === 'Cuatro Uno Dos Tres', `position 1: ${await order()}`);
    const before = await runBridgeTool('wh_move_chapter', { projectId: P, id: 'w1', before: 'w3' });
    assert(before.ok && await order() === 'Cuatro Dos Uno Tres', `before Tres: ${await order()}`);
    const down = await runBridgeTool('wh_move_chapter', { projectId: P, id: 'w4', direction: 'down' });
    assert(down.ok && await order() === 'Dos Cuatro Uno Tres', `down: ${await order()}`);
    bad(await runBridgeTool('wh_move_chapter', { projectId: P, id: 'loose', position: 1 }), /no chapter number/, 'An unnumbered writing');
    bad(await runBridgeTool('wh_move_chapter', { projectId: P, id: 'w1', position: 1, direction: 'up' }), /exactly one/, 'Two ways at once');
    bad(await runBridgeTool('wh_move_chapter', { projectId: P, id: 'w1', before: 'loose' }), /No numbered chapter/, 'Before an unnumbered writing');
    const audit = (down.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    assert(audit && Array.isArray((audit.before as { __chapters: unknown[] }).__chapters), 'The receipt keeps the numbers before');
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_move_chapter', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'move' } });
    assert(undone.ok && await order() === 'Cuatro Dos Uno Tres', `Undo puts the chapters back: ${await order()} ${JSON.stringify(undone).slice(0, 200)}`);
    // ---- kicker and held back ----------------------------------------------------------------------------
    bad(await runBridgeTool('wh_update_writing', { projectId: P, id: 'w2', kicker: 'x'.repeat(61) }), /60/, 'A kicker too long');
    const kicked = await runBridgeTool('wh_update_writing', { projectId: P, id: 'w2', kicker: ' Prólogo ' });
    assert(kicked.ok && (await db.writings.get('w2'))?.kicker === 'Prólogo', 'A kicker is saved, tidied');
    const kickAudit = (kicked.result as { __audit: { before: Record<string, unknown> } }).__audit;
    assert(Array.isArray(kickAudit.before.__absent) && (kickAudit.before.__absent as string[]).includes('kicker'), 'Undo knows the kicker was not there');
    const held = await runBridgeTool('wh_update_writing', { projectId: P, id: 'w3', heldBack: true });
    assert(held.ok && (await db.writings.get('w3'))?.heldBack === true, 'Held back');
    const listed = (await runBridgeTool('wh_list_writings', { projectId: P })).result as { writings: { id: string; kicker?: string; heldBack?: boolean }[] };
    assert(listed.writings.find((w) => w.id === 'w2')?.kicker === 'Prólogo' && listed.writings.find((w) => w.id === 'w3')?.heldBack === true, 'wh_list_writings tells the kicker and held back');
    const all = await db.writings.where('projectId').equals(P).toArray();
    const profile = { id: 'p', projectId: P, name: 'Libro', format: 'markdown', includeTitlePage: false, includeSynopsis: false, includeBibliography: false, citationStyle: 'apa', selectionMode: 'all', selectedWritingIds: [], createdAt: 1, updatedAt: 1 } as unknown as PublishingProfile;
    const book = resolvePublishingWritings(all, profile).writings.map((w) => w.id);
    assert(!book.includes('w3') && book.includes('w2') && book.includes('loose'), `The whole book leaves the held-back chapter out: ${book}`);
    const chosen = resolvePublishingWritings(all, { ...profile, selectionMode: 'selected', selectedWritingIds: ['w3'] } as PublishingProfile).writings.map((w) => w.id);
    assert(chosen.join() === 'w3', 'A chosen selection is taken as made');
    const doc = composePublishingDocument([(await db.writings.get('w2'))!, (await db.writings.get('w1'))!], { projectTitle: 'Libro', includeTitlePage: false, includeSynopsis: false, chapterLabel: 'Capítulo', locale: 'es' } as never);
    assert(doc.sections[0].title === 'Prólogo — Dos' && /^Capítulo \d+ — Uno$/.test(doc.sections[1].title), `Headings: ${doc.sections.map((x) => x.title).join(' / ')}`);
    const cleared = await runBridgeTool('wh_update_writing', { projectId: P, id: 'w2', kicker: '' });
    assert(cleared.ok && (await db.writings.get('w2'))?.kicker === undefined, 'An empty kicker takes it off');
    return [
      'A chapter can carry a kicker read in place of its number ("Prólogo — Dos" in the book) and be held back from the book: a whole-book profile leaves it out, a chosen selection is taken as made; wh_update_writing sets and clears both and wh_list_writings tells them',
      'A chapter dragged to a place takes it and the others move along; the numbers already in the book are dealt along the new order, gaps kept; a drop where it is, an unnumbered writing or an unknown id change nothing',
      'Bridge: wh_move_chapter puts a chapter at a position, before another, or one place down; refuses an unnumbered writing, two ways at once and an unnumbered target; undo puts every renumbered chapter back',
    ];
  } finally {
    await db.writings.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
