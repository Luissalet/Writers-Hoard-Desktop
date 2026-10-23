import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function LibraryBookmarkMenu({ x, y, label, onPin, onClose }: { x: number; y: number; label: string; onPin: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape, true); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [onClose]);
  return createPortal(<div ref={ref} role="menu" aria-label={label} className="fixed z-50 rounded-lg border border-border bg-surface p-1 text-text-primary" style={{ left: Math.max(4, Math.min(x, innerWidth - 190)), top: Math.max(4, Math.min(y, innerHeight - 60)) }}>
    <button type="button" role="menuitem" className="min-h-10 w-44 rounded px-3 text-left text-sm hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold" onClick={onPin} onKeyDown={event => { if (event.key === 'Tab') onClose(); }}>{label}</button>
  </div>, document.body);
}
