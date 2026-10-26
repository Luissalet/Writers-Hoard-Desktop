import { useEffect, useState, useSyncExternalStore } from 'react';
import {createWorkspaceFocusController,WorkspaceFocusContext} from '@/components/project/workspace/workspaceFocus';
import {useTourStore} from '@/components/tutorial/tourStore';
import { Outlet, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import WindowTitleBar from './WindowTitleBar';
import GlobalSearch from '../common/GlobalSearch';
import ShortcutsPanel from '../common/ShortcutsPanel';
import { ToastHost } from '../common/toast';
import BridgeConfirmHost from '../common/BridgeConfirmHost';
import PendingWritesHost from '../common/PendingWritesHost';
import TourHost from '../tutorial/TourHost';
import QuickNoteHost from '@/engines/notes/components/QuickNoteHost';
import CopilotDock from '@/components/copilot/CopilotDock';
import { installNavigator } from '@/engines/_shared/anchoring';
import { initializeAppServices } from '@/services/appInitialization';
import { useAiStore } from '@/stores/aiStore';
import { useLocaleStore } from '@/stores/localeStore';
import { useAppStore } from '@/stores/appStore';
import { useTranslation } from '@/i18n/useTranslation';
import { SIDEBAR_SHORTCUT, matchesShortcut } from '../common/shortcuts';

export default function MainLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const loadAiSettings = useAiStore(state => state.loadSettings);
  const loadLocale = useLocaleStore(state => state.loadLocale);
  const loadMotion = useAppStore(state => state.loadMotion);
  const loadSidebar = useAppStore(state => state.loadSidebar);
  const [focus] = useState(createWorkspaceFocusController);
  const focusState = useSyncExternalStore(focus.subscribe, focus.getState, focus.getState);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.isComposing || event.defaultPrevented || !focus.getState().active) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"], [data-local-tool-context-menu]') || useTourStore.getState().active) return;
      if (!focus.ownsEvent(event)) return;
      event.preventDefault(); focus.clear();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [focus]);

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
      loadSidebar(),
    ]).catch(error => console.error('Application initialization failed', error));
  }, [loadAiSettings, loadLocale, loadMotion, loadSidebar]);

  // The sidebar's hide key, bound to the window like the palette's: it has to
  // work from inside the chapter editor, which is exactly where a writer
  // wants the sidebar gone.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.repeat || !matchesShortcut(event, SIDEBAR_SHORTCUT)) return;
      event.preventDefault();
      useAppStore.getState().toggleSidebarHidden();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <WorkspaceFocusContext.Provider value={focus}><div className="h-dvh w-full flex flex-col overflow-hidden relative" data-workspace-focus={focusState.active || undefined}>
      <WindowTitleBar />
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Moves focus by hand: under the desktop HashRouter, following the
          fragment would rewrite the route to `/main-content`, which matches
          nothing and navigates the writer away from the page they are on. */}
      <a
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
        className="sr-only fixed left-3 top-3 z-[100] rounded-lg bg-accent-gold px-3 py-2 font-semibold text-deep focus:not-sr-only"
      >
        {t('a11y.skipToContent')}
      </a>
      <Sidebar />
      <main id="main-content" tabIndex={-1} className="flex-1 flex flex-col overflow-hidden min-w-0 outline-none">
        {focusState.active && <div className="flex shrink-0 justify-end border-b border-border bg-surface px-4 py-2"><button type="button" data-workspace-focus-exit className="min-h-10 rounded-lg border border-border px-3 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold" onClick={() => focus.clear(true)}>{t('localTool.focus.exit')}</button></div>}
        <Outlet />
      </main>
      {/* Right-hand copilot; renders only inside a project (desktop). */}
      <CopilotDock />
      <GlobalSearch />
      {/* The keyboard sheet. Mounted here rather than per page because the
          key that opens it is bound to the window, like the palette's. */}
      <ShortcutsPanel />
      {/* Guided tours: spotlight, list and the one-time offer. */}
      <TourHost />
      <QuickNoteHost />
      <ToastHost />
      {/* Coordinates buffered fields and asks visibly if a write failed. */}
      <PendingWritesHost />
      {/* Renders the confirmation an AI bridge deletion has to get past. */}
      <BridgeConfirmHost />
      </div>
    </div></WorkspaceFocusContext.Provider>
  );
}
