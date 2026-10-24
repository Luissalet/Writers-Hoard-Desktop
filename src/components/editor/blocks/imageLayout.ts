export const IMAGE_ALIGNS = ['left', 'center', 'right'] as const;
export type ImageAlign = typeof IMAGE_ALIGNS[number];
export const imageAlign = (value: unknown): ImageAlign | null => (IMAGE_ALIGNS as readonly unknown[]).includes(value) ? value as ImageAlign : null;
export const isInlineRaster = (value: unknown): value is string => typeof value === 'string' && /^data:image\/(?:avif|bmp|gif|jpe?g|png|webp);base64,[a-z\d+/=\s]+$/i.test(value);

// Separate from WRITING_BLOCKS_CSS: legacy exports retain their exact bytes.
// Every selector requires explicit, admitted alignment; legacy siblings stay untouched.
const aligned = 'img:is([data-wh-align="left"],[data-wh-align="center"],[data-wh-align="right"])';
export const NOTE_IMAGE_LAYOUT_CSS = `${aligned}{display:block;height:auto}${['25', '50', '75', '100'].map(width => `${aligned}[data-wh-width="${width}"]{width:${width}%}`).join('')}${aligned}[data-wh-width="page"]{width:100%;max-width:100%}${aligned}[data-wh-frame="border"]{border:3px solid currentColor;padding:2px}${aligned}[data-wh-frame="rounded"]{border-radius:16px}${aligned}[data-wh-frame="polaroid"]{background:#fff;padding:10px 10px 34px;box-shadow:0 3px 12px rgba(0,0,0,.3);transform:rotate(-1.2deg)}img[data-wh-align][data-wh-align="left"]{margin-left:0;margin-right:auto}img[data-wh-align][data-wh-align="center"]{margin-left:auto;margin-right:auto}img[data-wh-align][data-wh-align="right"]{margin-left:auto;margin-right:0}`;

/** Call against final sanitized/published HTML, after image and document omissions. */
export function noteImageLayoutCss(html: string): string {
  if (!html.includes('data-wh-align')) return '';
  const template = document.createElement('template'); template.innerHTML = html;
  return [...template.content.querySelectorAll('img')].some(image => imageAlign(image.getAttribute('data-wh-align')) && isInlineRaster(image.getAttribute('src'))) ? NOTE_IMAGE_LAYOUT_CSS : '';
}

export function ensureNoteImageLayout(doc: Document): void {
  if (doc.getElementById('wh-note-image-layout')) return;
  const style = doc.createElement('style'); style.id = 'wh-note-image-layout'; style.textContent = NOTE_IMAGE_LAYOUT_CSS; doc.head.append(style);
}
