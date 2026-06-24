import { useState, useRef, useEffect } from 'react';
import { Download, FileJson, FileText, Clapperboard, ChevronDown } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { VideoPlan, VideoSegment } from '../types';
import { exportScriptPdf } from '../scriptExport';
import TeleprompterExportModal from './TeleprompterExportModal';

interface Props {
  plan: VideoPlan;
  segments: VideoSegment[];
}

export default function PlanExportMenu({ plan, segments }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [showRecorder, setShowRecorder] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Auto-dismiss transient status messages.
  useEffect(() => {
    if (!status) return;
    const id = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(id);
  }, [status]);

  const exportJson = () => {
    const data = {
      plan: { title: plan.title, totalDuration: plan.totalDuration },
      segments: segments.map((s) => ({
        title: s.title,
        startTime: s.startTime,
        endTime: s.endTime,
        speakerName: s.speakerName,
        script: s.script,
        visualType: s.visualType,
        visualDescription: s.visualDescription,
        audioNotes: s.audioNotes,
        notes: s.notes,
        tags: s.tags,
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${plan.title || 'plan'}-plan.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportPdf = async () => {
    setStatus(t('videoPlanner.pdf.generating'));
    try {
      const res = await exportScriptPdf(plan, segments);
      if (res.canceled) {
        setStatus(null);
        return;
      }
      setStatus(res.ok ? t('videoPlanner.pdf.done') : t('videoPlanner.pdf.failed'));
    } catch {
      setStatus(t('videoPlanner.pdf.failed'));
    }
  };

  const itemClass =
    'w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-200 hover:bg-accent-gold/10 hover:text-accent-gold transition-colors text-left';

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-4 py-2 rounded bg-surface border border-border hover:border-accent-gold/50 text-neutral-300 hover:text-accent-gold transition-colors text-sm"
      >
        <Download className="w-4 h-4" />
        {t('videoPlanner.export')}
        <ChevronDown className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-60 z-20 rounded-lg border border-border bg-surface shadow-xl overflow-hidden">
          <button
            className={itemClass}
            onClick={() => {
              setOpen(false);
              exportJson();
            }}
          >
            <FileJson className="w-4 h-4 shrink-0" />
            {t('videoPlanner.exportPlanJson')}
          </button>
          <button
            className={itemClass}
            onClick={() => {
              setOpen(false);
              void exportPdf();
            }}
          >
            <FileText className="w-4 h-4 shrink-0" />
            {t('videoPlanner.exportScriptPdf')}
          </button>
          <button
            className={itemClass}
            onClick={() => {
              setOpen(false);
              setShowRecorder(true);
            }}
          >
            <Clapperboard className="w-4 h-4 shrink-0" />
            {t('videoPlanner.exportVideoMp4')}
          </button>
        </div>
      )}

      {status && (
        <div className="absolute right-0 mt-1 w-60 z-10 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-neutral-300 shadow-xl">
          {status}
        </div>
      )}

      {showRecorder && (
        <TeleprompterExportModal
          plan={plan}
          segments={segments}
          onClose={() => setShowRecorder(false)}
        />
      )}
    </div>
  );
}
