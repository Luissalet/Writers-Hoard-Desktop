// Recortes: preservation level, link-only filter, batch archive, CSV export,
// and the "user typed during a long download" backfill fix.
//
//   xvfb-run -a npx electron scripts/run-focused-browser-tests.cjs \
//     tests/scrapper-preservation.browser.tsx testScrapperPreservation 120000 --no-sandbox
//
// The runner uses a throwaway profile, and every check also asserts that no
// link row is lost or has its URL rewritten (lessons #67).
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import ScrapperEngine from '@/engines/scrapper/components/ScrapperEngine';
import { preservationLevel, isLinkOnly } from '@/engines/scrapper/preservation';
import { csvCell, snapshotsToCsv } from '@/engines/scrapper/linkExport';
import { updateSnapshot } from '@/engines/scrapper/operations';
import { runSnapshotDownload } from '@/services/scrapperMedia';
import { startArchiveBatch } from '@/engines/scrapper/archiveBatch';
import { runSnapshotCapture } from '@/services/pageCapture';
import { ToastHost } from '@/components/common/toast';
import { useLocaleStore } from '@/stores/localeStore';
import type { Snapshot } from '@/engines/scrapper/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const P = `scrapper-preservation-${Date.now()}`;

function snap(id: string, extra: Partial<Snapshot> = {}): Snapshot {
  return {
    id: `${P}-${id}`,
    projectId: P,
    url: `https://${id}.example/`,
    title: id,
    source: 'url',
    status: 'success',
    notes: '',
    tags: [],
    preservedAt: 1,
    createdAt: Date.UTC(2026, 0, 1),
    ...extra,
  };
}

type FakeApi = Record<string, unknown>;
function setElectronApi(api: FakeApi | undefined) {
  const w = window as unknown as { electronAPI?: FakeApi };
  if (api) w.electronAPI = { isDesktop: true, ...api };
  else delete w.electronAPI;
}

function levels(): string {
  const cases: [Partial<Snapshot>, string][] = [
    [{}, 'link-only'],
    [{ extractedText: '   \n' }, 'link-only'],
    [{ mediaItems: [] }, 'link-only'],
    [{ extractedText: 'body' }, 'text'],
    [{ captureImagePath: 'p/x.png' }, 'archived'],
    [{ captureHtmlPath: 'p/x.html' }, 'archived'],
    [{ capturePdfPath: 'p/x.pdf', extractedText: 'body' }, 'archived'],
    [{ localMediaPath: 'p/x.mp4', capturePdfPath: 'p/x.pdf', extractedText: 'b' }, 'media'],
    [{ mediaItems: [{ relPath: 'p/x/1.jpg', kind: 'image' }] }, 'media'],
  ];
  for (const [fields, expected] of cases) {
    const got = preservationLevel(fields);
    assert(got === expected, `${JSON.stringify(fields)} → ${got}, expected ${expected}`);
  }
  assert(isLinkOnly(snap('l')), 'a bare link is link-only');
  assert(!isLinkOnly(snap('m', { url: '' , source: 'manual' })), 'a manual note without URL counted as link-only');
  assert(!isLinkOnly(snap('t', { extractedText: 'x' })), 'a clipping with text counted as link-only');
  return 'preservationLevel precedence: media > archived > text > link-only';
}

