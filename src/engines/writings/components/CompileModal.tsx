// ============================================
// Compile / Export manuscript modal
// ============================================
//
// Select writings → combine into one manuscript → export as Markdown, HTML
// or (desktop) a real PDF. Default selection: everything that isn't an idea,
// ordered by chapter number, then recency.

import { useMemo, useState } from 'react';
import { BookDown, FileText, FileCode2, FileDown, ChevronUp, ChevronDown } from 'lucide-react';
import type { Writing } from '@/types';
import Modal from '@/components/common/Modal';
import { toast } from '@/components/common/toast';
import { useTranslation } from '@/i18n/useTranslation';
import {
  buildManuscriptHtml,
  buildManuscriptMarkdown,
  canExportPdf,
  downloadTextFile,
  exportManuscriptPdf,
  sanitizeFilename,
  type CompileOptions,
} from '../manuscriptExport';

interface CompileModalProps {
  open: boolean;
  onClose: () => void;
  writings: Writing[];
  projectTitle: string;
}

function defaultOrder(writings: Writing[]): Writing[] {
  return [...writings].sort((a, b) => {
    const ac = a.chapter ?? Number.MAX_SAFE_INTEGER;
    const bc = b.chapter ?? Number.MAX_SAFE_INTEGER;
    if (ac !== bc) return ac - bc;
    return a.createdAt - b.createdAt;
  });
}

