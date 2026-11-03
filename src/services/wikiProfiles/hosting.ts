import {
  WIKI_HOST_COVER_IMAGE, WIKI_HOST_MANAGE_PATH,
  type WikiHostAddress, type WikiHostChange, type WikiHostListScope, type WikiHostSelection,
} from './hostingTypes';

async function manage<T>(action: string, input: object): Promise<T> {
  const response = await fetch(WIKI_HOST_MANAGE_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, input }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body === null) throw Error(body?.error ?? 'wiki_host_unavailable');
  return body as T;
}

export function listWikiAddresses(owner: WikiHostListScope) {
  return manage<WikiHostAddress[]>('list', owner);
}

export async function serveWikiEdition(input: WikiHostSelection) {
  if (input.coverImage != null) {
    if (!WIKI_HOST_COVER_IMAGE.test(input.coverImage)) throw Error('wiki_host_cover_invalid');
    const image = new Image();
    image.src = input.coverImage;
    await image.decode().catch(() => { throw Error('wiki_host_cover_invalid'); });
    if (!image.naturalWidth || !image.naturalHeight) throw Error('wiki_host_cover_invalid');
  }
  const { getWikiEdition } = await import('./store');
  const edition = await getWikiEdition(input.projectId, input.profileId, input.editionId);
  return manage<WikiHostAddress>('publish', { ...input, sha256: edition.reader.sha256, html: edition.reader.html });
}

export function withdrawWikiAddress(input: WikiHostChange) {
  return manage<WikiHostAddress>('withdraw', input);
}
