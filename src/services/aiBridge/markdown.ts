// ============================================================================
// AI bridge — Markdown → TipTap HTML
// ============================================================================
//
// The app stores rich text as the HTML TipTap StarterKit produces. External
// models are far better at Markdown than at HTML, so the bridge speaks
// Markdown in both directions:
//
//   reading   htmlToMarkdown()          (engines/writings/manuscriptExport.ts)
//   writing   markdownToTiptapHtml()    (here)
//
// Zero dependencies on purpose: `marked`, `turndown` and friends would pull a
// full CommonMark engine into the renderer bundle to serve a node set TipTap
// deliberately keeps small. Everything produced here stays inside StarterKit's
// schema plus the Link and Image extensions the app already loads.
//
// Whatever comes out of this MUST still pass through sanitizeRichHtml before
// it touches the database — this converter escapes its input, but the
// sanitizer is the app's single admitted gate for foreign HTML.

/** Characters that would otherwise smuggle markup through. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Only http(s), mailto, in-document and data-image URLs survive. */
function safeUrl(raw: string): string | null {
  const url = raw.trim();
  if (/^(https?:|mailto:)/i.test(url)) return url;
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(url)) return url;
  if (/^(\/|\.\/|\.\.\/|#)/.test(url)) return url;
  return null;
}

/**
 * Inline formatting. Code spans are lifted out first so their contents are
 * never re-read as bold, italic or a link.
 */
function inline(text: string): string {
  const codeSpans: string[] = [];
  let work = text.replace(/`([^`]+)`/g, (_match, code: string) => {
    codeSpans.push('<code>' + escapeHtml(code) + '</code>');
    // A sentinel no prose produces, left alone by escapeHtml and by the
    // emphasis patterns below.
    return '%%WHCODE' + String(codeSpans.length - 1) + '%%';
  });

  work = escapeHtml(work);

  // Images before links: ![alt](src) is the link pattern with a leading bang.
  work = work.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (match, alt: string, src: string) => {
      const url = safeUrl(src);
      return url ? `<img src="${url}" alt="${alt}">` : match;
    },
  );
  work = work.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (match, label: string, href: string) => {
      const url = safeUrl(href);
      return url ? `<a href="${url}">${label}</a>` : match;
    },
  );

  work = work
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^\w_])_([^_\n]+)_(?![\w_])/g, '$1<em>$2</em>');

  return work.replace(/%%WHCODE(\d+)%%/g, (_match, index: string) => codeSpans[Number(index)] ?? '');
}

interface ListFrame {
  ordered: boolean;
  indent: number;
  /** An <li> is open: a deeper list nests inside it, a sibling item closes it. */
  open: boolean;
}

/**
 * Convert Markdown to the HTML subset TipTap round-trips cleanly.
 * Unknown syntax degrades to paragraphs rather than being dropped.
 */
export function markdownToTiptapHtml(markdown: string): string {
  const lines = String(markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');

  const out: string[] = [];
  const listStack: ListFrame[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];
  let codeFence: string[] | null = null;

  const closeLists = (toIndent = -1): void => {
    while (listStack.length && listStack[listStack.length - 1].indent > toIndent) {
      const frame = listStack.pop();
      if (frame?.open) out.push('</li>');
      out.push(frame?.ordered ? '</ol>' : '</ul>');
    }
  };

  const flushParagraph = (): void => {
    if (!paragraph.length) return;
    out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    paragraph = [];
  };

  const flushQuote = (): void => {
    if (!quote.length) return;
    out.push(`<blockquote><p>${quote.map(inline).join('<br>')}</p></blockquote>`);
    quote = [];
  };

  const flushAll = (): void => {
    flushParagraph();
    flushQuote();
    closeLists();
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '    ');
    const fence = /^\s*```(\w*)\s*$/.exec(line);

    // A fenced block swallows every line until its closing fence.
    if (codeFence) {
      if (fence) {
        out.push(`<pre><code>${escapeHtml(codeFence.join('\n'))}</code></pre>`);
        codeFence = null;
      } else {
        codeFence.push(rawLine);
      }
      continue;
    }
    if (fence) {
      flushAll();
      codeFence = [];
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      continue;
    }

    if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushAll();
      out.push('<hr>');
      continue;
    }

    const blockquote = /^\s{0,3}>\s?(.*)$/.exec(line);
    if (blockquote) {
      flushParagraph();
      closeLists();
      quote.push(blockquote[1]);
      continue;
    }

    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    const ordered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
    const item = bullet ?? ordered;
    if (item) {
      flushParagraph();
      flushQuote();
      let indent = item[1].length;
      const isOrdered = Boolean(ordered);
      const text = (ordered ? ordered[3] : item[2]).trim();
      // Models write "1. Marta" then "- age: 34" flush left, meaning the bullet
      // belongs to the item above. CommonMark would start a new list and the
      // numbering would restart at 1 for every entry; read it as nesting.
      const sibling = listStack.find((frame) => frame.indent === indent);
      if (bullet && sibling?.ordered && sibling.open) indent = sibling.indent + 2;
      closeLists(indent);
      const top = listStack[listStack.length - 1];
      if (!top || top.indent < indent) {
        const start = ordered ? Number(ordered[2]) : 1;
        listStack.push({ ordered: isOrdered, indent, open: false });
        out.push(isOrdered ? (start > 1 ? `<ol start="${start}">` : '<ol>') : '<ul>');
      } else if (top.ordered !== isOrdered) {
        // A different marker at the same depth starts a different list.
        listStack.pop();
        if (top.open) out.push('</li>');
        out.push(top.ordered ? '</ol>' : '</ul>');
        listStack.push({ ordered: isOrdered, indent, open: false });
        out.push(isOrdered ? '<ol>' : '<ul>');
      }
      const frame = listStack[listStack.length - 1];
      if (frame.open) out.push('</li>');
      out.push(`<li><p>${inline(text)}</p>`);
      frame.open = true;
      continue;
    }

    // Anything else is prose; consecutive lines join as soft breaks.
    flushQuote();
    closeLists();
    paragraph.push(line.trim());
  }

  if (codeFence) out.push(`<pre><code>${escapeHtml(codeFence.join('\n'))}</code></pre>`);
  flushAll();

  return out.join('') || '<p></p>';
}

/** Word count from Markdown, matching what the app shows for the stored HTML. */
export function countMarkdownWords(markdown: string): number {
  const text = String(markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~]/g, ' ')
    .trim();
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}
