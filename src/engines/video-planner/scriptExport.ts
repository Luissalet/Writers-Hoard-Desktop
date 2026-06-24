// ============================================================================
// Script export — build a printable script document and save it as PDF
// ============================================================================
//
// Desktop: hands styled HTML to the main process, which renders it to a real
// PDF (Electron printToPDF) and prompts for a save location.
// Web fallback: opens the HTML in a new tab and triggers the print dialog so
// the user can "Save as PDF" themselves.

import { t } from '@/i18n/useTranslation';
import type { VideoPlan, VideoSegment } from './types';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'script';
}

/** Build a self-contained, print-styled HTML document for the plan's script. */
export function buildScriptHtml(plan: VideoPlan, segments: VideoSegment[]): string {
  const title = plan.title || t('videoPlanner.pdf.untitled');

  const sections = segments
    .map((seg, i) => {
      const meta: string[] = [];
      if (seg.speakerName) {
        meta.push(`${escapeHtml(t('videoPlanner.segment.speakerName'))}: ${escapeHtml(seg.speakerName)}`);
      }
      const time = [seg.startTime, seg.endTime].filter(Boolean).join(' – ');
      if (time) meta.push(escapeHtml(time));
      meta.push(escapeHtml(t(`videoPlanner.segment.visual.${seg.visualType}`)));

      const blocks: string[] = [];
      if (seg.script?.trim()) {
        blocks.push(`<p class="script">${escapeHtml(seg.script).replace(/\n/g, '<br>')}</p>`);
      }
      if (seg.visualDescription?.trim()) {
        blocks.push(
          `<p class="note"><span>${escapeHtml(t('videoPlanner.segment.visualDescription'))}:</span> ${escapeHtml(seg.visualDescription)}</p>`,
        );
      }
      if (seg.audioNotes?.trim()) {
        blocks.push(
          `<p class="note"><span>${escapeHtml(t('videoPlanner.segment.audioNotes'))}:</span> ${escapeHtml(seg.audioNotes)}</p>`,
        );
      }
      if (seg.notes?.trim()) {
        blocks.push(
          `<p class="note"><span>${escapeHtml(t('videoPlanner.segment.productionNotes'))}:</span> ${escapeHtml(seg.notes)}</p>`,
        );
      }

      return `      <section class="segment">
        <h2><span class="num">${i + 1}.</span> ${escapeHtml(seg.title || '')}</h2>
        <p class="meta">${meta.join(' · ')}</p>
        ${blocks.join('\n        ')}
      </section>`;
    })
    .join('\n');

  const durationLine = plan.totalDuration
    ? `<p class="subtitle">${escapeHtml(
        t('videoPlanner.totalDurationLabel').replace('{duration}', plan.totalDuration),
      )}</p>`
    : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; margin: 0; padding: 48px 56px; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  .subtitle { color: #b8860b; margin: 0 0 24px; font-size: 13px; }
  .segment { padding: 16px 0; border-top: 1px solid #e3e3e3; page-break-inside: avoid; }
  .segment h2 { font-size: 18px; margin: 0 0 4px; }
  .segment h2 .num { color: #b8860b; margin-right: 4px; }
  .meta { color: #777; font-size: 12px; margin: 0 0 10px; }
  .script { font-size: 15px; line-height: 1.6; white-space: pre-wrap; margin: 0 0 10px; }
  .note { font-size: 12.5px; color: #444; margin: 2px 0; }
  .note span { color: #888; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${durationLine}
${sections}
</body>
</html>`;
}

export interface ScriptExportResult {
  ok: boolean;
  canceled?: boolean;
  /** True when the web print-dialog fallback was used instead of a saved PDF. */
  fallback?: boolean;
  error?: string;
}

export async function exportScriptPdf(
  plan: VideoPlan,
  segments: VideoSegment[],
): Promise<ScriptExportResult> {
  const html = buildScriptHtml(plan, segments);
  const fileName = `${sanitizeFileName(plan.title || 'script')}-script.pdf`;

  const api = window.electronAPI;
  if (api?.exporter) {
    const res = await api.exporter.scriptToPdf(html, fileName);
    return { ok: res.ok, canceled: res.canceled, error: res.error };
  }

  // Web fallback: open the document and invoke the browser's print dialog.
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    URL.revokeObjectURL(url);
    return { ok: false, error: 'popup-blocked' };
  }
  const triggerPrint = () => {
    try {
      win.focus();
      win.print();
    } catch {
      /* noop */
    }
  };
  win.addEventListener('load', triggerPrint);
  // Safety net if the load event was missed.
  setTimeout(triggerPrint, 800);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { ok: true, fallback: true };
}
