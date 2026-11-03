import { getWikiEdition } from './store';
import {
  WIKI_HOST_MANAGE_PATH,
  type WikiHostAddress, type WikiHostAudience, type WikiHostChange, type WikiHostListScope,
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

export async function serveWikiEdition(input: WikiHostChange & { editionId: string; audience: WikiHostAudience }) {
  const edition = await getWikiEdition(input.projectId, input.profileId, input.editionId);
  return manage<WikiHostAddress>('publish', { ...input, sha256: edition.reader.sha256, html: edition.reader.html });
}

export function withdrawWikiAddress(input: WikiHostChange) {
  return manage<WikiHostAddress>('withdraw', input);
}
