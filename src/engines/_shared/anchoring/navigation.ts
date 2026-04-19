// ============================================
// Navigation bridge for anchor adapters
// ============================================
//
// Anchor adapters are registered at module-init time, long before any React
// router mounts. But `navigateToEntity` is called from UI handlers that live
// inside a <BrowserRouter>. This tiny bridge lets the adapter call a plain
// function; a top-level component installs the real `navigate` fn once.
//
// Fallback: if no navigator is installed (e.g. during a test or before the
// first render), we fall back to `history.pushState` + a popstate event so
// that react-router picks up the change.

type Navigator = (to: string) => void;

let installed: Navigator | null = null;

export function installNavigator(nav: Navigator): void {
  installed = nav;
}

export function navigateTo(path: string): void {
  if (installed) {
    installed(path);
    return;
  }
  if (typeof window !== 'undefined' && window.history) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}

/**
 * Best-effort current-project-id reader. Anchor adapters need a projectId
 * to compose engine URLs but don't always know which project is active
 * (they're module-scoped). We parse the first URL segment as a pragma —
 * matches `/project/:id/...`.
 */
export function getCurrentProjectIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const m = window.location.pathname.match(/\/project\/([^/?#]+)/);
  return m ? m[1] : null;
}
