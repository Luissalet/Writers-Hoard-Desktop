import { useEffect, useRef, useState } from 'react';
import { BookPlus, ChevronLeft, ChevronRight, MapPin, MessageSquarePlus, Pentagon, Route, Type } from 'lucide-react';
import type { CodexEntryType, MapFeature } from '@/types';
import { useTranslation } from '@/i18n/useTranslation';
import { mapFeatureCopy } from './mapFeatureCopy';
import { PICKER_TYPES } from './codexSearch';

export interface MapMenuAt { clientX: number; clientY: number; x: number; y: number }

interface Props {
  at: MapMenuAt;
  onClose: () => void;
  /** Each action is offered only when the host can do it. */
  onNewEntry?: (title: string, type: CodexEntryType) => Promise<void>;
  onAddPin?: () => void;
  onDraw?: (kind: MapFeature['kind']) => void;
  onComment?: () => void;
}

/** The map's right-click menu: things that start at the clicked spot. */
export default function MapContextMenu({ at, onClose, onNewEntry, onAddPin, onDraw, onComment }: Props) {
  const { t, locale } = useTranslation();
  const copy = mapFeatureCopy[locale === 'en' ? 'en' : 'es'];
  const box = useRef<HTMLDivElement>(null);
  const [naming, setNaming] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<CodexEntryType>('location');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    box.current?.querySelector<HTMLElement>('button, input')?.focus();
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [onClose]);
  const left = Math.min(at.clientX, window.innerWidth - 248), top = Math.min(at.clientY, window.innerHeight - (naming ? 170 : 240));
  const item = 'flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm text-text-secondary hover:bg-elevated hover:text-text-primary focus:bg-elevated focus:outline-none';
  const run = (action: () => void) => () => { action(); onClose(); };
  const create = async () => {
    if (!onNewEntry || busy) return;
    setBusy(true); setFailed(false);
    try { await onNewEntry(title.trim() || copy.untitled, type); onClose(); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  };
  const step = (by: number) => setType(PICKER_TYPES[(PICKER_TYPES.indexOf(type) + by + PICKER_TYPES.length) % PICKER_TYPES.length]);
  return <div ref={box} role="menu" aria-label={copy.menuTitle} className="fixed z-50 w-60 rounded-lg border border-border bg-surface p-1.5 shadow-2xl" style={{ left, top }} data-testid="map-context-menu" data-x={at.x.toFixed(2)} data-y={at.y.toFixed(2)}
    onContextMenu={event => event.preventDefault()}>
    {!naming ? <>
      {onNewEntry && <button type="button" role="menuitem" className={item} onClick={() => setNaming(true)} data-testid="map-menu-new-entry"><BookPlus size={14} />{copy.menuNewEntry}</button>}
      {onAddPin && <button type="button" role="menuitem" className={item} onClick={run(onAddPin)} data-testid="map-menu-add-pin"><MapPin size={14} />{copy.menuAddPin}</button>}
      {onDraw && <>
        <button type="button" role="menuitem" className={item} onClick={run(() => onDraw('region'))} data-testid="map-menu-region"><Pentagon size={14} />{copy.menuRegion}</button>
        <button type="button" role="menuitem" className={item} onClick={run(() => onDraw('path'))} data-testid="map-menu-path"><Route size={14} />{copy.menuPath}</button>
        <button type="button" role="menuitem" className={item} onClick={run(() => onDraw('label'))} data-testid="map-menu-label"><Type size={14} />{copy.menuLabel}</button>
      </>}
      {onComment && <button type="button" role="menuitem" className={item} onClick={run(onComment)} data-testid="map-menu-comment"><MessageSquarePlus size={14} />{copy.menuComment}</button>}
    </> : <form className="space-y-2 p-1" onSubmit={event => { event.preventDefault(); void create(); }}>
      <label className="block text-xs text-text-muted">{copy.menuEntryName}<input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder={copy.untitled} className="mt-1 w-full rounded-md border border-border bg-deep px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-accent-gold" data-testid="map-menu-entry-name" /></label>
      <div className="flex items-center justify-between text-xs text-text-muted"><button type="button" onClick={() => step(-1)} className="rounded p-1 hover:text-text-primary" aria-label={copy.prevType} data-testid="map-menu-type-prev"><ChevronLeft size={14} /></button><span data-testid="map-menu-type" data-type={type}>{t(`codex.types.${type}`)}</span><button type="button" onClick={() => step(1)} className="rounded p-1 hover:text-text-primary" aria-label={copy.nextType} data-testid="map-menu-type-next"><ChevronRight size={14} /></button></div>
      {failed && <p role="alert" className="text-xs text-danger">{copy.createFailed}</p>}
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-md px-2.5 py-1 text-xs text-text-muted hover:text-text-primary">{copy.cancelShort}</button><button type="submit" disabled={busy} className="rounded-md bg-accent-gold px-3 py-1 text-xs font-semibold text-deep disabled:opacity-50" data-testid="map-menu-entry-create">{busy ? copy.creating : copy.menuCreate}</button></div>
    </form>}
  </div>;
}
