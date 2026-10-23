// Import: pasted text as a source, export guides, ePub and PDF readers,
// "select all of this type", a destination Library folder and per-file skip
// reasons. The panel is mounted for real; the same flows are repeated through
// the bridge (`wh_world_folder_import_*`, `wh_manuscript_import_*`).
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import '@/engines';
import '@/services/aiBridge/dispatch';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import WorldFolderImportPanel from '@/components/import/WorldFolderImportPanel';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { base64FromBytes } from '@/services/documents/client';
import { readManuscriptFiles, ManuscriptImportError } from '@/engines/writings/manuscriptImport';
import { useLocaleStore } from '@/stores/localeStore';
import type { WorldFolderPlan } from '@/services/worldFolderImport/types';
import type { Project } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean | Promise<boolean>, label: string, tries = 300) { for (let i = 0; i < tries; i++) { if (await check()) return; await act(async () => { await pause(50); }); } throw new Error(`Timed out: ${label}`); }
const click = async (element: Element | null, label: string) => { assert(element, label); await act(async () => { (element as HTMLElement).click(); await pause(60); }); };
const setValue = async (element: Element | null, value: string) => {
  assert(element, 'control');
  const control = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const proto = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(control, value); control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause(30); });
};
const bytes = (text: string) => new TextEncoder().encode(text);
const b64 = (text: string) => base64FromBytes(bytes(text));

