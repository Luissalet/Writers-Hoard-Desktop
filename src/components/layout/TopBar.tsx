import { useState } from 'react';
import { Search, Settings } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useTranslation } from '@/i18n/useTranslation';
import SettingsModal from '@/components/settings/SettingsModal';
import StorageStatus from '@/components/common/StorageStatus';

interface TopBarProps {
  title?: string;
  subtitle?: string;
}

export default function TopBar({ title, subtitle }: TopBarProps) {
  const { t } = useTranslation();
  const { setSearchOpen } = useAppStore();
  const [showSettings, setShowSettings] = useState(false);
  const commandShortcut = /Mac|iPhone|iPad/i.test(navigator.platform) ? '⌘ K' : 'Ctrl K';

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
          <StorageStatus />
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
