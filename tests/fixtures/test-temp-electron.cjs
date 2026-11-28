const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const mode = process.env.WH_TEST_EXIT_MODE;
let handlesLastWindow = false;

class FakeWorker extends EventEmitter {
  threadId = 1;

  constructor() {
    super();
    if (mode !== 'prepare-timeout') queueMicrotask(() => this.emit('message', 55555));
  }

  stop(code) {
    this.threadId = -1;
    queueMicrotask(() => this.emit('exit', code));
  }

  postMessage() {
    if (mode !== 'close-timeout') this.stop(0);
  }

  async terminate() {
    this.stop(1);
    return 1;
  }
}

class FakeWindow {
  webContents = new EventEmitter();
  destroyed = false;

  constructor() {
    this.webContents.executeJavaScript = (code) => {
      if (code.includes('import(')) return Promise.resolve({ ok: true });
      if (mode === 'test-timeout') return new Promise(() => {});
      if (mode === 'test-failure') return Promise.resolve({ ok: false, error: 'fixture test failure' });
      return Promise.resolve({ ok: true, tests: ['fixture test'] });
    };
  }

  async loadURL() {}
  async loadFile() {}
  isDestroyed() { return this.destroyed; }
  destroy() {
    this.destroyed = true;
    if (!handlesLastWindow) process.exit(0);
  }
}

const app = {
  commandLine: { appendSwitch() {} },
  on(event) {
    if (event === 'window-all-closed') handlesLastWindow = true;
  },
  setPath(_name, profile) {
    fs.writeFileSync(process.env.WH_TEST_PROFILE_RECEIPT, path.dirname(profile));
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(path.join(profile, 'fixture-data'), 'owned');
    if (mode === 'setup-failure') throw new Error('fixture setup failure');
  },
  whenReady() {
    if (mode === 'ready-failure') return Promise.reject(new Error('fixture startup failure'));
    return Promise.resolve();
  },
  exit(code) { process.exit(code); },
  quit() { process.exit(0); },
};

const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { app, BrowserWindow: FakeWindow };
  if (name === 'node:worker_threads') return { Worker: FakeWorker };
  if (name === 'esbuild') return {
    async build() {
      if (mode === 'build-failure') throw new Error('fixture build failure');
      return { warnings: [] };
    },
  };
  return originalLoad.call(this, name, ...args);
};
