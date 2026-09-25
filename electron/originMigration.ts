// One-time copy of a library stored under the old packaged origin (file://)
// into the renderer origin every build now uses (rendererServer.ts).
//
// IndexedDB and localStorage are keyed by origin. Up to 0.1.2 the packaged app
// loaded its renderer from file://, so an installed copy kept its books there.
// From 0.1.3 the packaged renderer is served from http://127.0.0.1:5174, which
// starts empty. Before the main window opens this module:
//
//   1. skips when the marker says it already ran, or no file:// store exists;
//   2. opens a hidden page on each origin and counts records on both sides;
//   3. copies only when the old side has data and the new side has none --
//      it never merges into, or overwrites, an existing library;
//   4. copies every database (same name, version, stores, indexes, keys) and
//      every localStorage key, Blobs included, then counts again;
//   5. on any mismatch deletes what it wrote on the new side and tries again
//      on the next start (three attempts at most).
//
// The old store is left untouched, so going back to 0.1.2 still finds it.
import { app, BrowserWindow, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import {
  DROP_SCRIPT,
  DUMP_SCRIPT,
  RESTORE_SCRIPT,
  SUMMARY_SCRIPT,
  sameCounts,
  type OriginSummary,
} from './originMigrationScripts';

export interface OriginMigrationReport {
  status: 'migrated' | 'skipped' | 'failed';
  reason: string;
  at: string;
  attempts?: number;
  databases?: number;
  records?: number;
  localStorageKeys?: number;
}

const PUT = 'wh-migration:put';
const GET = 'wh-migration:get';
const MAX_ATTEMPTS = 3;

const markerPath = (): string => path.join(app.getPath('userData'), 'origin-migration.json');

async function readMarker(): Promise<OriginMigrationReport | null> {
  try {
    return JSON.parse(await fs.readFile(markerPath(), 'utf8')) as OriginMigrationReport;
  } catch {
    return null;
  }
}

async function writeMarker(report: OriginMigrationReport): Promise<void> {
  const file = markerPath();
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.rename(`${file}.tmp`, file);
}

function hiddenWindow(preloadPath: string): BrowserWindow {
  return new BrowserWindow({
    show: false,
    webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
}

export async function migrateLegacyFileOrigin(options: {
  targetBlankUrl: string;
  preloadPath: string;
  log?: (message: string) => void;
}): Promise<OriginMigrationReport> {
  const log = options.log ?? ((m: string) => console.log(`[origin-migration] ${m}`));
  const previous = await readMarker();
  if (previous && previous.status !== 'failed') return previous;
  const attempts = (previous?.attempts ?? 0) + 1;
  if (previous && attempts > MAX_ATTEMPTS) return previous;
  const finish = async (
    report: Omit<OriginMigrationReport, 'at' | 'attempts'>,
  ): Promise<OriginMigrationReport> => {
    const full: OriginMigrationReport = { ...report, at: new Date().toISOString(), attempts };
    await writeMarker(full).catch((err) => log(`could not write marker: ${String(err)}`));
    log(`${full.status}: ${full.reason}`);
    return full;
  };

  const legacyDir = path.join(app.getPath('userData'), 'IndexedDB', 'file__0.indexeddb.leveldb');
  try {
    await fs.access(legacyDir);
  } catch {
    return finish({ status: 'skipped', reason: 'no store under the old file:// origin' });
  }

  const blankDir = path.join(app.getPath('userData'), 'migration');
  await fs.mkdir(blankDir, { recursive: true });
  const blankFile = path.join(blankDir, 'blank.html');
  await fs.writeFile(blankFile, '<!doctype html><meta charset="utf-8"><title>migration</title>', 'utf8');

  const source = hiddenWindow(options.preloadPath);
  const target = hiddenWindow(options.preloadPath);
  // Chunks go to a spool file, not memory: a library with media can run to
  // hundreds of megabytes.
  const spoolPath = path.join(blankDir, `spool-${process.pid}.bin`);
  const spool = await fs.open(spoolPath, 'w+');
  const offsets: Array<[number, number]> = [];
  let spoolEnd = 0;
  let finished = false;
  ipcMain.handle(PUT, async (event, chunk: unknown) => {
    if (finished || event.sender !== source.webContents) throw new Error('Forbidden');
    const buf = v8.serialize(chunk);
    await spool.write(buf, 0, buf.length, spoolEnd);
    offsets.push([spoolEnd, buf.length]);
    spoolEnd += buf.length;
    return true;
  });
  ipcMain.handle(GET, async (event, index: number) => {
    if (finished || event.sender !== target.webContents) throw new Error('Forbidden');
    const entry = Number.isInteger(index) ? offsets[index] : undefined;
    if (!entry) return null;
    const buf = Buffer.alloc(entry[1]);
    await spool.read(buf, 0, entry[1], entry[0]);
    return v8.deserialize(buf);
  });
  let written: string[] = [];
  try {
    await source.loadFile(blankFile);
    await target.loadURL(options.targetBlankUrl);
    const before = (await source.webContents.executeJavaScript(SUMMARY_SCRIPT)) as OriginSummary;
    if (before.records === 0) {
      return await finish({ status: 'skipped', reason: 'the old file:// store holds no records' });
    }
    const existing = (await target.webContents.executeJavaScript(SUMMARY_SCRIPT)) as OriginSummary;
    if (existing.records > 0) {
      return await finish({
        status: 'skipped',
        reason: 'the renderer origin already has a library; nothing is merged',
      });
    }
    await source.webContents.executeJavaScript(DUMP_SCRIPT);
    written = Object.keys(before.databases);
    await target.webContents.executeJavaScript(RESTORE_SCRIPT);
    const after = (await target.webContents.executeJavaScript(SUMMARY_SCRIPT)) as OriginSummary;
    if (!sameCounts(before, after)) {
      throw new Error(
        `counts differ after copy: ${JSON.stringify(before.databases)} vs ${JSON.stringify(after.databases)}`,
      );
    }
    return await finish({
      status: 'migrated',
      reason: 'library copied from file:// to the renderer origin; the old store is kept',
      databases: Object.keys(before.databases).length,
      records: before.records,
      localStorageKeys: before.localStorageKeys,
    });
  } catch (err) {
    if (written.length && !target.isDestroyed()) {
      await target.webContents.executeJavaScript(DROP_SCRIPT(written)).catch(() => undefined);
    }
    return finish({ status: 'failed', reason: String((err as Error)?.message ?? err) });
  } finally {
    finished = true;
    ipcMain.removeHandler(PUT);
    ipcMain.removeHandler(GET);
    if (!source.isDestroyed()) source.destroy();
    if (!target.isDestroyed()) target.destroy();
    await spool.close().catch(() => undefined);
    await fs.rm(spoolPath, { force: true }).catch(() => undefined);
  }
}
