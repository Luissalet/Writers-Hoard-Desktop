// Assemble Writer's owned publishing worker and native editorial/PDF engines.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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
if (process.platform === 'win32') run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm ci --omit=dev --no-audit --no-fund'], path.join(source, 'links_native'));
else run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], path.join(source, 'links_native'));
}
if (!process.argv.includes('--setup-only')) {
  if (!workerOnly) {
  run(python, ['publishing/scripts/build_pdf_engine.py']);
  run(python, ['publishing/editorial/scripts/build_engine.py']);
  }
  run(python, ['-m', 'pip', 'install', 'pyinstaller==6.22.3']);
  const data = (name, target = name) => ['--add-data', `${path.join(source, name)}${path.delimiter}${target}`];
  // collect_all executes while the spec is evaluated, before Analysis applies
  // --paths. Make the owned packages visible to those collection subprocesses.
  process.env.PYTHONPATH = [source, path.join(source, 'borges'), path.join(source, 'editorial'),
    ...(process.env.PYTHONPATH ? [process.env.PYTHONPATH] : [])].join(path.delimiter);
  run(python, ['-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--name', 'writer-publishing-worker',
    '--distpath', 'publishing/runtime', '--workpath', 'publishing/.build/work', '--specpath', 'publishing/.build',
    '--paths', source, '--paths', path.join(source, 'borges'), '--paths', path.join(source, 'editorial'),
    '--collect-all', 'borges', '--collect-all', 'kafka_hoard', '--collect-all', 'gutenberg_hoard', '--collect-all', 'hoard_link',
    '--collect-all', 'yt_dlp', '--collect-all', 'gallery_dl', '--collect-all', 'pip', '--collect-all', 'rapidocr',
    ...data('fusion'), ...data('links_native/server'), ...data('links_native/package.json', 'links_native'), ...data('links_native/node_modules'),
    ...data('native/bin'), ...data('editorial/native/bin', 'native/bin'), ...data('scripts'),
    ...(existsSync(path.join(source, 'node_modules')) ? data('node_modules') : []), ...data('LICENSE', '.'), ...data('PROVENANCE.json', '.'),
    path.join(source, 'worker.py')]);
}
