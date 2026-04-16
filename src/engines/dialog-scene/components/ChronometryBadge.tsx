import { useState, useMemo } from 'react';
import { Clock, ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { DialogBlock } from '../types';
import { estimateSceneDuration, type ChronometryMode } from '../chronometry';

interface ChronometryBadgeProps {
  blocks: DialogBlock[];
  /** Compact mode for list views */
  compact?: boolean;
}

const MODE_LABELS: Record<ChronometryMode, string> = {
  page: 'Page Count',
  character: 'Character Count',
  custom: 'Custom WPM',
};

export default function ChronometryBadge({ blocks, compact = false }: ChronometryBadgeProps) {
  const [mode, setMode] = useState<ChronometryMode>('page');
  const [customWpm, setCustomWpm] = useState(160);
  const [showDetail, setShowDetail] = useState(false);

  const result = useMemo(
    () => estimateSceneDuration(blocks, mode, customWpm),
    [blocks, mode, customWpm],
  );

  if (blocks.length === 0) return null;

  // Compact mode — just show time + word count
  if (compact) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-text-dim" title={`~${result.formatted} | ${result.wordCount} words | ${result.pageCount} pages`}>
        <Clock size={11} />
        <span>{result.formatted}</span>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowDetail(!showDetail)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-surface border border-border rounded-lg text-text-muted hover:text-text-primary hover:border-accent-gold/30 transition"
      >
        <Clock size={12} />
        <span className="font-medium">{result.formatted}</span>
        <span className="text-text-dim">|</span>
        <span>{result.wordCount}w</span>
        <span className="text-text-dim">|</span>
        <span>{result.pageCount}pg</span>
        <ChevronDown size={10} className={`transition ${showDetail ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {showDetail && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute top-full right-0 mt-1 z-20 bg-elevated border border-border rounded-lg p-3 shadow-xl min-w-[220px]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[10px] text-text-dim font-semibold uppercase tracking-wide mb-2">
              Estimation Method
            </p>

            {/* Mode selector */}
            <div className="flex gap-1 mb-3">
              {(['page', 'character', 'custom'] as ChronometryMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-2 py-1 text-[10px] rounded transition ${
                    mode === m
                      ? 'bg-accent-gold/20 text-accent-gold border border-accent-gold/40'
                      : 'border border-border text-text-muted hover:text-text-primary'
                  }`}
                >
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>

            {/* Custom WPM input */}
            {mode === 'custom' && (
              <div className="mb-3">
                <label className="text-[10px] text-text-dim">Words per minute:</label>
                <input
                  type="number"
                  value={customWpm}
                  onChange={(e) => setCustomWpm(Number(e.target.value) || 160)}
                  min={60}
                  max={300}
                  className="w-full mt-1 px-2 py-1 text-xs bg-surface border border-border rounded text-text-primary focus:outline-none focus:border-accent-gold/50"
                />
              </div>
            )}

            {/* Breakdown */}
            <div className="space-y-1.5 border-t border-border/50 pt-2">
              <div className="flex justify-between text-xs">
                <span className="text-text-dim">Dialog</span>
                <span className="text-text-muted">{Math.round(result.breakdown.dialogSeconds / 60 * 10) / 10}m</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-dim">Action</span>
                <span className="text-text-muted">{Math.round(result.breakdown.actionSeconds / 60 * 10) / 10}m</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-dim">Other</span>
                <span className="text-text-muted">{Math.round(result.breakdown.otherSeconds / 60 * 10) / 10}m</span>
              </div>
              <div className="flex justify-between text-xs font-medium border-t border-border/50 pt-1.5">
                <span className="text-text-primary">Total</span>
                <span className="text-accent-gold">{result.formatted}</span>
              </div>
            </div>

            <p className="text-[9px] text-text-dim/60 mt-2 italic">
              {mode === 'page' && 'Industry standard: ~1 minute per screenplay page (250 words)'}
              {mode === 'character' && 'Dialog at 150 WPM spoken, action at 200 WPM read'}
              {mode === 'custom' && `Custom: ${customWpm} words per minute`}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
