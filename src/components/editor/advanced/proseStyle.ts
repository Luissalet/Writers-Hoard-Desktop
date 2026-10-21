/** Shared content CSS; static HTML/PDF may add display-only initial wrappers. */
export const EDITORIAL_PROSE_CSS=`
[data-wh-small-caps="true"]{font-variant:small-caps;font-variant-caps:small-caps}
[data-wh-small-caps="false"]{font-variant:normal;font-variant-caps:normal}
[data-wh-drop-cap="true"]{text-indent:0!important}
[data-wh-drop-cap="true"]:not([data-wh-drop-cap-rendered="true"])::first-letter{float:left;font-size:3.2em;line-height:.85;margin:.05em .12em 0 0;font-weight:inherit}
[data-wh-drop-cap-rendered="true"]>.wh-drop-cap-initial{float:left;font-size:3.2em;line-height:.85;margin:.05em .12em 0 0;font-weight:inherit}
hr[data-wh-ornament]{display:block;position:relative;height:2em;margin:1.5em auto;border:0;overflow:visible;clear:both;text-align:center;break-inside:avoid;color:inherit}
hr[data-wh-ornament]::after{display:block;font:inherit;font-size:1.1em;line-height:2em;letter-spacing:.15em;text-indent:0}
hr[data-wh-ornament="line"]::after{content:"—"}
hr[data-wh-ornament="asterism"]::after{content:"⁂"}
hr[data-wh-ornament="dots"]::after{content:"• • •"}
hr[data-wh-ornament="diamond"]::after{content:"◇"}
hr[data-wh-ornament="space"]::after{content:""}
.wh-scene-break{clear:both;text-align:center;text-indent:0!important;margin:1.5em 0;min-height:1em;break-inside:avoid;letter-spacing:.15em}
`;

/** Static HTML/PDF only: never pass a live editor DOM into this preparation. */
export function prepareStaticEditorialHtml(html: string): string {
  if (!html.includes('data-wh-drop-cap')) return html;
  const document = new DOMParser().parseFromString(html, 'text/html');
  let changed = false;
  for (const paragraph of Array.from(document.querySelectorAll('p[data-wh-drop-cap="true"]'))) {
    if (paragraph.hasAttribute('data-wh-drop-cap-rendered')) continue;
    const text = paragraph.textContent ?? '';
    let length = 0;
    for (const { segment, index } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
      length = index + segment.length;
      if (!/^[\s\p{P}]+$/u.test(segment)) break;
    }
    if (!length || !/[\p{L}\p{N}]/u.test(text.slice(0, length))) continue;
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode(), remaining = length;
    const first = node;
    while (node && remaining > (node.textContent?.length ?? 0)) {
      remaining -= node.textContent?.length ?? 0;
      node = walker.nextNode();
    }
    if (!first || !node) continue;
    const range = document.createRange();
    range.setStart(paragraph, 0);
    range.setEnd(node, remaining);
    // An atomic inline object is not an initial; leave its existing rendering.
    if (range.cloneContents().querySelector('img,br,video,audio,svg,math,input,button,sup,[data-tool-block]')) continue;
    const initial = document.createElement('span');
    initial.className = 'wh-drop-cap-initial';
    initial.append(range.extractContents());
    range.insertNode(initial);
    paragraph.setAttribute('data-wh-drop-cap-rendered', 'true');
    changed = true;
  }
  return changed ? document.body.innerHTML : html;
}
