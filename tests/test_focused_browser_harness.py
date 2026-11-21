"""Exercise the focused runner's deadlines without installing the renderer dependencies."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
ELECTRON = """
const { EventEmitter } = require('node:events');
exports.app = Object.assign(new EventEmitter(), {
  commandLine: { appendSwitch() {} },
  setPath() {},
  whenReady: async () => {},
  exit: code => process.exit(code),
});
exports.BrowserWindow = class {
  constructor() {
    this.webContents = new EventEmitter();
    this.webContents.executeJavaScript = async script => {
      if (script.includes('IS_REACT_ACT_ENVIRONMENT')) return { ok: true };
      if (process.env.FOCUSED_FIXTURE_HANGS) return new Promise(() => {});
      return { ok: true, tests: ['fixture executed'] };
    };
  }
  async loadURL() {}
  isDestroyed() { return false; }
  destroy() {}
};
"""
VITE = """
exports.createServer = async config => {
  const stall = Number(process.env.FOCUSED_VITE_STALL_MS);
  if (stall) {
    console.log('Vite worker entering synchronous startup');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, stall);
  }
  return {
    async listen() {},
    async close() {},
    httpServer: { address: () => ({ port: config.server.port }) },
  };
};
"""


@pytest.fixture
def focused_runner(tmp_path):
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    for name in ("run-focused-browser-tests.cjs", "focused-browser-deadline.cjs", "focused-browser-vite.cjs"):
        shutil.copyfile(ROOT / "scripts" / name, scripts / name)
    for name, source in (("electron", ELECTRON), ("vite", VITE)):
        module = tmp_path / "node_modules" / name
        module.mkdir(parents=True)
        (module / "index.js").write_text(source, encoding="utf-8")
    (tmp_path / "package-lock.json").write_text("{}", encoding="utf-8")

    def run(**env):
        clean = os.environ.copy()
        clean.pop("WH_FOCUSED_PREP_TIMEOUT_MS", None)
        clean.update(TEMP=str(tmp_path), TMP=str(tmp_path), TMPDIR=str(tmp_path))
        clean.update(env)
        return subprocess.run(
            ["node", str(scripts / "run-focused-browser-tests.cjs"), "tests/fixture.ts", "testFixture", "1000"],
            cwd=tmp_path,
            env=clean,
            capture_output=True,
            encoding="utf-8",
            timeout=20,
        )

    return run


def test_slow_preparation_leaves_the_full_fixture_budget(focused_runner):
    result = focused_runner(FOCUSED_VITE_STALL_MS="1250")
    assert result.returncode == 0, result.stderr
    assert "Vite worker entering synchronous startup" in result.stdout
    assert "Focused browser preparation finished in " in result.stdout
    assert "PASS fixture executed" in result.stdout


def test_synchronous_vite_startup_has_its_own_deadline(focused_runner):
    result = focused_runner(FOCUSED_VITE_STALL_MS="60000", WH_FOCUSED_PREP_TIMEOUT_MS="2000")
    assert result.returncode == 1
    assert "Vite worker entering synchronous startup" in result.stdout
    assert "running the test" not in result.stdout
    assert "preparation timed out while starting Vite" in result.stderr
    assert "ms elapsed; 2000 ms budget" in result.stderr


def test_fixture_timeout_names_the_execution_phase(focused_runner):
    result = focused_runner(FOCUSED_FIXTURE_HANGS="1")
    assert result.returncode == 1
    assert "Focused browser preparation finished in " in result.stdout
    assert "tests timed out while running the test" in result.stderr
    assert "ms elapsed; 1000 ms budget" in result.stderr
