import { Menu } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import DesktopUpdates from './DesktopUpdates';

/** Native caption buttons remain owned by Electron (including Windows Snap). */
export default function WindowTitleBar() {
  const { t } = useTranslation();
  if (!window.electronAPI) return null;
  if (window.electronAPI.platform === 'darwin') return <DesktopUpdates />;

  return (
    <div className="desktop-titlebar" aria-label="Writers Hoard">
      <button
        type="button"
        className="desktop-titlebar-menu rounded text-text-muted hover:bg-elevated hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold"
        aria-label={t('window.menu')}
        title={t('window.menu')}
        aria-haspopup="menu"
        onClick={() => window.electronAPI?.openWindowMenu()}
      >
        <Menu size={16} aria-hidden="true" />
      </button>
      <DesktopUpdates />
    </div>
  );
}
