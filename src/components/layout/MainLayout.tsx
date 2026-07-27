import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import GlobalSearch from '../common/GlobalSearch';
import { ToastHost } from '../common/toast';
import QuickNoteHost from '@/engines/notes/components/QuickNoteHost';
import { installNavigator } from '@/engines/_shared/anchoring';
import { initializeAppServices } from '@/services/appInitialization';
import { useAiStore } from '@/stores/aiStore';
import { useLocaleStore } from '@/stores/localeStore';

export default function MainLayout() {
  const navigate = useNavigate();
  const loadAiSettings = useAiStore(state => state.loadSettings);
  const loadLocale = useLocaleStore(state => state.loadLocale);

  // Expose the router's navigate to module-scoped anchor adapters so they
  // can jump to entities without reloading the page.
  useEffect(() => {
    installNavigator((to: string) => navigate(to));
  }, [navigate]);

  useEffect(() => {
    void Promise.all([
      initializeAppServices(),
      loadAiSettings(),
      loadLocale(),
    ]).catch(error => console.error('Application initialization failed', error));
  }, [loadAiSettings, loadLocale]);

  return (
    <div className="h-screen w-screen flex overflow-hidden grain-bg">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <Outlet />
      </main>
      <GlobalSearch />
      <QuickNoteHost />
      <ToastHost />
    </div>
  );
}
