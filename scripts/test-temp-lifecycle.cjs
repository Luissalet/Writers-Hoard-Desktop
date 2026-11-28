const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const profileVariable = 'WH_ELECTRON_TEST_PROFILE';

function removeProfile(temporaryRoot, temporaryDirectory, prefix) {
  let resolved;
  try {
    resolved = fs.realpathSync(temporaryDirectory);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (resolved !== temporaryDirectory || path.dirname(resolved) !== temporaryRoot ||
      !path.basename(resolved).startsWith(prefix)) {
    throw new Error('Temporary test directory changed location.');
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function runTemporaryElectronTest(app, prefix, profileName, run) {
  const windows = process.platform === 'win32';
  const assignedDirectory = windows ? process.env[profileVariable] : undefined;
  const isLauncher = windows && !assignedDirectory;
  if (assignedDirectory) delete process.env[profileVariable];

  let temporaryRoot;
  let temporaryDirectory;
  let code = 0;
  try {
    temporaryRoot = fs.realpathSync(os.tmpdir());
    if (assignedDirectory && (path.dirname(assignedDirectory) !== temporaryRoot ||
        !path.basename(assignedDirectory).startsWith(prefix) ||
        fs.realpathSync(assignedDirectory) !== assignedDirectory)) {
      throw new Error('The launcher did not provide a valid temporary test directory.');
    }
    temporaryDirectory = assignedDirectory || fs.mkdtempSync(path.join(temporaryRoot, prefix));
    const profile = path.join(temporaryDirectory, isLauncher ? 'launcher' : profileName);
    fs.mkdirSync(profile);
    app.setPath('userData', profile);
    if (isLauncher) {
      // Wait and clean up synchronously so the launcher stays before Electron
      // readiness while the child opens the test session and releases its files.
      const result = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
        env: { ...process.env, [profileVariable]: temporaryDirectory },
        stdio: 'inherit',
        windowsHide: true,
      });
      if (result.error) throw result.error;
      code = result.status ?? 1;
    } else {
      app.on('window-all-closed', () => {});
      await run(temporaryDirectory, profile);
    }
  } catch (error) {
    console.error(error?.stack || error);
    code = 1;
  } finally {
    if (temporaryDirectory && !assignedDirectory) {
      try {
        removeProfile(temporaryRoot, temporaryDirectory, prefix);
      } catch (error) {
        console.error('Could not remove the temporary test directory:', temporaryDirectory, error);
        code = 1;
      }
    }
    app.exit(code);
  }
}

module.exports = { runTemporaryElectronTest };
