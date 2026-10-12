import { spawn } from 'node:child_process'
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const native = path.join(root, 'native')
const extension = process.platform === 'win32' ? '.exe' : ''
const child = spawn('cargo', ['build', '--release', '--locked', '-p', 'writer-document-engine'], {
  cwd: native,
  env: { ...process.env, CARGO_TARGET_DIR: path.join(native, 'target') },
  stdio: 'inherit',
  windowsHide: true,
})
child.on('error', error => {
  console.error(`Could not build Writers document engine: ${error.message}`)
  process.exitCode = 1
})
child.on('exit', async code => {
  if (code !== 0) { process.exitCode = code ?? 1; return }
  try {
    await mkdir(path.join(native, 'bin'), { recursive: true })
    const destination = path.join(native, 'bin', `writer-document-engine${extension}`)
    await copyFile(path.join(native, 'target', 'release', `writer-document-engine${extension}`), destination)
    for (const name of ['LICENSE-MIT', 'LICENSE-APACHE', 'LICENSE-HYPHENATION-ES', 'NOTICE', 'ATTRIBUTION.md']) {
      await copyFile(path.join(native, name), path.join(native, 'bin', name))
    }
    for (const name of await readdir(path.join(native, 'assets', 'fonts'))) {
      if (name.startsWith('OFL-') && name.endsWith('.txt')) {
        await copyFile(path.join(native, 'assets', 'fonts', name), path.join(native, 'bin', name))
      }
    }
    console.log(`Writers document engine: ${destination}`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
})
