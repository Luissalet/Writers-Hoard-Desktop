import { wikiStandaloneConfig } from './config';

async function run() {
  if (process.argv.includes('--help')) {
    console.log('Writer wiki reader: set WH_WIKI_HOST_DATA_DIR to the absolute registry directory. Optional: WH_WIKI_HOST_PORT (default 5184) and WH_WIKI_HOST_PUBLIC_ORIGIN. Press Ctrl+C to stop.');
    return;
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 19)) throw Error('Node.js 22.19 or later is required.');
  const config = wikiStandaloneConfig();
  const { createStandaloneWikiReader } = await import('./server');
  const reader = createStandaloneWikiReader(config);
  await reader.start();
  console.log(`Writer wiki reader: ${reader.origin()} (${config.file})`);
  function stop() {
    void reader.close().catch(report);
  }
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

function report(reason: unknown) {
  console.error(`Writer wiki reader: ${reason instanceof Error ? reason.message : String(reason)}`);
  process.exitCode = 1;
}

void run().catch(report);
