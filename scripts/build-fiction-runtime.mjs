// Build the owned fiction worker for the desktop installer. No app is started.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const story = path.join(root, 'story');
const python = path.join(story, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}
if (!existsSync(python)) run(process.env.PYTHON || 'python', ['-m', 'venv', path.join(story, '.venv')]);
run(python, ['-m', 'pip', 'install', '-r', 'story/requirements.txt']);
if (!process.argv.includes('--setup-only')) {
  run(python, ['-m', 'pip', 'install', 'pyinstaller==6.22.3']);
  run(python, ['-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--name', 'writer-fiction-worker',
    '--distpath', 'story/runtime', '--workpath', 'story/.build/work', '--specpath', 'story/.build',
    '--paths', story, '--add-data', `${path.join(story, 'writer_story')}${path.delimiter}writer_story`,
    '--add-data', `${path.join(story, 'LICENSE')}${path.delimiter}.`, path.join(story, 'worker.py')]);
}
