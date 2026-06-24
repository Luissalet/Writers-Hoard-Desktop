// Tiny runtime helper for "are we inside the Electron desktop shell?".
//
// Used to (a) pick HashRouter vs BrowserRouter and (b) gate desktop-only UI
// such as the Media Downloader, which needs the bundled yt-dlp backend that
// the web/GitHub Pages build can't host.

export function isDesktop(): boolean {
  if (typeof window !== 'undefined' && window.electronAPI?.isDesktop) return true;
  if (typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent)) return true;
  return false;
}
