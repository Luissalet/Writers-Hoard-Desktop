// ============================================================================
// Page capture â€” archive a plain web page as PDF + full-page screenshot + HTML
// ============================================================================
//
// This is the Electron port of Rabbitholer's `/api/puppeteer-capture` endpoint.
// Rabbitholer had to launch a separate headless Chrome through puppeteer-core;
// here the main process IS Chromium, so we load the page in a hidden
// BrowserWindow and drive it with `printToPDF` + the Chrome DevTools Protocol.
//
// Parity with Rabbitholer, deliberately:
//   â€¢ 1280x900 viewport, desktop Chrome UA
//   â€¢ wait for load, then a settle delay for JS-heavy pages
//   â€¢ full rendered HTML (after JS execution), not the raw server response
//   â€¢ PDF printed at the *screen* width (1280px) as ONE tall page rather than
//     reflowed to A4 â€” so the archive looks exactly like the live page
//   â€¢ full-page PNG (captureBeyondViewport), not just the viewport
//   â€¢ metadata scraped from og:/twitter:/article: meta tags with the same
//     fallback chain, plus a heuristic main-content text extraction

import { BrowserWindow } from 'electron';

/** Viewport width used for both the screenshot and the PDF page width. */
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 900;

/** CSS pixels per inch â€” Chromium's printToPDF sizes are expressed in inches. */
const PX_PER_INCH = 96;

/** Chromium refuses PDF pages larger than 200in; taller pages just paginate. */
const MAX_PDF_PAGE_PX = 200 * PX_PER_INCH;

/**
 * Chromium can't composite an image taller than ~16k px. Rather than clip a
 * long article in half, very tall pages are captured at a reduced scale so the
 * whole page still fits in one image.
 */
const MAX_SCREENSHOT_PX = 16000;

const NAV_TIMEOUT_MS = 30000;
/** Extra wait after load for JS-heavy pages (countdowns, lazy content). */
const SETTLE_MS = 1500;

// A hidden window only composites lazily, so `Page.captureScreenshot` can wait
// forever for a frame that never comes. Every step that talks to the page gets
// a ceiling â€” a capture that gives up is recoverable, one that hangs leaves the
// snapshot stuck on "Archivingâ€¦" with no way out.
const SCRIPT_TIMEOUT_MS = 15000;
const SCREENSHOT_TIMEOUT_MS = 25000;
const PDF_TIMEOUT_MS = 45000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface PageMeta {
  title?: string;
  author?: string;
  publishDate?: string;
  siteName?: string;
  description?: string;
  favicon?: string;
  ogImage?: string;
  language?: string;
  /** Heuristic main-content text, used when Readability finds too little. */
  fallbackText?: string;
  wordCount?: number;
}

export interface PageCaptureResult {
  /** Fully rendered outerHTML, with a <base> tag injected for offline reading. */
  html: string;
  pdf: Buffer;
  /** Null when the screenshot step failed â€” the rest of the capture still counts. */
  png: Buffer | null;
  meta: PageMeta;
}

// ---------------------------------------------------------------------------
// In-page scripts (plain strings: the electron tsconfig has no DOM lib)
// ---------------------------------------------------------------------------

/**
 * Scroll the whole page once to force lazy-loaded images/sections to render.
 * Puppeteer's `networkidle2` covered this for Rabbitholer; Electron has no
 * equivalent, so we walk the page instead and then return to the top.
 */
const SCROLL_SCRIPT = `
(async () => {
  const step = Math.max(400, window.innerHeight * 0.9);
  const limit = Math.min(document.documentElement.scrollHeight, 60000);
  for (let y = 0; y < limit; y += step) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 120));
  }
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 300));
  return true;
})()
`;

/**
 * Metadata + main-content text extraction. Same fallback chain Rabbitholer
 * used in `urlCapture.ts`, but run against the live DOM instead of a
 * re-parsed HTML string.
 */