/** Minimal RFC 4180 reader, enough to round-trip what the exporter writes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += c;
  }
  return rows;
}

function csv(): string {
  assert(csvCell('plain') === '"plain"', 'plain cell not quoted');
  assert(csvCell('a,b') === '"a,b"', 'comma not quoted');
  assert(csvCell('say "hi"') === '"say ""hi"""', 'quotes not doubled');
  assert(csvCell('l1\nl2') === '"l1\nl2"', 'newline not kept inside quotes');
  for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
    const cell = csvCell(`${lead}SUM(A1)`);
    assert(cell === `"'${lead}SUM(A1)"`, `formula lead ${JSON.stringify(lead)} not neutralised: ${cell}`);
  }
  const rows = [
    snap('csv1', { title: 'Comma, "quoted"', notes: 'line one\nline two', tags: ['a', 'b'], description: '=HYPERLINK("x")' }),
    snap('csv2', { captureHtmlPath: 'p/x.html' }),
  ];
  const text = snapshotsToCsv(rows);
  assert(text.startsWith('﻿'), 'missing UTF-8 BOM');
  const parsed = parseCsv(text.slice(1));
  assert(parsed.length === 3, `expected header + 2 rows, got ${parsed.length}`);
  const header = parsed[0];
  const col = (name: string) => header.indexOf(name);
  assert(['url', 'title', 'description', 'notes', 'tags', 'createdAt', 'preservation'].every((n) => col(n) >= 0), `header: ${header}`);
  assert(parsed[1][col('url')] === 'https://csv1.example/', 'url did not round-trip');
  assert(parsed[1][col('title')] === 'Comma, "quoted"', 'title did not round-trip');
  assert(parsed[1][col('notes')] === 'line one\nline two', 'multi-line notes did not round-trip');
  assert(parsed[1][col('tags')] === 'a; b', 'tags not joined');
  assert(parsed[1][col('description')] === `'=HYPERLINK("x")`, 'formula description not neutralised');
  assert(parsed[1][col('createdAt')] === '2026-01-01T00:00:00.000Z', 'createdAt not ISO');
  assert(parsed[1][col('preservation')] === 'link-only' && parsed[2][col('preservation')] === 'archived', 'preservation column wrong');
  return 'CSV export escapes quotes, commas, newlines and formula leads';
}

async function downloadKeepsTypedDescription(): Promise<string> {
  const typed = snap('dl-typed', { source: 'youtube', description: '', author: '' });
  const untouched = snap('dl-empty', { source: 'youtube', description: '' });
  await db.snapshots.bulkAdd([typed, untouched]);
  setElectronApi({
    media: {
      downloadToLibrary: async ({ snapshotId }: { snapshotId: string }) => {
        // The user types into the detail view while yt-dlp is still running.
        if (snapshotId === typed.id) await db.snapshots.update(typed.id, { description: 'typed during download' });
        return { ok: true, relPath: `${P}/${snapshotId}.mp4`, kind: 'video', description: 'caption from the site', uploader: 'uploader', uploadDate: '20240102' };
      },
    },
  });
  try {
    // Both calls get the row as it was when the download STARTED.
    await runSnapshotDownload({ ...typed }, updateSnapshot);
    await runSnapshotDownload({ ...untouched }, updateSnapshot);
  } finally {
    setElectronApi(undefined);
  }
  const a = await db.snapshots.get(typed.id);
  const b = await db.snapshots.get(untouched.id);
  assert(a?.downloadState === 'done' && a.localMediaPath, 'download did not complete');
  assert(a.description === 'typed during download', `typed description overwritten: ${a.description}`);
  assert(a.author === 'uploader' && a.publishDate === '2024-01-02', 'still-empty fields were not filled');
  assert(b?.description === 'caption from the site', 'an empty description was not filled');
  assert(a.url === typed.url && b.url === untouched.url, 'download rewrote a link');
  await db.snapshots.bulkDelete([typed.id, untouched.id]);
  return 'runSnapshotDownload re-reads the row: a description typed mid-download survives';
}

async function captureKeepsTypedDescription(): Promise<string> {
  const row = snap('cap-typed', { description: '', title: 'cap-typed.example' });
  await db.snapshots.add(row);
  setElectronApi({
    capture: {
      page: async () => {
        await db.snapshots.update(row.id, { description: 'typed during capture' });
        return { ok: true, pdfPath: `${P}/c.pdf`, meta: { title: 'Real title', description: 'meta description' } };
      },
    },
  });
  try {
    await runSnapshotCapture({ ...row }, updateSnapshot);
  } finally {
    setElectronApi(undefined);
  }
  const after = await db.snapshots.get(row.id);
  assert(after?.captureState === 'done', 'capture did not complete');
  assert(after.description === 'typed during capture', `typed description overwritten: ${after.description}`);
  assert(after.title === 'Real title', 'domain placeholder title was not replaced');
  await db.snapshots.delete(row.id);
  return 'runSnapshotCapture re-reads the row: a description typed mid-capture survives';
}

/**
 * A clipping deleted while its download / page capture runs: the finished job
 * must not leave its files behind — and must never touch anything that is not
 * that clipping's own (a bare project id would wipe the project folder).
 */