export default function CompileModal({ open, onClose, writings, projectTitle }: CompileModalProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [order, setOrder] = useState<string[]>([]);
  const [includeTitlePage, setIncludeTitlePage] = useState(true);
  const [includeSynopsis, setIncludeSynopsis] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [initializedFor, setInitializedFor] = useState<string | null>(null);

  // (Re)initialize selection when the modal opens — render-adjust pattern,
  // no effect needed.
  const openKey = open ? `${projectTitle}:${writings.length}` : null;
  if (open && initializedFor !== openKey) {
    setInitializedFor(openKey);
    const ordered = defaultOrder(writings);
    setOrder(ordered.map((w) => w.id));
    setSelected(new Set(ordered.filter((w) => w.status !== 'idea').map((w) => w.id)));
  }

  const byId = useMemo(() => new Map(writings.map((w) => [w.id, w])), [writings]);
  const orderedWritings = order.map((id) => byId.get(id)).filter((w): w is Writing => !!w);
  const chosen = orderedWritings.filter((w) => selected.has(w.id));
  const totalWords = chosen.reduce((sum, w) => sum + (w.wordCount || 0), 0);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const move = (id: string, dir: -1 | 1) => {
    setOrder((prev) => {
      const idx = prev.indexOf(id);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };

  const opts = (): CompileOptions => ({
    projectTitle,
    includeTitlePage,
    includeSynopsis,
    chapterLabel: t('writings.compile.chapterLabel'),
  });

  const requireSelection = (): boolean => {
    if (chosen.length === 0) {
      toast.error(t('writings.compile.selectSomething'));
      return false;
    }
    return true;
  };

  const exportMd = () => {
    if (!requireSelection()) return;
    downloadTextFile(
      buildManuscriptMarkdown(chosen, opts()),
      `${sanitizeFilename(projectTitle)}.md`,
      'text/markdown',
    );
    toast.success(t('writings.compile.done'));
  };

  const exportHtml = () => {
    if (!requireSelection()) return;
    downloadTextFile(
      buildManuscriptHtml(chosen, opts()),
      `${sanitizeFilename(projectTitle)}.html`,
      'text/html',
    );
    toast.success(t('writings.compile.done'));
  };

  const exportPdf = async () => {
    if (!requireSelection()) return;
    setExporting(true);
    try {
      const res = await exportManuscriptPdf(chosen, opts());
      if (res.ok) toast.success(t('writings.compile.done'));
      else if (!res.canceled) toast.error(res.error || t('writings.compile.error'));
    } catch (err) {
      console.error('PDF export failed:', err);
      toast.error(t('writings.compile.error'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('writings.compile.title')} wide>
      <div className="space-y-4">
        {/* Options */}
        <div className="flex items-center gap-5 flex-wrap text-sm">
          <label className="flex items-center gap-2 text-text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={includeTitlePage}
              onChange={(e) => setIncludeTitlePage(e.target.checked)}
              className="accent-[#c4973b]"
            />
            {t('writings.compile.titlePage')}
          </label>
          <label className="flex items-center gap-2 text-text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={includeSynopsis}
              onChange={(e) => setIncludeSynopsis(e.target.checked)}
              className="accent-[#c4973b]"
            />
            {t('writings.compile.synopsis')}
          </label>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelected(new Set(order))}
              className="text-xs text-accent-gold hover:underline"
            >
              {t('writings.compile.selectAll')}
            </button>
            <span className="text-text-dim">·</span>
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs text-accent-gold hover:underline"
            >
              {t('writings.compile.selectNone')}
            </button>
          </div>
        </div>

        {/* Writing list */}
        <div className="max-h-72 overflow-y-auto space-y-1.5 border border-border rounded-lg p-2 bg-deep/40">
          {orderedWritings.length === 0 && (
            <p className="text-sm text-text-dim text-center py-6">{t('writings.compile.empty')}</p>
          )}
          {orderedWritings.map((w, i) => (
            <div
              key={w.id}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition ${
                selected.has(w.id)
                  ? 'border-accent-gold/40 bg-accent-gold/5'
                  : 'border-transparent hover:bg-elevated'
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(w.id)}
                onChange={() => toggle(w.id)}
                className="accent-[#c4973b] cursor-pointer"
              />
              <button onClick={() => toggle(w.id)} className="flex-1 min-w-0 text-left">
                <span className="text-sm text-text-primary truncate block">
                  {w.chapter !== undefined && (
                    <span className="text-accent-gold font-semibold mr-1.5">{w.chapter}.</span>
                  )}
                  {w.title}
                </span>
                <span className="text-[10px] text-text-dim">
                  {(w.wordCount || 0).toLocaleString()} {t('writings.words')} · {t(`writings.status.${w.status}`)}
                </span>
              </button>
              <div className="flex flex-col">
                <button
                  onClick={() => move(w.id, -1)}
                  disabled={i === 0}
                  className="p-0.5 text-text-dim hover:text-text-primary disabled:opacity-20 transition"
                  aria-label="move up"
                >
                  <ChevronUp size={13} />
                </button>
                <button
                  onClick={() => move(w.id, 1)}
                  disabled={i === orderedWritings.length - 1}
                  className="p-0.5 text-text-dim hover:text-text-primary disabled:opacity-20 transition"
                  aria-label="move down"
                >
                  <ChevronDown size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <p className="text-xs text-text-dim">
          {t('writings.compile.summary')
            .replace('{count}', String(chosen.length))
            .replace('{words}', totalWords.toLocaleString())}
        </p>

        {/* Export buttons */}
        <div className="flex gap-2 pt-2 border-t border-border flex-wrap">
          <button
            onClick={exportMd}
            className="flex items-center gap-2 px-4 py-2.5 border border-border rounded-lg text-sm text-text-primary hover:border-accent-gold/50 hover:bg-elevated transition"
          >
            <FileText size={15} className="text-accent-gold" />
            Markdown
          </button>
          <button
            onClick={exportHtml}
            className="flex items-center gap-2 px-4 py-2.5 border border-border rounded-lg text-sm text-text-primary hover:border-accent-gold/50 hover:bg-elevated transition"
          >
            <FileCode2 size={15} className="text-accent-gold" />
            HTML
          </button>
          {canExportPdf() && (
            <button
              onClick={exportPdf}
              disabled={exporting}
              className="flex items-center gap-2 px-4 py-2.5 bg-accent-gold text-deep font-semibold rounded-lg text-sm hover:bg-accent-amber transition disabled:opacity-50"
            >
              <FileDown size={15} />
              {exporting ? t('writings.compile.exporting') : 'PDF'}
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-sm text-text-muted hover:text-text-primary transition"
          >
            {t('common.close')}
          </button>
        </div>

        <p className="flex items-center gap-1.5 text-[11px] text-text-dim">
          <BookDown size={12} />
          {t('writings.compile.hint')}
        </p>
      </div>
    </Modal>
  );
}
