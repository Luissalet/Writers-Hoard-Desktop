import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface WorldMenuItem {
  id: string;
  label: string;
  icon: ReactNode;
  /** When set, the item first asks for a name or text (with this field label). */
  ask?: string;
  run: (text: string) => boolean | void;
}

/**
 * The world map's right-click menu: things that start at the clicked spot.
 * Items that need words open a one-line field first; Escape or a click
 * elsewhere closes it without doing anything.
 */
export default function WorldMapMenu({ at, items, onClose, title, cancel, create }: { at: { clientX: number; clientY: number; x: number; y: number }; items: WorldMenuItem[]; onClose: () => void; title: string; cancel: string; create: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState<WorldMenuItem | null>(null);
  const [text, setText] = useState('');
  useEffect(() => {
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [onClose]);
  useEffect(() => { box.current?.querySelector<HTMLElement>('input, button')?.focus(); }, [asking]);
  const left = Math.min(at.clientX, window.innerWidth - 248), top = Math.min(at.clientY, window.innerHeight - 220);
  const item = 'flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm text-text-secondary hover:bg-elevated hover:text-text-primary focus:bg-elevated focus:outline-none';
  const done = (entry: WorldMenuItem, value: string) => { if (entry.run(value) !== false) onClose(); };
  return <div ref={box} role="menu" aria-label={title} className="fixed z-50 w-60 rounded-lg border border-border bg-surface p-1.5 shadow-2xl" style={{ left, top }} data-testid="worldgen-map-menu" data-x={at.x.toFixed(2)} data-y={at.y.toFixed(2)} onContextMenu={event => event.preventDefault()}>
    {!asking ? items.map(entry => <button key={entry.id} type="button" role="menuitem" className={item} onClick={() => { if (entry.ask) { setAsking(entry); setText(''); } else done(entry, ''); }} data-testid={`worldgen-menu-${entry.id}`}>{entry.icon}{entry.label}</button>)
      : <form className="space-y-2 p-1" onSubmit={event => { event.preventDefault(); if (text.trim()) done(asking, text.trim()); }}>
        <label className="block text-xs text-text-muted">{asking.ask}<input value={text} onChange={event => setText(event.target.value)} maxLength={120} className="mt-1 w-full rounded-md border border-border bg-deep px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-accent-gold" data-testid="worldgen-menu-text" /></label>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-md px-2.5 py-1 text-xs text-text-muted hover:text-text-primary">{cancel}</button><button type="submit" disabled={!text.trim()} className="rounded-md bg-accent-gold px-3 py-1 text-xs font-semibold text-deep disabled:opacity-50" data-testid="worldgen-menu-create">{create}</button></div>
      </form>}
  </div>;
}
