// ============================================
// Manuscript import — ePub reader
// ============================================
//
// An .epub is a zip of XHTML files plus a package file (`.opf`) that says in
// which order they are read (the "spine"). JSZip is already a dependency, so
// this needs no new package and is loaded dynamically like the .docx reader.
//
// READS
//   • the chapters, in SPINE order (never file-name order);
//   • headings, paragraphs, emphasis, line breaks, quotes, lists, rules and
//     preformatted text, as the same escaped block html the .docx and
//     Markdown readers produce — nothing from the file is used as markup;
//   • the chapter title from the book's own table of contents when a chapter
//     file has no heading of its own.
//
// SKIPS (and says so)
//   • the navigation document, the contents page and the cover page;
//   • images — they are counted and reported, not imported;
//   • tables are flattened to one paragraph per row (reported).
//
// REFUSES
//   • a file that is not a zip / has no readable package (`invalid-epub`);
//   • a book with DRM (`protected`). Font obfuscation is not DRM and is fine.

import { countWords } from '@/utils/text';
import { ManuscriptImportError, yieldToUi, MAX_SOURCE_BYTES, MAX_TOTAL_BYTES, type ManuscriptBlock, type SourceNote } from './manuscriptImport';
import { readZipEntryBytes, ZipLimitError, type ZipBudget } from '@/services/zipEntryLimits';

/** A book longer than this many chapter files, or with more text than this, is refused rather than inflated. */
export const MAX_EPUB_CHAPTERS = 1500;
export const MAX_EPUB_CHARACTERS = 24 * 1024 * 1024;

export interface EpubReadResult { blocks: ManuscriptBlock[]; notes: SourceNote[] }

const FONT_OBFUSCATION = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']);
const XHTML_TYPES = new Set(['application/xhtml+xml', 'text/html', 'application/x-dtbook+xml']);
const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'pre', 'hr', 'table', 'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'figure', 'figcaption', 'dl', 'dt', 'dd', 'details', 'summary', 'hgroup', 'body', 'address', 'fieldset', 'form']);
const SKIP_TAGS = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'template', 'noscript']);

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const squash = (value: string): string => value.replace(/[\s\u00a0\ufeff]+/g, ' ');
const localName = (element: Element): string => element.localName.toLowerCase();
function all(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter(element => localName(element) === name);
}
const attr = (element: Element, name: string): string => element.getAttribute(name) ?? '';
function normalizePath(parts: string[]): string {
  const out: string[] = [];
  for (const part of parts) { if (!part || part === '.') continue; if (part === '..') out.pop(); else out.push(part); }
  return out.join('/');
}
function resolveHref(base: string, href: string): string {
  const clean = href.split('#')[0].split('?')[0];
  let decoded = clean;
  try { decoded = decodeURIComponent(clean); } catch { /* keep as written */ }
  return normalizePath([...base.split('/').slice(0, -1), ...decoded.split('/')]);
}
const parseXml = (text: string): Document => new DOMParser().parseFromString(text, 'application/xml');
const parseHtml = (text: string): Document => new DOMParser().parseFromString(text, 'text/html');

interface InlineState { images: number }

function inlineHtml(node: Node, state: InlineState): string {
  if (node.nodeType === 3) return escapeHtml(squash(node.nodeValue ?? ''));
  if (node.nodeType !== 1) return '';
  const element = node as Element, name = localName(element);
  if (SKIP_TAGS.has(name)) return '';
  if (name === 'br') return '<br>';
  if (name === 'img') { state.images += 1; return ''; }
  if (name === 'svg') { state.images += Math.max(1, all(element, 'image').length); return ''; }
  const inner = Array.from(element.childNodes).map(child => inlineHtml(child, state)).join('');
  if (!inner.trim()) return inner;
  if (name === 'em' || name === 'i' || name === 'cite' || name === 'dfn' || name === 'var') return `<em>${inner}</em>`;
  if (name === 'strong' || name === 'b') return `<strong>${inner}</strong>`;
  return inner;
}
function tidy(html: string): string {
  return html.replace(/(?:<br>\s*)+$/g, '').replace(/^(?:\s*<br>)+/g, '').replace(/ {2,}/g, ' ').trim();
}
const plain = (html: string): string => squash(html.replace(/<br>/g, ' ').replace(/<[^>]+>/g, '')).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

