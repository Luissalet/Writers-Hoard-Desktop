import { BrowserRouter, Routes, Route } from 'react-router-dom';
import '@/engines'; // Initialize engine registry
import MainLayout from './components/layout/MainLayout';
import Dashboard from './pages/Dashboard';
import ProjectDetail from './pages/ProjectDetail';
// import MediaDownloader from './pages/MediaDownloader';
//   ^^ Disabled 2026-05-28 — requires a yt-dlp backend that GitHub Pages
//   can't host. Re-enable once we decide between (1) cobalt.tools redirect,
//   (2) cobalt API client, or (3) self-hosted server (Fly/Render).
//   See tasks/todo.md and tasks/lessons.md #14.

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

export default function App() {
  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/project/:id" element={<ProjectDetail />} />
          <Route path="/project/:id/:tab" element={<ProjectDetail />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
