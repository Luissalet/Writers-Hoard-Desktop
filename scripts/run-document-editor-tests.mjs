import { spawn } from 'node:child_process';
import electron from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['scripts/run-focused-browser-tests.cjs', 'tests/documents-tools.browser.ts', 'testDocumentTools', '120000'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('close', code => { process.exitCode = code ?? 1; });
