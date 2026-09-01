import { xmlSafeText, type PublishingDocument } from './publishingDocument';

const XHTML_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'hr', 'i', 'li', 'ol', 'p', 'pre', 's', 'span', 'strong',
  'sub', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
]);

// The characters XML cannot carry at all — C0 controls, non-characters, lone
// surrogates — are dropped by `xmlSafeText`, which lives beside the IR because
// the DOCX writer needs exactly the same guard and used to lack it. Any one of
// them makes the whole .epub unparseable. This function adds the part that is
// only ePub's: turning the five markup characters into entities.
function escapeXml(value: string): string {
  return xmlSafeText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function serializeXhtmlNode(node: Node): string {
  if (node.nodeType === 3) return escapeXml(node.textContent ?? '');
  if (!(node instanceof Element)) return '';
  const sourceTag = node.tagName.toLowerCase();
  if (sourceTag === 'img') return '';
  if (!XHTML_TAGS.has(sourceTag)) {
    return [...node.childNodes].map(serializeXhtmlNode).join('');
  }
  const tag = sourceTag === 'b' ? 'strong' : sourceTag === 'i' ? 'em' : sourceTag;
  const attributes: string[] = [];
  if (tag === 'a') {
    const href = node.getAttribute('href');
    if (href) attributes.push(` href="${escapeXml(href)}"`);
  }
  const title = node.getAttribute('title');
  if (title) attributes.push(` title="${escapeXml(title)}"`);
  if (tag === 'br' || tag === 'hr') return `<${tag}${attributes.join('')} />`;
  return `<${tag}${attributes.join('')}>${[...node.childNodes].map(serializeXhtmlNode).join('')}</${tag}>`;
}

function toXhtmlFragment(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return [...parsed.body.childNodes].map(serializeXhtmlNode).join('');
}

function xhtmlPage(document: PublishingDocument, title: string, body: string): string {
  const locale = escapeXml(document.locale);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${locale}" lang="${locale}">
<head>
  <meta charset="UTF-8" />
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css" />
</head>
<body>${body}</body>
</html>`;
}

/** Build a self-contained EPUB 3 Blob with deterministic reading order. */
export async function buildPublishingEpub(document: PublishingDocument): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  // EPUB requires this to be the first ZIP member and stored without compression.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`);

  const manifest: string[] = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />',
    '<item id="styles" href="styles.css" media-type="text/css" />',
  ];
  const spine: string[] = [];
  const navigation: Array<{ href: string; title: string }> = [];

  if (document.includeTitlePage) {
    const href = 'title.xhtml';
    const body = `<section class="title-page"><h1>${escapeXml(document.title)}</h1><p>${document.wordCount.toLocaleString(document.locale)} ${escapeXml(document.wordLabel)} · ${escapeXml(new Date(document.generatedAt).toLocaleDateString(document.locale))}</p></section>`;
    zip.file(`EPUB/${href}`, xhtmlPage(document, document.title, body));
    manifest.push(`<item id="title" href="${href}" media-type="application/xhtml+xml" />`);
    spine.push('<itemref idref="title" />');
    navigation.push({ href, title: document.title });
  }

  document.sections.forEach((section, index) => {
    const id = `section-${index + 1}`;
    const href = `${id}.xhtml`;
    const synopsis = section.synopsis ? `<p class="synopsis">${escapeXml(section.synopsis)}</p>` : '';
    const body = `<section><h1>${escapeXml(section.title)}</h1>${synopsis}${toXhtmlFragment(section.portableHtml)}</section>`;
    zip.file(`EPUB/${href}`, xhtmlPage(document, section.title, body));
    manifest.push(`<item id="${id}" href="${href}" media-type="application/xhtml+xml" />`);
    spine.push(`<itemref idref="${id}" />`);
    navigation.push({ href, title: section.title });
  });

  if (document.bibliography.length > 0 && document.bibliographyTitle) {
    const href = 'bibliography.xhtml';
    const body = `<section><h1>${escapeXml(document.bibliographyTitle)}</h1>${document.bibliography.map(citation => `<p>${escapeXml(citation)}</p>`).join('')}</section>`;
    zip.file(`EPUB/${href}`, xhtmlPage(document, document.bibliographyTitle, body));
    manifest.push(`<item id="bibliography" href="${href}" media-type="application/xhtml+xml" />`);
    spine.push('<itemref idref="bibliography" />');
    navigation.push({ href, title: document.bibliographyTitle });
  }

  const navBody = `<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc" id="toc"><h1>${escapeXml(document.title)}</h1><ol>${navigation.map(item => `<li><a href="${item.href}">${escapeXml(item.title)}</a></li>`).join('')}</ol></nav>`;
  zip.file('EPUB/nav.xhtml', xhtmlPage(document, document.title, navBody));
  zip.file('EPUB/styles.css', `body { font-family: serif; line-height: 1.55; margin: 5%; }
h1 { text-align: center; margin: 1.5em 0 1em; }
p { margin: 0 0 0.5em; }
.title-page { text-align: center; margin-top: 30%; }
.synopsis { font-style: italic; text-align: center; margin-bottom: 2em; }
blockquote { margin: 1em 2em; font-style: italic; }
pre, code { font-family: monospace; }
table { border-collapse: collapse; }
td, th { border: 1px solid #777; padding: 0.25em; }`);

  const modified = new Date(document.generatedAt).toISOString().replace(/\.\d{3}Z$/, 'Z');
  zip.file('EPUB/package.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="publication-id" xml:lang="${escapeXml(document.locale)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="publication-id">${escapeXml(document.identifier)}</dc:identifier>
    <dc:title>${escapeXml(document.title)}</dc:title>
    <dc:language>${escapeXml(document.locale)}</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>${manifest.join('')}</manifest>
  <spine>${spine.join('')}</spine>
</package>`);

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
