export const CODEX_IMAGE_ATTRIBUTE = 'data-wh-codex-image';
export const CODEX_THUMBNAIL_ATTRIBUTE = 'data-wh-codex-thumbnail';

/** Syntax only: parsing prose never reads a project or a card. */
export function codexImageTarget(href: unknown): { projectId: string; entryId: string } | undefined {
  if (typeof href !== 'string') return;
  try {
    const url = new URL(href, 'https://writer.invalid');
    const match = /^\/project\/([^/]+)\/codex$/.exec(url.pathname);
    if (url.origin !== 'https://writer.invalid' || !match) return;
    const projectId = decodeURIComponent(match[1]), entryId = url.searchParams.get('entry');
    if ([projectId, entryId].every(id => id && id.length <= 500 && !Array.from(id).some(character => character.charCodeAt(0) < 32))) return { projectId, entryId: entryId! };
  } catch { /* Ordinary or malformed links carry no image preference. */ }
}

/** Derived pixels never become authored images when pasted/reimported. */
export function stripCodexThumbnails(html: string): string {
  if (!html.includes(CODEX_THUMBNAIL_ATTRIBUTE)) return html;
  const host = document.createElement('template'); host.innerHTML = html;
  host.content.querySelectorAll(`img[${CODEX_THUMBNAIL_ATTRIBUTE}="true"]`).forEach(image => image.remove());
  return host.innerHTML;
}

export function createCodexThumbnail(owner: Document, avatar: string): HTMLImageElement {
  const image = owner.createElement('img');
  image.setAttribute(CODEX_THUMBNAIL_ATTRIBUTE, 'true'); image.src = avatar;
  image.alt = ''; image.setAttribute('aria-hidden', 'true'); image.contentEditable = 'false';
  image.style.cssText = 'display:inline-block;height:1.1em;width:auto;max-width:2em;object-fit:contain;vertical-align:-0.15em;margin-inline-end:0.25em';
  return image;
}

/** Caller supplies the admitted/captured cut. There is deliberately no DB fallback. */
export function projectCodexImages(container: ParentNode, projectId: string, entries: readonly { id: string; projectId: string; avatar?: string }[], includeImages = true): void {
  container.querySelectorAll(`img[${CODEX_THUMBNAIL_ATTRIBUTE}="true"]`).forEach(image => image.remove());
  if (!includeImages) return;
  const admitted = new Map(entries.filter(entry => entry.projectId === projectId).map(entry => [entry.id, entry]));
  let previous: HTMLAnchorElement | undefined;
  for (const anchor of container.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const block = 'p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,pre,div';
    let continuation = false;
    if (previous && previous.closest(block) === anchor.closest(block) && ['href','target','rel','class','title',CODEX_IMAGE_ATTRIBUTE].every(attribute => previous!.getAttribute(attribute) === anchor.getAttribute(attribute))) {
      const gap = anchor.ownerDocument.createRange(); gap.setStartAfter(previous); gap.setEndBefore(anchor);
      const fragment = gap.cloneContents();
      continuation = !fragment.textContent && !fragment.querySelector('br,img,hr,[contenteditable="false"]');
    }
    previous = anchor;
    if (continuation || anchor.getAttribute(CODEX_IMAGE_ATTRIBUTE) !== 'true' || !anchor.textContent) continue;
    const target = codexImageTarget(anchor.getAttribute('href'));
    const avatar = target?.projectId === projectId ? admitted.get(target.entryId)?.avatar : undefined;
    if (avatar && /^data:image\/(png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+$/i.test(avatar)) anchor.prepend(createCodexThumbnail(anchor.ownerDocument, avatar));
  }
}
