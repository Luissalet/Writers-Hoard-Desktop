import { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, RotateCcw, Check } from 'lucide-react';
import type { WritingSession } from '../types';
import { generateId } from '@/utils/idGenerator';
import { toast } from '@/components/common/toast';
import { useTranslation } from '@/i18n/useTranslation';

interface SprintTimerProps {
  projectId: string;
  onComplete: (session: WritingSession) => Promise<void>;
  onCancel: () => void;
}

export default function SprintTimer({ projectId, onComplete, onCancel }: SprintTimerProps) {
  const { t } = useTranslation();
  const [duration, setDuration] = useState(25 * 60); // 25 minutes default
  const [timeRemaining, setTimeRemaining] = useState(25 * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [sessionType, setSessionType] = useState<'freewrite' | 'sprint' | 'edit' | 'outline'>(
    'sprint'
  );
  const [startWordCount, setStartWordCount] = useState('');
  const [endWordCount, setEndWordCount] = useState('');
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Timer tick
  useEffect(() => {
    if (!isRunning) return;

    intervalRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          setIsRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunning]);

  const handleStart = useCallback(() => {
    setIsRunning(true);
  }, []);

  const handlePause = useCallback(() => {
    setIsRunning(false);
  }, []);

  const handleReset = useCallback(() => {
    setIsRunning(false);
    setTimeRemaining(duration);
    setStartWordCount('');
    setEndWordCount('');
  }, [duration]);

  const handleStop = useCallback(async () => {
    setIsRunning(false);

    const start = parseInt(startWordCount, 10) || 0;
    const end = parseInt(endWordCount, 10) || start;
    const wordCount = Math.max(0, end - start);
    const elapsedSeconds = duration - timeRemaining;

    if (elapsedSeconds < 1) {
      toast.error(t('stats.sprintTooShort'));
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const session: WritingSession = {
      id: generateId('session'),
      projectId,
      date: today,
      wordCount,
      duration: elapsedSeconds,
      type: sessionType,
      createdAt: Date.now(),
    };

    await onComplete(session);
  }, [projectId, duration, timeRemaining, startWordCount, endWordCount, sessionType, onComplete, t]);

  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;
  const progressPercent = ((duration - timeRemaining) / duration) * 100;

  return (
    <div className="bg-gradient-to-br from-accent-gold/10 to-accent-gold/5 border border-accent-gold/20 rounded-lg p-6 space-y-4">
      {/* Timer Display */}
      <div className="text-center space-y-2">
        <div className="text-5xl font-bold text-accent-gold tabular-nums">
          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </div>
        <div className="h-2 bg-elevated rounded-full overflow-hidden">
          <div
            className="h-full bg-accent-gold transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Duration Presets */}
      <div className="flex gap-2 justify-center flex-wrap">
        {[15, 25, 30].map((mins) => (
          <button
            key={mins}
            onClick={() => {
              const newDuration = mins * 60;
              setDuration(newDuration);
              setTimeRemaining(newDuration);
              setIsRunning(false);
            }}
            disabled={isRunning}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              duration === mins * 60
                ? 'bg-accent-gold text-deep'
                : 'bg-elevated text-text-muted hover:bg-border disabled:opacity-50'
            }`}
          >
            {mins}m
          </button>
        ))}
      </div>

      {/* Session Type */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-text-muted">{t('stats.sessionType')}</label>
        <select
          value={sessionType}
          onChange={(e) => setSessionType(e.target.value as 'freewrite' | 'sprint' | 'edit' | 'outline')}
          disabled={isRunning}
          className="w-full px-3 py-2 bg-elevated text-text-primary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-gold disabled:opacity-50"
        >
          <option value="freewrite">{t('stats.type.freewrite')}</option>
          <option value="sprint">{t('stats.type.sprint')}</option>
          <option value="edit">{t('stats.type.edit')}</option>
          <option value="outline">{t('stats.type.outline')}</option>
        </select>
      </div>

      {/* Word Count Inputs */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-text-muted block">{t('stats.startWords')}</label>
          <input
            type="number"
            value={startWordCount}
            onChange={(e) => setStartWordCount(e.target.value)}
            disabled={isRunning}
            placeholder="0"
            className="w-full px-3 py-2 bg-elevated text-text-primary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-gold disabled:opacity-50"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-text-muted block">{t('stats.endWords')}</label>
          <input
            type="number"
            value={endWordCount}
            onChange={(e) => setEndWordCount(e.target.value)}
            disabled={isRunning}
            placeholder="0"
            className="w-full px-3 py-2 bg-elevated text-text-primary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-gold disabled:opacity-50"
          />
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-3 justify-center">
        {!isRunning ? (
          <button
            onClick={handleStart}
            className="flex items-center gap-2 px-6 py-2 bg-accent-gold text-deep font-medium rounded-lg hover:bg-accent-gold/90 transition-colors"
          >
            <Play size={18} />
            {t('stats.start')}
          </button>
        ) : (
          <button
            onClick={handlePause}
            className="flex items-center gap-2 px-6 py-2 bg-yellow-500 text-deep font-medium rounded-lg hover:bg-yellow-600 transition-colors"
          >
            <Pause size={18} />
            {t('stats.pause')}
          </button>
        )}

        <button
          onClick={handleReset}
          disabled={isRunning}
          className="flex items-center gap-2 px-4 py-2 bg-elevated text-text-muted font-medium rounded-lg hover:bg-border transition-colors disabled:opacity-50"
        >
          <RotateCcw size={18} />
          {t('stats.reset')}
        </button>
      </div>

      {/* Stop & Log Button */}
      <div className="pt-2 border-t border-accent-gold/20 flex gap-3">
        <button
          onClick={handleStop}
          disabled={isRunning}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-500 text-white font-medium rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50"
        >
          <Check size={18} />
          {t('stats.stopAndLog')}
        </button>
        <button
          onClick={onCancel}
          className="flex-1 px-4 py-2 bg-elevated text-text-muted font-medium rounded-lg hover:bg-border transition-colors"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
