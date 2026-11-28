const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const stub = path.join(__dirname, 'fixtures', 'test-temp-electron.cjs');

function run(script, prefix, mode, code, args = []) {
  const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'wh-lifecycle-fixture-'));
  try {
    const receipt = path.join(temp, 'profile.txt');
    const unrelated = path.join(temp, prefix + 'unrelated');
    fs.mkdirSync(unrelated);
    const result = spawnSync(process.execPath, ['--require', stub, path.join(root, 'scripts', script), ...args], {
      cwd: root,
      env: {
        ...process.env,
        TEMP: temp,
        TMP: temp,
        TMPDIR: temp,
        WH_TEST_EXIT_MODE: mode,
        WH_TEST_PROFILE_RECEIPT: receipt,
        WH_FOCUSED_PREP_TIMEOUT_MS: mode === 'prepare-timeout' ? '50' : '3000',
      },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, code, result.stderr);
    const profile = fs.readFileSync(receipt, 'utf8');
    assert.equal(path.dirname(profile), temp);
    assert.ok(path.basename(profile).startsWith(prefix));
    assert.ok(fs.existsSync(unrelated), 'an unrelated directory was removed');
    assert.ok(!fs.existsSync(profile), 'temporary profile still exists after ' + mode);
    return result.stdout + result.stderr;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

for (const mode of ['success', 'test-failure', 'prepare-timeout', 'test-timeout', 'close-timeout', 'setup-failure']) {
  test('focused browser removes its profile after ' + mode, () => {
    const output = run('run-focused-browser-tests.cjs', 'wh-focused-', mode, mode === 'success' ? 0 : 1,
      ['tests/family-ui.browser.tsx', 'testFamilyUi', '1000']);
    if (mode.endsWith('-timeout')) assert.match(output, /timed out/);
    if (mode === 'test-failure') assert.match(output, /fixture test failure/);
  });
}

test('critical tests remove their profile when Electron fails to start', () => {
  assert.match(run('run-critical-tests.cjs', 'writers-hoard-critical-', 'ready-failure', 1), /fixture startup failure/);
});

for (const [file, suffix] of [
  ['run-character-pressure-test.cjs', 'pressure'], ['run-project-health-test.cjs', 'health'],
  ['run-read-aloud-tests.cjs', 'read-aloud'], ['run-scene-lab-tests.cjs', 'scene-lab'],
  ['run-engine-user-smoke.cjs', 'engines'],
]) {
  test(suffix + ' removes its profile when test preparation fails', () => {
    assert.match(run(file, 'writers-hoard-' + suffix + '-', 'build-failure', 1), /fixture build failure/);
  });
}

test('engine smoke removes its profile after a successful run and prints its results', () => {
  assert.match(run('run-engine-user-smoke.cjs', 'writers-hoard-engines-', 'success', 0), /PASS fixture test/);
});
