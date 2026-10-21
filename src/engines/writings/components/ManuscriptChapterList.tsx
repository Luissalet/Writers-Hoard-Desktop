// ============================================
// Manuscript import — the chapter preview
// ============================================
//
// The list the writer reads BEFORE anything is written: every chapter the
// current rule found, its title (editable) and its word count, with a checkbox
// that drops it from the import. Numbering shows the order the chapters will
// be created in, counting only the ones still included — so unticking the
// title page renumbers the rest immediately.

import { useTranslation } from '@/i18n/useTranslation';

export interface ManuscriptChapterRow {
  /** `splitIntoChapters` key — survives a change of rule where the boundary does. */
  key: string;
  title: string;
  words: number;
  included: boolean;
  /** The chapter's date in the world calendar, already formatted; shown when present. */
  worldDate?: string;
}

interface ManuscriptChapterListProps {
  rows: ManuscriptChapterRow[];
  /** True while a read or a write is in flight. */
  disabled: boolean;
  onRename: (key: string, title: string) => void;
  onToggle: (key: string) => void;
  targets?: { id: string; title: string }[];
  selectedTargets?: Record<string, string>;
  onTarget?: (key: string, targetId: string) => void;
  previews?: Record<string, string>;
}

export default function ManuscriptChapterList({
  rows,
  disabled,
  onRename,
  onToggle,
  targets, selectedTargets, onTarget, previews,
}: ManuscriptChapterListProps) {
  const { t, locale } = useTranslation();
  const es = locale === 'es';

  // Numbered before the markup, not inside it: the counter has to run straight
  // through the list in order, and a `map` callback is not the place to keep a
  // running total.
  const numbers: string[] = [];
  let position = 0;
  for (const row of rows) {
    if (row.included) position += 1;
    numbers.push(row.included ? String(position) : '—');
  }

  return (
    <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
      {rows.map((row, index) => {
        const number = numbers[index];
        return (
          <div
            key={row.key}
            className={`flex flex-wrap items-center gap-3 px-3 py-2 ${row.included ? '' : 'opacity-45'}`}
          >
            <input
              type="checkbox"
              checked={row.included}
              disabled={disabled}
              onChange={() => onToggle(row.key)}
              title={t('writings.manuscriptImport.include')}
              className="accent-accent-gold"
            />
            <span className="w-7 shrink-0 text-right text-xs tabular-nums text-text-dim">
              {number}
            </span>
            <input
              value={row.title}
              disabled={disabled}
              onChange={(event) => onRename(row.key, event.target.value)}
              placeholder={t('writings.manuscriptImport.chapterTitle')}
              aria-label={t('writings.manuscriptImport.chapterTitle')}
              className="flex-1 min-w-0 px-2 py-1 bg-elevated border border-border rounded-md text-sm text-text-primary outline-none focus:border-accent-gold transition font-serif"
            />
            {row.worldDate && (
              <span data-testid="manuscript-row-world-date" className="shrink-0 text-xs text-accent-gold">
                {row.worldDate}
              </span>
            )}
            <span className="shrink-0 text-xs tabular-nums text-text-muted">
              {row.words.toLocaleString()} {t('writings.words')}
            </span>
            {targets && <label className="flex w-full min-w-0 items-center gap-2 pl-10 text-xs text-text-secondary">{es?'Destino':'Target'}
              <select aria-label={`${es?'Destino de':'Target for'} ${row.title}`} value={selectedTargets?.[row.key] ?? ''} disabled={disabled || !row.included} onChange={event => onTarget?.(row.key, event.target.value)} className="min-w-0 flex-1 rounded border border-border bg-elevated px-2 py-1.5 text-text-primary">
                <option value="">{es?'Nuevo borrador':'New draft'}</option>{targets.map(target => <option key={target.id} value={target.id}>{es?'Reemplazar':'Replace'}: {target.title}</option>)}
              </select>
            </label>}
            {previews?.[row.key] && <p className="w-full break-words pl-10 text-xs leading-relaxed text-text-secondary">{previews[row.key]}</p>}
          </div>
        );
      })}
    </div>
  );
}
