"""Exercise the focused runner's deadlines without installing the renderer dependencies."""

import ctypes
import json
import os
import shutil
import subprocess
import time
from ctypes import wintypes
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
ELECTRON = """
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
exports.app = Object.assign(new EventEmitter(), {
  commandLine: { appendSwitch() {} },
  setPath(_name, profile) {
    if (!process.env.FOCUSED_LOCK_PROFILE || path.basename(profile) === 'launcher') return;
    const root = process.env.TEMP;
    const file = path.join(profile, 'locked-file');
    fs.writeFileSync(file, 'synthetic profile data');
    const witness = path.join(root, 'lock-target');
    fs.writeFileSync(witness + '.tmp', JSON.stringify({ file, pid: process.pid }));
    fs.renameSync(witness + '.tmp', witness);
    const deadline = Date.now() + 8000;
    while (!fs.existsSync(path.join(root, 'lock-ready'))) {
      if (Date.now() >= deadline) throw new Error('Could not establish the profile lock');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  },
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
const { strictEqual } = require('node:assert');
exports.createServer = async config => {
  // Simulate the app's watch options surviving Vite's non-null config merge.
  config.server.watch = { ignored: ['**/native/bin/**'] };
  for (const plugin of config.plugins) plugin.config?.(config);
  strictEqual(config.server.watch, null, 'Focused fixtures must start without a recursive file watcher');
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
    for name in (
        "run-focused-browser-tests.cjs",
        "focused-browser-deadline.cjs",
        "focused-browser-vite.cjs",
        "test-temp-lifecycle.cjs",
    ):
        shutil.copyfile(ROOT / "scripts" / name, scripts / name)
    for name, source in (("electron", ELECTRON), ("vite", VITE)):
        module = tmp_path / "node_modules" / name
        module.mkdir(parents=True)
        (module / "index.js").write_text(source, encoding="utf-8")
    (tmp_path / "package-lock.json").write_text("{}", encoding="utf-8")

    def start(**env):
        clean = os.environ.copy()
        clean.pop("WH_FOCUSED_PREP_TIMEOUT_MS", None)
        clean.update(TEMP=str(tmp_path), TMP=str(tmp_path), TMPDIR=str(tmp_path))
        clean.update(env)
        return subprocess.Popen(
            ["node", str(scripts / "run-focused-browser-tests.cjs"), "tests/fixture.ts", "testFixture", "1000"],
            cwd=tmp_path,
            env=clean,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            encoding="utf-8",
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )

    return start


@pytest.fixture
def run_focused(focused_runner, tmp_path):
    def run(**env):
        with focused_runner(**env) as child:
            stdout, stderr = collect_output(child, timeout=20)
        leftovers = [path for path in tmp_path.glob("wh-focused-*") if path.name != "wh-focused-vite"]
        assert not leftovers, stdout + stderr
        return subprocess.CompletedProcess(child.args, child.returncode, stdout, stderr)

    return run


def collect_output(child, timeout):
    try:
        return child.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        child.kill()
        child.communicate()
        raise


def test_slow_preparation_leaves_the_full_fixture_budget(run_focused):
    result = run_focused(FOCUSED_VITE_STALL_MS="1250")
    assert result.returncode == 0, result.stderr
    assert "Vite worker entering synchronous startup" in result.stdout
    assert "Focused browser preparation finished in " in result.stdout
    assert "PASS fixture executed" in result.stdout


def test_synchronous_vite_startup_has_its_own_deadline(run_focused):
    result = run_focused(FOCUSED_VITE_STALL_MS="60000", WH_FOCUSED_PREP_TIMEOUT_MS="2000")
    assert result.returncode == 1
    assert "Vite worker entering synchronous startup" in result.stdout
    assert "running the test" not in result.stdout
    assert "preparation timed out while starting Vite" in result.stderr
    assert "ms elapsed; 2000 ms budget" in result.stderr


def test_fixture_timeout_names_the_execution_phase(run_focused):
    result = run_focused(FOCUSED_FIXTURE_HANGS="1")
    assert result.returncode == 1
    assert "Focused browser preparation finished in " in result.stdout
    assert "tests timed out while running the test" in result.stderr
    assert "ms elapsed; 1000 ms budget" in result.stderr


@pytest.mark.skipif(os.name != "nt", reason="requires a Windows file handle without delete sharing")
@pytest.mark.parametrize("hangs, expected_code", [(False, 0), (True, 1)])
def test_profile_is_removed_after_windows_process_exits(focused_runner, tmp_path, hangs, expected_code):
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateFileW.argtypes = (
        wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
        wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE,
    )
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    kernel.WaitForSingleObject.restype = wintypes.DWORD
    kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel.CloseHandle.restype = wintypes.BOOL

    env = {"FOCUSED_LOCK_PROFILE": "1"}
    if hangs:
        env["FOCUSED_FIXTURE_HANGS"] = "1"
    with focused_runner(**env) as child:
        try:
            target = tmp_path / "lock-target"
            deadline = time.monotonic() + 5
            while not target.is_file() and child.poll() is None and time.monotonic() < deadline:
                time.sleep(0.02)
            assert target.is_file(), "The harness did not create its profile"
            witness = json.loads(target.read_text(encoding="utf-8"))
            file = Path(witness["file"]).resolve()
            assert file.is_relative_to(tmp_path.resolve()) and file.name == "locked-file"
            # Wait on the process that owns the profile, rather than its launcher.
            owner = kernel.OpenProcess(0x00100000, False, witness["pid"])  # SYNCHRONIZE
            if not owner:
                raise ctypes.WinError(ctypes.get_last_error())
            try:
                # GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, OPEN_EXISTING.
                handle = kernel.CreateFileW(str(file), 0x80000000, 3, None, 3, 0, None)
                if handle == ctypes.c_void_p(-1).value:
                    raise ctypes.WinError(ctypes.get_last_error())
                try:
                    (tmp_path / "lock-ready").touch()
                    result = kernel.WaitForSingleObject(owner, 5000)
                    assert result == 0, "The harness never exited while the Windows profile handle was open."
                    assert file.is_file(), "The file was removed while its handle was open"
                finally:
                    assert kernel.CloseHandle(handle), ctypes.get_last_error()
            finally:
                assert kernel.CloseHandle(owner), ctypes.get_last_error()
        finally:
            stdout, stderr = collect_output(child, timeout=10)

    assert child.returncode == expected_code, stdout + stderr
    if hangs:
        assert "tests timed out while running the test" in stderr
    else:
        assert "PASS fixture executed" in stdout
    assert "Could not remove the temporary test directory" not in stderr
    assert not file.parent.parent.exists(), "The launcher left the temporary profile"
