// ============================================================================
// AI settings — "a text model is holding the card" (shared warning)
// ============================================================================
//
// One card, two residents. With ~9 GB of Ollama resident on a 12 GB board the
// image server gets no memory and quietly falls back to the CPU: the same
// picture takes minutes instead of seconds (docs/AI-BRIDGE.md §19). Nothing is
// broken — they simply do not fit — so this is a warning with a way out, never
// a gate: generation stays available at all times.
//
// Used by the Image Studio before a generation and by the copilot on an image
// tool call, so the reader meets the same sentence and the same two buttons in
// both places.

import { useState } from 'react';
import { AlertTriangle, ImagePlus, Loader2, Zap } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { unloadChatModel } from '@/services/aiRuntime/client';
import { formatBinaryBytes } from '@/services/aiRuntime/fit';
import type { VramContention } from '@/services/aiRuntime/sdServer';
import { useImageRuntimeStore } from '@/stores/imageRuntimeStore';

interface VramWarningProps {
  contention: VramContention;
  /** The escape hatch. Omitted where the caller has nothing to start. */
  onProceed?: () => void;
  proceedDisabled?: boolean;
}

/** Ollama drops a model asynchronously; give it a moment before measuring again. */
const SETTLE_MS = 900;

export default function VramWarning({ contention, onProceed, proceedDisabled }: VramWarningProps) {
  const { t } = useTranslation();
  const refreshRuntime = useImageRuntimeStore((s) => s.refresh);
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const names = contention.resident.map((model) => model.modelId).join(', ');
  const need = formatBinaryBytes(contention.needBytes);
  const body = contention.measured
    ? t('vram.body')
        .replace('{model}', names)
        .replace('{free}', formatBinaryBytes(contention.freeBytes ?? 0))
        .replace('{need}', need)
    : t('vram.bodyUnknown').replace('{model}', names).replace('{need}', need);

  const release = async () => {
    setReleasing(true);
    setError(null);
    let failure: string | null = null;
    for (const model of contention.resident) {
      const result = await unloadChatModel(model.connectionId, model.modelId);
      if (!result.ok && !failure) failure = result.error ?? 'error';
    }
    // The unload is a request, not a fact: wait for Ollama to actually let go
    // and then re-read the card. Whatever is still there stays on screen.
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    await refreshRuntime();
    setAttempted(true);
    if (failure) setError(failure);
    setReleasing(false);
  };

  return (
    <div className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle size={13} className="text-warning mt-0.5 flex-shrink-0" />
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs text-text-primary">{t('vram.title')}</p>
          <p className="text-[11px] text-text-muted break-words">{body}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap pl-5">
        <button
          type="button"
          onClick={() => void release()}
          disabled={releasing}
          title={t('vram.releaseHint')}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-warning/15 text-warning text-[11px] font-medium hover:bg-warning/25 transition disabled:opacity-50"
        >
          {releasing ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
          {releasing ? t('vram.releasing') : t('vram.release')}
        </button>
        {onProceed && (
          <button
            type="button"
            onClick={onProceed}
            disabled={proceedDisabled}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-border text-text-muted text-[11px] hover:text-text-primary hover:border-accent-gold/40 transition disabled:opacity-40"
          >
            <ImagePlus size={11} />
            {t('vram.generateAnyway')}
          </button>
        )}
      </div>
      {error && <p className="pl-5 text-[11px] text-danger break-words">{t('vram.releaseFailed').replace('{error}', error)}</p>}
      {attempted && !error && <p className="pl-5 text-[11px] text-text-dim">{t('vram.stillLoaded')}</p>}
    </div>
  );
}