interface PdfLine { text: string; size: number; x: number; y: number }
/** A small valid PDF (Helvetica, one content stream per page) with a real cross-reference table. */
function makePdf(pages: PdfLine[][], opts: { drawOnly?: boolean } = {}): Uint8Array {
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  pages.forEach((lines, index) => {
    const id = pageIds[index];
    const stream = opts.drawOnly
      ? '0.5 g 50 50 400 600 re f'
      : lines.map(line => `BT /F1 ${line.size} Tf ${line.x} ${line.y} Td (${line.text.replace(/([\\()])/g, '\\$1')}) Tj ET`).join('\n');
    objects[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`;
    objects[id + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    if (objects[id] === undefined) continue;
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += offsets[id] === undefined ? '0000000000 65535 f \n' : `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, char => char.charCodeAt(0));
}
const body = (texts: string[], startY: number, lead = 15): PdfLine[] => texts.map((text, index) => ({ text, size: 12, x: 72, y: startY - index * lead }));
/** Heading, a three-line paragraph, a gap, a second paragraph. */
const textPdf = (): Uint8Array => makePdf([[
  { text: 'The Salt Harbor', size: 26, x: 72, y: 700 },
  ...body(['Ada walked down to the harbor before dawn and counted the', 'boats that had not come back. Nobody on the quay would meet', 'her eyes, and the gulls were louder than usual.'], 650),
  ...body(['By noon the fog had lifted and the first sail showed itself', 'on the horizon, grey and patched, still far too small.'], 590),
]]);
const scannedPdf = (): Uint8Array => makePdf([[]], { drawOnly: true });

async function epubBytes(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:test</dc:identifier><dc:title>Libro de prueba</dc:title></metadata><manifest>
<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="z-one" href="z-first.xhtml" media-type="application/xhtml+xml"/><item id="a-two" href="a-second.xhtml" media-type="application/xhtml+xml"/>
<item id="img" href="pic.png" media-type="image/png"/></manifest><spine><itemref idref="cover"/><itemref idref="nav"/><itemref idref="z-one"/><itemref idref="a-two"/></spine></package>`);
  const page = (inner: string) => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>x</title></head><body>${inner}</body></html>`;
  zip.file('OEBPS/cover.xhtml', page('<img src="pic.png" alt="cover"/>'));
  zip.file('OEBPS/nav.xhtml', page('<nav epub:type="toc"><ol><li><a href="z-first.xhtml">La partida</a></li><li><a href="a-second.xhtml">El regreso</a></li></ol></nav>'));
  zip.file('OEBPS/z-first.xhtml', page('<h1>La partida</h1><p>Ada cerró la puerta del faro y no miró atrás. Llevaba <em>poco</em> equipaje y mucha prisa.</p><p><img src="pic.png" alt="mapa"/></p><p>El camino bajaba hasta el puerto entre muros de piedra seca.</p>'));
  zip.file('OEBPS/a-second.xhtml', page('<h1>El regreso</h1><p>Volvió al amanecer, cuando la niebla se levantaba del agua.</p><p>Nadie la esperaba en el muelle, y eso le pareció lo mejor.</p>'));
  zip.file('OEBPS/pic.png', Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='), char => char.charCodeAt(0)));
  return zip.generateAsync({ type: 'uint8array' });
}

const bridge = async (name: string, args: Record<string, unknown>) => runBridgeTool(name, args) as Promise<{ ok: boolean; result?: any; error?: string; code?: string }>;

export async function testImportPasteEpubPdf(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [], P = 'import-paste-epub-pdf', host = document.getElementById('root')!, root = createRoot(host);
  const scope = { projectId: P };
  try {
    await db.projects.put({
      id: P, title: 'Importación', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft',
      enabledEngines: ['codex', 'writings', 'tables', 'timeline', 'media'], createdAt: 1, updatedAt: 1,
      workspaceFolders: [{ id: 'carpeta-1', name: 'Importados', order: 0 }, { id: 'carpeta-2', name: 'Notas', parentId: 'carpeta-1', order: 1 }], workspacePlacements: [], workspaceRevision: 0,
    } as Project);
    await act(async () => {
      root.render(<EnginePaneContext.Provider value={{ instanceId: 'import-test', projectId: P, visible: true, primary: true }}><main><WorldFolderImportPanel projectId={P} onChanged={() => undefined} /></main></EnginePaneContext.Provider>);
      await pause(200);
    });
    const q = (selector: string) => host.querySelector<HTMLElement>(selector);

    // ---- Guides ----
    const guides = ['notes-markdown', 'spreadsheet-csv', 'wiki-json', 'manuscript-files', 'paste-text'].filter(id => q(`[data-testid="source-guide-${id}"]`));
    assert(guides.length === 5, `guide cards: ${guides.join()}`);
    const guideText = q('[data-testid="world-folder-guides"]')!.textContent ?? '';
    assert(/Qué se conserva/.test(guideText) && /Qué se pierde/.test(guideText), 'guide has kept/dropped sections');
    for (const id of guides) assert(q(`[data-testid="source-guide-${id}-keeps"] li`) && q(`[data-testid="source-guide-${id}-drops"] li`), `guide ${id} lists what is kept and dropped`);
    passed.push(`Export guides: ${guides.length} cards, each with steps, what is kept and what is dropped`);

    // ---- Paste box + files ----
    await setValue(q('[data-testid="world-folder-paste-name"]'), 'notas');
    await setValue(q('[data-testid="world-folder-paste-text"]'), '# Capitana Ada\nUna capitana tozuda.\n---8<---\n# Puerto Sal\nUn puerto con niebla.\n');
    assert(/2 documentos pegados/.test(q('[data-testid="world-folder-paste-count"]')?.textContent ?? ''), 'two pasted documents counted');
    const input = q('[data-testid="world-folder-zip"]') as HTMLInputElement, transfer = new DataTransfer();
    const add = (name: string, data: Uint8Array | string) => transfer.items.add(new File([typeof data === 'string' ? bytes(data) : data as BlobPart], name));
    add('Guia/Nave.md', '# Nave\nUna nave de tres mástiles.');
    add('texto.pdf', textPdf());
    add('escaneado.pdf', scannedPdf());
    add('datos.xyz', 'cosas raras');
    add('vacio.md', '');
    await act(async () => { input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); await pause(100); });
    await until(() => !q('[data-testid="world-folder-preview"]')!.hasAttribute('disabled'), 'files read');
    await click(q('[data-testid="world-folder-preview"]'), 'preview');
    await until(() => !!q('[data-testid="world-folder-groups"]') && !!q('[data-import-source="notas.md"]'), 'plan with pasted files', 600);
    assert(q('[data-import-source="notas-2.md"]'), 'second pasted document is notas-2.md');
    assert(/\bpegado/.test(q('[data-testid="world-folder-import"]')!.textContent ?? ''), 'file counter names the pasted documents');
    passed.push('Paste box: two pieces split on a ---8<--- line become notas.md and notas-2.md in the same review as the chosen files');

    // ---- Skip reasons in the UI ----
    const reasons = new Map([...host.querySelectorAll<HTMLElement>('[data-testid="world-folder-skip-reason"]')].map(node => [node.dataset.path!, node]));
    assert(reasons.get('escaneado.pdf')?.dataset.reason === 'needs-ocr' && /necesita OCR/.test(reasons.get('escaneado.pdf')!.textContent ?? ''), `scanned PDF reason ${[...reasons.values()].map(node => node.textContent).join(' // ')} :: ${[...host.querySelectorAll('details li')].map(n => n.textContent).join(' ## ')}`);
    assert(reasons.get('datos.xyz')?.dataset.reason === 'unsupported-type', 'unsupported type reason');
    assert(reasons.get('vacio.md')?.dataset.reason === 'empty', 'empty file reason');
    assert(!reasons.has('texto.pdf') && q('[data-import-source="texto.pdf"]'), 'text PDF is importable, not skipped');
    passed.push('Skip reasons shown per file in the review: escaneado.pdf (needs OCR), datos.xyz (unsupported type), vacio.md (empty); texto.pdf is read');

    // ---- Select by type ----
    const checkbox = (path: string) => q(`[data-import-source="${path}"] input[type=checkbox]`) as HTMLInputElement;
    const group = q('[data-group="codex:custom"]');
    assert(group, 'a group of Codex cards');
    const members = ['notas.md', 'notas-2.md', 'Guia/Nave.md', 'texto.pdf'];
    assert(members.every(path => checkbox(path).checked), 'all start included');
    await click(q('[data-testid="world-folder-clear-codex:custom"]'), 'clear type');
    assert(members.every(path => !checkbox(path).checked), 'clear all of this type unchecks every member');
    await click(q('[data-testid="world-folder-select-all-codex:custom"]'), 'select type');
    assert(members.every(path => checkbox(path).checked), 'select all of this type checks every member');
    passed.push('"Seleccionar todo de este tipo" / clear: one group of Codex cards toggles all of its files at once');

    // ---- Library folder ----
    assert(q('[data-testid="world-folder-library-folder"]')!.querySelectorAll('option').length === 3, 'folder picker lists root and both folders');
    await setValue(q('[data-testid="world-folder-library-folder"]'), 'carpeta-2');
    await click(q('[data-testid="world-folder-preview"]'), 'refresh');
    await until(() => /Importados/.test(q('[data-testid="world-folder-library-target"]')?.textContent ?? '') && !q('[data-testid="world-folder-apply"]')!.hasAttribute('disabled'), 'refreshed plan with folder', 600);
    assert(/Importados \/ Notas|Importados\/Notas|Importados › Notas/.test(q('[data-testid="world-folder-library-target"]')!.textContent ?? '') || /Notas/.test(q('[data-testid="world-folder-library-target"]')!.textContent ?? ''), 'folder path shown');
    await click(q('[data-testid="world-folder-apply"]'), 'apply');
    await until(() => /creados/.test(host.textContent ?? ''), 'applied', 600);
    const cards = await db.codexEntries.where('projectId').equals(P).toArray();
    assert(['Capitana Ada', 'Puerto Sal', 'Nave'].every(title => cards.some(card => card.title === title)), `cards: ${cards.map(card => card.title).join()}`);
    const pdfCard = cards.find(card => /Salt Harbor/.test(card.title) || /Salt Harbor/.test(card.content));
    assert(pdfCard && /Ada walked down/.test(pdfCard.content) && /first sail/.test(pdfCard.content), 'PDF text became a card');
    const placed = (await db.projects.get(P))!.workspacePlacements ?? [];
    assert(placed.length === cards.length && placed.every(item => item.folderId === 'carpeta-2'), `placements: ${JSON.stringify(placed)}`);
    assert(cards.length === 4, `four cards, got ${cards.length}`);
    passed.push('Library folder: the four created cards (two pasted, one Markdown, one PDF) are filed in the chosen folder in the same commit; PDF paragraphs and heading came from line positions');
    const undo = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => /Deshacer lote/.test(button.textContent ?? ''));
    await click(undo ?? null, 'undo');
    await until(async () => (await db.codexEntries.where('projectId').equals(P).count()) === 0, 'undone', 100);
    assert(((await db.projects.get(P))!.workspacePlacements ?? []).length === 0, 'Undo also removes the Library placements');
    passed.push('Undo removes the cards and their Library placements');

    // ---- Bridge: world import with pasted text ----
    const pasted = [{ name: 'diario', text: 'Primero\n---8<---\nSegundo' }];
    const first = await bridge('wh_world_folder_import_preview', { ...scope, format: 'obsidian', pasted });
    assert(first.ok && first.result.rows.length === 2, `bridge preview ${JSON.stringify(first)}`);
    const again = await bridge('wh_world_folder_import_preview', { ...scope, format: 'obsidian', pasted });
    const edited = await bridge('wh_world_folder_import_preview', { ...scope, format: 'obsidian', pasted: [{ name: 'diario', text: 'Primero\n---8<---\nSegundo cambiado' }] });
    assert(again.result.digest === first.result.digest && edited.result.digest !== first.result.digest, 'pasted text is hashed into the plan digest like a file');
    assert(first.result.files.every((file: { sha256: string }) => /^[0-9a-f]{64}$/.test(file.sha256)) && first.result.files.map((file: { path: string }) => file.path).join() === 'diario.md,diario-2.md', 'pasted pieces listed with a hash');
    const stale = await bridge('wh_world_folder_import_apply', { ...scope, format: 'obsidian', pasted: [{ name: 'diario', text: 'Primero\n---8<---\nSegundo cambiado' }], expectedDigest: first.result.digest });
    assert(!stale.ok, 'a digest from other pasted text is refused');
    const noFolder = await bridge('wh_world_folder_import_preview', { ...scope, format: 'obsidian', pasted, libraryFolderId: 'no-existe' });
    assert(!noFolder.ok && /library_folder_missing/.test(`${noFolder.code} ${noFolder.error}`), `unknown folder refused: ${JSON.stringify(noFolder)}`);
    const withFolder = await bridge('wh_world_folder_import_preview', { ...scope, format: 'obsidian', pasted, libraryFolderId: 'carpeta-1' });
    assert(withFolder.ok && withFolder.result.libraryFolder?.name === 'Importados', 'bridge preview names the destination folder');
    const applied = await bridge('wh_world_folder_import_apply', { ...scope, format: 'obsidian', pasted, libraryFolderId: 'carpeta-1', expectedDigest: withFolder.result.digest });
    assert(applied.ok && applied.result.created.length === 2, `bridge apply ${JSON.stringify(applied)}`);
    assert(((await db.projects.get(P))!.workspacePlacements ?? []).filter(item => item.folderId === 'carpeta-1').length === 2, 'bridge apply filed both documents');
    const reread = await bridge('wh_world_folder_import_preview', { ...scope, format: 'obsidian', pasted });
    assert(reread.result.rows.every((row: { status: string }) => row.status === 'duplicate'), 'pasting the same text again reads as already imported');
    await bridge('wh_world_folder_import_undo', { ...scope, receiptId: applied.result.receiptId });
    passed.push('Bridge: pasted[] feeds wh_world_folder_import_preview/apply; the digest changes with the text; libraryFolderId files the documents (unknown folder refused); the same paste again is "already imported"');

    // ---- Bridge: PDF skip reasons in the world import ----
    const pdfPlan = await bridge('wh_world_folder_import_preview', { ...scope, format: 'obsidian', files: [{ path: 'a.pdf', dataBase64: base64FromBytes(scannedPdf()) }, { path: 'b.pdf', dataBase64: base64FromBytes(textPdf()) }, { path: 'c.rtf', dataBase64: b64('{\\rtf1}') }] });
    assert(pdfPlan.ok, 'pdf preview');
    const plan = pdfPlan.result as WorldFolderPlan;
    const skipOf = (path: string) => plan.findings.find(finding => finding.path === path)?.reason;
    assert(skipOf('a.pdf') === 'needs-ocr' && skipOf('c.rtf') === 'unsupported-type' && !skipOf('b.pdf'), `reasons ${JSON.stringify(plan.findings)}`);
    assert(plan.findings.find(finding => finding.path === 'a.pdf')!.message.includes('necesita OCR') && plan.rows.length === 1 && plan.rows[0].sourcePath === 'b.pdf', 'scanned PDF refused with the OCR message; text PDF becomes a row');
    passed.push('Bridge: findings carry reason (needs-ocr, unsupported-type); the scanned PDF says "este PDF es una imagen escaneada: necesita OCR"');

    // ---- Manuscript: ePub ----
    const epub = await epubBytes();
    const epubFiles = [{ name: 'libro.epub', dataBase64: base64FromBytes(epub) }];
    const split = { mode: 'heading', headingLevel: 1, separator: '' };
    const inspected = await bridge('wh_manuscript_import_inspect', { ...scope, files: epubFiles, split });
    assert(inspected.ok, `epub inspect ${JSON.stringify(inspected)}`);
    const chapters = inspected.result.chapters as { title: string; words: number }[];
    assert(chapters.map(chapter => chapter.title).join('|') === 'La partida|El regreso', `spine order, nav and cover skipped: ${chapters.map(chapter => chapter.title).join('|')}`);
    const findingCodes = (inspected.result.findings as { code: string; count: number }[]).map(finding => `${finding.code}:${finding.count}`);
    assert(findingCodes.some(code => code === 'epub-images-skipped:1'), `images reported: ${findingCodes.join()}`);
    assert(findingCodes.some(code => code.startsWith('epub-pages-skipped')), `skipped pages reported: ${findingCodes.join()}`);
    const epubApplied = await bridge('wh_manuscript_import_apply', { ...scope, files: epubFiles, split, choices: chapters.map((chapter, index) => ({ key: (inspected.result.chapters as { key: string }[])[index].key, title: chapter.title, included: true })), expectedDigest: inspected.result.digest });
    assert(epubApplied.ok, `epub apply ${JSON.stringify(epubApplied)}`);
    const writings = await db.writings.where('projectId').equals(P).toArray();
    assert(writings.length === 2 && writings.some(row => /poco/.test(row.content) && /<em>/.test(row.content)), 'two chapters stored with emphasis kept');
    const stored = await bridge('wh_manuscript_sources', scope);
    assert(stored.ok && stored.result.some((row: { name: string }) => row.name === 'libro.epub'), 'the original ePub is kept');
    passed.push('ePub: chapters in spine order (not file-name order), cover and nav skipped, 1 image reported as not imported, emphasis kept, original ePub stored');

    // ---- Manuscript: PDF ----
    const pdfFiles = [{ name: 'texto.pdf', dataBase64: base64FromBytes(textPdf()) }];
    const pdfInspect = await bridge('wh_manuscript_import_inspect', { ...scope, files: pdfFiles, split: { mode: 'heading', headingLevel: 1, separator: '' } });
    assert(pdfInspect.ok, `pdf inspect ${JSON.stringify(pdfInspect)}`);
    const pdfChapter = pdfInspect.result.chapters[0] as { title: string; content: string };
    assert(pdfChapter.title === 'The Salt Harbor' && (pdfChapter.content.match(/<p>/g) ?? []).length === 2, `heading and two paragraphs: ${pdfChapter.title} ${pdfChapter.content}`);
    assert(/counted the boats|counted the\s+boats/.test(pdfChapter.content.replace(/<[^>]+>/g, '')), 'lines of one paragraph are joined');
    assert((pdfInspect.result.findings as { code: string }[]).some(finding => finding.code === 'pdf-layout-guess'), 'layout guess reported');
    passed.push('PDF (manuscript): text layer read with pdfjs; "The Salt Harbor" is the heading, two paragraphs rebuilt from line positions, layout-guess finding reported');

    // ---- Manuscript: no text layer, pasted text, bad files ----
    const scanned = await bridge('wh_manuscript_import_inspect', { ...scope, files: [{ name: 'escaneado.pdf', dataBase64: base64FromBytes(scannedPdf()) }], split });
    assert(!scanned.ok && scanned.code === 'scanned-pdf' && /necesita OCR/.test(scanned.error ?? ''), `scanned refusal ${JSON.stringify(scanned)}`);
    try { await readManuscriptFiles([new File([scannedPdf() as BlobPart], 'escaneado.pdf')]); throw new Error('should refuse'); } catch (error) { assert(error instanceof ManuscriptImportError && error.code === 'scanned-pdf', 'reader refuses a PDF without text layer'); }
    try { await readManuscriptFiles([new File([bytes('no soy un pdf')], 'roto.pdf')]); throw new Error('should refuse'); } catch (error) { assert(error instanceof ManuscriptImportError && error.code === 'invalid-pdf', 'broken PDF refused'); }
    try { await readManuscriptFiles([new File([bytes('no soy un zip')], 'roto.epub')]); throw new Error('should refuse'); } catch (error) { assert(error instanceof ManuscriptImportError && error.code === 'invalid-epub', 'broken ePub refused'); }
    const pastedManuscript = await bridge('wh_manuscript_import_inspect', { ...scope, pasted: [{ name: 'borrador', text: '# Uno\nTexto uno.\n\n# Dos\nTexto dos.' }], split });
    assert(pastedManuscript.ok && pastedManuscript.result.chapters.length === 2, `pasted manuscript ${JSON.stringify(pastedManuscript)}`);
    passed.push('Refusals: a PDF without text layer says "este PDF es una imagen escaneada: necesita OCR" (UI error code and bridge), broken PDF/ePub are refused, pasted manuscript text works through inspect');
  } finally {
    await act(async () => root.unmount());
    await deleteProject(P).catch(() => undefined);
  }
  return passed;
}
