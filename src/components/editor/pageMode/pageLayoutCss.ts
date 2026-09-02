/**
 * The GEOMETRY of page mode, injected by the extension into the document it
 * runs in (`<style data-wh-page-layout>`, once per document).
 *
 * These rules are the other half of the arithmetic in `pagination.ts` and
 * `PageLayout.ts`: the sheet is a flex column so block margins never
 * collapse and a block's margin box starts exactly where the previous one
 * ended; the foot of a page is `fill + margin` tall so that, with the gap
 * band and the next page's head, every page comes out exactly one sheet
 * high. Change a height here and the measurement no longer describes what
 * is on screen — which is why they live next to the code and not in the
 * app's stylesheet. Colours, shadows and typefaces are the app's business:
 * see "page mode" in `src/index.css`.
 *
 * The sheet's `--wh-page-width/height/margin` are set inline by the plugin
 * from `PAGE_SIZES`, so the numbers have one home.
 *
 * `div.ProseMirror[…]` on purpose: one point of specificity over the app's
 * `.tiptap-editor .ProseMirror`, so the sheet's padding and width win no
 * matter which stylesheet the document loaded last.
 */
export const PAGE_LAYOUT_STYLE_ATTRIBUTE = 'data-wh-page-layout';

export const PAGE_LAYOUT_CSS = `
div.ProseMirror[data-page-size] {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: var(--wh-page-width);
  max-width: none;
  min-height: var(--wh-page-height);
  padding: var(--wh-page-margin);
  margin: 0 auto;
}
div.ProseMirror[data-page-size] > * {
  min-width: 0;
}
/* A replaced element stretches to the column's width as a flex item; an
   image keeps its own. */
div.ProseMirror[data-page-size] > img {
  align-self: flex-start;
}
/* An image taller than the text area cannot be cut between lines: it is
   scaled to fit one page, or the block would be taller than a sheet and the
   sheet would grow with it. */
div.ProseMirror[data-page-size] img {
  max-height: calc(var(--wh-page-height) - 2 * var(--wh-page-margin));
  object-fit: contain;
}
div.ProseMirror[data-page-size] .wh-page-break {
  display: block;
  box-sizing: border-box;
  width: var(--wh-page-width);
  /* Up over the bottom margin of the block before (--pull, set by the
     plugin), so the foot starts at the text's bottom edge; out over the
     sheet's padding (and any list indent measured into --wh-indent), so
     the gap band crosses the whole sheet. */
  margin: calc(-1 * var(--pull, 0px)) 0 0 calc(-1 * var(--wh-page-margin) - var(--wh-indent, 0px));
  padding: 0;
  user-select: none;
  -webkit-user-select: none;
}
div.ProseMirror[data-page-size] .wh-page-foot {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  min-height: calc(var(--fill) + var(--wh-page-margin));
  padding: 0 var(--wh-page-margin);
}
div.ProseMirror[data-page-size] .wh-page-break--last .wh-page-foot {
  /* The sheet's own bottom padding is the last page's bottom margin: the
     foot hangs down into it, so the page number sits where it does on
     every other page and the sheet ends exactly one page after it began. */
  margin-bottom: calc(-1 * var(--wh-page-margin));
}
/* 1 + 6 + 12 = 19px around the notes: NOTES_BLOCK_PX in PageLayout.ts. */
div.ProseMirror[data-page-size] .wh-page-notes {
  box-sizing: border-box;
  border-top: 1px solid transparent;
  margin: 0 0 12px;
  padding: 6px 0 0 1.5em;
}
div.ProseMirror[data-page-size] .wh-page-notes li {
  margin: 0 0 2px;
}
div.ProseMirror[data-page-size] .wh-page-number {
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--wh-page-margin);
  margin: 0;
}
div.ProseMirror[data-page-size] .wh-page-gap {
  height: var(--wh-page-gap, 24px);
}
div.ProseMirror[data-page-size] .wh-page-head {
  height: var(--wh-page-margin);
}
`;

/** Put the geometry in the document once. Safe to call on every mount. */
export function ensurePageLayoutStyle(doc: Document): void {
  if (doc.head.querySelector(`style[${PAGE_LAYOUT_STYLE_ATTRIBUTE}]`)) return;
  const style = doc.createElement('style');
  style.setAttribute(PAGE_LAYOUT_STYLE_ATTRIBUTE, '');
  style.textContent = PAGE_LAYOUT_CSS;
  doc.head.appendChild(style);
}
