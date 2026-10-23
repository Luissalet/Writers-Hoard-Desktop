import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { readWorldDocument } from '@/services/worldEras/store';
import { captureWikiSnapshot, wikiSource } from '@/services/wikiProfiles/snapshot';
import { buildWorldWiki, loadWorldWikiData } from '@/services/worldWikiExport';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
export async function reviewNotesRich(): Promise<string[]> {
  const P = 'review-notes-rich', png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const call = async (tool: string, args: Record<string, unknown>) => { const reply = await runBridgeTool(tool, { projectId: P, ...args }); assert(reply.ok, JSON.stringify(reply)); return reply.result as Record<string, unknown>; };
  try {
    await db.projects.put({ id: P, title: 'Independent notes', description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#888888', enabledEngines: ['notes'], createdAt: 1, updatedAt: 1, worldEras: [{ id: 'past', name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 }] });
    const created = await call('wh_create_note', { text: 'fallback', richHtml: '<h2>Saved rich</h2><p>First<br>Second</p>', title: 'Keep title', source: 'Keep source' }), id = created.id as string;
    const original = (await db.notes.get(id))!;
    const clear = await call('wh_update_note', { id, richHtml: null });
    const plain = (await db.notes.get(id))!;
    assert(plain.richHtml === undefined && plain.text === 'Saved rich\nFirst\nSecond' && plain.title === original.title, 'Null rich update lost existing projection or metadata');
    await call('wh_update_note', { id, pinned: true });
    assert((await db.notes.get(id))?.richHtml === undefined, 'Metadata after null recreated formatting');
    await undoAuditEntry({ entry: { ...(clear.__audit as object), kind: 'update', tool: 'wh_update_note' } });
    const restored = (await db.notes.get(id))!;
    assert(restored.richHtml === original.richHtml && restored.text === original.text, 'Undo null did not restore rich/plain pair');
    const base = JSON.stringify(restored);
    await call('wh_update_note', { id, eraId: 'past', richHtml: '<h3>Past rich</h3><p>Past body</p>' });
    const changed = await call('wh_update_note', { id, eraId: 'past', text: 'Past plain replacement' });
    const scope = { projectId: P, eraId: 'past' };
    assert((await readWorldDocument(scope, 'notes', id))?.document.root.richHtml === undefined, 'Era plain replacement retained stale HTML');
    await undoAuditEntry({ entry: { ...(changed.__audit as object), eraId: 'past', kind: 'update', tool: 'wh_update_note' } });
    const past = (await readWorldDocument(scope, 'notes', id))!.document.root;
    assert(past.richHtml === '<h3>Past rich</h3><p>Past body</p>' && past.text === 'Past rich\nPast body' && JSON.stringify(await db.notes.get(id)) === base, 'Era Undo did not restore paired content independently of Base');

    // Simulate an imported row bypassing the write helper, with cached atoms
    // and authored HTML that must never turn into a published capability.
    const raw = `<h6>Imported heading</h6><p>Visible</p><img src="${png}"><img src="https://example.invalid/private.png"><script>ACTIVE_SECRET</script><iframe src="https://example.invalid/">FRAME_SECRET</iframe><section data-wh-wiki-hidden="true">HIDDEN_SECRET</section><span data-wh-wiki-spoiler="true">SPOILER_SECRET</span><figure data-wh-tool-block="true" data-project-id="foreign"><figcaption>FOREIGN_CACHE_SECRET</figcaption></figure><figure data-wh-source-block="true">SOURCE_CACHE_SECRET</figure>`;
    await db.notes.put({ ...restored, richHtml: raw });
    const before = JSON.stringify(await db.notes.get(id));
    const source = wikiSource(await captureWikiSnapshot({ projectId: P })), options = { locale: 'en' as const, types: [], includeMaps: false, additionalDocuments: [{ kind: 'notes' as const, id }] };
    db.close();
    try {
      const html = buildWorldWiki(await loadWorldWikiData(P, options, source), options).html;
      const document = new DOMParser().parseFromString(html, 'text/html'), content = document.querySelector('#wiki')!;
      assert(content.querySelector('h6')?.textContent === 'Imported heading' && content.querySelector('img')?.getAttribute('src') === png, 'Safe heading or local raster was lost');
      assert(!/ACTIVE_SECRET|FRAME_SECRET|HIDDEN_SECRET|SPOILER_SECRET|FOREIGN_CACHE_SECRET|SOURCE_CACHE_SECRET|private.png/.test(content.innerHTML) && !content.querySelector('script,iframe'), 'Imported note exposed active/private/cache content');
      const without = { ...options, includeImages: false }, noImages = buildWorldWiki(await loadWorldWikiData(P, without, source), without).html;
      assert(!new DOMParser().parseFromString(noImages, 'text/html').querySelector('#wiki img'), 'Image-off retained imported inline raster');
    } finally { await db.open(); }
    assert(JSON.stringify(await db.notes.get(id)) === before, 'Readonly sanitized captured export rewrote imported row');
    return ['MCP richHtml:null retains text; metadata/Undo restore rich pair; era plain replacement and Undo preserve Base', 'Imported rich note exports from closed-DB capture with safe h6/raster only, no active/private/cache leakage, images-off honored and no read migration'];
  } finally { if (!db.isOpen()) await db.open(); if (await db.projects.get(P)) await deleteProject(P); }
}
