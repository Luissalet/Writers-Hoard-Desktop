import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PaintedLabel } from '../core/edits';
import { LABEL_CURVE_RANGE, LABEL_DEFAULT_SPACING, LABEL_SIZE_RANGE, LABEL_SPACING_RANGE, LABEL_STYLE_IDS, type LabelChange } from '../core/labelShape';

const DEG = 180 / Math.PI;
const defaults = (label: PaintedLabel) => ({ size: label.size ?? 12, angle: label.angle ?? 0, spacing: label.spacing ?? LABEL_DEFAULT_SPACING[label.style], curve: label.curve ?? 0 });

/**
 * The Labels tool's inspector: the selected painted label's words, type style,
 * size, angle, letter spacing and bend. The map's handles change the last
 * three by hand; these controls set exact values. Each settled change is one
 * edit, so undo takes it back.
 */
export default function LabelEditor({ label, onChange, onRemove }: {
  label: PaintedLabel | null;
  /** A change and the key of the label it belongs to, which may no longer be the selected one. */
  onChange: (change: LabelChange, key: string) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(label?.text ?? '');
  const [shape, setShape] = useState(() => (label ? defaults(label) : null));
  // Unsaved work, always tagged with the label it was made on.
  const pending = useRef<{ key: string; change: LabelChange } | null>(null);
  const typed = useRef<{ key: string; text: string; original: string } | null>(null);
  const timer = useRef(0);
  const labelKey = label ? `${label.key}:${label.text}:${label.style}:${label.size}:${label.angle}:${label.spacing}:${label.curve}` : '';
  // Follow the label when it changes elsewhere (its handles, undo, an agent).
  const [seen, setSeen] = useState(labelKey);
  if (seen !== labelKey) { setSeen(labelKey); setText(label?.text ?? ''); setShape(label ? defaults(label) : null); }
  const flush = () => {
    window.clearTimeout(timer.current);
    const work = pending.current; pending.current = null;
    if (work && Object.keys(work.change).length) onChange(work.change, work.key);
  };
  /** Words typed but not yet confirmed are kept when the reader clicks away. */
  const flushText = () => {
    const work = typed.current; typed.current = null;
    const next = work?.text.trim();
    if (work && next && next !== work.original) onChange({ text: next }, work.key);
  };
  const flushRef = useRef(() => { flush(); flushText(); });
  useEffect(() => { flushRef.current = () => { flush(); flushText(); }; });
  // Leaving this label (another is picked, or none) or closing the panel saves what is pending.
  useEffect(() => () => flushRef.current(), [label?.key]);
  if (!label || !shape) return <p className="text-[11px] text-white/60 leading-snug" data-testid="label-editor-empty">{t('worldgen.labels.pick')}</p>;
  const queue = (change: LabelChange) => {
    pending.current = { key: label.key, change: { ...(pending.current?.key === label.key ? pending.current.change : {}), ...change } };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flushRef.current(), 400);
  };
  const setNumber = (field: 'size' | 'angle' | 'spacing' | 'curve', value: number) => { setShape({ ...shape, [field]: value }); queue({ [field]: value }); };
  const commitText = () => { typed.current = null; const next = text.trim(); if (next && next !== label.text) onChange({ text: next }, label.key); else setText(label.text); };
  const slider = (field: 'size' | 'angle' | 'spacing' | 'curve', min: number, max: number, step: number, value: number, shown: string, toStored: (v: number) => number) => (
    <label className="flex flex-col gap-0.5" key={field}>
      <span className="flex justify-between text-[10px] text-white/45"><span>{t(`worldgen.labels.${field}`)}</span><span className="tabular-nums text-white/65">{shown}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={t(`worldgen.labels.${field}`)} data-testid={`label-${field}`}
        onChange={(event) => setNumber(field, toStored(Number(event.target.value)))} onPointerUp={flush} onKeyUp={flush} className="w-full accent-amber-400" />
    </label>
  );
  return (
    <div className="flex flex-col gap-2" data-testid="label-editor">
      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-white/45">{t('worldgen.paint.row.text')}</span>
        <input value={text} data-testid="label-text" onChange={(event) => { setText(event.target.value); typed.current = { key: label.key, text: event.target.value, original: label.text }; }} onBlur={commitText}
          onKeyDown={(event) => { if (event.key === 'Enter') commitText(); }}
          className="w-full px-2 py-1 rounded bg-black/40 border border-white/15 text-[11px] text-white/90 outline-none focus:border-amber-400/60" />
      </label>
      <div className="grid grid-cols-5 gap-1" role="group" aria-label={t('worldgen.paint.row.style')}>
        {LABEL_STYLE_IDS.map((id) => (
          <button key={id} type="button" aria-pressed={label.style === id} onClick={() => { if (id !== label.style) onChange({ style: id }, label.key); }}
            className={`px-1 py-1 rounded text-[10px] border ${label.style === id ? 'bg-amber-400/25 border-amber-400/60 text-amber-100' : 'bg-black/30 border-white/10 text-white/70 hover:bg-white/10'}`}>
            {t(`worldgen.paint.labelStyle.${id}`)}
          </button>
        ))}
      </div>
      {slider('size', LABEL_SIZE_RANGE.min, LABEL_SIZE_RANGE.max, 1, shape.size, `${Math.round(shape.size)} px`, (v) => v)}
      {slider('angle', -180, 180, 1, Math.round(shape.angle * DEG), `${Math.round(shape.angle * DEG)}°`, (v) => Math.round(v / DEG * 1000) / 1000)}
      {slider('spacing', LABEL_SPACING_RANGE.min * 100, LABEL_SPACING_RANGE.max * 100, 1, Math.round(shape.spacing * 100), `${Math.round(shape.spacing * 100)}%`, (v) => v / 100)}
      {slider('curve', LABEL_CURVE_RANGE.min * 100, LABEL_CURVE_RANGE.max * 100, 1, Math.round(shape.curve * 100), `${Math.round(shape.curve * 100)}%`, (v) => v / 100)}
      <div className="flex gap-2">
        <button type="button" data-testid="label-straighten" className="flex-1 rounded border border-white/15 bg-black/30 px-2 py-1 text-[10px] text-white/80 hover:bg-white/10"
          onClick={() => { setShape({ ...shape, angle: 0, curve: 0 }); onChange({ angle: 0, curve: 0 }, label.key); }}>{t('worldgen.labels.straighten')}</button>
        <button type="button" data-testid="label-remove" className="flex-1 rounded border border-red-300/30 bg-red-500/10 px-2 py-1 text-[10px] text-red-100 hover:bg-red-500/20"
          onClick={onRemove}>{t('worldgen.labels.remove')}</button>
      </div>
      <p className="text-[10px] text-white/45 leading-snug">{t('worldgen.labels.handlesNote')}</p>
    </div>
  );
}