interface WalkState extends InlineState { tables: number }

function paragraphBlock(html: string): ManuscriptBlock | null {
  const body = tidy(html);
  if (!plain(body)) return null;
  const out = `<p>${body}</p>`;
  return { level: 0, text: plain(body), html: out, words: countWords(out) };
}

function walkChildren(parent: Element, out: ManuscriptBlock[], state: WalkState): void {
  let run: Node[] = [];
  const flush = (): void => {
    if (!run.length) return;
    const block = paragraphBlock(run.map(node => inlineHtml(node, state)).join(''));
    run = [];
    if (block) out.push(block);
  };
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === 3) { run.push(child); continue; }
    if (child.nodeType !== 1) continue;
    const element = child as Element, name = localName(element);
    if (SKIP_TAGS.has(name)) continue;
    if (!BLOCK_TAGS.has(name)) { run.push(element); continue; }
    flush();
    walkBlock(element, name, out, state);
  }
  flush();
}

function listHtml(list: Element, state: WalkState): string {
  const ordered = localName(list) === 'ol';
  const items = Array.from(list.children).filter(child => localName(child) === 'li').map(item => {
    const own: Node[] = [], nested: string[] = [];
    for (const child of Array.from(item.childNodes)) {
      if (child.nodeType === 1 && ['ul', 'ol'].includes(localName(child as Element))) nested.push(listHtml(child as Element, state));
      else own.push(child);
    }
    const text = tidy(own.map(node => inlineHtml(node, state)).join(''));
    return text || nested.length ? `<li><p>${text}</p>${nested.join('')}</li>` : '';
  }).filter(Boolean);
  return items.length ? `<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>` : '';
}

function walkBlock(element: Element, name: string, out: ManuscriptBlock[], state: WalkState): void {
  if (/^h[1-6]$/.test(name)) {
    const level = Number(name[1]), html = tidy(Array.from(element.childNodes).map(child => inlineHtml(child, state)).join('').replace(/<br>/g, ' ')), text = plain(html);
    if (text) out.push({ level, text, html: `<h${level}>${html}</h${level}>`, words: countWords(text) });
  } else if (name === 'ul' || name === 'ol') {
    const html = listHtml(element, state);
    if (html) out.push({ level: 0, text: plain(html), html, words: countWords(html) });
  } else if (name === 'blockquote') {
    const inner: ManuscriptBlock[] = [];
    walkChildren(element, inner, state);
    const html = inner.filter(block => block.level === 0).map(block => (block.html.startsWith('<p>') ? block.html : `<p>${plain(block.html)}</p>`)).join('');
    if (html) out.push({ level: 0, text: plain(html), html: `<blockquote>${html}</blockquote>`, words: countWords(html) });
  } else if (name === 'hr') {
    out.push({ level: 0, text: '***', html: '<hr>', words: 0 });
  } else if (name === 'pre') {
    const text = (element.textContent ?? '').replace(/\s+$/, '');
    if (text.trim()) out.push({ level: 0, text, html: `<pre><code>${escapeHtml(text)}</code></pre>`, words: countWords(text) });
  } else if (name === 'table') {
    state.tables += 1;
    for (const row of all(element, 'tr')) {
      const cells = Array.from(row.children).filter(cell => ['td', 'th'].includes(localName(cell))).map(cell => tidy(Array.from(cell.childNodes).map(child => inlineHtml(child, state)).join('')).replace(/<br>/g, ' ')).filter(cell => plain(cell));
      const block = paragraphBlock(cells.join(' | '));
      if (block) out.push(block);
    }
  } else if (name === 'li' || name === 'dt' || name === 'dd' || name === 'summary' || name === 'figcaption' || name === 'address') {
    walkChildren(element, out, state);
  } else {
    walkChildren(element, out, state);
  }
}

