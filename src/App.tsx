import { BrowserRouter, Routes, Route } from 'react-router-dom';
import '@/engines'; // Initialize engine registry
import MainLayout from './components/layout/MainLayout';
import Dashboard from './pages/Dashboard';
import ProjectDetail from './pages/ProjectDetail';
import MediaDownloader from './pages/MediaDownloader';

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

export default function App() {
  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/media-downloader" element={<MediaDownloader />} />
          <Route path="/project/:id" element={<ProjectDetail />} />
          <Route path="/project/:id/:tab" element={<ProjectDetail />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
