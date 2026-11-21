const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { parentPort, workerData } = require('node:worker_threads');

const { root, host, harnessPath, entry, entryUrl } = workerData;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, host, () => {
      const { port } = probe.address();
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function serve() {
  // The checkout and fixture affect the dependency graph even with the same lockfile.
  const cacheKey = createHash('sha256')
    .update(root).update('\0').update(entryUrl).update('\0')
    .update(readFileSync(path.join(root, 'package-lock.json')))
    .digest('hex');
  const cacheDir = path.join(os.tmpdir(), 'wh-focused-vite', cacheKey);

  const { createServer } = await import('vite');
  const server = await createServer({
    root,
    configFile: path.join(root, 'vite.config.ts'),
    mode: 'test',
    base: '/',
    cacheDir,
    logLevel: 'error',
    // Without a mode, the source-tool bootstrap leaves registration to the fixture.
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.MODE': 'undefined' },
    optimizeDeps: { entries: [entry.replaceAll(path.sep, '/')] },
    server: { host, port: await freePort(), strictPort: true, hmr: false },
    plugins: [{
      name: 'focused-browser-test-page',
      configureServer(devServer) {
        devServer.middlewares.use(harnessPath, (_request, response) => {
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>');
        });
      },
    }],
  });

  try {
    await server.listen();
    parentPort.postMessage(server.httpServer.address().port);
    await new Promise(resolve => parentPort.once('message', resolve));
  } finally {
    await server.close();
  }
}

serve().then(() => process.exit(0), error => {
  console.error(error.stack || error);
  process.exit(1);
});
