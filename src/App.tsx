import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, HashRouter, Navigate, Routes, Route, useLocation } from 'react-router-dom';
import '@/engines'; // Initialize engine registry
import MainLayout from './components/layout/MainLayout';
import EngineErrorBoundary from './components/common/EngineErrorBoundary';
import { useTranslation } from './i18n/useTranslation';
import { isDesktop } from './utils/platform';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'));
const MediaDownloader = lazy(() => import('./pages/MediaDownloader'));
const NotesInbox = lazy(() => import('./pages/NotesInbox'));
const AiSettings = lazy(() => import('./pages/AiSettings'));

// In the desktop shell the renderer loads from file://, so we use HashRouter
// (path-based routing can't resolve under file://). The web build keeps
// BrowserRouter with its GitHub Pages basename.
const desktop = isDesktop();
const Router = desktop ? HashRouter : BrowserRouter;
const basename = desktop ? '/' : import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

/**
 * A page that throws while rendering — or whose lazy chunk fails to load —
 * must not unmount the shell with it: without a boundary here React drops the
 * whole tree and the window goes blank, sidebar included. The boundary sits
 * outside Suspense so a rejected import is caught too, and resets when the
 * writer navigates elsewhere.
 */
function DeferredRoute({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  return (
    <EngineErrorBoundary
      resetKey={pathname}
      title={t('app.routeError.title')}
      message={t('app.routeError.message')}
      retryLabel={t('common.retry')}
      detailsLabel={t('project.engineError.details')}
    >
      <Suspense
        fallback={(
          <div className="flex min-h-[16rem] flex-1 items-center justify-center" aria-busy="true">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-gold border-t-transparent" />
          </div>
        )}
      >
        {children}
      </Suspense>
    </EngineErrorBoundary>
  );
}

export default function App() {
  return (
    <Router basename={basename}>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<DeferredRoute><Dashboard /></DeferredRoute>} />
          {/* Media Downloader is desktop-only: it needs the bundled yt-dlp
              backend that GitHub Pages can't host. */}
          {desktop && (
            <Route
              path="/media-downloader"
              element={<DeferredRoute><MediaDownloader /></DeferredRoute>}
            />
          )}
          {/* Project-less quick-capture drawer — reachable from anywhere. */}
          <Route path="/notes" element={<DeferredRoute><NotesInbox /></DeferredRoute>} />
          {/* AI settings: connections by IP, local models, defaults, MCP access. */}
          <Route path="/settings/ai" element={<DeferredRoute><AiSettings /></DeferredRoute>} />
          <Route path="/project/:id" element={<DeferredRoute><ProjectDetail /></DeferredRoute>} />
          <Route path="/project/:id/:tab" element={<DeferredRoute><ProjectDetail /></DeferredRoute>} />
          {/* An unknown path (a stale bookmark, a desktop-only route in the
              web build) would otherwise match nothing and render an empty
              window with no sidebar to navigate away from. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Router>
  );
}
