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
}

interface ManuscriptChapterListProps {
  rows: ManuscriptChapterRow[];
  /** True while a read or a write is in flight. */
  disabled: boolean;
  onRename: (key: string, title: string) => void;
  onToggle: (key: string) => void;
}

export default function ManuscriptChapterList({
  rows,
  disabled,
  onRename,
  onToggle,
}: ManuscriptChapterListProps) {
  const { t } = useTranslation();

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
            className={`flex items-center gap-3 px-3 py-2 ${row.included ? '' : 'opacity-45'}`}
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
            <span className="shrink-0 text-xs tabular-nums text-text-muted">
              {row.words.toLocaleString()} {t('writings.words')}
            </span>
          </div>
        );
      })}
    </div>
  );
}
