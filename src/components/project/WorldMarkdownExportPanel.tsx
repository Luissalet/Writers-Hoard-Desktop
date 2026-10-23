import { useEffect, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { vaultCopy } from '@/services/worldMarkdownExport/copy';
import type { WorldMarkdownEstimate } from '@/services/worldMarkdownExport';
import { MEDIA_CONFIRM_BYTES, type MediaLimits } from '@/services/worldMarkdownExport/limits';

const megabytes = (bytes: number) => {
  const value = bytes / 1048576;
  return value < 0.1 ? '<0.1' : value.toFixed(1);
};

/**
 * "Export as Markdown": the whole world as a folder of readable files, zipped.
 * Everything heavy lives in services/worldMarkdownExport and is loaded only
 * when the panel is used.
 */
export default function WorldMarkdownExportPanel({ projectId, onDone, confirmAboveBytes = MEDIA_CONFIRM_BYTES, mediaLimits }: { projectId: string; onDone?: () => void; /** Ask before exporting with media above this size (tests lower it). */ confirmAboveBytes?: number; /** Smaller memory guards than the defaults (tests). */ mediaLimits?: Partial<MediaLimits> }) {
  const { locale } = useTranslation();
  const lang = locale === 'es' ? 'es' : 'en';
  const ui = vaultCopy(lang).ui;
  const [includeMedia, setIncludeMedia] = useState(false);
  const [estimate, setEstimate] = useState<WorldMarkdownEstimate | null>(null);
  const [phase, setPhase] = useState<{ text: string; done: number; total: number } | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean; warnings?: string[] } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const running = phase !== null;

  useEffect(() => {
    let active = true;
    void import('@/services/worldMarkdownExport').then(module => module.estimateWorldMarkdownVault(projectId)).then(
      value => { if (active) setEstimate(value); },
      () => { if (active) setEstimate(null); },
    );
    return () => { active = false; };
  }, [projectId]);
  useEffect(() => () => controller.current?.abort(), []);

  async function start() {
    if (controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setNotice(null); setConfirming(false);
    setPhase({ text: ui.busy, done: 0, total: 1 });
    try {
      const { buildWorldMarkdownVault, isWorldMarkdownAborted } = await import('@/services/worldMarkdownExport');
      try {
        const result = await buildWorldMarkdownVault(projectId, {
          includeMedia, lang, signal: abort.signal, mediaLimits,
          onPhase: (text, done, total) => { if (!abort.signal.aborted) setPhase({ text, done, total }); },
        });
        const { downloadBlobFile } = await import('@/engines/writings/manuscriptExport');
        downloadBlobFile(result.blob, result.fileName);
        setNotice({ text: ui.done(result.files), warnings: result.warnings });
        onDone?.();
      } catch (error) {
        setNotice(isWorldMarkdownAborted(error) ? { text: ui.canceled } : { text: ui.failed, error: true });
      }
    } catch {
      setNotice({ text: ui.failed, error: true });
    } finally {
      controller.current = null;
      setPhase(null);
    }
  }

  const bytes = estimate ? (includeMedia ? estimate.estimatedBytesWithMedia : estimate.estimatedBytes) : 0;
  return <section className="space-y-4" data-testid="world-md-panel" aria-label={ui.title}>
    <p className="text-sm leading-relaxed text-text-muted">{ui.detail}</p>
    <label className="flex items-center gap-2 text-sm text-text-primary">
      <input type="checkbox" data-testid="world-md-include-media" checked={includeMedia} disabled={running} onChange={event => { setIncludeMedia(event.target.checked); setConfirming(false); }} />
      {ui.includeMedia}
    </label>
    <p className="text-xs text-text-muted" data-testid="world-md-estimate" role="status">
      {estimate ? `${includeMedia ? ui.estimateMedia(megabytes(bytes)) : ui.estimateText(megabytes(bytes))} · ${ui.docs(estimate.documents)}` : ui.estimating}
    </p>
    {running && <p className="flex items-center gap-2 text-sm text-text-secondary" data-testid="world-md-phase" role="status"><Loader2 size={15} className="animate-spin" aria-hidden="true" />{phase.text}{phase.total > 1 ? ` (${Math.min(phase.done, phase.total)}/${phase.total})` : ''}</p>}
    {notice && <p role={notice.error ? 'alert' : 'status'} data-testid="world-md-notice" className={`text-sm ${notice.error ? 'text-danger' : 'text-text-secondary'}`}>{notice.text}</p>}
    {notice?.warnings?.length ? <div data-testid="world-md-warnings" role="status" className="text-xs text-text-muted"><p>{ui.warnings(notice.warnings.length)}</p><ul className="list-disc pl-5">{notice.warnings.map(line => <li key={line}>{line}</li>)}</ul></div> : null}
    {confirming && <div role="group" data-testid="world-md-confirm" className="flex flex-wrap items-center justify-end gap-3 rounded-lg border border-border p-3 text-sm text-text-primary"><span className="min-w-0 flex-1">{ui.confirmLarge(megabytes(bytes))}</span><button type="button" data-testid="world-md-confirm-no" onClick={() => setConfirming(false)} className="min-h-10 rounded-lg border border-border px-4 hover:bg-elevated">{ui.confirmNo}</button><button type="button" data-testid="world-md-confirm-yes" onClick={() => void start()} className="min-h-10 rounded-lg bg-accent-gold px-4 font-semibold text-deep">{ui.confirmYes}</button></div>}
    <div className="flex flex-wrap items-center justify-end gap-3">
      {running && <button type="button" data-testid="world-md-cancel" onClick={() => controller.current?.abort()} className="min-h-10 rounded-lg border border-border px-4 text-sm text-text-primary hover:bg-elevated">{ui.cancel}</button>}
      <button type="button" data-testid="world-md-start" disabled={running} onClick={() => { if (includeMedia && bytes > confirmAboveBytes) setConfirming(true); else void start(); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent-gold px-4 text-sm font-semibold text-deep disabled:opacity-50"><Download size={15} aria-hidden="true" />{ui.start}</button>
    </div>
  </section>;
}
