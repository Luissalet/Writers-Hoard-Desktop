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

/**
 * Manuscript editions share the wiki registry and reader but live under
 * `/read/<slug>`. Their storage key carries this prefix, which the wiki slug
 * grammar cannot produce, so a wiki and a reading address may use the same
 * public slug without touching each other's rows.
 */
export const READ_HOST_KEY_PREFIX = 'read:';

export interface ReadHostOwner {
  projectId: string;
  /** JSON `[scope, manuscriptId|null, eraId|null]` derived from the saved edition. */
  ownerKey: string;
}

export type ReadHostListScope = Partial<ReadHostOwner>;

export interface ReadHostAddress extends ReadHostOwner {
  kind: 'manuscript-edition';
  slug: string;
  editionId: string;
  audience: WikiHostAudience;
  sha256: string;
  revision: number;
  active: boolean;
  url: string | null;
}

export interface ReadHostChange extends ReadHostOwner {
  slug: string;
  expectedRevision: number;
}

export interface ReadHostPublication extends ReadHostChange {
  editionId: string;
  audience: WikiHostAudience;
  sha256: string;
  html: string;
}

export const WIKI_HOST_COVER_IMAGE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})(?![\s\S])/;
export const WIKI_HOST_MANAGE_PATH = '/__wh_wiki_host';
export const WIKI_HOST_SLUG = /^[a-z0-9](?:[a-z0-9\x2d]{0,62}[a-z0-9])?$/;
