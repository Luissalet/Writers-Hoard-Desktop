import { useRef, useState } from 'react';
import { X, Loader2, CheckCircle2, AlertCircle, Clapperboard } from 'lucide-react';
import { saveAs } from 'file-saver';
import { useTranslation } from '@/i18n/useTranslation';
import type { VideoPlan, VideoSegment } from '../types';
import { recordTeleprompter, type RecorderSegment } from '../teleprompterRecorder';

interface Props {
  plan: VideoPlan;
  segments: VideoSegment[];
  onClose: () => void;
}

type Phase = 'options' | 'recording' | 'encoding' | 'done' | 'error' | 'canceled';

const RESOLUTIONS = {
  '1080p': { w: 1920, h: 1080 },
  '720p': { w: 1280, h: 720 },
} as const;

type ResKey = keyof typeof RESOLUTIONS;

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function sanitize(name: string): string {
  return name.replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'teleprompter';
}

export default function TeleprompterExportModal({ plan, segments, onClose }: Props) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('options');
  const [resolution, setResolution] = useState<ResKey>('1080p');
  const [speed, setSpeed] = useState(1);
  const [progress, setProgress] = useState({ elapsed: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const ctrlRef = useRef<AbortController | null>(null);

  const recSegments: RecorderSegment[] = segments
    .filter((s) => (s.script && s.script.trim()) || (s.title && s.title.trim()))
    .map((s) => ({ title: s.title, speakerName: s.speakerName, script: s.script }));
  const hasScript = segments.some((s) => s.script && s.script.trim());

  const busy = phase === 'recording' || phase === 'encoding';

  const start = async () => {
    setError(null);
    setFallback(false);
    setPhase('recording');
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    const { w, h } = RESOLUTIONS[resolution];
    try {
      const { blob } = await recordTeleprompter({
        segments: recSegments,
        width: w,
        height: h,
        speed,
        onProgress: (elapsed, total) => setProgress({ elapsed, total }),
        signal: ctrl.signal,
      });
      const base = sanitize(plan.title);
      const api = window.electronAPI;
      if (api?.media) {
        setPhase('encoding');
        const buf = await blob.arrayBuffer();
        const res = await api.media.saveTeleprompterMp4(buf, `${base}-teleprompter.mp4`);
        if (res.canceled) {
          setPhase('canceled');
          return;
        }
        if (!res.ok) {
          setError(res.error ?? null);
          setPhase('error');
          return;
        }
        setPhase('done');
      } else {
        // Web build: no ffmpeg — hand back the WebM directly.
        saveAs(blob, `${base}-teleprompter.webm`);
        setFallback(true);
        setPhase('done');
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setPhase('canceled');
      } else {
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    }
  };

  const cancelRecording = () => ctrlRef.current?.abort();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="flex items-center gap-2 font-serif text-lg text-neutral-50">
            <Clapperboard className="w-5 h-5 text-accent-gold" />
            {t('videoPlanner.record.title')}
          </h3>
          {!busy && (
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="p-1.5 rounded text-neutral-400 hover:bg-deep transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-5">
          {phase === 'options' &&
            (!hasScript ? (
              <p className="text-sm text-amber-400">{t('videoPlanner.record.noScript')}</p>
            ) : (
              <>
                <p className="text-sm text-neutral-300">{t('videoPlanner.record.intro')}</p>

                <div className="space-y-1.5">
                  <label className="text-xs text-neutral-400">{t('videoPlanner.record.resolution')}</label>
                  <div className="flex gap-2">
                    {(Object.keys(RESOLUTIONS) as ResKey[]).map((r) => (
                      <button
                        key={r}
                        onClick={() => setResolution(r)}
                        className={`px-3 py-1.5 rounded border text-sm transition-colors ${
                          resolution === r
                            ? 'border-accent-gold bg-accent-gold/10 text-accent-gold'
                            : 'border-border text-neutral-300 hover:border-accent-gold/50'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-neutral-400">
                    {t('videoPlanner.record.speed')}: {speed.toFixed(1)}x
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="3"
                    step="0.1"
                    value={speed}
                    onChange={(e) => setSpeed(parseFloat(e.target.value))}
                    className="w-full cursor-pointer"
                  />
                </div>

                <p className="text-xs text-neutral-500">{t('videoPlanner.record.hint')}</p>
              </>
            ))}

          {busy && (
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-2 text-neutral-200">
                <Loader2 className="w-4 h-4 animate-spin text-accent-gold" />
                <span className="text-sm">
                  {phase === 'recording'
                    ? t('videoPlanner.record.recording')
                        .replace('{elapsed}', fmt(progress.elapsed))
                        .replace('{total}', fmt(progress.total))
                    : t('videoPlanner.record.encoding')}
                </span>
              </div>
              {phase === 'recording' && progress.total > 0 && (
                <div className="h-1.5 w-full rounded-full bg-deep overflow-hidden">
                  <div
                    className="h-full bg-accent-gold transition-all"
                    style={{ width: `${Math.min(100, (progress.elapsed / progress.total) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {phase === 'done' && (
            <div className="flex items-start gap-2 text-sm text-neutral-200">
              <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
              <div>
                <p>{t('videoPlanner.record.done')}</p>
                {fallback && (
                  <p className="text-xs text-neutral-400 mt-1">{t('videoPlanner.record.webmFallback')}</p>
                )}
              </div>
            </div>
          )}

          {phase === 'canceled' && (
            <p className="text-sm text-neutral-400">{t('videoPlanner.record.canceled')}</p>
          )}

          {phase === 'error' && (
            <div className="flex items-start gap-2 text-sm text-red-400">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <div>
                <p>{t('videoPlanner.record.failed')}</p>
                {error && <p className="text-xs text-red-400/80 mt-1 break-words">{error}</p>}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          {phase === 'options' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded border border-border text-neutral-300 hover:bg-deep transition-colors text-sm"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={start}
                disabled={!hasScript}
                className="px-4 py-2 rounded bg-accent-gold text-deep font-medium hover:bg-accent-gold/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
              >
                {t('videoPlanner.record.start')}
              </button>
            </>
          )}
          {phase === 'recording' && (
            <button
              onClick={cancelRecording}
              className="px-4 py-2 rounded border border-border text-neutral-300 hover:bg-deep transition-colors text-sm"
            >
              {t('common.cancel')}
            </button>
          )}
          {phase === 'encoding' && (
            <button
              disabled
              className="px-4 py-2 rounded border border-border text-neutral-500 text-sm cursor-not-allowed"
            >
              {t('common.cancel')}
            </button>
          )}
          {(phase === 'done' || phase === 'canceled' || phase === 'error') && (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded bg-accent-gold text-deep font-medium hover:bg-accent-gold/90 transition-colors text-sm"
            >
              {t('common.close')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
