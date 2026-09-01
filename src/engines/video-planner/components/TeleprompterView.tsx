import { useCallback, useState, useEffect, useRef } from 'react';
import { Play, Pause, X } from 'lucide-react';
import type { VideoSegment } from '../types';
import { useTranslation } from '@/i18n/useTranslation';

interface TeleprompterViewProps {
  segments: VideoSegment[];
  onExit: () => void;
}

const BASE_PIXELS_PER_SECOND = 50;

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

export default function TeleprompterView({ segments, onExit }: TeleprompterViewProps) {
  const { t } = useTranslation();
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number>(0);
  // Scroll is integrated frame by frame rather than recomputed from the total
  // elapsed time: an absolute `elapsed × speed` meant nudging the speed slider
  // mid-read retroactively rescaled the whole take and the page leapt.
  const scrollRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  // The clock and the segment counter used to be state, so every one of the
  // 60 frames a second reconciled the whole script — every segment, for as
  // long as the teleprompter was open. They own one small node each now, and
  // the scroll stays what it always was: imperative.
  const elapsedRef = useRef<number>(0);
  const timeNodeRef = useRef<HTMLDivElement>(null);
  const segmentNodeRef = useRef<HTMLDivElement>(null);
  // Segments are variable-height blocks of `text-5xl` script; their real tops
  // are measured once after layout instead of assumed to be 300px apart.
  const segmentRefs = useRef<Array<HTMLDivElement | null>>([]);
  const segmentTopsRef = useRef<number[]>([]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onExit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onExit]);

  // Reading the template once keeps `paint` stable across renders, so the
  // animation loop is never torn down and restarted by a re-render.
  const segmentTemplate = t('videoPlanner.teleprompter.segment');

  const paint = useCallback(
    (elapsed: number, scrollTop: number) => {
      if (timeNodeRef.current) {
        timeNodeRef.current.textContent = formatTime(elapsed);
      }
      if (segmentNodeRef.current) {
        // The segment being read is the last one whose top has passed the
        // middle of the viewport.
        const middle = scrollTop + (scrollContainerRef.current?.clientHeight ?? 0) / 2;
        const tops = segmentTopsRef.current;
        let index = 0;
        for (let i = 0; i < tops.length; i++) {
          if (tops[i] > middle) break;
          index = i;
        }
        const current = Math.min(index + 1, Math.max(segments.length, 1));
        segmentNodeRef.current.textContent = segmentTemplate
          .replace('{current}', String(current))
          .replace('{total}', String(segments.length));
      }
    },
    [segments.length, segmentTemplate],
  );

  // Measure the real segment tops after layout, and again whenever the window
  // resizes — the blocks reflow and every offset moves.
  useEffect(() => {
    const measure = () => {
      segmentTopsRef.current = segments.map((_, index) => segmentRefs.current[index]?.offsetTop ?? 0);
      paint(elapsedRef.current, scrollContainerRef.current?.scrollTop ?? 0);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [segments, paint]);

  useEffect(() => {
    if (!isPlaying) return;

    // Pick up wherever the reader left the page — including a manual scroll —
    // and treat the first frame as zero elapsed, so a speed change only ever
    // affects the frames that come after it.
    lastFrameRef.current = 0;
    scrollRef.current = scrollContainerRef.current?.scrollTop ?? 0;

    const animate = (now: number) => {
      const container = scrollContainerRef.current;
      if (container) {
        const delta = lastFrameRef.current === 0 ? 0 : (now - lastFrameRef.current) / 1000;
        lastFrameRef.current = now;
        elapsedRef.current += delta;

        const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
        scrollRef.current = Math.min(
          scrollRef.current + delta * BASE_PIXELS_PER_SECOND * speed,
          maxScroll,
        );

        container.scrollTop = scrollRef.current;
        paint(elapsedRef.current, scrollRef.current);

        // The end of the script is the end of the take: wrapping back to the
        // top mid-sentence with the clock still running was never wanted.
        if (scrollRef.current >= maxScroll) {
          setIsPlaying(false);
          return;
        }
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, speed, paint]);

  const togglePlayPause = () => {
    setIsPlaying((playing) => !playing);
  };

  const handleContainerClick = () => {
    togglePlayPause();
  };

  return (
    <div className="fixed inset-0 bg-black flex flex-col z-50">
      {/* Exit button */}
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={onExit}
          className="p-2 hover:bg-white/10 rounded transition-colors"
          title={t('common.close')}
          aria-label={t('common.close')}
        >
          <X className="w-6 h-6 text-white" aria-hidden="true" />
        </button>
      </div>

      {/* Main content area */}
      <div
        ref={scrollContainerRef}
        onClick={handleContainerClick}
        className="flex-1 overflow-y-auto cursor-pointer"
      >
        <div className="min-h-full flex flex-col justify-center items-center p-8">
          <div className="max-w-4xl w-full">
            {segments.map((segment, index) => (
              <div
                key={segment.id}
                ref={(node) => { segmentRefs.current[index] = node; }}
                className="mb-12"
              >
                {/* Segment title separator */}
                <div className="text-center mb-8">
                  <h2 className="text-xl text-white/40 font-serif">
                    {segment.title}
                  </h2>
                  {segment.speakerName && (
                    <p className="text-sm text-white/30 mt-1">{segment.speakerName}</p>
                  )}
                </div>

                {/* Script text */}
                <div className="text-center">
                  <p className="text-5xl font-serif text-white leading-relaxed whitespace-pre-wrap">
                    {segment.script}
                  </p>
                </div>

                {/* Spacing between segments */}
                {index < segments.length - 1 && (
                  <div className="my-16 flex justify-center">
                    <div className="w-32 h-1 bg-white/10 rounded"></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Control bar */}
      <div className="bg-black/80 border-t border-white/10 p-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          {/* Play/Pause */}
          <button
            onClick={togglePlayPause}
            className="p-2 hover:bg-white/10 rounded transition-colors"
            title={isPlaying ? t('videoPlanner.teleprompter.pause') : t('videoPlanner.teleprompter.play')}
            aria-label={isPlaying ? t('videoPlanner.teleprompter.pause') : t('videoPlanner.teleprompter.play')}
          >
            {isPlaying ? (
              <Pause className="w-6 h-6 text-white" aria-hidden="true" />
            ) : (
              <Play className="w-6 h-6 text-white" aria-hidden="true" />
            )}
          </button>

          {/* Time display — written imperatively by the animation loop */}
          <div ref={timeNodeRef} className="text-white font-mono text-sm" />

          {/* Speed control */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-white/70">{t('videoPlanner.teleprompter.speed')}</label>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              className="w-24 cursor-pointer"
            />
            <span className="text-xs text-white/70 w-10">{speed.toFixed(1)}x</span>
          </div>

          {/* Current segment indicator — written imperatively too */}
          <div ref={segmentNodeRef} className="ml-auto text-xs text-white/50" />
        </div>
      </div>

      {/* Instructions overlay (shown briefly) */}
      <div className="fixed bottom-24 left-1/2 -translate-x-1/2 text-white/40 text-sm pointer-events-none">
        {t('videoPlanner.teleprompter.hint')}
      </div>
    </div>
  );
}
