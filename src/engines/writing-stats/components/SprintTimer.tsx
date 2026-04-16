import { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, RotateCcw, Check } from 'lucide-react';
import type { WritingSession } from '../types';
import { generateId } from '@/utils/idGenerator';

interface SprintTimerProps {
  projectId: string;
  onComplete: (session: WritingSession) => Promise<void>;
  onCancel: () => void;
}

export default function SprintTimer({ projectId, onComplete, onCancel }: SprintTimerProps) {
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
      alert('Sprint must be at least 1 second to log');
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
  }, [projectId, duration, timeRemaining, startWordCount, endWordCount, sessionType, onComplete]);

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
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
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
                ? 'bg-accent-gold text-black'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50'
            }`}
          >
            {mins}m
          </button>
        ))}
      </div>

      {/* Session Type */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-gray-600">Session Type</label>
        <select
          value={sessionType}
          onChange={(e) => setSessionType(e.target.value as any)}
          disabled={isRunning}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-gold disabled:opacity-50"
        >
          <option value="freewrite">Freewrite</option>
          <option value="sprint">Sprint</option>
          <option value="edit">Edit</option>
          <option value="outline">Outline</option>
        </select>
      </div>

      {/* Word Count Inputs */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600 block">Start Words</label>
          <input
            type="number"
            value={startWordCount}
            onChange={(e) => setStartWordCount(e.target.value)}
            disabled={isRunning}
            placeholder="0"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-gold disabled:opacity-50"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600 block">End Words</label>
          <input
            type="number"
            value={endWordCount}
            onChange={(e) => setEndWordCount(e.target.value)}
            disabled={isRunning}
            placeholder="0"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-gold disabled:opacity-50"
          />
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-3 justify-center">
        {!isRunning ? (
          <button
            onClick={handleStart}
            className="flex items-center gap-2 px-6 py-2 bg-accent-gold text-black font-medium rounded-lg hover:bg-accent-gold/90 transition-colors"
          >
            <Play size={18} />
            Start
          </button>
        ) : (
          <button
            onClick={handlePause}
            className="flex items-center gap-2 px-6 py-2 bg-yellow-500 text-black font-medium rounded-lg hover:bg-yellow-600 transition-colors"
          >
            <Pause size={18} />
            Pause
          </button>
        )}

        <button
          onClick={handleReset}
          disabled={isRunning}
          className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300 transition-colors disabled:opacity-50"
        >
          <RotateCcw size={18} />
          Reset
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
          Stop & Log
        </button>
        <button
          onClick={onCancel}
          className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
