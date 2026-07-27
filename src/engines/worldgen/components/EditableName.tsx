import { useEffect, useRef, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';

/**
 * A name you can change, in place.
 *
 * This exists because renaming used to be a BRUSH — you picked "rename" from the
 * tool box, hunted for the dot, clicked it, and answered a `window.prompt`. That
 * is three decisions and a modal dialogue to change one word, and it treated an
 * edit to a single named thing as though it were a stroke across the ground.
 *
 * Renaming belongs to the thing. Open a town's plan and its name is at the top,
 * editable; select a sea in the index and the same is true there. Both routes
 * produce exactly the same `rename` edit, keyed by position, so the new name
 * still survives a full regeneration — which was always the good part of the
 * old design and is the part worth keeping.
 */
export default function EditableName({ value, onRename, className, placeholder }: {
  value: string;
  /** Absent means the name is not editable here — it simply renders as text. */
  onRename?: (name: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [edit, setEdit] = useState<{ source: string; draft: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // A rename elsewhere, or a different place selected, makes the edit stale
  // immediately without needing an effect to mirror the prop into state.
  const editing = edit?.source === value;
  const draft = editing ? edit.draft : value;

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const next = draft.trim();
    setEdit(null);
    if (!next || next === value) return;
    onRename?.(next);
  };

  if (!onRename) {
    return <span className={className}>{value || placeholder || '(sin nombre)'}</span>;
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEdit({ source: value, draft: value })}
        title="Cambiar el nombre"
        className={`group inline-flex items-center gap-1.5 min-w-0 text-left ${className ?? ''}`}
      >
        <span className="truncate">{value || placeholder || '(sin nombre)'}</span>
        <Pencil size={11} className="shrink-0 opacity-0 group-hover:opacity-70 transition" />
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 min-w-0">
      <input
        ref={inputRef}
        value={draft}
        autoFocus
        onChange={(e) => setEdit({ source: value, draft: e.target.value })}
        onKeyDown={(e) => {
          // Stop here: the map underneath binds single letters to tools and
          // Ctrl+Z to the world's undo, and neither should fire while somebody
          // is typing a name.
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEdit(null);
        }}
        onBlur={commit}
        className={`min-w-0 flex-1 bg-black/40 border border-accent-gold/50 rounded px-1.5 py-0.5 outline-none ${className ?? ''}`}
      />
      <button onMouseDown={(e) => e.preventDefault()} onClick={commit} title="Guardar" className="shrink-0 text-accent-gold/80 hover:text-accent-gold">
        <Check size={12} />
      </button>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setEdit(null)}
        title="Cancelar"
        className="shrink-0 text-text-dim hover:text-text-muted"
      >
        <X size={12} />
      </button>
    </span>
  );
}
