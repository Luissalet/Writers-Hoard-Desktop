import { spawn } from 'node:child_process';
import electron from 'electron';

const suites = [
  ['tests/revisions-core.browser.ts', 'testRevisionsCore'],
  ['tests/revisions-ui.browser.tsx', 'testRevisionsUi'],
  ['tests/revisions-tools.browser.ts', 'testRevisionTools'],
  ['tests/revisions-export.browser.tsx', 'testRevisionsExport'],
];
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
for (const [file, entry] of suites) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(electron, ['scripts/run-focused-browser-tests.cjs', file, entry, '120000'], { env, windowsHide: true, stdio: 'inherit' });
    child.once('error', reject); child.once('close', resolve);
  });
  if (code !== 0) { process.exitCode = code ?? 1; break; }
}
