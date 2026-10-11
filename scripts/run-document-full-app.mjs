import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import electron from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = process.env.WRITER_DOCUMENT_FULL_APP_QA || 'D:/LocalAI/research-inbox/wordcraft-writers-20261011/qa/full-app';
await mkdir(directory, { recursive: true });
const compiler = await compile(await readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} });
const scanner = new Scanner({ sources: [{ base: path.join(root, 'src'), pattern: '**/*.{ts,tsx}', negated: false }] });
await writeFile(path.join(directory, 'styles.css'), compiler.build(scanner.scan()));
const common = { bundle: true, alias: { '@': path.join(root, 'src') }, logLevel: 'warning' };
await build({ ...common, entryPoints: [path.join(root, 'tests/documents-full-app.browser.tsx')], outfile: path.join(directory, 'app.js'), platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome130', loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"./"}', 'import.meta.url': '"file:///document-full-app.js"' } });
await build({ ...common, entryPoints: [path.join(root, 'electron/preload.ts')], outfile: path.join(directory, 'preload.cjs'), platform: 'node', format: 'cjs', external: ['electron'], target: 'node22' });
await build({ ...common, stdin: { contents: `export {registerDocumentIpc} from './electron/documents/register'; export {stopDocumentEngine} from './electron/documents/nativeDocumentService'; export {registerAiIpc} from './electron/ai/ipc'; export {registerFaustusIpc} from './electron/ai/faustusIpc'; export {isExactRendererDocumentUrl,isIpcChannelAllowedForRole} from './electron/security'; export {setBridgeWindowResolver,resolveBridgeReply} from './electron/aibridge/rpc';`, resolveDir: root }, outfile: path.join(directory, 'runtime.cjs'), platform: 'node', format: 'cjs', external: ['electron'], target: 'node22' });
await copyFile(path.join(root, 'public/app-icon.png'), path.join(directory, 'app-icon.png'));
await writeFile(path.join(directory, 'index.html'), '<!doctype html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
const env = { ...process.env, WRITER_DOCUMENT_FULL_APP_QA: directory, WRITER_DOCUMENT_ENGINE_PATH: path.join(root, 'native/bin/writer-document-engine.exe'), HOARD_EVENTS: '0' };
delete env.ELECTRON_RUN_AS_NODE;
process.exitCode = await new Promise((resolve, reject) => {
  const child = spawn(electron, [path.join(root, 'tests/documents-full-app-main.cjs')], { windowsHide: true, stdio: 'inherit', env });
  child.on('error', reject); child.on('close', code => resolve(code ?? 1));
});
