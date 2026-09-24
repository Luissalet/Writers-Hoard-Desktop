// ============================================================================
// Writers Hoard — embedded Instagram login (main process)
// ============================================================================
//
// Instagram needs a logged-in session to fetch photos/carousels (and it makes
// video downloads more reliable too). Instead of handling the user's password,
// we open a real Instagram login window in an isolated, persistent session
// partition. Once a `sessionid` cookie appears, we export the partition's
// cookies to a Netscape `cookies.txt` that yt-dlp / gallery-dl consume via
// `--cookies`. The password never touches our code.

import { app, BrowserWindow, session } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const PARTITION = 'persist:instagram';
const LOGIN_URL = 'https://www.instagram.com/accounts/login/';
// A normal desktop-Chrome UA avoids Instagram flagging the Electron client.
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export function igCookiesPath(): string {
  return path.join(app.getPath('userData'), 'ig-cookies.txt');
}

function igSession() {
  return session.fromPartition(PARTITION);
}

async function hasSessionCookie(): Promise<boolean> {
  const cookies = await igSession().cookies.get({ domain: 'instagram.com', name: 'sessionid' });
  return cookies.some((c) => !!c.value);
}

/**
 * Callers between an `exportIgCookies()` and its `cleanupIgCookies()`.
 *
 * Two of them can overlap: a collection listing (`ig:listCollection`) does not
 * run on the download lane, so it shares the one jar with a queued download.
 * Deleting it when the FIRST of them finished pulled the file out from under a
 * gallery-dl / yt-dlp still starting up (a private collection then lists as
 * "login required"), and a child still running afterwards writes the jar back
 * on exit (both tools update a `--cookies` file), leaving the session on disk.
 * So the jar goes when the LAST holder lets go.
 */
let cookieJarHolders = 0;

/**
 * Export the Instagram partition's cookies to a Netscape cookies.txt.
 * Returns true if a logged-in session was found (and the file written).
 *
 * The `sessionid` in that file IS the account: it is written owner-only and
 * the caller must `cleanupIgCookies()` in a finally once the child process it
 * was written for has exited — whatever this returned or threw, since every
 * call takes a hold on the jar.
 */
export async function exportIgCookies(): Promise<boolean> {
  cookieJarHolders += 1;
  const cookies = await igSession().cookies.get({ domain: 'instagram.com' });
  if (!cookies.some((c) => c.name === 'sessionid' && c.value)) return false;

  const lines = ['# Netscape HTTP Cookie File', ''];
  for (const c of cookies) {
    const domain = c.domain ?? '.instagram.com';
    const includeSub = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 0;
    lines.push(
      [domain, includeSub, c.path || '/', c.secure ? 'TRUE' : 'FALSE', String(expiry), c.name, c.value].join(
        '\t',
      ),
    );
  }
  await fs.writeFile(igCookiesPath(), lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
  // `mode` only applies when the file is created — an existing jar keeps
  // whatever it had, so narrow it explicitly.
  await fs.chmod(igCookiesPath(), 0o600).catch(() => undefined);
  return true;
}

/** Release one hold on the exported jar; the last release deletes it. */
export async function cleanupIgCookies(): Promise<void> {
  cookieJarHolders = Math.max(0, cookieJarHolders - 1);
  if (cookieJarHolders > 0) return;
  await removeIgCookieJar();
}

/** Delete the exported cookie jar. Safe to call when it is not there. */
async function removeIgCookieJar(): Promise<void> {
  await fs.rm(igCookiesPath(), { force: true }).catch(() => undefined);
}

/** Whether the app currently holds an Instagram session. */
export async function igStatus(): Promise<{ connected: boolean }> {
  return { connected: await hasSessionCookie() };
}

/** Clear the Instagram session and the exported cookies file. */
export async function igLogout(): Promise<void> {
  try {
    await igSession().clearStorageData();
  } catch {
    /* ignore */
  }
  // Logging out removes the jar now, held or not; the holders' own releases
  // stay balanced and simply find nothing left to delete.
  await removeIgCookieJar();
}

/**
 * Open an embedded Instagram login window. Resolves once a session cookie is
 * present (auto-detected) or when the user closes the window.
 */
export function openIgLogin(parent: BrowserWindow | null): Promise<{ connected: boolean }> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 460,
      height: 760,
      parent: parent ?? undefined,
      title: 'Conectar Instagram',
      autoHideMenuBar: true,
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });

    let settled = false;
    const finish = async () => {
      if (settled) return;
      settled = true;
      const connected = await hasSessionCookie().catch(() => false);
      if (!win.isDestroyed()) win.close();
      resolve({ connected });
    };

    const check = async () => {
      if (await hasSessionCookie()) void finish();
    };

    win.webContents.setUserAgent(CHROME_UA);
    win.webContents.on('did-navigate', () => void check());
    win.webContents.on('did-navigate-in-page', () => void check());

    win.on('closed', () => {
      if (settled) return;
      settled = true;
      hasSessionCookie()
        .then((connected) => resolve({ connected }))
        .catch(() => resolve({ connected: false }));
    });

    void win.loadURL(LOGIN_URL);
  });
}
