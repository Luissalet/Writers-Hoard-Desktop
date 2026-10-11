// Live tools/list for #309: start the worktree AI bridge and check trimmed descs.
//   electron scripts/live-mcp-desc-list.cjs
const { app } = require('electron');
const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');

const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-309-live-'));
app.setPath('userData', path.join(directory, 'profile'));

function assert(value, note) {
  if (!value) throw new Error(note);
}

async function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

function getJson(url, token) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
  });
}

async function main() {
  process.env.WH_AIBRIDGE_PORT = String(await freePort());
  await esbuild.build({
    stdin: {
      contents: `export * from './electron/aibridge/server'; export * from './electron/aibridge/state'; export * from './electron/aibridge/rpc';`,
      resolveDir: root,
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    alias: { '@': path.join(root, 'src') },
    outfile: path.join(directory, 'native.cjs'),
  });
  await app.whenReady();
  const native = require(path.join(directory, 'native.cjs'));
  // writesEnabled must be true so write tools (wh_grade_source) appear in /api/tools.
  await native.setBridgeConfig({ enabled: true, writesEnabled: true });
  const token = await native.getBridgeToken();
  await native.startAiBridge({ version: 'task-309-live', hasWindow: () => false });
  try {
    const base = native.AI_BRIDGE_URL || `http://127.0.0.1:${process.env.WH_AIBRIDGE_PORT}`;
    const catalogue = await getJson(`${base}/api/tools`, token);
    assert(catalogue.ok && Array.isArray(catalogue.tools), 'GET /api/tools ok');
    for (const name of ['wh_list_claims', 'wh_grade_source']) {
      const tool = catalogue.tools.find((t) => t.name === name);
      assert(tool, `${name} in live catalogue`);
      const chars = (tool.description || '').length;
      const tokens = Math.ceil(chars / 3);
      assert(chars <= 750, `${name} live desc ${chars} chars`);
      assert(tokens <= 250, `${name} live ~${tokens} tokens`);
      console.log(`PASS live ${name}: ${chars} chars (~${tokens} tokens)`);
    }
    const oversized = catalogue.tools
      .filter((t) => (t.description || '').length > 1000)
      .map((t) => `${t.name}:${t.description.length}`);
    assert(oversized.length === 0, `live oversized: ${oversized.join(', ')}`);
    console.log(`PASS live /api/tools catalogue ${catalogue.tools.length} tools, all ≤1000 chars`);
  } finally {
    native.stopAiBridge();
    fs.rmSync(directory, { recursive: true, force: true });
  }
  app.exit(0);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
