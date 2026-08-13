import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useGoogleStore } from '@/stores/googleStore';
import { syncGoogleDoc } from '@/services/googleDocs';
import { useTranslation } from '@/i18n/useTranslation';
import { toast } from '@/components/common/toast';
import type { Writing } from '@/types';

interface SyncButtonProps {
  writing: Writing;
  onSynced: (changes: Partial<Writing>) => void;
  size?: 'sm' | 'md';
}

export default function SyncButton({ writing, onSynced, size = 'sm' }: SyncButtonProps) {
  const { t } = useTranslation();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { accessToken } = useGoogleStore();

  const handleSync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!accessToken || syncing) return;

    setSyncing(true);
    setError(null);

    try {
      const changes = await syncGoogleDoc(accessToken, writing);
      onSynced(changes);
      toast.success(t('writings.gdoc.synced'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('writings.gdoc.syncError');
      setError(message);
      toast.error(message);
    } finally {
      setSyncing(false);
    }
  };

  const sizeClasses = size === 'sm'
    ? 'p-1.5 text-xs'
    : 'px-3 py-1.5 text-sm gap-1.5';

  return (
    <div className="relative">
      <button
        onClick={handleSync}
        disabled={syncing || !accessToken}
        className={`inline-flex items-center ${sizeClasses} rounded-lg transition
          ${syncing
            ? 'bg-blue-500/10 text-blue-400 cursor-wait'
            : 'hover:bg-elevated text-text-muted hover:text-blue-400'
          }
          ${!accessToken ? 'opacity-50 cursor-not-allowed' : ''}
        `}
        title={!accessToken ? t('writings.gdoc.connectFirst') : t('writings.gdoc.syncTooltip')}
      >
        <RefreshCw size={size === 'sm' ? 14 : 16} className={syncing ? 'animate-spin' : ''} />
        {size === 'md' && <span>{syncing ? t('writings.gdoc.syncing') : t('writings.gdoc.sync')}</span>}
      </button>
      {error && (
        <div className="absolute top-full right-0 mt-1 px-2 py-1 bg-red-500/20 text-red-400 text-[10px] rounded whitespace-nowrap z-10">
          {error}
        </div>
      )}
    </div>
  );
}
