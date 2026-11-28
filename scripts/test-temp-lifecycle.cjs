const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function runTemporaryElectronTest(app, prefix, profileName, run) {
  let temporaryRoot;
  let temporaryDirectory;
  let code = 0;
  try {
    temporaryRoot = fs.realpathSync(os.tmpdir());
    temporaryDirectory = fs.mkdtempSync(path.join(temporaryRoot, prefix));
    const profile = path.join(temporaryDirectory, profileName);
    fs.mkdirSync(profile);
    app.setPath('userData', profile);
    // The harness still owns its cleanup after the last test window closes.
    app.on('window-all-closed', () => {});
    await run(temporaryDirectory, profile);
  } catch (error) {
    console.error(error?.stack || error);
    code = 1;
  } finally {
    if (temporaryDirectory) {
      try {
        const resolved = await fs.promises.realpath(temporaryDirectory).catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (resolved) {
          if (resolved !== temporaryDirectory || path.dirname(resolved) !== temporaryRoot ||
              !path.basename(resolved).startsWith(prefix)) {
            throw new Error('Temporary test directory changed location.');
          }
          await fs.promises.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
      } catch (error) {
        console.error('Could not remove the temporary test directory:', temporaryDirectory, error);
        code = 1;
      }
    }
    app.exit(code);
  }
}

module.exports = { runTemporaryElectronTest };