async function orphanedFilesAreDiscarded(): Promise<string> {
  const keep = snap('orphan-keep', { source: 'youtube', localMediaPath: `${P}/${P}-orphan-keep.mp4`, downloadState: 'done' });
  const single = snap('orphan-single', { source: 'youtube' });
  const carousel = snap('orphan-carousel', { source: 'instagram' });
  const late = snap('orphan-late', { source: 'youtube' });
  const page = snap('orphan-page');
  await db.snapshots.bulkAdd([keep, single, carousel, late, page]);
  const deleted: string[] = [];
  setElectronApi({
    media: {
      deleteLibraryFile: async (relPath: string) => { deleted.push(relPath); },
      downloadToLibrary: async ({ snapshotId }: { snapshotId: string }) => {
        // The user deletes the clipping while yt-dlp runs (except `late`).
        if (snapshotId !== late.id) await db.snapshots.delete(snapshotId);
        if (snapshotId === carousel.id) {
          return {
            ok: true,
            relPath: `${P}/${snapshotId}/0.mp4`,
            kind: 'video',
            // Hostile extras: the project folder and another clipping's file.
            items: [
              { relPath: `${P}/${snapshotId}/0.mp4`, kind: 'video' },
              { relPath: `${P}/${snapshotId}/1.jpg`, kind: 'image' },
              { relPath: P, kind: 'image' },
              { relPath: `${P}/${keep.id}.mp4`, kind: 'video' },
              { relPath: `${P}/${snapshotId}/../${keep.id}.mp4`, kind: 'video' },
            ],
          };
        }
        return { ok: true, relPath: `${P}/${snapshotId}.mp4`, kind: 'video' };
      },
    },
    capture: {
      page: async ({ snapshotId }: { snapshotId: string }) => {
        await db.snapshots.delete(snapshotId);
        return { ok: true, pdfPath: `${P}/${snapshotId}.pdf`, htmlPath: `${P}/${snapshotId}.html`, imagePath: `${P}/${snapshotId}.png` };
      },
    },
  });
  try {
    await runSnapshotDownload({ ...single }, updateSnapshot);
    await runSnapshotDownload({ ...carousel }, updateSnapshot);
    // Deleted in the gap between the post-download read and the write.
    await runSnapshotDownload({ ...late }, async (id, changes) => {
      if (changes.downloadState === 'done') await db.snapshots.delete(id);
      await updateSnapshot(id, changes);
    });
    await runSnapshotCapture({ ...page }, updateSnapshot);
    // Deleted BEFORE its queued turn (collection import): nothing is fetched.
    const before = deleted.length;
    await runSnapshotDownload({ ...snap('orphan-never', { source: 'youtube' }) }, updateSnapshot);
    assert(deleted.length === before, 'a download ran for a clipping that no longer exists');
  } finally {
    setElectronApi(undefined);
  }
  const expected = [
    `${P}/${single.id}.mp4`,
    `${P}/${carousel.id}`,
    `${P}/${late.id}.mp4`,
    `${P}/${page.id}.pdf`,
    `${P}/${page.id}.png`,
    `${P}/${page.id}.html`,
  ];
  assert(
    JSON.stringify([...deleted].sort()) === JSON.stringify([...expected].sort()),
    `orphan cleanup deleted ${JSON.stringify(deleted)}, expected ${JSON.stringify(expected)}`,
  );
  const survivor = await db.snapshots.get(keep.id);
  assert(survivor?.url === keep.url && survivor.localMediaPath === keep.localMediaPath, 'another clipping was touched');
  for (const gone of [single, carousel, late, page]) {
    assert(!(await db.snapshots.get(gone.id)), `a deleted clipping was resurrected: ${gone.id}`);
  }
  await db.snapshots.delete(keep.id);
  return 'a download/capture that finishes after its clipping was deleted discards only that clipping\'s files';
}

