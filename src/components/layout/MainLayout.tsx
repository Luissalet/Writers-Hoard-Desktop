import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import WindowTitleBar from './WindowTitleBar';
import GlobalSearch from '../common/GlobalSearch';
import ShortcutsPanel from '../common/ShortcutsPanel';
import { ToastHost } from '../common/toast';
import BridgeConfirmHost from '../common/BridgeConfirmHost';
import PendingWritesHost from '../common/PendingWritesHost';
import QuickNoteHost from '@/engines/notes/components/QuickNoteHost';
import CopilotDock from '@/components/copilot/CopilotDock';
import { installNavigator } from '@/engines/_shared/anchoring';
import { initializeAppServices } from '@/services/appInitialization';
import { useAiStore } from '@/stores/aiStore';
import { useLocaleStore } from '@/stores/localeStore';
import { useAppStore } from '@/stores/appStore';
import { useTranslation } from '@/i18n/useTranslation';

export default function MainLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const loadAiSettings = useAiStore(state => state.loadSettings);
  const loadLocale = useLocaleStore(state => state.loadLocale);
  const loadMotion = useAppStore(state => state.loadMotion);

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
      loadMotion(),
    ]).catch(error => console.error('Application initialization failed', error));
  }, [loadAiSettings, loadLocale, loadMotion]);

  return (
    <div className="h-dvh w-full flex flex-col overflow-hidden relative">
      <WindowTitleBar />
      <div className="flex flex-1 min-h-0 overflow-hidden">
      <a
        href="#main-content"
        className="sr-only fixed left-3 top-3 z-[100] rounded-lg bg-accent-gold px-3 py-2 font-semibold text-deep focus:not-sr-only"
      >
        {t('a11y.skipToContent')}
      </a>
      <Sidebar />
      <main id="main-content" tabIndex={-1} className="flex-1 flex flex-col overflow-hidden min-w-0 outline-none">
        <Outlet />
      </main>
      {/* Right-hand copilot; renders only inside a project (desktop). */}
      <CopilotDock />
      <GlobalSearch />
      {/* The keyboard sheet. Mounted here rather than per page because the
          key that opens it is bound to the window, like the palette's. */}
      <ShortcutsPanel />
      <QuickNoteHost />
      <ToastHost />
      {/* Coordinates buffered fields and asks visibly if a write failed. */}
      <PendingWritesHost />
      {/* Renders the confirmation an AI bridge deletion has to get past. */}
      <BridgeConfirmHost />
      </div>
    </div>
  );
}
