// Fixes from the independent review of the reveal / player view, assets library, ePub / PDF import and
// compression work. One PASS line per finding; every assertion fails on the code as it was before.
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import JSZip from 'jszip';
import '@/engines';
import '@/services/aiBridge/dispatch';
import { db } from '@/db';
import CodexEngine from '@/engines/codex/CodexEngine';
import WikiExportControl from '@/engines/codex/WikiExportControl';
import AssetsLibrary from '@/components/project/AssetsLibrary';
import { playerHiddenFields, playerSafeHtml, playerVisibleEntries } from '@/engines/codex/playerView';
import { buildWorldWiki, loadWorldWikiData } from '@/services/worldWikiExport';
import { findAssetUsage } from '@/services/assetsLibrary/usage';
import { listProjectAssets } from '@/services/assetsLibrary/catalog';
import { importLocalMedia } from '@/engines/media/operations';
import { parseEpubBlocks, MAX_EPUB_CHAPTERS, MAX_EPUB_CHARACTERS } from '@/engines/writings/manuscriptEpub';
import { parsePdfBlocks, MAX_PDF_PAGES } from '@/engines/writings/manuscriptPdf';
import { ManuscriptImportError, MAX_TOTAL_BYTES } from '@/engines/writings/manuscriptImport';
import { readFolderSources } from '@/services/worldFolderImport/paths';
import { pastedFolderFiles, MAX_PASTED_FILES } from '@/services/worldFolderImport/pasted';
import { readZipEntryBytes, ZipLimitError } from '@/services/zipEntryLimits';
import { base64FromBytes } from '@/services/documents/client';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { useLocaleStore } from '@/stores/localeStore';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { buildCompressArgs, appendBoundedStderr, COMPRESS_TIMEOUT_MS, FFMPEG_STDERR_LIMIT } from '../electron/media/compressArgs';
import type { CodexEntry, InspirationImage, Project, Timeline, TimelineEvent, WorldMap } from '@/types';
import type { LibraryAsset } from '@/services/assetsLibrary/catalog';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
const P = 'review-1095d2b', P8 = 'review-1095d2b-wiki', PA = 'review-1095d2b-assets', PI = 'review-1095d2b-import';
const ids = [P, P8, PA, PI];

const card = (project: string, id: string, title: string, extra: Partial<CodexEntry> = {}): CodexEntry => ({ id: `${project}-${id}`, projectId: project, type: 'character', title, fields: {}, content: `<p>${title} public line.</p>`, tags: [], relations: [], createdAt: 10, updatedAt: 10, ...extra });
const project = (id: string, extra: Partial<Project> = {}): Project => ({ id, title: id, description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#c4973b', enabledEngines: ['codex', 'writings', 'timeline', 'gallery'], engineOrder: ['codex', 'writings'], createdAt: 1, updatedAt: 1, ...extra }) as Project;
const bytes = (text: string) => new TextEncoder().encode(text);

async function cleanup() {
  for (const id of ids) {
    await db.codexEntries.where('projectId').equals(id).delete();
    await db.worldMaps.where('projectId').equals(id).delete();
    await db.timelineEvents.where('projectId').equals(id).delete();
    await db.timelines.where('projectId').equals(id).delete();
    await db.diaryEntries.where('projectId').equals(id).delete();
    await db.boardNodes.where('projectId').equals(id).delete();
    await db.imageRecipes.where('projectId').equals(id).delete();
    await db.visualRefs.where('projectId').equals(id).delete();
    await db.inspirationImages.where('projectId').equals(id).delete();
    await db.localMediaAssets.where('projectId').equals(id).delete();
    await db.writings.where('projectId').equals(id).delete();
    await db.projects.delete(id);
  }
}

/** An ePub whose chapter files are given as [path, xhtml body, spineRepeats]. */
async function epub(chapters: Array<{ id: string; body: string; repeat?: number }>, extra: Record<string, string | Uint8Array> = {}): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const manifest = chapters.map(chapter => `<item id="${chapter.id}" href="${chapter.id}.xhtml" media-type="application/xhtml+xml"/>`).join('');
  const spine = chapters.map(chapter => `<itemref idref="${chapter.id}"/>`.repeat(chapter.repeat ?? 1)).join('');
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:x</dc:identifier><dc:title>Book</dc:title></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`);
  const page = (inner: string) => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>${inner}</body></html>`;
  for (const chapter of chapters) zip.file(`OEBPS/${chapter.id}.xhtml`, page(chapter.body));
  for (const [path, data] of Object.entries(extra)) zip.file(path, data);
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 1 } });
}