/** Deleting a clipping from the detail view cancels its running jobs. */
async function deleteCancelsRunningJobs(): Promise<string> {
  const target = snap('del-running', { source: 'youtube' });
  const other = snap('del-other', { source: 'youtube', localMediaPath: `${P}/${P}-del-other.mp4`, downloadState: 'done' });
  await db.snapshots.bulkAdd([target, other]);
  const cancelledDownloads: string[] = [];
  const cancelledCaptures: string[] = [];
  const deleted: string[] = [];
  let finishDownload: (() => void) | null = null;
  setElectronApi({
    instagram: { status: async () => ({ connected: false }) },
    media: {
      deleteLibraryFile: async (relPath: string) => { deleted.push(relPath); },
      // The cancel loses the race: yt-dlp had already finished the copy.
      cancelDownload: async (id: string) => { cancelledDownloads.push(id); },
      downloadToLibrary: async ({ snapshotId }: { snapshotId: string }) => {
        await new Promise<void>((resolve) => { finishDownload = resolve; });
        return { ok: true, relPath: `${P}/${snapshotId}.mp4`, kind: 'video' };
      },
    },
    capture: { cancel: async (id: string) => { cancelledCaptures.push(id); } },
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const pause = (ms = 25) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  const waitFor = async (condition: () => boolean, message: string) => {
    const deadline = Date.now() + 8000;
    while (!condition() && Date.now() < deadline) await act(async () => { await pause(); });
    assert(condition(), message);
  };
  try {
    await act(async () => {
      root.render(<MemoryRouter><ScrapperEngine projectId={P} /><ToastHost /></MemoryRouter>);
    });
    await waitFor(() => host.querySelectorAll('[data-snapshot-id]').length === 2, 'grid did not load');
    const running = runSnapshotDownload({ ...target }, updateSnapshot);
    await waitFor(() => finishDownload !== null, 'download did not start');
    await act(async () => host.querySelector<HTMLElement>(`[data-snapshot-id="${target.id}"]`)!.click());
    // The detail footer's Delete, then the confirmation's (rendered after it).
    const deleteButtons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .filter((b) => b.textContent?.trim() === 'Delete');
    await waitFor(() => deleteButtons().length === 1, 'detail view did not open');
    await act(async () => deleteButtons()[0].click());
    await waitFor(() => (document.body.textContent?.includes('Delete this snapshot?') ?? false) && deleteButtons().length === 2, 'no delete confirmation');
    await act(async () => deleteButtons()[1].click());
    await waitFor(() => cancelledDownloads.includes(target.id) && cancelledCaptures.includes(target.id), 'delete did not cancel the running jobs');
    await waitFor(() => host.querySelectorAll('[data-snapshot-id]').length === 1, 'clipping was not deleted');
    assert(!cancelledDownloads.includes(other.id) && !cancelledCaptures.includes(other.id), 'another clipping was cancelled');
    await act(async () => { finishDownload!(); await running; });
    assert(JSON.stringify(deleted) === JSON.stringify([`${P}/${target.id}.mp4`]), `late file cleanup: ${JSON.stringify(deleted)}`);
    assert(!(await db.snapshots.get(target.id)), 'the deleted clipping came back');
    assert((await db.snapshots.get(other.id))?.url === other.url, 'another clipping was lost');
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
    setElectronApi(undefined);
    await db.snapshots.bulkDelete([target.id, other.id]);
  }
  return 'deleting a clipping cancels its download/capture; a download that finishes anyway is removed';
}

/** The batch belongs to the module: a remounted view shows Stop, and no second batch starts. */
async function batchSurvivesRemount(): Promise<string> {
  const rows = [snap('rm-a'), snap('rm-b')];
  await db.snapshots.bulkAdd(rows);
  const started: string[] = [];
  let release: (() => void) | null = null;
  setElectronApi({
    instagram: { status: async () => ({ connected: false }) },
    capture: {
      page: async ({ snapshotId }: { snapshotId: string }) => {
        started.push(snapshotId);
        await new Promise<void>((resolve) => { release = resolve; });
        return { ok: false, error: 'cancelled' };
      },
      cancel: async () => { release?.(); },
    },
  });
  const pause = (ms = 25) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  const waitFor = async (condition: () => boolean, message: string) => {
    const deadline = Date.now() + 8000;
    while (!condition() && Date.now() < deadline) await act(async () => { await pause(); });
    assert(condition(), message);
  };
  const button = (match: (text: string) => boolean) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => match(b.textContent?.trim() ?? ''));
  const mount = async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<MemoryRouter><ScrapperEngine projectId={P} /><ToastHost /></MemoryRouter>);
    });
    return { host, root };
  };
  let view = await mount();
  try {
    await waitFor(() => button((t) => t === 'Archive link-only (2)') !== undefined, 'archive button missing');
    await act(async () => button((t) => t === 'Archive link-only (2)')!.click());
    await waitFor(() => Boolean(button((t) => t === 'Archive 2')), 'no confirmation');
    await act(async () => button((t) => t === 'Archive 2')!.click());
    await waitFor(() => Boolean(button((t) => t.startsWith('Stop archiving'))) && release !== null, 'batch did not start');

    // Leave the tab and come back while the first page is still rendering.
    await act(async () => { view.root.unmount(); });
    view.host.remove();
    view = await mount();
    await waitFor(() => button((t) => t === 'Stop archiving (0/2)') !== undefined, 'remounted view lost the Stop control');
    assert(!button((t) => t.startsWith('Archive link-only')), 'remounted view offers a second batch');
    assert(!startArchiveBatch(rows.map((r) => r.id)), 'a second batch started while one runs');
    assert(started.length === 1, `captures running at once: ${started.length}`);

    await act(async () => button((t) => t.startsWith('Stop archiving'))!.click());
    await waitFor(() => document.body.textContent?.includes('Archived 0 of 2 pages.') ?? false, 'stop from the remounted view did not end the batch');
    assert(started.length === 1, 'the batch kept going after Stop');
    await waitFor(() => button((t) => t === 'Archive link-only (2)') !== undefined, 'archive button did not come back');
    const after = await db.snapshots.bulkGet(rows.map((r) => r.id));
    assert(after.every((row, i) => row?.url === rows[i].url), 'a link was lost or rewritten');
  } finally {
    await act(async () => { view.root.unmount(); });
    view.host.remove();
    setElectronApi(undefined);
    await db.snapshots.bulkDelete(rows.map((r) => r.id));
  }
  return 'batch archive progress + Stop survive a remount, and only one batch runs at a time';
}

