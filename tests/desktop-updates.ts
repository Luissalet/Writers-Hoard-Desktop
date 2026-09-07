import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createUpdateController } from '../electron/updates';
import type { DesktopUpdateState } from '../src/types/updates';

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = false;
  allowDowngrade = true;
  checks = 0;
  downloads = 0;
  check: () => Promise<void> = async () => { this.emit('update-available', { version: '0.2.0' }); };
  download: () => Promise<void> = async () => {
    this.emit('download-progress', { percent: 42 });
    this.emit('update-downloaded', { version: '0.2.0' });
  };
  async checkForUpdates() { this.checks++; await this.check(); return null; }
  async downloadUpdate() { this.downloads++; await this.download(); return []; }
}

export async function runDesktopUpdateTests(): Promise<string[]> {
  const fake = new FakeUpdater();
  const history: DesktopUpdateState[] = [];
  const controller = createUpdateController(fake as unknown as Parameters<typeof createUpdateController>[0], '0.1.0', true, value => history.push(value));
  assert.equal(fake.autoDownload, false);
  assert.equal(fake.autoInstallOnAppQuit, false);
  assert.equal(fake.allowPrerelease, true);
  assert.equal(fake.allowDowngrade, false);
  await controller.download();
  assert.equal(fake.downloads, 0, 'cannot download before an available update');
  await controller.check();
  assert.equal(controller.snapshot().status, 'available');
  assert.equal(fake.downloads, 0, 'availability must not download without consent');
  const snapshot = controller.snapshot();
  snapshot.status = 'error';
  assert.equal(controller.snapshot().status, 'available', 'snapshot must not mutate controller');
  await controller.download();
  assert.deepEqual(history.map(value => value.status), ['checking', 'available', 'downloading', 'downloading', 'downloaded']);
  assert.equal(history[3].percent, 42);
  assert.equal(controller.snapshot().version, '0.2.0');
  for (let i = 1; i < history.length; i++) assert.ok(history[i].revision > history[i - 1].revision);
  await controller.check();
  await controller.download();
  assert.equal(fake.checks, 1, 'ready installer cannot be overwritten by polling');
  assert.equal(fake.downloads, 1, 'ready installer cannot be downloaded twice');

  fake.emit('error', new Error('network unavailable'));
  assert.equal(controller.snapshot().status, 'error', 'error events must be caught');
  fake.check = async () => { fake.emit('update-not-available'); };
  await controller.check();
  assert.equal(controller.snapshot().status, 'latest', 'retry recovers after error');
  fake.check = async () => { throw new Error('offline'); };
  await controller.check();
  assert.equal(controller.snapshot().status, 'error', 'rejected check must become recoverable state');
  fake.check = async () => { fake.emit('update-available', { version: '0.3.0-beta.1' }); };
  await controller.check();
  fake.download = async () => { throw new Error('disk full'); };
  await controller.download();
  assert.equal(controller.snapshot().status, 'error', 'download failure must not leave perpetual progress');

  let release!: () => void;
  fake.check = () => new Promise(resolve => { release = resolve; });
  const pending = controller.check();
  const checkCount = fake.checks;
  await controller.check();
  assert.equal(fake.checks, checkCount, 'concurrent checks must coalesce');
  fake.emit('update-not-available');
  release();
  await pending;

  const dev = new FakeUpdater();
  const disabled = createUpdateController(dev as unknown as Parameters<typeof createUpdateController>[0], '0.1.0', false, () => {});
  await disabled.check();
  await disabled.download();
  assert.equal(disabled.snapshot().status, 'disabled');
  assert.equal(dev.checks + dev.downloads, 0, 'development must never contact updater');
  return ['desktop updates: consent, state transitions, progress, snapshots, retries, concurrency and disabled mode'];
}
