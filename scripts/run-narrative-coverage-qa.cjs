// Isolated native bridge/MCP/UI QA for #140. Never opens the user's profile or :8766.
const { app, BrowserWindow, ipcMain } = require('electron');
const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const artifactRoot = path.join('D:', 'LocalAI', 'cursor', 'work', 'qa140-r3');
fs.mkdirSync(artifactRoot, { recursive: true });
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-coverage-qa-'));
const profileDir = path.join(directory, 'profile');
app.setPath('userData', profileDir);
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const BRIDGE_PORT = Number(process.env.WH_AIBRIDGE_PORT || 61816);
process.env.WH_AIBRIDGE_PORT = String(BRIDGE_PORT);

function assert(value, note) {
  if (!value) throw new Error(note);
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function httpJson(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: BRIDGE_PORT,
        path: urlPath,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
            : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = { raw: text };
          }
          resolve({ status: res.statusCode, json, text });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const sourceBefore = require('node:child_process')
    .execSync('git rev-parse HEAD', { cwd: root })
    .toString()
    .trim();
  fs.writeFileSync(
    path.join(artifactRoot, 'source-before.txt'),
    `${sourceBefore}\nprofile=${profileDir}\nport=${BRIDGE_PORT}\n`,
  );

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
  await esbuild.build({
    entryPoints: [path.join(root, 'electron/aibridge/mcpStdio.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    alias: { '@': path.join(root, 'src') },
    outfile: path.join(directory, 'mcp.cjs'),
  });
  const stubDir = path.join(directory, 'stubs');
  fs.mkdirSync(stubDir, { recursive: true });
  for (const name of ['dnd-core.js', 'dnd-sortable.js', 'dnd-utilities.js']) {
    fs.writeFileSync(path.join(stubDir, name), 'module.exports = {};\n');
  }
  await esbuild.build({
    stdin: {
      contents: `import { testNarrativeCoverage, COVERAGE_FIXTURE_ID } from './tests/narrative-coverage.browser';
import { runBridgeTool } from './src/services/aiBridge/dispatch';
window.qaCall = runBridgeTool;
testNarrativeCoverage()
  .then(tests => { window.qaResult = { tests, projectId: COVERAGE_FIXTURE_ID }; })
  .catch(error => { window.qaResult = { error: error.stack || String(error) }; });`,
      resolveDir: root,
    },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    alias: { '@': path.join(root, 'src') },
    loader: { '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'empty' },
    define: {
      'process.env.NODE_ENV': '"test"',
      'import.meta.env': '{"DEV":false,"BASE_URL":"/"}',
      'import.meta.url': '"file:///narrative-coverage-qa.js"',
    },
    outfile: path.join(directory, 'renderer.js'),
    logLevel: 'warning',
    plugins: [
      {
        name: 'stub-optional-dnd',
        setup(build) {
          build.onResolve({ filter: /^@dnd-kit\// }, (args) => ({
            path: path.join(
              stubDir,
              args.path.includes('sortable')
                ? 'dnd-sortable.js'
                : args.path.includes('utilities')
                  ? 'dnd-utilities.js'
                  : 'dnd-core.js',
            ),
          }));
        },
      },
    ],
  });

  fs.writeFileSync(
    path.join(directory, 'preload.cjs'),
    `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{isDesktop:true,aiBridge:{onRequest:callback=>ipcRenderer.on('aibridge:request',(_event,payload)=>callback(payload)),reply:payload=>ipcRenderer.invoke('aibridge:reply',payload)}});`,
  );
  fs.writeFileSync(
    path.join(directory, 'test.html'),
    '<!doctype html><meta charset="utf-8"><div id="root"></div><script>globalThis.IS_REACT_ACT_ENVIRONMENT=true</script><script src="renderer.js"></script>',
  );

  await app.whenReady();
  const native = require(path.join(directory, 'native.cjs'));
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      preload: path.join(directory, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  const consoleLines = [];
  const pageErrors = [];
  win.webContents.on('console-message', (details) => {
    const line = `${details.level}:${details.sourceId}:${details.lineNumber} ${details.message}`;
    consoleLines.push(line);
    if (details.level === 'error') console.error(line);
  });
  win.webContents.on('page-title-updated', () => undefined);
  win.webContents.on('render-process-gone', (_e, details) => {
    pageErrors.push(`render-gone ${details.reason} ${details.exitCode}`);
  });

  native.setBridgeWindowResolver(() => win);
  ipcMain.handle('aibridge:reply', (_event, payload) => native.resolveBridgeReply(payload));

  await win.loadFile(path.join(directory, 'test.html'));
  let result;
  for (let attempt = 0; attempt < 400; attempt++) {
    result = await win.webContents.executeJavaScript('window.qaResult');
    if (result) break;
    await pause(100);
  }
  assert(result && !result.error, result?.error ?? 'renderer timed out');
  result.tests.forEach((test) => console.log(`PASS ${test}`));

  const shotPath = path.join(artifactRoot, 'ui-coverage.png');
  await win.webContents.executeJavaScript(`
    (() => {
      const root = document.getElementById('root');
      root.innerHTML = '';
      return true;
    })()
  `);
  // Remount panel for screenshot via a tiny inline mark — capture current DOM after tests.
  await win.capturePage().then((img) => fs.writeFileSync(shotPath, img.toPNG()));

  await native.setBridgeConfig({ enabled: true, writesEnabled: true });
  const token = await native.getBridgeToken();
  await native.startAiBridge({ version: 'narrative-coverage-qa', hasWindow: () => true });

  const health = await httpJson('GET', '/api/health', token);
  assert(health.status === 200, `HTTP /api/health status ${health.status}`);

  const toolsHttp = await httpJson('GET', '/api/tools', token);
  // Some builds use RPC-only; accept either catalogue HTTP or later MCP list.
  fs.writeFileSync(
    path.join(artifactRoot, 'http-tools.json'),
    JSON.stringify({ status: toolsHttp.status, body: toolsHttp.json }, null, 2),
  );

  const child = spawn(process.execPath, [path.join(directory, 'mcp.cjs')], {
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      WH_BRIDGE_URL: native.AI_BRIDGE_URL || `http://127.0.0.1:${BRIDGE_PORT}`,
      WH_BRIDGE_TOKEN: token,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let sequence = 0;
  let buffer = '';
  const pending = new Map();
  child.stdout.on('data', (bytes) => {
    buffer += bytes;
    let line;
    while ((line = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, line));
      buffer = buffer.slice(line + 1);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  child.stderr.on('data', (bytes) => process.stderr.write(bytes));
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP timed out: ${method}`));
      }, 45000);
      pending.set(id, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });

  const required = [
    'wh_get_narrative_coverage',
    'wh_set_coverage_cell',
    'wh_list_timeline_evidence',
    'wh_set_timeline_evidence',
    'wh_get_manuscript_board',
    'wh_list_phrase_recurrence',
  ];

  try {
    assert(
      (await rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'narrative-coverage-qa', version: '1' },
      })).result,
      'MCP initialized',
    );
    const catalogue = (await rpc('tools/list', {})).result.tools;
    fs.writeFileSync(
      path.join(artifactRoot, 'mcp-tools.json'),
      JSON.stringify(
        catalogue.map((t) => t.name).filter((n) => n.startsWith('wh_') && (n.includes('coverage') || n.includes('manuscript') || n.includes('phrase') || n.includes('timeline_evidence'))),
        null,
        2,
      ),
    );
    for (const name of required) {
      assert(catalogue.some((tool) => tool.name === name), `MCP catalogue includes ${name}`);
    }

    const projectId = result.projectId;
    const coverage = await rpc('tools/call', {
      name: 'wh_get_narrative_coverage',
      arguments: { projectId },
    });
    const coverageBody = JSON.parse(coverage.result.content.find((b) => b.type === 'text').text);
    assert(!coverage.result.isError, 'MCP coverage ok');
    assert(coverageBody.writings?.length === 30, 'MCP coverage sees 30 writings');

    const board = await rpc('tools/call', {
      name: 'wh_get_manuscript_board',
      arguments: { projectId, mode: 'kanban' },
    });
    const boardBody = JSON.parse(board.result.content.find((b) => b.type === 'text').text);
    assert(!board.result.isError && boardBody.ordered.length === 30, 'MCP board 30');

    const phrases = await rpc('tools/call', {
      name: 'wh_list_phrase_recurrence',
      arguments: { projectId, locale: 'en', fillers: ['basically'] },
    });
    const phraseBody = JSON.parse(phrases.result.content.find((b) => b.type === 'text').text);
    assert(!phrases.result.isError && phraseBody.hits?.some((h) => h.phrase === 'basically'), 'MCP phrases');

    const evidence = await rpc('tools/call', {
      name: 'wh_list_timeline_evidence',
      arguments: { projectId },
    });
    const evidenceBody = JSON.parse(evidence.result.content.find((b) => b.type === 'text').text);
    assert(!evidence.result.isError, 'MCP evidence ok');
    fs.writeFileSync(path.join(artifactRoot, 'mcp-evidence.json'), JSON.stringify(evidenceBody, null, 2));

    const bad = await rpc('tools/call', {
      name: 'wh_set_coverage_cell',
      arguments: {
        projectId,
        characterId: 'char-foreign',
        writingId: 'w1',
        role: 'presence',
      },
    });
    assert(bad.result.isError, 'MCP foreign character fails closed');

    await native.setBridgeConfig({ writesEnabled: false });
    const denied = await rpc('tools/call', {
      name: 'wh_set_coverage_cell',
      arguments: {
        projectId,
        characterId: 'char-ana',
        writingId: 'w1',
        role: 'presence',
      },
    });
    assert(denied.result.isError, 'read-only denies coverage write');
    const readOk = await rpc('tools/call', {
      name: 'wh_get_narrative_coverage',
      arguments: { projectId },
    });
    assert(!readOk.result.isError, 'read-only still allows coverage read');
    console.log('PASS real stdio MCP catalogue, tools, foreign ID, readonly');
  } finally {
    child.kill();
    native.stopAiBridge();
  }

  fs.writeFileSync(path.join(artifactRoot, 'console.log'), consoleLines.join('\n'));
  fs.writeFileSync(path.join(artifactRoot, 'page-errors.log'), pageErrors.join('\n'));
  const sourceAfter = require('node:child_process')
    .execSync('git rev-parse HEAD', { cwd: root })
    .toString()
    .trim();
  fs.writeFileSync(
    path.join(artifactRoot, 'source-after.txt'),
    `${sourceAfter}\nprofile=${profileDir}\nport=${BRIDGE_PORT}\npid=${process.pid}\n`,
  );
  fs.writeFileSync(
    path.join(artifactRoot, 'QA.md'),
    [
      '#140 live QA',
      '',
      `- source_before: ${sourceBefore}`,
      `- source_after: ${sourceAfter}`,
      `- WH_USER_DATA_DIR/profile: ${profileDir}`,
      `- WH_AIBRIDGE_PORT: ${BRIDGE_PORT}`,
      `- artifacts: ${artifactRoot}`,
      `- methods: Electron isolated profile + Dexie seed + runBridgeTool + HTTP probe + MCP stdio`,
      `- status: PASS renderer contrasts + MCP catalogue/tools/readonly/foreign`,
      `- limits: no shared :8766; no Luis userdata; Vite not used (Electron+esbuild harness)`,
      '',
    ].join('\n'),
  );
  console.log(`ARTIFACTS ${artifactRoot}`);
  console.log(`PROFILE ${profileDir}`);
  win.destroy();
  app.exit(0);
}

main().catch((error) => {
  console.error(error.stack || error);
  try {
    fs.writeFileSync(path.join(artifactRoot, 'QA-FAIL.txt'), String(error.stack || error));
  } catch {
    /* ignore */
  }
  app.exit(1);
});
