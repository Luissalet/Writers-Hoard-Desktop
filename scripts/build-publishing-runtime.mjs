// Assemble Writer's owned publishing worker and native editorial/PDF engines.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { digestPublishingSource, MANIFEST_NAME } from './publishing-source-digest.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'publishing');
const python = path.join(source, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, windowsHide: true, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status) throw new Error(`${command} exited ${result.status}`);
}
if (!existsSync(python)) run(process.env.PYTHON || 'python', ['-m', 'venv', path.join(source, '.venv')]);
const workerOnly = process.argv.includes('--worker-only');
if (!workerOnly) {
run(python, ['-m', 'pip', 'install', '-r', 'publishing/requirements.txt']);
// Reading/links is Links Hoard's own app now: no Node engine is bundled for it.
}
if (!process.argv.includes('--setup-only')) {
  // Paperwork and its PDF engine are Kafka's Hoard's own app now; only the editorial engine is built here.
  if (!workerOnly) run(python, ['publishing/editorial/scripts/build_engine.py']);
  run(python, ['-m', 'pip', 'install', 'pyinstaller==6.22.3']);
  const data = (name, target = name) => ['--add-data', `${path.join(source, name)}${path.delimiter}${target}`];
  // collect_all executes while the spec is evaluated, before Analysis applies
  // --paths. Make the owned packages visible to those collection subprocesses.
  process.env.PYTHONPATH = [source, path.join(source, 'borges'), path.join(source, 'editorial'),
    ...(process.env.PYTHONPATH ? [process.env.PYTHONPATH] : [])].join(path.delimiter);
  run(python, ['-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--name', 'writer-publishing-worker',
    '--distpath', 'publishing/runtime', '--workpath', 'publishing/.build/work', '--specpath', 'publishing/.build',
    '--paths', source, '--paths', path.join(source, 'borges'), '--paths', path.join(source, 'editorial'),
    '--collect-all', 'borges', '--collect-all', 'gutenberg_hoard', '--collect-all', 'hoard_link',
    '--collect-all', 'pip',
    ...data('fusion'),
    ...data('editorial/native/bin', 'native/bin'),
    ...data('LICENSE', '.'), ...data('PROVENANCE.json', '.'),
    path.join(source, 'worker.py')]);
  // Record what this executable was built from; the contract test compares it with the repo.
  const exe = path.join(root, 'publishing/runtime/writer-publishing-worker', process.platform === 'win32' ? 'writer-publishing-worker.exe' : 'writer-publishing-worker');
  const digest = await digestPublishingSource(root);
  await writeFile(path.join(path.dirname(exe), MANIFEST_NAME), JSON.stringify({
    source_sha256: digest.sha256, source_files: digest.files,
    worker_sha256: createHash('sha256').update(await readFile(exe)).digest('hex'),
    built_at: new Date().toISOString(),
  }, null, 2));
}