async function engineUi(passed: string[]): Promise<void> {
  const rows = [
    snap('a'),
    snap('b'),
    snap('c', { extractedText: 'saved text' }),
    snap('d', { source: 'youtube', localMediaPath: `${P}/d.mp4`, downloadState: 'done' }),
    snap('e', { source: 'youtube', title: 'video link' }),
    snap('f', { source: 'manual', url: '', title: 'manual note' }),
  ];
  await db.snapshots.bulkAdd(rows);
  const byId = (s: string) => `${P}-${s}`;

  let pendingCancel: (() => void) | null = null;
  let mode: 'normal' | 'hang' = 'normal';
  setElectronApi({
    instagram: { status: async () => ({ connected: false }) },
    capture: {
      page: async ({ url }: { url: string }) => {
        if (mode === 'hang') {
          await new Promise<void>((resolve) => { pendingCancel = resolve; });
          return { ok: false, error: 'cancelled' };
        }
        if (url.includes('a.example')) {
          return { ok: true, pdfPath: `${P}/a.pdf`, htmlPath: `${P}/a.html`, meta: { title: 'Page A' } };
        }
        return { ok: false, error: 'net::ERR_NAME_NOT_RESOLVED' };
      },
      cancel: async () => { pendingCancel?.(); },
    },
  });

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const pause = (ms = 25) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  const waitFor = async (condition: () => boolean, message: string) => {
    const deadline = Date.now() + 8000;
    while (!condition() && Date.now() < deadline) await act(async () => { await pause(); });
    assert(condition(), message);
  };
  const button = (match: (text: string) => boolean) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => match(b.textContent?.trim() ?? ''));
  const cards = () => host.querySelectorAll('[data-snapshot-id]').length;
  const chip = () => host.querySelector<HTMLButtonElement>('button[aria-pressed]');

  try {
    await act(async () => {
      root.render(<MemoryRouter><ScrapperEngine projectId={P} /><ToastHost /></MemoryRouter>);
    });
    await waitFor(() => cards() === 6, `grid did not load (${cards()} cards)`);

    // 1. Badges: one per link clipping, in text, none for the URL-less note.
    const badge = (level: string) => host.querySelectorAll(`[data-preservation="${level}"]`).length;
    assert(badge('link-only') === 3 && badge('text') === 1 && badge('media') === 1 && badge('archived') === 0, 'wrong badge counts');
    assert(host.querySelectorAll('[data-preservation]').length === 5, 'a manual note got a badge');
    assert(host.querySelector('[data-preservation="link-only"]')?.textContent === 'Link only', 'badge is not readable text');
    passed.push('grid shows one readable preservation badge per link clipping');

    // 2. Filter chip + clear filters.
    assert(chip()?.textContent === 'Link only (3)', `chip text: ${chip()?.textContent}`);
    await act(async () => chip()!.click());
    await waitFor(() => cards() === 3, 'link-only filter did not narrow the grid');
    assert(chip()!.getAttribute('aria-pressed') === 'true', 'chip does not expose its pressed state');
    const search = host.querySelector<HTMLInputElement>('input[placeholder="Search snapshots..."]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'saved text');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await waitFor(() => cards() === 0 && Boolean(button((t) => t === 'Clear filters')), 'search + chip did not combine');
    await act(async () => button((t) => t === 'Clear filters')!.click());
    await waitFor(() => cards() === 6, 'clear filters did not restore every clipping');
    assert(chip()!.getAttribute('aria-pressed') === 'false' && search.value === '', 'clear filters left a filter on');
    passed.push('link-only chip filters, combines with search, and clear filters resets both');

    // 3. Export: intercept the browser-native download and read the blob back.
    const originalDispatch = HTMLAnchorElement.prototype.dispatchEvent;
    let exported: { href: string; name: string } | null = null;
    HTMLAnchorElement.prototype.dispatchEvent = function (this: HTMLAnchorElement, event: Event) {
      if (this.download) { exported = { href: this.href, name: this.download }; return true; }
      return originalDispatch.call(this, event);
    };
    try {
      const exportButton = host.querySelector<HTMLButtonElement>('button[aria-label="Export links"]');
      assert(exportButton, 'export button missing');
      await act(async () => exportButton.click());
      await waitFor(() => exported !== null, 'export did not start a download');
    } finally {
      HTMLAnchorElement.prototype.dispatchEvent = originalDispatch;
    }
    const file = exported as unknown as { href: string; name: string };
    assert(/^recortes-\d{4}-\d{2}-\d{2}\.csv$/.test(file.name), `export filename: ${file.name}`);
    const parsed = parseCsv((await (await fetch(file.href)).text()).replace(/^﻿/, ''));
    assert(parsed.length === 7, `export should hold header + 6 rows, got ${parsed.length}`);
    passed.push('export downloads every clipping of the project as CSV');

    // 4. Batch archive: confirm, run sequentially, one summary toast.
    const archiveButton = () => button((t) => t.startsWith('Archive link-only'));
    assert(archiveButton()?.textContent === 'Archive link-only (2)', `archive button: ${archiveButton()?.textContent}`);
    await act(async () => archiveButton()!.click());
    await waitFor(() => Boolean(document.querySelector('[role="dialog"]')), 'archive did not ask for confirmation');
    await act(async () => button((t) => t === 'Archive 2')!.click());
    await waitFor(() => document.body.textContent?.includes('Archived 1 of 2 pages.') ?? false, 'no batch summary toast');
    assert(document.body.textContent?.includes('1 failed'), 'summary does not report the failure');
    const a = await db.snapshots.get(byId('a'));
    const b = await db.snapshots.get(byId('b'));
    const e = await db.snapshots.get(byId('e'));
    assert(a?.captureState === 'done' && a.capturePdfPath, 'page A not archived');
    assert(b?.captureState === 'error', 'page B failure not recorded');
    assert(e?.captureState === undefined, 'a video link was sent to the page archiver');
    await waitFor(() => host.querySelector(`[data-snapshot-id="${byId('a')}"] [data-preservation="archived"]`) !== null, 'badge did not update after archiving');
    await waitFor(() => chip()?.textContent === 'Link only (2)', 'chip count did not drop after archiving');
    passed.push('batch archive confirms, captures sequentially and ends with one summary toast');

    // 5. Stop: cancels the page being rendered; it goes back to link-only.
    mode = 'hang';
    await waitFor(() => archiveButton()?.textContent === 'Archive link-only (1)', 'retry count wrong');
    await act(async () => archiveButton()!.click());
    await waitFor(() => Boolean(button((t) => t === 'Archive 1')), 'second confirmation missing');
    await act(async () => button((t) => t === 'Archive 1')!.click());
    await waitFor(() => Boolean(button((t) => t.startsWith('Stop archiving'))) && pendingCancel !== null, 'no stop control while running');
    await act(async () => button((t) => t.startsWith('Stop archiving'))!.click());
    await waitFor(() => document.body.textContent?.includes('Archived 0 of 1 pages.') ?? false, 'stopped batch did not summarise');
    assert((await db.snapshots.get(byId('b')))?.captureState === 'idle', 'stopped capture not reset to link-only');
    passed.push('stopping the batch cancels the running capture');

    // Nothing lost, no link rewritten.
    const after = await db.snapshots.where('projectId').equals(P).toArray();
    assert(after.length === rows.length, 'a clipping disappeared');
    for (const row of rows) {
      assert(after.find((s) => s.id === row.id)?.url === row.url, `link rewritten for ${row.id}`);
    }
    passed.push('no clipping is deleted and no URL is rewritten');
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
    setElectronApi(undefined);
    await db.snapshots.bulkDelete(rows.map((r) => r.id));
  }
}

export async function testScrapperPreservation(): Promise<string[]> {
  if (!db.isOpen()) await db.open();
  const priorLocale = useLocaleStore.getState().locale;
  useLocaleStore.setState({ locale: 'en' });
  const passed: string[] = [];
  try {
    passed.push(levels());
    passed.push(csv());
    passed.push(await downloadKeepsTypedDescription());
    passed.push(await captureKeepsTypedDescription());
    await engineUi(passed);
    passed.push(await orphanedFilesAreDiscarded());
    passed.push(await deleteCancelsRunningJobs());
    passed.push(await batchSurvivesRemount());
  } finally {
    useLocaleStore.setState({ locale: priorLocale });
  }
  return passed;
}
