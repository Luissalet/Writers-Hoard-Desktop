import { Clock, FileText } from 'lucide-react';
import type { WritingSession } from '../types';

interface SessionCardProps {
  session: WritingSession;
}

const TYPE_COLORS: Record<WritingSession['type'], string> = {
  freewrite: 'bg-blue-100 text-blue-800',
  sprint: 'bg-purple-100 text-purple-800',
  edit: 'bg-green-100 text-green-800',
  outline: 'bg-yellow-100 text-yellow-800',
};

const TYPE_LABELS: Record<WritingSession['type'], string> = {
  freewrite: 'Freewrite',
  sprint: 'Sprint',
  edit: 'Edit',
  outline: 'Outline',
};

export default function SessionCard({ session }: SessionCardProps) {
  const date = new Date(session.date + 'T00:00:00');
  const today = new Date().toISOString().split('T')[0];
  const isToday = session.date === today;

  const dateLabel = isToday
    ? 'Today'
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const hours = Math.floor(session.duration / 3600);
  const minutes = Math.floor((session.duration % 3600) / 60);
  const durationLabel =
    hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  return (
    <div className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <FileText size={20} className="text-gray-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-xs font-semibold px-2 py-1 rounded ${TYPE_COLORS[session.type]}`}>
              {TYPE_LABELS[session.type]}
            </span>
            <span className="text-xs text-gray-600">{dateLabel}</span>
          </div>
          {session.notes && (
            <p className="text-xs text-gray-600 truncate">{session.notes}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 ml-2 flex-shrink-0 text-right">
        <div>
          <div className="text-sm font-bold text-gray-900">
            {session.wordCount.toLocaleString()}
          </div>
          <div className="text-xs text-gray-500 flex items-center gap-1 justify-end">
            <Clock size={12} />
            {durationLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
