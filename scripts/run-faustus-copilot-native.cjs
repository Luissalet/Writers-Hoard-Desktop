const { app } = require('electron');
const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const directory = path.resolve(process.env.WH_QA_DIRECTORY || path.join(root, 'qa', 'faustus-copilot-native'));
process.env.WH_QA_DIRECTORY = directory;
process.env.WH_AIBRIDGE_PORT ||= '62997';
process.env.WH_FAUSTUS_MCP_SERVER_ID ||= 'writer340';
process.env.HOARD_EVENTS = '0';
async function run() {
  fs.mkdirSync(directory, { recursive: true });
  const { compile } = require('@tailwindcss/node');
  const { Scanner } = require('@tailwindcss/oxide');
  const compiler = await compile(fs.readFileSync(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} });
  const scanner = new Scanner({ sources: [{ base: path.join(root, 'src'), pattern: '**/*.{ts,tsx}', negated: false }] });
  fs.writeFileSync(path.join(directory, 'styles.css'), compiler.build(scanner.scan()));
  await esbuild.build({ entryPoints: [path.join(root, 'tests/faustus-copilot-native.browser.tsx')], outfile: path.join(directory, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome130', alias: { '@': path.join(root, 'src') }, loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":false,"BASE_URL":"./"}', 'import.meta.url': '"file:///writer-qa.js"' }, logLevel: 'warning' });
  fs.copyFileSync(path.join(root, 'public/app-icon.png'), path.join(directory, 'app-icon.png'));
  fs.copyFileSync(path.join(root, 'dist-electron/preload.cjs'), path.join(directory, 'preload.cjs'));
  fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><html lang="es"><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
  await esbuild.build({ entryPoints: [path.join(root, 'tests/faustus-copilot-native.ts')], outfile: path.join(directory, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'node20', alias: { '@': path.join(root, 'src') }, logLevel: 'warning' });
  require(path.join(directory, 'main.cjs'));
}
run().catch((error) => { console.error(error.stack || error); app.exit(1); });