const META_SCRIPT = `
(() => {
  const attr = (sel, name) => {
    const el = document.querySelector(sel);
    const v = el && el.getAttribute(name || 'content');
    return v ? v.trim() : undefined;
  };

  const title =
    attr('meta[property="og:title"]') ||
    attr('meta[name="twitter:title"]') ||
    (document.querySelector('title') && document.querySelector('title').textContent || '').trim() ||
    (document.querySelector('h1') && document.querySelector('h1').textContent || '').trim() ||
    undefined;

  let author = attr('meta[name="author"]') || attr('meta[property="article:author"]');
  if (!author) {
    const byline = document.querySelector('[class*="byline"], [class*="author"], [class*="by-"]');
    const text = byline && byline.textContent ? byline.textContent.trim() : '';
    if (text && text.length < 100) author = text;
  }

  const publishDate =
    attr('meta[property="article:published_time"]') ||
    attr('meta[name="publish_date"]') ||
    attr('time[datetime]', 'datetime');

  const description =
    attr('meta[property="og:description"]') || attr('meta[name="description"]');

  const favicon =
    attr('link[rel="icon"]', 'href') || attr('link[rel="apple-touch-icon"]', 'href');

  const siteName = attr('meta[property="og:site_name"]');
  const ogImage = attr('meta[property="og:image"]');
  const language =
    document.documentElement.getAttribute('lang') ||
    attr('meta[http-equiv="Content-Language"]') ||
    undefined;

  // --- main content text (Rabbitholer's findMainContent + cleanup) ---
  const pickMain = () => {
    const article = document.querySelector('article');
    if (article) return article;
    const main = document.querySelector('main');
    if (main) return main;
    const selectors = [
      '[role="main"]', '.content', '.post-content', '.entry-content',
      '.article-body', '.story-body', '#content', '.page-content',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent && el.textContent.length > 500) return el;
    }
    return document.body;
  };

  let fallbackText = '';
  try {
    const root = pickMain();
    const clone = root ? root.cloneNode(true) : null;
    if (clone) {
      const junk = 'script, style, noscript, nav, aside, iframe, form, ' +
        '[role="complementary"], [class*="sidebar"], [class*="comment"], ' +
        '[class*="social-share"], [class*="advert"], .ads, [data-ad-slot]';
      clone.querySelectorAll(junk).forEach((el) => el.remove());
      fallbackText = (clone.textContent || '')
        .split('\\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join('\\n')
        .replace(/\\n{3,}/g, '\\n\\n');
    }
  } catch (e) { /* text extraction is best-effort */ }

  const wordCount = fallbackText ? fallbackText.trim().split(/\\s+/).length : 0;

  return {
    title, author, publishDate, siteName, description,
    favicon, ogImage, language, fallbackText, wordCount,
  };
})()
`;

const HTML_SCRIPT = 'document.documentElement.outerHTML';
const HEIGHT_SCRIPT = 'document.documentElement.scrollHeight';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Load `url` in `win`, rejecting on navigation failure or after NAV_TIMEOUT_MS.
 * `loadURL` alone can hang forever on a stalled connection.
 */
function loadWithTimeout(win: BrowserWindow, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(
      () => done(new Error('timeout loading page')),
      NAV_TIMEOUT_MS,
    );
    win.webContents.once('did-fail-load', (_e, code, desc) => {
      // -3 (ABORTED) fires for benign client-side redirects; ignore it.
      if (code === -3) return;
      done(new Error(desc || 'failed to load page (' + code + ')'));
    });
    win.loadURL(url).then(() => done(), (err: unknown) =>
      done(err instanceof Error ? err : new Error(String(err))),
    );
  });
}

/** Reject with `label` if `p` hasn't settled within `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + ' timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Inject <base href> so relative asset URLs still resolve in the saved copy. */
function injectBase(html: string, pageUrl: string): string {
  if (/<base\s/i.test(html)) return html;
  const tag = '<base href="' + pageUrl.replace(/"/g, '&quot;') + '">';
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => m + '\n' + tag);
  }
  return tag + html;
}

/**
 * Full-page PNG through the DevTools Protocol. `capturePage()` only ever
 * returns the visible viewport; `Page.captureScreenshot` with
 * `captureBeyondViewport` is the equivalent of Puppeteer's `fullPage: true`.
 */
