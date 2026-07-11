// ============================================
// Google Docs HTML Cleaner
// ============================================
// Google Docs export as HTML produces extremely messy markup with
// inline styles, wrapper divs, comment anchors, and metadata spans.
// This utility cleans it into semantic HTML that TipTap can parse.

/**
 * Clean Google Docs HTML export into semantic HTML for TipTap
 */
export function cleanGoogleDocsHtml(html: string): string {
  // Create a DOM parser to work with the HTML
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Remove all <style> blocks
  doc.querySelectorAll('style').forEach(el => el.remove());

  // Remove Google's comment anchors and metadata
  doc.querySelectorAll('a[id^="cmnt"]').forEach(el => el.remove());
  doc.querySelectorAll('sup a[href^="#cmnt"]').forEach(el => el.parentElement?.remove());
  doc.querySelectorAll('div[id^="footnote"]').forEach(el => el.remove());

  // Process the body
  const body = doc.body;

  // Convert styled spans to semantic HTML
  convertStyledSpans(body);

  // Remove all style attributes
  body.querySelectorAll('[style]').forEach(el => {
    el.removeAttribute('style');
  });

  // Remove all class attributes
  body.querySelectorAll('[class]').forEach(el => {
    el.removeAttribute('class');
  });

  // Remove all id attributes (except on headings for anchoring)
  body.querySelectorAll('[id]').forEach(el => {
    if (!el.tagName.match(/^H[1-6]$/)) {
      el.removeAttribute('id');
    }
  });

  // Unwrap unnecessary wrapper divs (but keep structural ones)
  unwrapDivs(body);

  // Remove empty paragraphs that Google adds
  body.querySelectorAll('p').forEach(p => {
    if (!p.textContent?.trim() && !p.querySelector('img, br')) {
      p.remove();
    }
  });

  // Remove Google's <span> wrappers that have no attributes
  unwrapEmptySpans(body);

  // Normalize whitespace
  let result = body.innerHTML;
  result = result.replace(/\n\s*\n\s*\n/g, '\n\n');
  result = result.trim();

  return result;
}

/**
 * Convert Google's inline-styled spans to semantic HTML tags
 */
function convertStyledSpans(container: HTMLElement): void {
  const spans = container.querySelectorAll('span[style]');

  spans.forEach(span => {
    const style = span.getAttribute('style') || '';

    // Bold detection
    const isBold = style.includes('font-weight:700') ||
                   style.includes('font-weight: 700') ||
                   style.includes('font-weight:bold') ||
                   style.includes('font-weight: bold');

    // Italic detection
    const isItalic = style.includes('font-style:italic') ||
                     style.includes('font-style: italic');

    // Underline detection
    const isUnderline = style.includes('text-decoration:underline') ||
                        style.includes('text-decoration: underline') ||
                        style.includes('text-decoration-line:underline') ||
                        style.includes('text-decoration-line: underline');

    // Strikethrough detection
    const isStrikethrough = style.includes('text-decoration:line-through') ||
                            style.includes('text-decoration: line-through') ||
                            style.includes('text-decoration-line:line-through') ||
                            style.includes('text-decoration-line: line-through');

    let wrapper: HTMLElement = span as HTMLElement;

    if (isBold) {
      const strong = document.createElement('strong');
      strong.innerHTML = wrapper.innerHTML;
      wrapper.innerHTML = '';
      wrapper.appendChild(strong);
      wrapper = strong;
    }

    if (isItalic) {
      const em = document.createElement('em');
      em.innerHTML = wrapper.innerHTML;
      wrapper.innerHTML = '';
      wrapper.appendChild(em);
      wrapper = em;
    }

    if (isUnderline) {
      const u = document.createElement('u');
      u.innerHTML = wrapper.innerHTML;
      wrapper.innerHTML = '';
      wrapper.appendChild(u);
    }

    if (isStrikethrough) {
      const s = document.createElement('s');
      s.innerHTML = wrapper.innerHTML;
      wrapper.innerHTML = '';
      wrapper.appendChild(s);
    }
  });
}

/**
 * Unwrap div elements that are just wrappers (no semantic meaning)
 */
function unwrapDivs(container: HTMLElement): void {
  const divs = Array.from(container.querySelectorAll('div'));

  divs.forEach(div => {
    // Skip if div has meaningful attributes
    if (div.id || div.getAttribute('role')) return;

    // Replace div with its children
    const parent = div.parentNode;
    if (!parent) return;

    while (div.firstChild) {
      parent.insertBefore(div.firstChild, div);
    }
    parent.removeChild(div);
  });
}

/**
 * Unwrap span elements that have no attributes (just wrappers)
 */
function unwrapEmptySpans(container: HTMLElement): void {
  const spans = Array.from(container.querySelectorAll('span'));

  spans.forEach(span => {
    // If span has no attributes, it's just a wrapper — unwrap it
    if (span.attributes.length === 0) {
      const parent = span.parentNode;
      if (!parent) return;

      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      parent.removeChild(span);
    }
  });
}

// stripHtml / countWords now live in `@/utils/text` (single source of truth —
// this file's old `split(' ')` variant miscounted on multiple spaces).
export { stripHtml, countWords } from './text';
