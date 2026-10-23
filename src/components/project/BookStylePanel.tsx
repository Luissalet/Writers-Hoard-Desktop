// How the whole compiled book is set: a preset feel, then the rhythm of the
// page (alignment, paragraphs, spacing, title size) and its ornaments. Off
// means every paragraph prints as written.
import { SCENE_BREAK_STYLES, type SceneBreakStyle } from '@/components/editor/advanced/model';
import { useTranslation } from '@/i18n/useTranslation';
import { BOOK_PAPERS, BOOK_PRESETS, BOOK_TRIMS, TITLE_ORNAMENTS, bookPreset, type BookPaper, type BookPreset, type BookStyle, type BookTrim, type TitleOrnament } from '@/engines/writings/bookStyle';

interface Props {
  value?: BookStyle;
  onChange: (value: BookStyle | undefined) => void;
}

const field = 'flex flex-col gap-1 text-xs text-text-muted';
const control = 'rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary';

export default function BookStylePanel({ value, onChange }: Props) {
  const { t } = useTranslation();
  const set = <K extends keyof BookStyle>(key: K, next: BookStyle[K]) => {
    if (value) onChange({ ...value, [key]: next, preset: 'custom' });
  };
  return (
    <section className="rounded-lg border border-border bg-background/40 p-3" data-testid="publishing-book-style">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="mr-auto text-sm font-semibold text-text-primary">{t('projectTools.publishing.book.title')}</h3>
        <select
          data-testid="publishing-book-preset"
          aria-label={t('projectTools.publishing.book.preset')}
          value={value ? value.preset : 'none'}
          onChange={event => {
            const next = event.target.value;
            if (next === 'none') onChange(undefined);
            else if (next !== 'custom') onChange(bookPreset(next as BookPreset));
          }}
          className={control}
        >
          <option value="none">{t('projectTools.publishing.book.none')}</option>
          {BOOK_PRESETS.map(preset => <option key={preset} value={preset}>{t(`projectTools.publishing.book.preset.${preset}`)}</option>)}
          {value?.preset === 'custom' && <option value="custom">{t('projectTools.publishing.book.custom')}</option>}
        </select>
      </div>
      {!value && <p className="mt-2 text-xs text-text-muted">{t('projectTools.publishing.book.noneHint')}</p>}
      {value && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className={field}>
            {t('projectTools.publishing.book.trim')}
            <select data-testid="publishing-book-trim" value={value.trim} onChange={event => set('trim', event.target.value as BookTrim)} className={control}>
              {BOOK_TRIMS.map(trim => <option key={trim} value={trim}>{t(`projectTools.publishing.book.trim.${trim}`)}</option>)}
            </select>
          </label>
          <label className={field}>
            {t('projectTools.publishing.book.paper')}
            <select data-testid="publishing-book-paper" value={value.paper} onChange={event => set('paper', event.target.value as BookPaper)} className={control}>
              {BOOK_PAPERS.map(paper => <option key={paper} value={paper}>{t(`projectTools.publishing.book.paper.${paper}`)}</option>)}
            </select>
          </label>
          <label className={field}>
            {t('projectTools.publishing.book.columns')}
            <select data-testid="publishing-book-columns" value={value.columns} onChange={event => set('columns', Number(event.target.value) === 2 ? 2 : 1)} className={control}>
              <option value={1}>{t('projectTools.publishing.book.columns.1')}</option>
              <option value={2}>{t('projectTools.publishing.book.columns.2')}</option>
            </select>
          </label>
          <label className={field}>
            {t('projectTools.publishing.book.align')}
            <select data-testid="publishing-book-align" value={value.align} onChange={event => set('align', event.target.value as BookStyle['align'])} className={control}>
              <option value="justify">{t('projectTools.publishing.book.justify')}</option>
              <option value="left">{t('projectTools.publishing.book.ragged')}</option>
            </select>
          </label>
          <label className={field}>
            {t('projectTools.publishing.book.paragraphs')}
            <select data-testid="publishing-book-paragraphs" value={value.paragraphs} onChange={event => set('paragraphs', event.target.value as BookStyle['paragraphs'])} className={control}>
              <option value="indented">{t('projectTools.publishing.book.indented')}</option>
              <option value="spaced">{t('projectTools.publishing.book.spaced')}</option>
            </select>
          </label>
          <label className={field}>
            {t('projectTools.publishing.book.sceneBreak')}
            <select data-testid="publishing-book-scene-break" value={value.sceneBreak} onChange={event => set('sceneBreak', event.target.value as SceneBreakStyle)} className={control}>
              {SCENE_BREAK_STYLES.map(style => <option key={style} value={style}>{t(`projectTools.publishing.book.break.${style}`)}</option>)}
            </select>
          </label>
          <label className={field}>
            {`${t('projectTools.publishing.book.lineHeight')} · ${value.lineHeight.toFixed(2)}`}
            <input data-testid="publishing-book-line-height" type="range" min={1.1} max={2.4} step={0.05} value={value.lineHeight} onChange={event => set('lineHeight', Number(event.target.value))} />
          </label>
          <label className={field}>
            {`${t('projectTools.publishing.book.letterSpacing')} · ${value.letterSpacing.toFixed(3)} em`}
            <input data-testid="publishing-book-letter-spacing" type="range" min={0} max={0.12} step={0.005} value={value.letterSpacing} onChange={event => set('letterSpacing', Number(event.target.value))} />
          </label>
          {value.paragraphs === 'spaced' && (
            <label className={field}>
              {`${t('projectTools.publishing.book.paragraphSpacing')} · ${value.paragraphSpacing.toFixed(1)} em`}
              <input data-testid="publishing-book-paragraph-spacing" type="range" min={0.2} max={2} step={0.1} value={value.paragraphSpacing} onChange={event => set('paragraphSpacing', Number(event.target.value))} />
            </label>
          )}
          <label className={field}>
            {`${t('projectTools.publishing.book.titleSize')} · ${value.titleSize} pt`}
            <input data-testid="publishing-book-title-size" type="range" min={12} max={36} step={1} value={value.titleSize} onChange={event => set('titleSize', Number(event.target.value))} />
          </label>
          <label className={field}>
            {t('projectTools.publishing.book.titleOrnament')}
            <select data-testid="publishing-book-title-ornament" value={value.titleOrnament} onChange={event => set('titleOrnament', event.target.value as TitleOrnament)} className={control}>
              {TITLE_ORNAMENTS.map(ornament => <option key={ornament} value={ornament}>{t(`projectTools.publishing.book.ornament.${ornament}`)}</option>)}
            </select>
          </label>
          <div className="col-span-2 flex flex-wrap gap-x-5 gap-y-2 text-xs text-text-muted sm:col-span-3">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" data-testid="publishing-book-drop-cap" checked={value.dropCap} onChange={event => set('dropCap', event.target.checked)} className="accent-accent-gold" />
              {t('projectTools.publishing.book.dropCap')}
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" data-testid="publishing-book-small-caps" checked={value.smallCapsOpening} onChange={event => set('smallCapsOpening', event.target.checked)} className="accent-accent-gold" />
              {t('projectTools.publishing.book.smallCaps')}
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" data-testid="publishing-book-flush" checked={value.flushAfterBreak} onChange={event => set('flushAfterBreak', event.target.checked)} className="accent-accent-gold" />
              {t('projectTools.publishing.book.flushAfterBreak')}
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" data-testid="publishing-book-striped-tables" checked={value.stripedTables} onChange={event => set('stripedTables', event.target.checked)} className="accent-accent-gold" />
              {t('projectTools.publishing.book.stripedTables')}
            </label>
          </div>
        </div>
      )}
    </section>
  );
}
