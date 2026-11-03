export interface WikiHostOwner {
  projectId: string;
  profileId: string;
}

export type WikiHostListScope = Partial<WikiHostOwner>;

export type WikiHostAudience = 'public' | 'unlisted';

export interface WikiHostAddress extends WikiHostOwner {
  slug: string;
  editionId: string;
  audience: WikiHostAudience;
  sha256: string;
  revision: number;
  active: boolean;
  url: string | null;
}

export interface WikiHostChange extends WikiHostOwner {
  slug: string;
  expectedRevision: number;
}

export interface WikiHostPublication extends WikiHostChange {
  editionId: string;
  audience: WikiHostAudience;
  sha256: string;
  html: string;
}

export const WIKI_HOST_MANAGE_PATH = '/__wh_wiki_host';
export const WIKI_HOST_SLUG = /^[a-z0-9](?:[a-z0-9\x2d]{0,62}[a-z0-9])?$/;