/** Count (and optionally keep) every call that inflates a zip entry, by entry name. */
function spyOnInflate(): { calls: string[]; restore: () => void } {
  const sample = new JSZip().file('probe.txt', 'x').file('probe.txt')!;
  const proto = Object.getPrototypeOf(sample) as { internalStream: (...args: unknown[]) => unknown };
  const original = proto.internalStream, calls: string[] = [];
  proto.internalStream = function (this: { name: string }, ...args: unknown[]) { calls.push(this.name); return original.apply(this, args); };
  return { calls, restore: () => { proto.internalStream = original; } };
}

export async function testReview1095d2b(): Promise<string[]> {
  const passed: string[] = [], host = document.getElementById('root'); assert(host, 'Missing root');
  const root = createRoot(host);
  useLocaleStore.setState({ locale: 'en', loaded: true });
  const render = async (node: React.ReactNode) => { await act(async () => { root.render(<StrictMode><MemoryRouter>{node}</MemoryRouter></StrictMode>); await pause(150); }); await act(async () => { await pause(); }); };
  const until = async (check: () => unknown | Promise<unknown>, label: string, tries = 120) => { for (let i = 0; i < tries; i++) { if (await check()) return; await act(async () => { await pause(50); }); } throw new Error('Timed out: ' + label); };
  const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const qa = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
  const click = async (element: Element | null | undefined, label: string) => { assert(element, 'Missing ' + label); await act(async () => { (element as HTMLElement).click(); await pause(); }); await act(async () => { await pause(); }); };
  const type = async (input: HTMLInputElement | null, value: string) => { assert(input, 'Missing input'); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); await pause(80); }); };
  const titles = () => qa('codex-card').map(node => node.querySelector('h3')?.textContent ?? '').sort();
  try {
    await cleanup();

    // ---- 1. Timelines in a revealed-only wiki -------------------------------------------------------------------
    {
      const T = `${P}-t`;
      await db.projects.put(project(P));
      await db.codexEntries.bulkPut([card(P, 'pub', 'Open Ally', { revealed: { at: 5 } }), card(P, 'secret', 'Unrevealed Secret Title')]);
      await db.timelines.put({ id: T, projectId: P, title: 'Chronicle', color: '#aa5533', createdAt: 1, updatedAt: 1 } satisfies Timeline);
      const ev = (id: string, title: string, order: number, extra: Partial<TimelineEvent> = {}): TimelineEvent => ({ id: `${P}-${id}`, projectId: P, timelineId: T, title, description: `${title} text`, date: `Year ${order}`, dateMode: 'text', eventType: 'point', order, lane: '', color: '#aa5533', createdAt: 1, updatedAt: 1, ...extra });
      await db.timelineEvents.bulkPut([
        ev('free', 'FREEEVENT', 0, { tags: ['freetag'] }),
        ev('pub', 'PUBEVENT', 1, { tags: ['pubtag'], linkedEntryIds: [`${P}-pub`], linkedEntryId: `${P}-pub` }),
        ev('sec', 'SECEVENT', 2, { tags: ['sectag'], linkedEntryIds: [`${P}-secret`], linkedEntryId: `${P}-secret` }),
        ev('mixed', 'MIXEDEVENT', 3, { tags: ['mixedtag'], linkedEntryIds: [`${P}-pub`, `${P}-secret`] }),
      ]);
      const options = { locale: 'en' as const, includeTimelines: true, onlyRevealed: true };
      const revealed = buildWorldWiki(await loadWorldWikiData(P, options), options).html;
      assert(revealed.includes('PUBEVENT') && revealed.includes('pubtag'), 'The event tied to a revealed card is published');
      for (const secret of ['FREEEVENT', 'freetag', 'SECEVENT', 'sectag', 'MIXEDEVENT', 'mixedtag', 'SECEVENT text']) assert(!revealed.includes(secret), `Revealed-only wiki must not publish "${secret}"`);
      const open = { locale: 'en' as const, includeTimelines: true };
      const all = buildWorldWiki(await loadWorldWikiData(P, open), open).html;
      assert(['FREEEVENT', 'PUBEVENT', 'SECEVENT', 'MIXEDEVENT', 'freetag', 'sectag', 'mixedtag'].every(text => all.includes(text)), 'Without onlyRevealed every event still shows');
      passed.push('Wiki, revealed only: timelines publish only events tied to at least one card with every tied card admitted; unlinked, secret and mixed events and their tags (also in the tag filter) stay out; without the policy nothing changes');
    }

    // ---- 2, 5, 6. Player view: blocks, search, profile rules -----------------------------------------------------
    {
      const block = (entry: string, label: string) => `<aside data-wh-codex-block="true" data-project-id="${P}" data-entry-id="${P}-${entry}" data-label="${label}"><p>Codex: ${label}</p></aside>`;
      const content = `<p>Public body.</p><p data-wh-wiki-hidden="true">HIDDENBODYTEXT</p>${block('secret', 'Unrevealed Secret Title')}${block('pub', 'Open Ally')}`
        + `<figure data-wh-tool-block="true" data-project-id="${P}" data-tool-kind="map" data-document-id="m1" data-label="Secret Map Label"><figcaption>Secret Map Label</figcaption></figure>`
        + `<figure data-wh-source-block="true" data-wh-tool-block="true" data-project-id="${P}" data-tool-kind="source" data-document-id="s1"><figcaption>Secret Source Label</figcaption></figure>`;
      const profile = (id: string, options: Project['wikiOptions']) => ({ id, name: id, revision: 1, createdAt: 1, updatedAt: 1, options: options! });
      await db.projects.put(project(P, {
        wikiOptions: { excludedFields: ['hiddenfield'] },
        wikiProfiles: [profile('players', { onlyRevealed: true, excludedFields: ['profilefield'], excludedEntryIds: [`${P}-profhide`] }), profile('site', { excludedFields: ['role'], excludedEntryIds: [`${P}-pub`] })],
      }));
      await db.codexEntries.bulkPut([
        card(P, 'host', 'Visible Host', { revealed: { at: 5 }, fields: { aliases: 'Mistborn', hiddenfield: 'HIDDENFIELDVAL', profilefield: 'PROFFIELDVAL', role: 'Warden' }, content }),
        card(P, 'profhide', 'Profile Hidden Card', { revealed: { at: 5 } }),
      ]);
      const stored = (await db.projects.get(P))!;

      // 2. The pure body filter.
      const safe = playerSafeHtml(content, new Set([`${P}-pub`]));
      assert(safe.includes('Open Ally') && safe.includes('Public body'), 'A Codex block of a revealed card stays');
      for (const secret of ['Unrevealed Secret Title', 'Secret Map Label', 'Secret Source Label', 'HIDDENBODYTEXT']) assert(!safe.includes(secret), `Player-safe body must not carry "${secret}"`);
      assert(!playerSafeHtml(content).includes('Open Ally'), 'Without the revealed set no Codex block stays');
      passed.push('Player view body: Codex blocks of cards that are not revealed, tool blocks and source blocks (their labels name hidden things) are removed; blocks of revealed cards stay');

      // 6. The rules: project options plus the profiles that publish for players.
      assert(playerHiddenFields(stored).has('hiddenfield') && playerHiddenFields(stored).has('profilefield') && !playerHiddenFields(stored).has('role'), 'Hidden fields: project options and player profiles, not the open profile');
      const visible = playerVisibleEntries(await db.codexEntries.where('projectId').equals(P).toArray(), stored.codexTemplates, stored).map(entry => entry.id).sort();
      assert(visible.join() === [`${P}-host`, `${P}-pub`].sort().join(), 'Visible cards: ' + visible);
      assert(playerHiddenFields(stored, 'site').has('role') && !playerHiddenFields(stored, 'site').has('profilefield'), 'A chosen profile replaces the automatic player profiles');
      passed.push('Player view rules: the hidden fields and excluded cards are the union of the project preferences and the saved profiles that publish only revealed cards (a profile id picks one profile instead); profiles for other audiences do not apply');

      // UI: list, card and search.
      await render(<CodexEngine projectId={P} />);
      await until(() => titles().length >= 4, 'cards listed');
      await type(q('codex-search') as HTMLInputElement, 'Mistborn');
      assert(titles().join() === 'Visible Host', 'The author finds a card by alias: ' + titles());
      await type(q('codex-search') as HTMLInputElement, '');
      await click(q('codex-player-view'), 'player view on');
      await until(() => titles().join() === 'Open Ally,Visible Host', 'player list honours the profile exclusions: ' + titles());
      const probes: Array<[string, string[]]> = [['Mistborn', []], ['HIDDENFIELDVAL', []], ['PROFFIELDVAL', []], ['HIDDENBODYTEXT', []], ['Unrevealed Secret', []], ['Secret Map', []], ['Warden', ['Visible Host']], ['Public body', ['Visible Host']]];
      for (const [text, expected] of probes) {
        await type(q('codex-search') as HTMLInputElement, text);
        assert(titles().join() === expected.join(), `Player search for "${text}" gave [${titles()}]`);
      }
      await type(q('codex-search') as HTMLInputElement, '');
      await click(qa('codex-card').find(node => node.dataset.entryId === `${P}-host`), 'host card in player view');
      await until(() => q('codex-player-card'), 'player card');
      const dialog = document.querySelector('[role="dialog"]')!.textContent!;
      assert(dialog.includes('Public body') && dialog.includes('Warden') && dialog.includes('Open Ally'), 'Player card shows the public text, field and the revealed block');
      for (const secret of ['Unrevealed Secret Title', 'Secret Map Label', 'Secret Source Label', 'HIDDENBODYTEXT', 'HIDDENFIELDVAL', 'PROFFIELDVAL', 'Mistborn']) assert(!dialog.includes(secret), `Player card must not show "${secret}"`);
      await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await pause(150); });
      passed.push('Player view search reads only player-safe text: no aliases, no excluded fields (project or player profile), no wiki-hidden body text, no labels of hidden blocks; the card dialog shows none of them either; the author search is unchanged');
    }

    // ---- 3. Where an asset is used --------------------------------------------------------------------------------
    {
      const flag = (id: string, kind: string) => `<figure data-wh-media-block="true" data-project-id="${PA}" data-asset-id="${id}" data-label="x"><figcaption>${kind}</figcaption></figure>`;
      await db.projects.put(project(PA));
      const media = async (name: string) => (await importLocalMedia(PA, new File([new Uint8Array(1024)], `${name}.mp3`, { type: 'audio/mpeg' }))).id;
      const [inCodex, inDiary, inBoard, chapterAudio, cueAudio, editionAudio, editionBody, unused] = [await media('codex'), await media('diary'), await media('board'), await media('chapter'), await media('cue'), await media('editionaudio'), await media('editionbody'), await media('unused')];
      const model = (id: string) => `<figure data-wh-tool-block="true" data-project-id="${PA}" data-tool-kind="model-viewer" data-document-id="${id}" data-label="m"><figcaption>m</figcaption></figure>`;
      const image = (id: string, data: string): InspirationImage => ({ id, projectId: PA, imageData: data, notes: id, tags: [], createdAt: 1 } as InspirationImage);
      await db.projects.update(PA, {
        readerPresentation: { revision: 1, cover: { style: 'paper', color: '#fff', texture: 'none', artwork: false, showAtStart: false }, chapters: { w1: { font: 'inherit', background: '', imageLayout: 'none', mode: 'flow', audio: { assetId: chapterAudio, volume: 1, loop: true }, paragraphAudio: [{ paragraphIndex: 0, fingerprint: 'f', excerpt: 'e', track: { assetId: cueAudio, volume: 1, loop: false } }] } } },
        publishedEditions: [{ id: 'ed1', projectId: PA, title: 'First edition', publishedAt: 1, locale: 'en', sourceProjectTitle: 'x', sourceFingerprint: 'f', chapters: [{ sourceUpdatedAt: 1, writing: { id: 'w9', projectId: PA, title: 'Ch', content: flag(editionBody, 'edition') } }], presentation: { revision: 1, cover: { style: 'paper', color: '#fff', texture: 'none', artwork: false, showAtStart: false }, chapters: { w9: { font: 'inherit', background: '', imageLayout: 'none', mode: 'flow', audio: { assetId: editionAudio, volume: 1, loop: false } } } }, reader: { html: '', filename: 'x.html', sha256: 'x' } }] as unknown as Project['publishedEditions'],
      });
      await db.codexEntries.put(card(PA, 'c', 'Host card', { content: flag(inCodex, 'codex') + model('model-in-codex') }));
      await db.diaryEntries.put({ id: `${PA}-d`, projectId: PA, entryDate: '2026-01-01T10:00', title: 'Day', content: flag(inDiary, 'diary'), tags: [], pinned: false, createdAt: 1, updatedAt: 1 });
      await db.boardNodes.put({ id: `${PA}-n`, projectId: PA, boardId: 'b', kind: 'text', title: 'Note', content: '', richContent: flag(inBoard, 'board'), x: 0, y: 0, width: 10, height: 10, createdAt: 1, updatedAt: 1 } as never);
      await db.inspirationImages.bulkPut([image('src-init', 'data:image/png;base64,AAAA'), image('src-ref', 'data:image/png;base64,BBBB'), image('src-mask', 'data:image/png;base64,CCCC'), image('src-lora', 'data:image/png;base64,DDDD'), image('src-free', 'data:image/png;base64,EEEE'), image('made', 'data:image/png;base64,FFFF')]);
      await db.imageRecipes.put({ id: 'rec1', projectId: PA, imageId: 'made', inputs: { initImage: { imageId: 'src-init' }, maskImage: { imageId: 'src-mask' }, refImages: [{ imageId: 'src-ref' }] }, createdAt: 1 } as never);
      await db.visualRefs.put({ id: 'vr1', projectId: PA, name: 'Look', kind: 'character', lora: { fileName: 'x.safetensors', weight: 1, baseFamily: 'sdxl', trainedFromImageIds: ['src-lora'] }, createdAt: 1, updatedAt: 1 } as never);

      const assets = await listProjectAssets(PA);
      const find = (id: string): LibraryAsset => { const found = assets.find(asset => asset.id === id); assert(found, 'Asset listed: ' + id); return found; };
      const expect = async (id: string, kind: string) => { const places = await findAssetUsage(PA, find(id)); assert(places.some(place => place.kind === kind), `Asset ${id} should be in use as ${kind}, got [${places.map(place => place.kind)}]`); };
      await expect(inCodex, 'codex-block'); await expect(inDiary, 'diary-block'); await expect(inBoard, 'board-text');
      await expect(chapterAudio, 'reader-audio'); await expect(cueAudio, 'reader-audio');
      await expect(editionAudio, 'published-edition'); await expect(editionBody, 'published-edition');
      for (const image of ['src-init', 'src-ref', 'src-mask']) await expect(image, 'image-recipe');
      await expect('src-lora', 'visual-ref');
      const modelPlaces = await findAssetUsage(PA, { id: 'model-in-codex', kind: 'model', store: 'model', name: 'm', size: 1, createdAt: 1 } as LibraryAsset);
      assert(modelPlaces.some(place => place.kind === 'codex-block'), 'A 3D model shown in a Codex card is in use');
      assert((await findAssetUsage(PA, find(unused))).length === 0 && (await findAssetUsage(PA, find('src-free'))).length === 0, 'Unreferenced files report no use');
      passed.push('Assets library usage: sounds in Codex, diary and board text, reader chapter audio and paragraph cues, published editions (presentation and chapters), 3D models in Codex cards, and pictures kept as recipe inputs or as the source of a LoRA are all reported before a delete; an unused file reports nothing');
    }

    // ---- 4. Zip bombs, repeated spine, caps -----------------------------------------------------------------------
    {
      // Declared size is refused before anything is inflated.
      const spy = spyOnInflate();
      try {
        const big = 'a'.repeat(40 * 1024 * 1024);
        const bomb = await epub([{ id: 'ch1', body: '<p>fine</p>' }, { id: 'ch2', body: `<p>${big}</p>` }]);
        let refused: unknown;
        try { await parseEpubBlocks(bomb); } catch (error) { refused = error; }
        assert(refused instanceof ManuscriptImportError && refused.code === 'too-large', 'An entry that inflates past the cap is refused: ' + String(refused));
        assert(!spy.calls.includes('OEBPS/ch2.xhtml'), 'The oversized entry was never inflated (calls: ' + spy.calls.join() + ')');
      } finally { spy.restore(); }
      // A header that lies about the size is stopped by the running count.
      const lying = await JSZip.loadAsync(await new JSZip().file('lie.bin', new Uint8Array(6 * 1024 * 1024)).generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' }));
      const entry = lying.file('lie.bin')!;
      (entry as unknown as { _data: { uncompressedSize: number } })._data.uncompressedSize = 1;
      let stopped: unknown;
      try { await readZipEntryBytes(entry, 1024 * 1024); } catch (error) { stopped = error; }
      assert(stopped instanceof ZipLimitError, 'The running count stops an entry that outgrows its declared size: ' + String(stopped));
      // The same file listed over and over in the spine is read once.
      const repeated = await parseEpubBlocks(await epub([{ id: 'one', body: '<h1>One</h1><p>Only once please.</p>', repeat: 50 }, { id: 'two', body: '<h1>Two</h1><p>Second.</p>' }]));
      assert(repeated.blocks.filter(block => block.text === 'Only once please.').length === 1, 'Repeated itemrefs add the chapter once, got ' + repeated.blocks.filter(block => block.text === 'Only once please.').length);
      // Caps on chapters and on characters.
      const many = await epub(Array.from({ length: MAX_EPUB_CHAPTERS + 1 }, (_, index) => ({ id: `c${index}`, body: `<p>Chapter ${index}</p>` })));
      let tooMany: unknown;
      try { await parseEpubBlocks(many); } catch (error) { tooMany = error; }
      assert(tooMany instanceof ManuscriptImportError && tooMany.code === 'too-large', 'More chapter files than the cap are refused');
      const paragraph = `<p>${'word '.repeat(20000)}</p>`;
      const heavy = await epub(Array.from({ length: Math.ceil(MAX_EPUB_CHARACTERS / 800000) + 4 }, (_, index) => ({ id: `h${index}`, body: paragraph.repeat(8) })));
      let tooLong: unknown;
      try { await parseEpubBlocks(heavy); } catch (error) { tooLong = error; }
      assert(tooLong instanceof ManuscriptImportError && tooLong.code === 'too-large', 'More text than the cap is refused: ' + String(tooLong));
      passed.push('ePub: an entry whose declared size passes the cap is never inflated; an entry that outgrows its declared size is cut by the running count; a spine that repeats a file reads it once; too many chapter files or too much text is refused');

      // Folder import: ZIPs inflate one entry at a time under the same checks.
      const zip = new JSZip();
      zip.file('a-small.md', '# Small\n\nBody.');
      zip.file('b-bomb.bin', new Uint8Array(60 * 1024 * 1024));
      zip.file('c-after.md', '# After\n\nBody.');
      const archive = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 1 } });
      const folderSpy = spyOnInflate();
      let folderError = '';
      try { await readFolderSources([{ path: 'pack.zip', dataBase64: base64FromBytes(archive) }]); } catch (error) { folderError = error instanceof Error ? error.message : String(error); } finally { folderSpy.restore(); }
      assert(/world_folder_zip_too_large:b-bomb\.bin/.test(folderError), 'The oversized entry is refused: ' + folderError);
      assert(folderSpy.calls.join() === 'a-small.md', 'Only the entries before the refused one were inflated, in order: ' + folderSpy.calls.join());
      passed.push('Folder import: ZIP entries are inflated one at a time with a size check first; a bomb stops the import before the entries after it are touched');
    }

    // ---- 7. Compression ------------------------------------------------------------------------------------------
    {
      const audio = buildCompressArgs({ kind: 'audio', preset: 'balanced', inPath: 'in', outPath: 'out' }), video = buildCompressArgs({ kind: 'video', preset: 'small', inPath: 'in', outPath: 'out' });
      for (const args of [audio, video]) assert(args.slice(0, 3).join(' ') === '-nostats -loglevel error', 'ffmpeg runs quiet: ' + args.slice(0, 3));
      assert(video.includes('-sn') && !audio.includes('-sn'), 'Video drops subtitle streams');
      assert(COMPRESS_TIMEOUT_MS === 10 * 60 * 1000, 'Compression has a 10 minute timeout');
      let tail = '';
      for (let i = 0; i < 10000; i++) tail = appendBoundedStderr(tail, 'frame=1234 speed=1x\n');
      assert(tail.length <= FFMPEG_STDERR_LIMIT && tail.endsWith('speed=1x\n'), 'The error output is bounded and keeps the end');
      // The panel cancels a running compression when it goes away.
      const holder = window as unknown as { electronAPI?: { media?: Record<string, unknown> } };
      const previous = holder.electronAPI?.media ? { ...holder.electronAPI.media } : null, hadApi = !!holder.electronAPI;
      const started: string[] = [], cancelled: string[] = [];
      const fake = { compressAsset: (args: { requestId: string }) => { started.push(args.requestId); return new Promise(() => undefined); }, cancelCompress: async (id: string) => { cancelled.push(id); return true; } };
      if (holder.electronAPI?.media) Object.assign(holder.electronAPI.media, fake); else (window as unknown as { electronAPI: unknown }).electronAPI = { media: fake };
      try {
        await db.projects.put(project(PA));
        await importLocalMedia(PA, new File([new Uint8Array(9 * 1024 * 1024)], 'Hang.mp3', { type: 'audio/mpeg' }));
        await render(<AssetsLibrary projectId={PA} />);
        await until(() => q('assets-compress'), 'Comprimir offered');
        await click(q('assets-compress'), 'open compress');
        await click(q('assets-compress-start'), 'start');
        await until(() => started.length === 1, 'compression started');
        await render(<></>);
        await until(() => cancelled.length === 1, 'cancelled on unmount');
        assert(cancelled[0] === started[0], 'The running request is the one cancelled');
      } finally {
        if (previous && holder.electronAPI?.media) { for (const key of ['compressAsset', 'cancelCompress']) { if (key in previous) holder.electronAPI.media[key] = previous[key]; else delete holder.electronAPI.media[key]; } }
        else if (!hadApi) delete (window as unknown as { electronAPI?: unknown }).electronAPI;
      }
      passed.push('Compression: ffmpeg runs with -nostats -loglevel error, video with -sn, a 10 minute timeout and a bounded error buffer; closing the assets panel cancels the running job (the main process also releases its slot when the temp folder cannot be made and accepts one job at a time)');
    }

    // ---- 8. Export settings validity -----------------------------------------------------------------------------
    {
      await db.projects.put(project(P8));
      await db.codexEntries.put(card(P8, 'hidden', 'Not yet'));
      await db.worldMaps.put({ id: `${P8}-map`, projectId: P8, title: 'Sea chart', createdAt: 1, updatedAt: 1 } as WorldMap);
      const panel = async () => { await render(<WikiExportControl projectId={P8} entries={await db.codexEntries.where('projectId').equals(P8).toArray()} />); };
      await panel();
      await until(() => document.querySelector('summary'), 'export panel');
      await click(document.querySelector('summary'), 'open the export panel');
      assert(!(q('wiki-download') as HTMLButtonElement).disabled, 'A map alone is enough while everything is published');
      await click(q('wiki-only-revealed'), 'only revealed');
      assert((q('wiki-download') as HTMLButtonElement).disabled && (q('wiki-preview') as HTMLButtonElement).disabled, 'Revealed-only with nothing revealed: maps are left out, so publishing is disabled');
      await db.codexEntries.update(`${P8}-hidden`, { revealed: { at: 9 } });
      await act(async () => { notifyDataChanged({ source: 'other', projectId: P8, table: 'codexEntries' }); await pause(200); });
      await panel();
      await until(() => q('wiki-only-revealed') && !(q('wiki-download') as HTMLButtonElement).disabled, 'enabled once a card is revealed');
      passed.push('Export settings: with "only revealed" the maps no longer count, so publishing is disabled until a card is revealed');
    }

    // ---- 9. Import budgets ----------------------------------------------------------------------------------------
    {
      await db.projects.put(project(PI));
      const scope = { projectId: PI };
      const call = (name: string, args: Record<string, unknown>) => runBridgeTool(name, args) as Promise<{ ok: boolean; result?: any; error?: string }>;
      const tooMany = await call('wh_manuscript_import_inspect', { ...scope, pasted: Array.from({ length: 201 }, (_, index) => ({ name: `p${index}`, text: `text ${index}` })), split: { mode: 'file' } });
      assert(!tooMany.ok && /Demasiados|máximo/.test(tooMany.error ?? ''), 'More than 200 pasted items are refused: ' + JSON.stringify(tooMany).slice(0, 200));
      const slab = 'x'.repeat(Math.floor(MAX_TOTAL_BYTES / 2.5));
      const heavy = await call('wh_manuscript_import_inspect', { ...scope, pasted: [{ name: 'a', text: slab }, { name: 'b', text: slab }, { name: 'c', text: slab }], split: { mode: 'file' } });
      assert(!heavy.ok && /límite/.test(heavy.error ?? ''), 'Pasted text counts toward the total: ' + JSON.stringify(heavy).slice(0, 200));
      let pasteError = '';
      try { await pastedFolderFiles(Array.from({ length: MAX_PASTED_FILES + 1 }, (_, index) => ({ name: `n${index}`, text: `t${index}` })), new Set(), []); } catch (error) { pasteError = error instanceof Error ? error.message : String(error); }
      assert(pasteError === 'world_folder_pasted_too_many', 'The world import caps pasted pieces: ' + pasteError);
      let totalError = '';
      try { await pastedFolderFiles([{ name: 'a', text: slab }, { name: 'b', text: slab }, { name: 'c', text: slab }], new Set(), []); } catch (error) { totalError = error instanceof Error ? error.message : String(error); }
      assert(totalError === 'world_folder_pasted_too_large', 'The world import counts pasted text in the total: ' + totalError);
      const same = base64FromBytes(bytes('# Twin\n\nThe very same text in two files.'));
      const files = [{ path: 'a.md', dataBase64: same }, { path: 'b.md', dataBase64: same }];
      const both = await call('wh_world_folder_import_preview', { ...scope, format: 'obsidian', files });
      assert(both.ok && both.result.rows.length === 1 && both.result.findings.some((f: { code: string; path: string }) => f.code === 'duplicate_content' && f.path === 'b.md'), 'Identical files: the second is the duplicate');
      const leftOut = await call('wh_world_folder_import_preview', { ...scope, format: 'obsidian', files, decisions: [{ path: 'a.md', include: false }] });
      assert(leftOut.ok && !leftOut.result.findings.some((f: { code: string }) => f.code === 'duplicate_content'), 'Leaving the first twin out must not drop the second: ' + JSON.stringify(leftOut.result?.findings));
      assert(leftOut.result.rows.some((row: { path: string; status: string }) => row.path === 'b.md' && row.status === 'new'), 'The second twin stays in the plan');
      passed.push('Import budgets: pasted text counts toward the 64 MiB total and is capped at 200 pieces (manuscript and world import); excluding the first of two identical files keeps the second in the plan');

      // Letters, not digits: lines that differ only by digits are taken for a running header and dropped.
      const marker = (n: number) => String(n).split('').map(digit => 'qwertzuiop'[Number(digit)]).join('');
      const makePdf = (total: number) => {
        const lines = (n: number) => `BT /F1 12 Tf 72 700 Td (Marker ${marker(n)} sentence one. Two.) Tj ET`;
        const objects: string[] = [];
        const pageIds = Array.from({ length: total }, (_, index) => 4 + index * 2);
        objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${total} >>`;
        objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
        pageIds.forEach((id, index) => { const stream = lines(index + 1); objects[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`; objects[id + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`; });
        let out = '%PDF-1.4\n'; const offsets: number[] = [];
        for (let id = 1; id < objects.length; id++) { if (objects[id] === undefined) continue; offsets[id] = out.length; out += `${id} 0 obj\n${objects[id]}\nendobj\n`; }
        const xref = out.length;
        out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
        for (let id = 1; id < objects.length; id++) out += offsets[id] === undefined ? '0000000000 65535 f \n' : `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
        out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
        return Uint8Array.from(out, char => char.charCodeAt(0));
      };
      const pdfSpy = makePdf(MAX_PDF_PAGES + 1);
      await parsePdfBlocks(makePdf(1)); // sets up the pdf.js worker the way the importer does
      const pdfjs = await import('pdfjs-dist');
      const probeTask = pdfjs.getDocument({ data: new Uint8Array(pdfSpy).slice() });
      const probePage = await (await probeTask.promise).getPage(1);
      const pageProto = Object.getPrototypeOf(probePage) as { cleanup: (...args: unknown[]) => unknown };
      await probeTask.destroy();
      const cleanupOriginal = pageProto.cleanup; let cleaned = 0;
      pageProto.cleanup = function (this: unknown, ...args: unknown[]) { cleaned += 1; return cleanupOriginal.apply(this, args); };
      try {
        const read = await parsePdfBlocks(pdfSpy);
        assert(read.pages === MAX_PDF_PAGES + 1, 'The page total is reported');
        assert(read.notes.some(note => note.code === 'pdf-pages-capped' && note.count === 1), 'A finding says pages were not read: ' + JSON.stringify(read.notes));
        assert(read.blocks.some(block => block.text.includes(`Marker ${marker(MAX_PDF_PAGES)} `)) && !read.blocks.some(block => block.text.includes(`Marker ${marker(MAX_PDF_PAGES + 1)} `)), 'Pages up to the cap are read, none after it');
        assert(cleaned >= MAX_PDF_PAGES, `Each page is released after reading (cleanup calls: ${cleaned})`);
      } finally { pageProto.cleanup = cleanupOriginal; }
      passed.push(`PDF: at most ${MAX_PDF_PAGES} pages are read with a finding for the rest, and each page is cleaned up after it is read`);
    }
  } finally {
    await act(async () => { root.render(<></>); await pause(60); });
    await cleanup();
  }
  return passed;
}
