// Native Electron contract test, using a private profile and the approved frozen worker.
// No GUI automation, real profile/origin 5174, provider, model or retired repository.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestPublishingSource, MANIFEST_NAME } from './publishing-source-digest.mjs';
import { startSyntheticHoards } from './synthetic-hoards.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const ts = require('typescript');
const base = process.env.WH_INSTALL_QA_ROOT || await mkdtemp(path.join(os.tmpdir(), 'writer-compat-native-'));
await mkdir(base, { recursive: true });
await writeFile(path.join(base, 'forbid-network.cjs'), `const fs=require('node:fs');const mark=${JSON.stringify(path.join(base, 'cold-io-attempt.txt'))};const fail=()=>{fs.appendFileSync(mark,'unexpected network/process attempt\\n');throw Error('Cold discovery attempted I/O')};require('node:http').request=fail;require('node:https').request=fail;require('node:child_process').spawn=fail;`);
const worker = path.join(root, 'publishing/runtime/writer-publishing-worker/writer-publishing-worker.exe');
// The packaged worker must be the one built from this source and catalogue: rebuild with
// `node scripts/build-publishing-runtime.mjs --worker-only` (docs/PUBLISHING.md) when this fails.
const manifest = JSON.parse(await readFile(path.join(path.dirname(worker), MANIFEST_NAME), 'utf8').catch(() => assert.fail('The packaged worker has no build manifest: rebuild it with node scripts/build-publishing-runtime.mjs --worker-only')));
assert.equal(createHash('sha256').update(await readFile(worker)).digest('hex'), manifest.worker_sha256, 'The packaged executable is not the one the build manifest describes: rebuild it');
assert.equal((await digestPublishingSource(root)).sha256, manifest.source_sha256, 'The packaged worker is stale: publishing/ or its catalogue changed since the build; run node scripts/build-publishing-runtime.mjs --worker-only');
const source = await readFile(path.join(root, 'electron/main.ts'), 'utf8');
const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const ipc = [], protocols = [];
function visit(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const expression = node.expression.getText(tree);
    const name = node.arguments[0];
    if (name && ts.isStringLiteral(name)) {
      if (expression === 'ipcMain.handle' && name.text.startsWith('publishing:')) ipc.push(node.getText(tree));
      if (expression === 'protocol.handle' && name.text === 'wh-publishing') protocols.push(node.getText(tree));
    }
  }
  ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(ipc.length, 3);
assert.equal(protocols.length, 1);
const registrations = ts.transpileModule(ipc.join(';\n') + ';\n' + protocols[0] + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
await writeFile(path.join(base, 'production-registrations.cjs'), registrations);
const common = { bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning', alias: { '@': path.join(root, 'src') } };
await build({ ...common, entryPoints: [path.join(root, 'electron/aibridge/mcpStdio.ts')], outfile: path.join(base, 'mcp.cjs') });
await build({ ...common, stdin: { contents: `export { configurePublishing,publishingService } from './electron/publishing/service'; export { startAiBridge,stopAiBridge } from './electron/aibridge/server'; export { setBridgeConfig,getBridgeToken } from './electron/aibridge/state';`, resolveDir: root }, external: ['electron'], outfile: path.join(base, 'api.cjs') });
await build({ ...common, entryPoints: [path.join(root, 'tests/publishing-compat.test.mjs')], external: ['electron'], outfile: path.join(base, 'test.cjs') });
const preload = await readFile(path.join(root, 'dist-electron/preload.cjs'));
await writeFile(path.join(base, 'preload.cjs'), Buffer.concat([preload, Buffer.from(`\nrequire('electron').contextBridge.exposeInMainWorld('qaNative', { report: value => require('electron').ipcRenderer.send('qa:report', value) });\n`)]));
await writeFile(path.join(base, 'source-pins.json'), JSON.stringify({ worker_sha256: createHash('sha256').update(await readFile(worker)).digest('hex'), preload_sha256: createHash('sha256').update(preload).digest('hex'), main_source_sha256: createHash('sha256').update(source).digest('hex'), registrations_sha256: createHash('sha256').update(registrations).digest('hex') }, null, 2));
// Links Hoard and Kafka's Hoard are their own apps: a synthetic stand-in answers for both, never the real ones.
const hoards = await startSyntheticHoards(base);
const executable = require('electron');
const environment = { ...process.env, ...hoards.environment, WH_INSTALL_QA_ROOT: base, WH_INSTALL_WRITER_ROOT: root, WH_INSTALL_NODE: process.execPath, WH_AIBRIDGE_PORT: '64852', HOARD_EVENTS: '0', BORGES_EMBED: 'none', HOARD_HUB_URL: 'http://127.0.0.1:1', FAUSTUS_URL: 'http://127.0.0.1:1', WH_USER_DATA_DIR: path.join(base, 'profile') };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [path.join(base, 'test.cjs')], { cwd: root, windowsHide: true, stdio: 'inherit', env: environment });
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
await hoards.close();
assert.equal(code, 0, `Native contract fixture exited ${code}; evidence ${base}`);
const receipt = JSON.parse(await readFile(path.join(base, 'receipt.json'), 'utf8'));
assert.equal(receipt.status, 'PASS');
assert.equal(receipt.worker_running_after_close, false);
console.log(JSON.stringify({ status: 'PASS', evidence: base, scope: receipt.scope, contracts: receipt.contracts }, null, 2));
