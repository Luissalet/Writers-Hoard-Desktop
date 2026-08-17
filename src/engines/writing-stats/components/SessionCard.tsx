import { Clock, FileText } from 'lucide-react';
import type { WritingSession } from '../types';
import { toLocalDateKey } from '../date';
import { useTranslation } from '@/i18n/useTranslation';

interface SessionCardProps {
  session: WritingSession;
}

const TYPE_COLORS: Record<WritingSession['type'], string> = {
  freewrite: 'bg-accent-gold/15 text-accent-gold',
  sprint: 'bg-accent-plum/20 text-accent-plum-light',
  edit: 'bg-success/15 text-success',
  outline: 'bg-warning/15 text-warning',
};

// `labelKey`, no `label`: es la regla del proyecto para todo objeto de
// configuración, y estas cuatro claves ya existían y las usa `SprintTimer`.
const TYPE_LABEL_KEYS: Record<WritingSession['type'], string> = {
  freewrite: 'stats.type.freewrite',
  sprint: 'stats.type.sprint',
  edit: 'stats.type.edit',
  outline: 'stats.type.outline',
};

export default function SessionCard({ session }: SessionCardProps) {
  const { t } = useTranslation();
  const date = new Date(session.date + 'T00:00:00');
  const today = toLocalDateKey();
  const isToday = session.date === today;

  const dateLabel = isToday
    ? t('common.today')
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const hours = Math.floor(session.duration / 3600);
  const minutes = Math.floor((session.duration % 3600) / 60);
  const durationLabel =
    hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  return (
    <div className="flex items-center justify-between p-3 bg-elevated border border-border rounded-lg hover:bg-elevated transition-colors">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <FileText size={20} className="text-text-dim flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-xs font-semibold px-2 py-1 rounded ${TYPE_COLORS[session.type]}`}>
              {t(TYPE_LABEL_KEYS[session.type])}
            </span>
            <span className="text-xs text-text-muted">{dateLabel}</span>
          </div>
          {session.notes && (
            <p className="text-xs text-text-muted truncate">{session.notes}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 ml-2 flex-shrink-0 text-right">
        <div>
          <div className="text-sm font-bold text-text-primary">
            {session.wordCount.toLocaleString()}
          </div>
          <div className="text-xs text-text-dim flex items-center gap-1 justify-end">
            <Clock size={12} />
            {durationLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
