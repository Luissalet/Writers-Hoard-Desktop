import { Cloud, ExternalLink } from 'lucide-react';
import { t } from '@/i18n/useTranslation';

interface GoogleDocBadgeProps {
  lastSyncedAt?: number;
  googleDocUrl?: string;
  compact?: boolean;
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return t('common.timeAgo.now');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('common.timeAgo.minutes').replace('{n}', String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('common.timeAgo.hours').replace('{n}', String(hours));
  const days = Math.floor(hours / 24);
  return t('common.timeAgo.days').replace('{n}', String(days));
}

export default function GoogleDocBadge({ lastSyncedAt, googleDocUrl, compact }: GoogleDocBadgeProps) {
  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded">
        <Cloud size={10} />
        {t('writings.gdoc.badge')}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded">
        <Cloud size={10} />
        {t('writings.gdoc.badge')}
      </span>
      {lastSyncedAt && (
        <span className="text-[10px] text-text-dim">
          {t('writings.gdoc.lastSync').replace('{when}', timeAgo(lastSyncedAt))}
        </span>
      )}
      {googleDocUrl && (
        <a
          href={googleDocUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-0.5 text-[10px] text-blue-400 hover:text-blue-300 transition"
        >
          <ExternalLink size={10} />
          {t('writings.gdoc.openInDocs')}
        </a>
      )}
    </div>
  );
}