interface Candidate { path: string; blocks: ManuscriptBlock[]; images: number; tables: number }

/** Read an .epub into blocks, in reading order. */
export async function parseEpubBlocks(buffer: ArrayBuffer, report?: (ratio: number) => void): Promise<EpubReadResult> {
  const { default: JSZip } = await import('jszip');
  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>;
  try { zip = await JSZip.loadAsync(buffer); } catch { throw new ManuscriptImportError('invalid-epub'); }
  const find = (path: string) => zip.file(path) ?? zip.file(new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'))[0] ?? null;
  // Every entry is checked against its declared size before it is inflated and counted while it inflates; all of them share one budget.
  const budget: ZipBudget = { remaining: MAX_TOTAL_BYTES };
  const decoder = new TextDecoder('utf-8');
  const readText = async (path: string): Promise<string> => {
    const entry = find(path);
    if (!entry) return '';
    try { return decoder.decode(await readZipEntryBytes(entry, MAX_SOURCE_BYTES, budget)); }
    catch (error) { if (error instanceof ZipLimitError) throw new ManuscriptImportError('too-large', path); throw error; }
  };

  const encryption = await readText('META-INF/encryption.xml');
  if (encryption) {
    const methods = all(parseXml(encryption), 'EncryptionMethod').map(method => method.getAttribute('Algorithm') ?? '');
    if (methods.some(algorithm => !FONT_OBFUSCATION.has(algorithm))) throw new ManuscriptImportError('protected');
  }

  const container = await readText('META-INF/container.xml');
  const rootPath = container ? all(parseXml(container), 'rootfile')[0]?.getAttribute('full-path') ?? '' : '';
  if (!rootPath) throw new ManuscriptImportError('invalid-epub');
  const opfText = await readText(rootPath);
  if (!opfText) throw new ManuscriptImportError('invalid-epub');
  const opf = parseXml(opfText);
  if (!all(opf, 'spine').length && !all(opf, 'manifest').length) throw new ManuscriptImportError('invalid-epub');

  interface Item { id: string; path: string; type: string; properties: string }
  const manifest = new Map<string, Item>();
  for (const item of all(opf, 'item')) {
    const id = item.getAttribute('id') ?? '', href = item.getAttribute('href') ?? '';
    if (id && href) manifest.set(id, { id, path: resolveHref(rootPath, href), type: (item.getAttribute('media-type') ?? '').toLowerCase(), properties: item.getAttribute('properties') ?? '' });
  }
  // The same file listed twice in the spine is read once (a repeated itemref would multiply the text).
  let spine = [...new Map(all(opf, 'itemref').map(ref => manifest.get(ref.getAttribute('idref') ?? '')).filter((item): item is Item => !!item).map(item => [item.path, item])).values()];
  if (!spine.length) spine = [...manifest.values()].filter(item => XHTML_TYPES.has(item.type)).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  if (!spine.length) throw new ManuscriptImportError('invalid-epub');
  if (spine.length > MAX_EPUB_CHAPTERS) throw new ManuscriptImportError('too-large', `${spine.length} chapters`);

  // Titles from the book's own contents list: the nav document, else the NCX.
  const titles = new Map<string, string>();
  const navItem = [...manifest.values()].find(item => /(^|\s)nav(\s|$)/.test(item.properties));
  if (navItem) {
    const nav = parseHtml(await readText(navItem.path));
    const lists = Array.from(nav.querySelectorAll('nav')), toc = lists.find(list => /toc/.test(attr(list, 'epub:type'))) ?? lists[0];
    for (const link of Array.from(toc?.querySelectorAll('a[href]') ?? [])) {
      const label = plain(squash(link.textContent ?? '')), key = resolveHref(navItem.path, link.getAttribute('href') ?? '');
      if (label && key && !titles.has(key)) titles.set(key, label);
    }
  }
  const ncxItem = [...manifest.values()].find(item => item.type === 'application/x-dtbncx+xml');
  if (ncxItem && !titles.size) {
    const ncx = parseXml(await readText(ncxItem.path));
    for (const point of all(ncx, 'navPoint')) {
      const label = squash(all(point, 'text')[0]?.textContent ?? '').trim(), source = all(point, 'content')[0]?.getAttribute('src') ?? '';
      const key = resolveHref(ncxItem.path, source);
      if (label && key && !titles.has(key)) titles.set(key, label);
    }
  }

  const candidates: Candidate[] = [], skipped: string[] = [];
  let images = 0, tables = 0, characters = 0;
  for (const [index, item] of spine.entries()) {
    report?.(0.1 + 0.85 * (index / spine.length));
    await yieldToUi();
    const baseName = item.path.split('/').at(-1) ?? item.path;
    if (!XHTML_TYPES.has(item.type) && !/\.(?:x?html?)$/i.test(item.path)) { skipped.push(baseName); continue; }
    if (/(^|\s)nav(\s|$)/.test(item.properties)) { skipped.push(baseName); continue; }
    const text = await readText(item.path);
    if (!text) { skipped.push(baseName); continue; }
    const document = parseHtml(text), body = document.body;
    if (!body) { skipped.push(baseName); continue; }
    const kinds = `${attr(body, 'epub:type')} ${Array.from(body.children).map(child => attr(child, 'epub:type')).join(' ')}`;
    const state: WalkState = { images: 0, tables: 0 }, blocks: ManuscriptBlock[] = [];
    walkChildren(body, blocks, state);
    const words = blocks.reduce((sum, block) => sum + block.words, 0);
    const named = /^(?:cover|cover-?page|titlepage|title-?page)\.|^(?:cover)(?:[-_].*)?\./i.test(baseName) || /^cover/i.test(item.id);
    const looksLikeCover = /(^|\s)cover(\s|$)/.test(kinds) || (named && words < 80) || (words === 0 && state.images > 0);
    const looksLikeContents = /(^|\s)(toc|landmarks|loi|lot)(\s|$)/.test(kinds) || (/^(?:toc|nav|contents)\b/i.test(baseName) && words < 400);
    if (looksLikeCover || looksLikeContents || words === 0) { skipped.push(baseName); continue; }
    characters += blocks.reduce((sum, block) => sum + block.text.length, 0);
    if (characters > MAX_EPUB_CHARACTERS) throw new ManuscriptImportError('too-large', item.path);
    candidates.push({ path: item.path, blocks, images: state.images, tables: state.tables });
    images += state.images; tables += state.tables;
  }
  if (!candidates.length) throw new ManuscriptImportError('no-text');

  // A chapter file with no heading borrows its title from the contents list,
  // at the depth the other chapter files use for theirs.
  const depths = new Map<number, number>();
  for (const candidate of candidates) if (candidate.blocks[0]?.level) depths.set(candidate.blocks[0].level, (depths.get(candidate.blocks[0].level) ?? 0) + 1);
  const titleLevel = [...depths.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 1;
  const blocks: ManuscriptBlock[] = [];
  for (const candidate of candidates) {
    const label = titles.get(candidate.path);
    if (label && !candidate.blocks.some(block => block.level > 0 && block.level <= titleLevel)) {
      const html = `<h${titleLevel}>${escapeHtml(label)}</h${titleLevel}>`;
      blocks.push({ level: titleLevel, text: label, html, words: countWords(label) });
    }
    blocks.push(...candidate.blocks);
  }
  const notes: SourceNote[] = [];
  if (images) notes.push({ code: 'epub-images-skipped', count: images });
  if (tables) notes.push({ code: 'epub-tables-flattened', count: tables });
  if (skipped.length) notes.push({ code: 'epub-pages-skipped', count: skipped.length, detail: skipped.slice(0, 6).join(', ') });
  report?.(1);
  return { blocks, notes };
}
