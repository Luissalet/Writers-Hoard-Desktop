import { useState } from 'react';
import { Keyboard, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings } from 'lucide-react';
import { openQuickNote } from '@/engines/notes/quickCapture';
import { useAppStore } from '@/stores/appStore';
import { useTranslation } from '@/i18n/useTranslation';
import SettingsModal from '@/components/settings/SettingsModal';
import StorageStatus from '@/components/common/StorageStatus';
import { PendingWriteStatus } from '@/components/common/PendingWritesHost';
import { openShortcutsPanel } from '@/components/common/ShortcutsPanel';
import { COMMAND_CENTRE_SHORTCUT, SIDEBAR_SHORTCUT, shortcutCaps } from '@/components/common/shortcuts';

interface TopBarProps {
  title?: string;
  subtitle?: string;
}

export default function TopBar({ title, subtitle }: TopBarProps) {
  const { t } = useTranslation();
  const { setSearchOpen, sidebarHidden, toggleSidebarHidden } = useAppStore();
  const [showSettings, setShowSettings] = useState(false);
  // The ⌘/Ctrl label used to be worked out here. It now comes from the
  // shortcuts table, so this badge cannot say one key while the palette
  // answers to another.
  const capsText = (caps: ReturnType<typeof shortcutCaps>[number] = []) =>
    caps.map((cap) => (cap.localeKey ? t(cap.localeKey) : cap.text)).join(' ');
  const commandShortcut = capsText(shortcutCaps(COMMAND_CENTRE_SHORTCUT)[0]);
  const sidebarShortcut = capsText(shortcutCaps(SIDEBAR_SHORTCUT)[0]);
  const sidebarLabel = `${t(sidebarHidden ? 'topbar.showSidebar' : 'topbar.hideSidebar')} (${sidebarShortcut})`;

  return (
    <>
      <header className="min-h-16 bg-surface border-b border-border flex flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-6 flex-shrink-0">
        <div className="flex min-w-40 flex-1 items-center gap-3">
          {/* The sidebar's way back lives here, where it is still on screen
              once the sidebar is not. */}
          <button
            type="button"
            onClick={toggleSidebarHidden}
            className="p-2 -ml-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-elevated transition"
            title={sidebarLabel}
            aria-label={sidebarLabel}
            aria-pressed={sidebarHidden}
            data-testid="topbar-sidebar-toggle"
          >
            {sidebarHidden ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
          </button>
          {title && (
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-text-primary leading-tight">{title}</h1>
              {subtitle && <p className="text-xs text-text-muted">{subtitle}</p>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={openQuickNote} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-accent-gold px-3 text-sm font-semibold text-deep hover:brightness-110" aria-label={t('creative.capture')}>
            <Plus size={16} aria-hidden="true" />
            <span className="hidden sm:inline">{t('creative.capture')}</span>
          </button>
          <PendingWriteStatus />
          <StorageStatus />
          {/* The sheet has a key of its own, which is no use at all to the
              writer who does not know it exists. It sits beside settings
              because that is where this app keeps the things you go looking
              for rather than reach for. */}
          <button
            type="button"
            onClick={() => openShortcutsPanel()}
            className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-elevated transition"
            title={t('topbar.shortcuts')}
            aria-label={t('topbar.shortcuts')}
          >
            <Keyboard size={16} />
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-elevated transition"
            title={t('topbar.settings')}
            aria-label={t('topbar.settings')}
            aria-haspopup="dialog"
          >
            <Settings size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label={`${t('topbar.search')} (${commandShortcut})`}
            className="flex items-center gap-2 px-3 py-1.5 bg-elevated border border-border rounded-lg text-text-muted text-sm hover:border-accent-gold/50 transition"
          >
            <Search size={14} />
            <span className="hidden lg:inline">{t('topbar.search')}</span>
            <kbd className="hidden xl:inline ml-2 px-1.5 py-0.5 bg-deep border border-border rounded text-[10px] font-mono">
              {commandShortcut}
            </kbd>
          </button>
        </div>
      </header>

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </>
  );
}