async function fullPageScreenshot(
  win: BrowserWindow,
  fullHeight: number,
): Promise<Buffer | null> {
  const wc = win.webContents;
  let attached = false;
  let subscribed = false;
  try {
    wc.debugger.attach('1.3');
    attached = true;
    // An occluded window composites lazily, so `Page.captureScreenshot` can sit
    // forever waiting for a frame that is never produced. Subscribing to frames
    // forces the compositor to keep drawing for as long as we're capturing.
    try {
      wc.beginFrameSubscription(false, () => {});
      subscribed = true;
    } catch {
      /* older/odd platforms â€” the timeout below still protects us */
    }
    wc.invalidate();
    await withTimeout(
      wc.debugger.sendCommand('Page.enable'),
      SCRIPT_TIMEOUT_MS,
      'Page.enable',
    );
    // Scale down rather than crop, so a 27k-pixel article still produces a
    // complete picture of the page instead of its first two thirds.
    const scale = Math.min(1, MAX_SCREENSHOT_PX / fullHeight);
    const result = (await withTimeout(
      wc.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: VIEWPORT_WIDTH, height: fullHeight, scale },
      }),
      SCREENSHOT_TIMEOUT_MS,
      'screenshot',
    )) as { data?: string };
    if (!result?.data) return null;
    return Buffer.from(result.data, 'base64');
  } catch {
    // CDP stalled or is unavailable â€” fall back to the viewport-only capture.
    try {
      const image = await withTimeout(wc.capturePage(), 10000, 'capturePage');
      return image.isEmpty() ? null : image.toPNG();
    } catch {
      return null;
    }
  } finally {
    if (subscribed) {
      try {
        wc.endFrameSubscription();
      } catch {
        /* window already gone */
      }
    }
    if (attached) {
      try {
        wc.debugger.detach();
      } catch {
        /* already detached */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render `url` in a hidden browser window and archive it.
 * Throws 'cancelled' when `signal` aborts, or a readable message on failure.
 */
export async function capturePage(
  url: string,
  signal?: AbortSignal,
): Promise<PageCaptureResult> {
  if (signal?.aborted) throw new Error('cancelled');

  const win = new BrowserWindow({
    show: false,
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    useContentSize: true,
    webPreferences: {
      // No preload, no Node, sandboxed: this window renders untrusted pages.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      // Hidden windows would otherwise stop painting â€” and a window that
      // never paints screenshots as blank.
      backgroundThrottling: false,
      images: true,
    },
  });

  const onAbort = () => {
    if (!win.isDestroyed()) win.destroy();
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    // Nothing this window does may escape into the app or the user's browser.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.setUserAgent(USER_AGENT);
    win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

    await loadWithTimeout(win, url);
    if (signal?.aborted) throw new Error('cancelled');

    await new Promise((r) => setTimeout(r, SETTLE_MS));
    if (signal?.aborted) throw new Error('cancelled');

    // Walk the page so lazy images load, then let it settle again.
    try {
      await withTimeout(
        win.webContents.executeJavaScript(SCROLL_SCRIPT, true),
        SCRIPT_TIMEOUT_MS * 2,
        'scroll',
      );
    } catch {
      /* some pages block scripted scrolling â€” not fatal */
    }
    if (signal?.aborted) throw new Error('cancelled');

    const rawHtml = (await withTimeout(
      win.webContents.executeJavaScript(HTML_SCRIPT, true),
      SCRIPT_TIMEOUT_MS,
      'read html',
    )) as string;
    const meta = (await withTimeout(
      win.webContents.executeJavaScript(META_SCRIPT, true),
      SCRIPT_TIMEOUT_MS,
      'read metadata',
    )) as PageMeta;
    const fullHeight = Math.max(
      VIEWPORT_HEIGHT,
      Math.ceil(
        (await withTimeout(
          win.webContents.executeJavaScript(HEIGHT_SCRIPT, true),
          SCRIPT_TIMEOUT_MS,
          'measure page',
        )) as number,
      ),
    );

    if (signal?.aborted) throw new Error('cancelled');
    const png = await fullPageScreenshot(win, fullHeight);

    if (signal?.aborted) throw new Error('cancelled');
    // Print at screen width as one tall page â€” no A4 reflow, no print-CSS
    // colour washing. Taller-than-max pages simply paginate.
    try {
      await win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        media: 'screen',
      });
    } catch {
      /* screen emulation is a nicety, not a requirement */
    }
    const pdf = await withTimeout(
      win.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: false,
        margins: { marginType: 'none' },
        pageSize: {
          width: VIEWPORT_WIDTH / PX_PER_INCH,
          height: Math.min(fullHeight, MAX_PDF_PAGE_PX) / PX_PER_INCH,
        },
      }),
      PDF_TIMEOUT_MS,
      'PDF print',
    );
    try {
      win.webContents.debugger.detach();
    } catch {
      /* already detached */
    }

    return { html: injectBase(rawHtml, url), pdf, png, meta };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (!win.isDestroyed()) win.destroy();
  }
}
