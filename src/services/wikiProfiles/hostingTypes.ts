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
  coverUrl?: string;
}

export interface WikiHostChange extends WikiHostOwner {
  slug: string;
  expectedRevision: number;
}

export interface WikiHostSelection extends WikiHostChange {
  editionId: string;
  audience: WikiHostAudience;
  /** Omit to retain a cover, or pass null to remove it. */
  coverImage?: string | null;
}

export interface WikiHostPublication extends WikiHostSelection {
  sha256: string;
  html: string;
}

export const WIKI_HOST_COVER_IMAGE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})(?![\s\S])/;
export const WIKI_HOST_MANAGE_PATH = '/__wh_wiki_host';
export const WIKI_HOST_SLUG = /^[a-z0-9](?:[a-z0-9\x2d]{0,62}[a-z0-9])?$/;
