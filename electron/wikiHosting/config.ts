import path from 'node:path';

const configuredPort = () => Number(process.env.WH_WIKI_HOST_PORT || 5184);

export function wikiStandaloneConfig() {
  const directory = process.env.WH_WIKI_HOST_DATA_DIR;
  const port = configuredPort();
  if (!directory || !path.isAbsolute(directory)) throw Error('WH_WIKI_HOST_DATA_DIR must be an absolute wiki registry directory.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('WH_WIKI_HOST_PORT must be a port between 1 and 65535.');
  return {
    file: path.join(directory, 'sites.sqlite'), port,
    publicOrigin: process.env.WH_WIKI_HOST_PUBLIC_ORIGIN,
  };
}

export function wikiHostingConfig(userData: string) {
  const mode = process.env.WH_WIKI_HOST_MODE || 'embedded';
  if (mode === 'external') return { ...wikiStandaloneConfig(), externalReader: true };
  if (mode !== 'embedded') throw Error('WH_WIKI_HOST_MODE must be embedded or external.');
  return {
    file: path.join(process.env.WH_WIKI_HOST_DATA_DIR || path.join(userData, 'wiki-hosting'), 'sites.sqlite'),
    port: configuredPort(),
    publicOrigin: process.env.WH_WIKI_HOST_PUBLIC_ORIGIN,
  };
}
