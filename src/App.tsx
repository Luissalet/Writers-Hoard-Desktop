import { BrowserRouter, HashRouter, Routes, Route } from 'react-router-dom';
import '@/engines'; // Initialize engine registry
import MainLayout from './components/layout/MainLayout';
import Dashboard from './pages/Dashboard';
import ProjectDetail from './pages/ProjectDetail';
import MediaDownloader from './pages/MediaDownloader';
import { isDesktop } from './utils/platform';

// In the desktop shell the renderer loads from file://, so we use HashRouter
// (path-based routing can't resolve under file://). The web build keeps
// BrowserRouter with its GitHub Pages basename.
const desktop = isDesktop();
const Router = desktop ? HashRouter : BrowserRouter;
const basename = desktop ? '/' : import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

export default function App() {
  return (
    <Router basename={basename}>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Dashboard />} />
          {/* Media Downloader is desktop-only: it needs the bundled yt-dlp
              backend that GitHub Pages can't host. */}
          {desktop && <Route path="/media-downloader" element={<MediaDownloader />} />}
          <Route path="/project/:id" element={<ProjectDetail />} />
          <Route path="/project/:id/:tab" element={<ProjectDetail />} />
        </Route>
      </Routes>
    </Router>
  );
}
