import Dexie from 'dexie';
import JSZip from 'jszip';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { capturePublishingBatch, encodePublishingBatch } from '@/engines/writings/publishingBatch';
import { currentPublishingLabels, validatePublishingLayout } from '@/services/projectTools';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { getBridgeTool } from '@/services/aiBridge/manifest';
import { SCOPE_KEY } from '@/services/aiBridge/schema';
import { useLocaleStore } from '@/stores/localeStore';
import { defaultReaderPresentation } from '@/engines/writings/readerPresentationTypes';
import type { Project, Writing } from '@/types';
import type { PublishingProfile } from '@/types/projectTools';
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const decode = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

export async function testPublishingBatch(): Promise<string[]> {
  const id = 'qa-c42-batch-' + crypto.randomUUID(), eraId = id + '-era', second = id + '-manuscript';
  const project: Project = { id, title: 'Captured A', author: 'Author A', description: 'C42 owned batch test', mode: 'custom', type: 'standalone', color: '#123456', status: 'draft', enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: 1, updatedAt: 1, readerPresentation: defaultReaderPresentation(), worldEras: [{ id: eraId, name: 'Era', description: '', revision: 0, createdAt: 1, updatedAt: 1 }], manuscriptCatalog: { revision: 0, entries: [{ id: second, title: 'Second A', createdAt: 1, updatedAt: 1 }] } };
  const writing: Writing = { id: id + '-chapter', projectId: id, title: 'Chapter A', content: '<p>Captured persisted prose A.</p>', status: 'draft', tags: [], wordCount: 4, createdAt: 1, updatedAt: 1 };
  const profile: PublishingProfile = { id: id + '-profile', projectId: id, name: 'Batch A', format: 'manuscript', includeCover: false, includeTitlePage: true, includeCopyright: true, includeBibliography: true, includeSynopsis: false, citationStyle: 'apa', selectedWritingIds: [], createdAt: 1, updatedAt: 1 };
  const citation = { id: id + '-citation', projectId: id, title: 'Source A', authors: ['Source author'], accessedAt: '2026-10-26', writingIds: [], tags: [], createdAt: 1, updatedAt: 1 };
  const done: string[] = [], originalLocale = useLocaleStore.getState().locale;
  const sets: string[][] = [];
  let rivalOnRead: (() => void) | undefined;
  const reading = (row: Writing) => { if (row.projectId === id && Dexie.currentTransaction?.mode === 'readonly') { sets.push([...Dexie.currentTransaction.storeNames].sort()); const rival = rivalOnRead; rivalOnRead = undefined; rival?.(); } return row; };
  db.writings.hook('reading', reading);
  try {
    await db.projects.add(project); await db.writings.bulkAdd([writing, { ...writing, id: id + '-held', heldBack: true, content: '<p>Held back sentinel.</p>' }, { ...writing, id: id + '-secondary', manuscriptId: second, title: 'Secondary A', content: '<p>Secondary Base A.</p>' }]);
    await db.citations.add(citation); await db.publishingProfiles.add(profile);
    useLocaleStore.setState({ locale: 'es' });
    const labels = currentPublishingLabels('manuscript');
    const draft = structuredClone(profile);
    const pending = capturePublishingBatch({ projectId: id, profile: draft, generatedAt: Date.UTC(2026, 9, 26), labels });
    draft.name = 'Mutated draft B'; labels.wordLabel = 'MUTATED LABEL B';
    const captured = await pending;
    check(Object.isFrozen(captured) && Object.isFrozen(captured.missingWritingIds), 'Capture metadata must be immutable');
    check(captured.pieces === 1 && captured.title === 'Captured A — Batch A', 'Scope/held-back/draft capture');
    check(sets.some(names => names.length === 7 && !names.includes('publishingProfiles')), 'Inline acquisition must use exactly seven tables');
    await db.transaction('rw', [db.projects, db.writings, db.citations, db.publishingProfiles], async () => {
      await db.projects.update(id, { title: 'Live B', author: 'Author B' });
      await db.writings.update(writing.id, { content: '<p>Live prose B.</p>', title: 'Chapter B' });
      await db.citations.update(citation.id, { title: 'Source B' });
      await db.publishingProfiles.update(profile.id, { name: 'Saved B' });
    });
    useLocaleStore.setState({ locale: 'en' });
    db.close({ disableAutoOpen: true });
    try {
      const files = await encodePublishingBatch(captured, ['html', 'markdown', 'epub', 'docx']);
      check(files.length === 4 && files.every(file => file.status === 'ready' && file.bytes?.length), 'All non-PDF encoders work after DB closes');
      const html = decode(files[0].bytes), md = decode(files[1].bytes);
      check(html.includes('Captured persisted prose A.') && html.includes('Source A') && html.includes('Author A') && !html.includes('Live prose B.') && !html.includes('Held back sentinel.') && !html.includes('Secondary Base A.'), 'HTML snapshot is A');
      check(md.includes('Captured persisted prose A.') && !md.includes('MUTATED LABEL B') && md.includes('palabras'), 'Markdown captured labels');
      for (const file of files.slice(2)) {
        const zip = await JSZip.loadAsync(file.bytes!);
        const text = await zip.file(file.output === 'docx' ? 'word/document.xml' : 'EPUB/section-1.xhtml')?.async('string');
        check(text?.includes('Captured persisted prose A.') && !text.includes('Live prose B.'), file.output + ' did not retain A');
      }
      // Mutating/detaching a returned encoder buffer cannot poison retry.
      const transfer = files[0].bytes!; structuredClone(transfer.buffer, { transfer: [transfer.buffer] });
      const [retry] = await encodePublishingBatch(captured, ['html']);
      check(retry.status === 'ready' && decode(retry.bytes) === html, 'Retry uses owned snapshot after output transfer');
      const incremental: string[] = [];
      const partial = await encodePublishingBatch(captured, ['print-cover', 'html'], { onResult: file => { incremental.push(file.output + ':' + file.status); } });
      check(partial[0].status === 'failed' && partial[0].error === 'print_cover_layout_required' && partial[1].status === 'ready' && decode(partial[1].bytes) === html && incremental.join(',') === 'print-cover:failed,html:ready', 'A real format failure must leave other results ready and notify incrementally');
      const controller = new AbortController(); controller.abort();
      const canceled = await encodePublishingBatch(captured, ['pdf', 'html', 'docx'], { signal: controller.signal });
      check(canceled.every(file => file.status === 'canceled' && !file.bytes), 'Unstarted formats canceled without losing ready results');
      done.push('capture A survives live B, caller/locale mutation, closed DB, output transfer and retry across four real encoders');
    } finally { await db.open(); }
    const saved = await capturePublishingBatch({ projectId: id, profileId: profile.id });
    check(saved.title === 'Live B — Saved B' && sets.some(names => names.length === 8 && names.includes('publishingProfiles')), 'Saved capture recaptures B in exactly eight tables');
    done.push('seven/eight-table readonly acquisition, held-back and manuscript scope');

    await db.transaction('rw', [db.projects, db.writings, db.citations, db.publishingProfiles], async () => {
      await db.projects.update(id, { title: 'Atomic A', author: 'Atomic author A' });
      await db.writings.update(writing.id, { content: '<p>Atomic prose A.</p>' });
      await db.citations.update(citation.id, { title: 'Atomic source A' });
      await db.publishingProfiles.update(profile.id, { name: 'Atomic profile A' });
    });
    let rival: Promise<unknown> | undefined;
    rivalOnRead = () => { rival = Dexie.ignoreTransaction(() => db.transaction('rw', [db.projects, db.writings, db.citations, db.publishingProfiles], async () => {
      await db.projects.update(id, { title: 'Atomic B', author: 'Atomic author B' });
      await db.writings.update(writing.id, { content: '<p>Atomic prose B.</p>' });
      await db.citations.update(citation.id, { title: 'Atomic source B' });
      await db.publishingProfiles.update(profile.id, { name: 'Atomic profile B' });
    })); };
    const atomic = await capturePublishingBatch({ projectId: id, profileId: profile.id });
    check(rival, 'Rival rw was not scheduled inside readonly acquisition'); await rival;
    const [atomicFile] = await encodePublishingBatch(atomic, ['html']);
    const atomicHtml = decode(atomicFile.bytes);
    check(atomic.title === 'Atomic A — Atomic profile A' && ['Atomic prose A.', 'Atomic author A', 'Atomic source A'].every(text => atomicHtml.includes(text)) && !atomicHtml.includes('Atomic prose B.') && (await db.projects.get(id))?.title === 'Atomic B', 'Concurrent rw mixed snapshot tables');
    done.push('rival rw scheduled during acquisition commits B while the readonly capture keeps project/profile/prose/citation A coherent');
    await db.projects.update(id, { title: 'Live B' }); await db.writings.update(writing.id, { content: '<p>Live prose B.</p>' });

    // A real cover decode pauses materialization after acquisition; the DB is
    // then mutated before the canvas/compositor resumes.
    const originalDecode = Image.prototype.decode;
    let paused = false;
    Image.prototype.decode = async function () {
      await originalDecode.call(this);
      if (!paused) { paused = true; await db.transaction('rw', [db.projects, db.writings], async () => { await db.projects.update(id, { title: 'Later C' }); await db.writings.update(writing.id, { content: '<p>Later C.</p>' }); }); }
    };
    let covered;
    try { covered = await capturePublishingBatch({ projectId: id, profile: { ...profile, includeCover: true }, generatedAt: 1 }); } finally { Image.prototype.decode = originalDecode; }
    check(paused, 'Real cover decode gate was not reached');
    db.close({ disableAutoOpen: true });
    try { const [html] = await encodePublishingBatch(covered, ['html']); check(html.status === 'ready' && decode(html.bytes).includes('Live prose B.') && !decode(html.bytes).includes('Later C.') && decode(html.bytes).includes('data:image/png;base64,'), 'Cover A/B materialization reread DB'); } finally { await db.open(); }
    done.push('cover materializes acquired bytes after real decode while rival rw commits; closed-DB encode');

    const secondary = { ...(await db.writings.get(id + '-secondary'))!, manuscriptId: undefined, content: '<p>Secondary era inherited owner.</p>' };
    await db.worldEraVariants.add({ id: id + '-variant', projectId: id, eraId, kind: 'writings', entityId: secondary.id, revision: 1, updatedAt: 2, document: { root: secondary, children: {} } });
    const eraCapture = await capturePublishingBatch({ projectId: id, profile: { ...profile, writingScope: { kind: 'manuscript', id: second }, includeBibliography: false }, eraId });
    const [eraFile] = await encodePublishingBatch(eraCapture, ['html']);
    check(eraCapture.pieces === 1 && eraCapture.title.startsWith('Second A') && decode(eraFile.bytes).includes('Secondary era inherited owner.') && !decode(eraFile.bytes).includes('Later C.'), 'Era inherited structural manuscript owner');
    done.push('era row inherits canonical Base owner while preserving secondary manuscript metadata');

    for (const invalid of [{ marginsMm: { top: 200, bottom: 200, inside: 1, outside: 1 } }, { initialPageNumber: 0 }, { initialPageNumber: 4294967296 }, { marginsMm: { top: -1, bottom: 1, inside: 1, outside: 1 } }]) { let failed = false; try { validatePublishingLayout(invalid); } catch { failed = true; } check(failed, 'Invalid physical geometry accepted'); }
    check(getBridgeTool('wh_publishing_export')?.writes === false && getBridgeTool('wh_publishing_cancel_export')?.writes === false, 'Normal manifest must expose readonly tools');
    const reply = await runBridgeTool('wh_publishing_export', { projectId: id, jobId: id + '-job', profileId: profile.id, outputs: ['html', 'markdown', 'epub', 'docx'] });
    check(reply.ok, 'Normal dispatcher export failed: ' + JSON.stringify(reply));
    const result = reply.result as { files: { status: string; output: string; byteLength: number; base64: string; mime: string; filename: string }[] };
    check(result.files.length === 4 && result.files.every(file => file.status === 'ready' && atob(file.base64).length === file.byteLength && file.mime && file.filename), 'MCP complete bytes schema');
    const draftReply = await runBridgeTool('wh_publishing_export', { projectId: id, jobId: id + '-draft-job', draft: { ...profile, name: 'Inline export' }, outputs: ['html'] });
    check(draftReply.ok && (await db.publishingProfiles.where('projectId').equals(id).count()) === 1, 'MCP draft export must not save');
    const unknown = await runBridgeTool('wh_publishing_cancel_export', { projectId: id, jobId: id + '-job' });
    check(unknown.ok && (unknown.result as { active: boolean }).active === false, 'Completed export must leave no active job');
    const wrongScope = await runBridgeTool('wh_publishing_cancel_export', { projectId: id, jobId: id + '-job', [SCOPE_KEY]: 'another-project' });
    check(!wrongScope.ok && wrongScope.code === 'scope', 'Cancel must use existing scope mechanism');
    const active = runBridgeTool('wh_publishing_export', { projectId: id, jobId: id + '-cancel', profileId: profile.id, outputs: ['html', 'epub'] });
    const duplicate = await runBridgeTool('wh_publishing_export', { projectId: id, jobId: id + '-cancel', profileId: profile.id, outputs: ['html'] });
    check(!duplicate.ok && duplicate.code === 'busy', 'Duplicate active id');
    const cancel = await runBridgeTool('wh_publishing_cancel_export', { projectId: id, jobId: id + '-cancel' });
    check(cancel.ok && (cancel.result as { active: boolean }).active, 'Sibling cancellation did not find active capture');
    const canceled = await active; check(!canceled.ok && canceled.code === 'canceled', 'Canceled call must terminate');
    const cleared = await runBridgeTool('wh_publishing_cancel_export', { projectId: id, jobId: id + '-cancel' });
    check(cleared.ok && !(cleared.result as { active: boolean }).active, 'Canceled export leaked active entry');
    done.push('normal MCP full bytes, draft readonly, declared catalog, scope, duplicate active id, sibling cancel and finally cleanup');
    const decodeBeforePending = Image.prototype.decode;
    let materializing = false, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    Image.prototype.decode = async function () { await decodeBeforePending.call(this); if (!materializing) { materializing = true; await gate; } };
    const materializationJob = id + '-materialization';
    let materialization: ReturnType<typeof runBridgeTool> | undefined;
    try {
      materialization = runBridgeTool('wh_publishing_export', { projectId: id, jobId: materializationJob, draft: { ...profile, includeCover: true }, outputs: ['html'] });
      const until = Date.now() + 10000;
      while (!materializing) { check(Date.now() < until, 'Materialization decode not reached'); await new Promise(resolve => setTimeout(resolve, 10)); }
      const canceled = await runBridgeTool('wh_publishing_cancel_export', { projectId: id, jobId: materializationJob });
      check(canceled.ok && (canceled.result as { active: boolean }).active, 'Materializing job not active');
      const stillBusy = await runBridgeTool('wh_publishing_export', { projectId: id, jobId: materializationJob, profileId: profile.id, outputs: ['html'] });
      check(!stillBusy.ok && stillBusy.code === 'busy', 'Cancel falsely freed an operation still materializing');
      release();
      const ended = await materialization;
      check(!ended.ok && ended.code === 'canceled' && ended.error?.includes('during capture'), 'Common materialization cancellation must report capture stage');
      const absent = await runBridgeTool('wh_publishing_cancel_export', { projectId: id, jobId: materializationJob });
      check(absent.ok && !(absent.result as { active: boolean }).active, 'Materializing job did not clean up finally');
    } finally { release(); Image.prototype.decode = decodeBeforePending; if (materialization) await materialization; }
    done.push('canceled capture keeps jobId busy until its real cover decode unwinds and finally removes it');
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 320;
    const context = canvas.getContext('2d')!, pixels = context.createImageData(320, 320);
    let seed = 0x12345678;
    for (let index = 0; index < pixels.data.length; index += 4) {
      for (let channel = 0; channel < 3; channel++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; pixels.data[index + channel] = seed & 255; }
      pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    const png = canvas.toDataURL('image/png'), expectedPng = Uint8Array.from(atob(png.split(',')[1]), char => char.charCodeAt(0));
    canvas.width = 0; canvas.height = 0;
    await db.writings.update(writing.id, { content: `<p>Complete binary prose.</p><img src="${png}" alt="Captured noise fixture">` });
    const largeReply = await runBridgeTool('wh_publishing_export', { projectId: id, jobId: id + '-large', draft: { ...profile, includeInlineImages: true }, outputs: ['docx', 'epub'] });
    check(largeReply.ok, 'Large binary MCP export');
    const largeFiles = (largeReply.result as { files: { output: string; status: string; byteLength: number; base64: string }[] }).files;
    for (const file of largeFiles) {
      const bytes = Uint8Array.from(atob(file.base64), char => char.charCodeAt(0));
      check(file.status === 'ready' && file.byteLength > 200000 && bytes.length === file.byteLength, file.output + ' binary must remain complete above legacy preview size');
      const zip = await JSZip.loadAsync(bytes), image = Object.keys(zip.files).find(name => /(?:word\/media|EPUB\/images)\//.test(name) && name.endsWith('.png'));
      const actual = image ? await zip.file(image)!.async('uint8array') : undefined;
      check(actual?.length === expectedPng.length && actual.every((value, index) => value === expectedPng[index]), file.output + ' full PNG was truncated/replaced');
    }
    done.push('normal MCP DOCX/EPUB binaries over 200000 bytes retain every byte and their real PNG exactly');
    return done;
  } finally {
    db.writings.hook('reading').unsubscribe(reading);
    useLocaleStore.setState({ locale: originalLocale });
    if (!db.isOpen()) await db.open();
    // Only this run's UUID-owned fixture is deleted.
    const ownProject = await db.projects.get(id);
    check(ownProject?.description === 'C42 owned batch test' && id.startsWith('qa-c42-batch-'), 'Cleanup target must be this run\'s fixture');
    await deleteProject(id);
    for (const table of db.tables) if ('projectId' in table.schema.idxByName) check(await table.where('projectId').equals(id).count() === 0, 'Own fixture cleanup: ' + table.name);
    check(!await db.projects.get(id), 'Project cleanup');
  }
}


/** Vite-loaded integration: real emitted Worker/WASM, six formats and sibling cancellation. */
export async function testPublishingBatchPdf(): Promise<string[]> {
  check(window.electronAPI === undefined, 'Browser integration must have no Electron API');
  const id = 'qa-c42-pdf-batch-' + crypto.randomUUID();
  const project: Project = { id, title: 'Six formats A', author: 'QA Author', description: 'C42 owned six-output test', mode: 'custom', type: 'standalone', color: '#123456', status: 'draft', enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: 1, updatedAt: 1, readerPresentation: defaultReaderPresentation() };
  const writing: Writing = { id: id + '-writing', projectId: id, title: 'Text chapter A', content: '<p>Seis formatos conservan esta prosa capturada.</p>', wordCount: 7, status: 'draft', tags: [], createdAt: 1, updatedAt: 1 };
  const profile: PublishingProfile = { id: id + '-profile', projectId: id, name: 'Six outputs A', format: 'manuscript', includeCover: false, includeTitlePage: true, includeSynopsis: false, includeBibliography: false, citationStyle: 'apa', selectedWritingIds: [], createdAt: 1, updatedAt: 1 };
  const done: string[] = [];
  try {
    await db.projects.add(project); await db.writings.add(writing); await db.publishingProfiles.add(profile);
    const capture = await capturePublishingBatch({ projectId: id, profile, generatedAt: Date.UTC(2026, 9, 26), printLayout: { trimWidthMm: 148, trimHeightMm: 210, spineMm: 5, bleedMm: 3, dpi: 72 } });
    await db.projects.update(id, { title: 'Live six B' }); await db.writings.update(writing.id, { content: '<p>Live six B.</p>' });
    db.close({ disableAutoOpen: true });
    try {
      const files = await encodePublishingBatch(capture, ['markdown', 'html', 'epub', 'docx', 'pdf', 'print-cover']);
      check(files.every(file => file.status === 'ready' && file.bytes?.length), 'Six-output encoder statuses: ' + JSON.stringify(files.map(({ bytes, ...file }) => file)));
      check(decode(files[1].bytes).includes('Seis formatos conservan esta prosa capturada.') && !decode(files[1].bytes).includes('Live six B.'), 'Six-output capture changed');
      const { PDFDocument } = await import('pdf-lib');
      for (const file of files.filter(file => file.mime === 'application/pdf')) {
        check(decode(file.bytes?.subarray(0, 5)) === '%PDF-', file.output + ' PDF signature');
        const pdf = await PDFDocument.load(file.bytes!);
        check(pdf.getPageCount() > 0, file.output + ' parsed pages');
      }
      const [retry] = await encodePublishingBatch(capture, ['pdf']);
      check(retry.status === 'ready' && decode(retry.bytes?.subarray(0, 5)) === '%PDF-', 'PDF retry after DB close');
      done.push('all six encoders ready from A after live B and DB close; real PDF/jacket parse and fresh-Worker retry');
    } finally { await db.open(); }

    const OriginalWorker = window.Worker;
    const workers: Worker[] = []; let terminated = 0;
    class ObservedWorker extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); workers.push(this); }
      terminate() { terminated++; super.terminate(); }
    }
    window.Worker = ObservedWorker;
    try {
      // Large enough that cancellation exercises an active real Worker. The
      // test observes Worker ownership/termination, not a claimed WASM phase.
      await db.writings.update(writing.id, { content: Array.from({ length: 1800 }, (_, n) => '<p>Paragraph ' + n + ': ' + 'continuous authored prose '.repeat(30) + '</p>').join('') });
      const pending = runBridgeTool('wh_publishing_export', { projectId: id, profileId: profile.id, jobId: id + '-active-A', outputs: ['html', 'pdf', 'epub'] });
      const until = Date.now() + 20000;
      while (!workers.length) { check(Date.now() < until, 'PDF Worker was never created'); await new Promise(resolve => setTimeout(resolve, 20)); }
      const other = await runBridgeTool('wh_publishing_export', { projectId: id, profileId: profile.id, jobId: id + '-B', outputs: ['markdown'] });
      check(other.ok && (other.result as { files: { status: string }[] }).files[0].status === 'ready', 'Concurrent job B affected by A');
      const cancel = await runBridgeTool('wh_publishing_cancel_export', { projectId: id, jobId: id + '-active-A' });
      check(cancel.ok && (cancel.result as { active: boolean }).active, 'Cancel did not find active Worker job');
      const reply = await pending;
      check(reply.ok, 'Partial canceled job should return results: ' + JSON.stringify(reply));
      const result = reply.result as { canceled: boolean; files: { output: string; status: string; base64?: string; byteLength?: number }[] };
      check(result.canceled && result.files[0].status === 'ready' && !!result.files[0].base64 && result.files[1].status === 'canceled' && result.files[2].status === 'canceled' && !result.files[1].base64 && !result.files[2].base64, 'Cancel must preserve prior ready HTML and cancel active/unstarted formats');
      check(result.files[0].byteLength! > 200000 && atob(result.files[0].base64!).length === result.files[0].byteLength && atob(result.files[0].base64!).includes('Paragraph 1799'), 'Ready HTML must remain complete above legacy preview size');
      check(terminated >= 1, 'Owned PDF Worker was not terminated');
      const cleared = await runBridgeTool('wh_publishing_cancel_export', { projectId: id, jobId: id + '-active-A' });
      check(cleared.ok && !(cleared.result as { active: boolean }).active, 'Completed cancellation leaked active job');
      done.push('MCP sibling cancels a real active PDF Worker, preserves ready HTML, cancels unstarted EPUB, leaves B ready and cleans active id');
    } finally { window.Worker = OriginalWorker; }
    return done;
  } finally {
    if (!db.isOpen()) await db.open();
    check((await db.projects.get(id))?.description === 'C42 owned six-output test', 'Six-output cleanup target');
    await deleteProject(id);
    for (const table of db.tables) if ('projectId' in table.schema.idxByName) check(await table.where('projectId').equals(id).count() === 0, 'Six-output cleanup: ' + table.name);
  }
}
