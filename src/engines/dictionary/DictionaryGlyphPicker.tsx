import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Languages, X } from 'lucide-react';
import { mappingGlyphs, scriptGlyphCatalogs, scriptPresets } from './scripts';
import { scriptCopy } from './scriptCopy';

const inputStyle = 'w-full min-w-0 rounded-lg border border-border bg-deep px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold';
const buttonStyle = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';

export function DictionaryGlyphPalette({ mapping, locale, fontFamily, onChoose, onClose, canChoose }: {
  mapping: string; locale: 'en' | 'es'; fontFamily?: string; onChoose: (glyph: string) => void; onClose: () => void; canChoose?: (glyph: string) => boolean;
}) {
  const copy = scriptCopy[locale], [catalog, setCatalog] = useState('language'), region = useRef<HTMLDivElement>(null);
  const declared = scriptGlyphCatalogs.find(item => item.id === catalog);
  const preset = scriptPresets.find(item => item.id === catalog);
  const glyphs = catalog === 'language' ? mappingGlyphs(mapping) : [...new Set([...(declared?.glyphs ?? preset?.glyphs ?? '')])];
  useEffect(() => { region.current?.querySelector('select')?.focus(); }, []);
  return <div ref={region} role="region" aria-label={copy.glyphs} className="mt-2 space-y-3 border-t border-border pt-3" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-40 flex-1 space-y-1 text-sm text-text-primary">{copy.glyphSet}<select className={inputStyle} value={catalog} onChange={event => setCatalog(event.target.value)}>
        <option value="language">{copy.languageGlyphs}</option>
        {scriptPresets.map(item => <option key={item.id} value={item.id}>{item.id === 'runic' ? copy.runicCatalog : item.name}{scriptGlyphCatalogs.some(entry => entry.id === item.id) ? '' : ` · ${copy.mappingGlyphs}`}</option>)}
      </select></label>
      <button type="button" className={buttonStyle} aria-label={copy.closeGlyphs} onClick={onClose}><X size={15} aria-hidden="true" />{copy.close}</button>
    </div>
    <p className="text-sm text-text-muted">{copy.exploreOnly}</p>
    {glyphs.length ? <div className="flex max-h-52 flex-wrap gap-1 overflow-y-auto" style={{ fontFamily }}>
      {glyphs.map(glyph => <button key={glyph} type="button" disabled={canChoose ? !canChoose(glyph) : false} aria-label={glyph} title={[...glyph].map(point => 'U+' + point.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(' ')}
        className="inline-flex min-h-10 min-w-10 items-center justify-center rounded border border-border bg-deep px-2 text-xl text-text-primary hover:border-accent-gold hover:text-accent-gold focus-visible:outline-2 focus-visible:outline-accent-gold disabled:cursor-not-allowed disabled:opacity-40"
        onMouseDown={event => event.preventDefault()} onClick={() => onChoose(glyph)}>{glyph}</button>)}
    </div> : <p className="text-sm text-text-muted">{copy.noGlyphs}</p>}
  </div>;
}

/** A normal controlled native-form input; the palette edits the same draft string. */
export default function DictionaryNativeFormInput({ label, value, onChange, mapping, locale, fontFamily }: {
  label: string; value: string; onChange: (value: string) => void; mapping: string; locale: 'en' | 'es'; fontFamily?: string;
}) {
  const copy = scriptCopy[locale], field = useRef<HTMLInputElement>(null), pendingFocus = useRef(false);
  const [open, setOpen] = useState(false), [selection, setSelection] = useState({ start: 0, end: 0 });
  const capture = () => {
    const input = field.current, range = { start: input?.selectionStart ?? value.length, end: input?.selectionEnd ?? value.length };
    setSelection(current => current.start === range.start && current.end === range.end ? current : range); return range;
  };
  const focus = () => { pendingFocus.current = true; setOpen(false); };
  const close = () => { capture(); focus(); };
  useLayoutEffect(() => {
    if (!pendingFocus.current || !field.current) return;
    pendingFocus.current = false; field.current.focus(); field.current.setSelectionRange(selection.start, selection.end);
  });
  const choose = (glyph: string) => {
    const currentValue = field.current?.value ?? value, range = capture();
    const start = Math.min(currentValue.length, range.start), end = Math.min(currentValue.length, range.end);
    if (currentValue.length - (end - start) + glyph.length > 50000) return;
    onChange(currentValue.slice(0, start) + glyph + currentValue.slice(end));
    setSelection({ start: start + glyph.length, end: start + glyph.length }); focus();
  };
  return <div className="min-w-0 space-y-1">
    <label className="block space-y-1 text-sm text-text-primary">{label}<input ref={field} maxLength={50000} className={inputStyle} style={{ fontFamily }} value={value}
      onChange={event => { onChange(event.target.value); capture(); }} onSelect={capture}
      onKeyDown={event => { if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }} /></label>
    <button type="button" className={buttonStyle} aria-expanded={open} onMouseDown={event => event.preventDefault()} onClick={() => { if (open) close(); else { capture(); setOpen(true); } }}><Languages size={15} aria-hidden="true" />{copy.insertGlyph}</button>
    {open && <DictionaryGlyphPalette mapping={mapping} locale={locale} fontFamily={fontFamily} onChoose={choose} onClose={close} canChoose={glyph => value.length - (selection.end - selection.start) + glyph.length <= 50000} />}
  </div>;
}
