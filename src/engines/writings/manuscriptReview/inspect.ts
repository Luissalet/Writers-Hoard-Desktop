import { manuscriptMarkerPattern } from './markers';
import { requestDocument, callDocumentTool, base64FromBytes } from '@/services/documents/client';
import { sha256Hex } from '@/services/judge/text';
import { countWords } from '@/utils/text';
import { projectWritingHtml } from '../revisionProjection';
import { readManuscriptFiles, MAX_SOURCE_BYTES, ManuscriptImportError, type ManuscriptBlock } from '../manuscriptImport';
import type { InspectedManuscript, SourceComment, ImportFinding } from './types';

/** Same native document reader used by DocumentTools; no world writes. */
export async function inspectManuscriptFile(file: File): Promise<InspectedManuscript> {
  if (file.size > MAX_SOURCE_BYTES) throw new ManuscriptImportError('too-large', file.name);
  const bytes = new Uint8Array(await file.arrayBuffer()), sha256 = await sha256Hex(bytes);
  const stem = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), markerPrefix = `\uE000wh-${sha256.slice(0, 16)}-`;
  if (!/\.docx$/i.test(file.name)) {
    const sources = await readManuscriptFiles([file]);
    return { ...sources[0], sha256, original: file, findings: [], comments: [], markerPrefix, format: file.name.split('.').at(-1) ?? 'txt' };
  }
  const reply = await callDocumentTool<{ sessionId: string }>('wh_document_open_bytes', { dataBase64: base64FromBytes(bytes), format: 'docx', fileName: file.name });
  if (!reply.ok) {
    if (!['desktop-required', 'DOCUMENT_ENGINE_UNAVAILABLE'].includes(reply.code ?? '')) throw Error(reply.error || 'No se ha podido abrir el documento.');
    // Preserve the existing browser-only import door, with explicit losses.
    const source = (await readManuscriptFiles([file]))[0];
    const { default: JSZip } = await import('jszip'), zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('word/document.xml')!.async('string');
    const comments = await zip.file('word/comments.xml')?.async('string') ?? '';
    const sourceOnlyComments = comments.match(/<w:comment\b/g)?.length ?? 0;
    const findings: ImportFinding[] = [{ code: 'simplified-browser-docx', count: 1 }];
    for (const [code, regex] of [['simplified-final-revisions', /<w:(?:ins|del)\b/g], ['simplified-table-structure', /<w:tbl\b/g], ['simplified-list-numbering', /<w:numPr\b/g], ['simplified-images-objects', /<w:(?:drawing|pict|object)\b|<m:oMath\b/g]] as const) { const count = xml.match(regex)?.length ?? 0; if (count) findings.push({ code, count }); }
    return { ...source, sha256, original: file, findings, comments: [], markerPrefix, format: 'docx', sourceOnlyComments };
  }
  const opened = reply.result!;
  try {
    const projection = await requestDocument<{ html: string; comments: SourceComment[]; warnings: string[]; findings: ImportFinding[]; commentProjectionVersion: number }>('document.exportHtml', { sessionId: opened.sessionId, includeRevisions: true, includeComments: true });
    if (projection.commentProjectionVersion !== 1) throw Error('El núcleo documental debe actualizarse para revisar comentarios del manuscrito.');
    const host = new DOMParser().parseFromString(projection.html, 'text/html');
    if (host.body.textContent?.includes(markerPrefix)) throw Error('El documento contiene una marca reservada de esta importación.');
    for (const comment of projection.comments) for (const edge of ['start', 'end'] as const) {
      for (const element of host.querySelectorAll('a[id]')) if (element.id === comment[edge === 'start' ? 'startMarker' : 'endMarker']) element.replaceWith(host.createTextNode(`${markerPrefix}${edge}-${comment.id}\uE001`));
    }
    const blocks: ManuscriptBlock[] = Array.from(host.body.children).map(element => {
      const level = /^H[1-6]$/.test(element.tagName) ? Number(element.tagName[1]) : 0;
      const heading = level ? new DOMParser().parseFromString(projectWritingHtml(element.outerHTML), 'text/html').body.textContent : undefined;
      const text = (heading ?? element.textContent ?? '').replace(manuscriptMarkerPattern(markerPrefix, projection.comments.map(comment => comment.id)), '');
      return { level, text, html: element.outerHTML, words: countWords(text) };
    }).filter(block => block.words || /<img|<table|data-wh-/i.test(block.html));
    if (!blocks.length) throw Error('El documento no contiene bloques importables.');
    const findings: ImportFinding[] = [...projection.warnings.map(code => ({ code, count: 1 })), ...projection.findings ?? []];
    return { name: file.name, stem, blocks, sha256, original: file, comments: projection.comments, findings, markerPrefix, format: 'docx' };
  } finally { await requestDocument('document.close', { sessionId: opened.sessionId }); }
}
