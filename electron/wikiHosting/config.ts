import path from 'node:path';

export function wikiHostingConfig(userData: string) {
  return {
    file: path.join(process.env.WH_WIKI_HOST_DATA_DIR || path.join(userData, 'wiki-hosting'), 'sites.sqlite'),
    port: Number(process.env.WH_WIKI_HOST_PORT || 5184),
    publicOrigin: process.env.WH_WIKI_HOST_PUBLIC_ORIGIN,
  };
}
