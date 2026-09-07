import { useState } from 'react';
import { Keyboard, Search, Settings } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useTranslation } from '@/i18n/useTranslation';
import SettingsModal from '@/components/settings/SettingsModal';
import StorageStatus from '@/components/common/StorageStatus';
import { PendingWriteStatus } from '@/components/common/PendingWritesHost';
import { openShortcutsPanel } from '@/components/common/ShortcutsPanel';
import { COMMAND_CENTRE_SHORTCUT, shortcutCaps } from '@/components/common/shortcuts';

interface TopBarProps {
  title?: string;
  subtitle?: string;
}

export default function TopBar({ title, subtitle }: TopBarProps) {
  const { t } = useTranslation();
  const { setSearchOpen } = useAppStore();
  const [showSettings, setShowSettings] = useState(false);
  // The ⌘/Ctrl label used to be worked out here. It now comes from the
  // shortcuts table, so this badge cannot say one key while the palette
  // answers to another.
  const [commandCaps = []] = shortcutCaps(COMMAND_CENTRE_SHORTCUT);
  const commandShortcut = commandCaps
    .map((cap) => (cap.localeKey ? t(cap.localeKey) : cap.text))
    .join(' ');

  return (
    <>
      <header className="h-14 bg-surface/80 backdrop-blur-sm border-b border-border flex items-center justify-between px-6 flex-shrink-0">
        <div className="flex items-center gap-3">
          {title && (
            <div>
              <h1 className="text-sm font-serif font-bold text-accent-gold leading-tight">{title}</h1>
              {subtitle && <p className="text-xs text-text-muted">{subtitle}</p>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
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
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-elevated transition"
            title={t('topbar.settings')}
          >
            <Settings size={16} />
          </button>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label={`${t('topbar.search')} (${commandShortcut})`}
            className="flex items-center gap-2 px-3 py-1.5 bg-elevated border border-border rounded-lg text-text-muted text-sm hover:border-accent-gold/50 transition"
          >
            <Search size={14} />
            <span>{t('topbar.search')}</span>
            <kbd className="ml-2 px-1.5 py-0.5 bg-deep border border-border rounded text-[10px] font-mono">
              {commandShortcut}
            </kbd>
          </button>
        </div>
      </header>

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </>
  );
}
