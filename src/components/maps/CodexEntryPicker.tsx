import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import type { CodexEntry, CodexEntryType } from '@/types';
import { useTranslation } from '@/i18n/useTranslation';
import { mapFeatureCopy } from './mapFeatureCopy';
import { PICKER_TYPES, matchEntries, searchKey } from './codexSearch';

interface Props {
  entries: CodexEntry[];
  value?: string;
  onChange: (id: string | undefined) => void;
  /** Creates an entry and resolves with its id; without it the picker only links. */
  onCreate?: (title: string, type: CodexEntryType) => Promise<string>;
  /** Kind of thing the new entry most likely is (a place for map marks). */
  defaultType?: CodexEntryType;
  testId: string;
  disabled?: boolean;
}

/** A searchable Codex link with "create as {type}" for an entry that does not exist yet. */
export default function CodexEntryPicker({ entries, value, onChange, onCreate, defaultType = 'location', testId, disabled }: Props) {
  const { t, locale } = useTranslation();
  const copy = mapFeatureCopy[locale === 'en' ? 'en' : 'es'];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [type, setType] = useState<CodexEntryType>(defaultType);
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = entries.find(entry => entry.id === value);
  const hits = useMemo(() => matchEntries(entries, query).slice(0, 40), [entries, query]);
  const exact = hits.some(entry => searchKey(entry.title) === searchKey(query));
  const canCreate = !!onCreate && !exact;
  const total = hits.length + (canCreate ? 1 : 0);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const pick = (id: string | undefined) => { onChange(id); setOpen(false); setQuery(''); };
  const create = async () => {
    if (!onCreate || creating) return;
    setCreating(true); setFailed(false);
    try { pick(await onCreate(query.trim() || copy.untitled, type)); }
    catch { setFailed(true); }
    finally { setCreating(false); }
  };
  const step = (by: number) => setType(PICKER_TYPES[(PICKER_TYPES.indexOf(type) + by + PICKER_TYPES.length) % PICKER_TYPES.length]);
  const typeName = (kind: CodexEntryType) => t(`codex.types.${kind}`);
  return <div ref={box} className="relative min-w-0" data-testid={`${testId}-picker`}>
    <div className="flex min-w-0 gap-1">
      <button type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-9 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-border bg-elevated px-3 py-2 text-left text-sm text-text-primary disabled:opacity-50" data-testid={testId}>
        <span className="truncate">{current ? `${current.title} · ${typeName(current.type)}` : copy.noLink}</span><ChevronDown size={14} className="shrink-0 text-text-muted" />
      </button>
      {current && <button type="button" disabled={disabled} onClick={() => pick(undefined)} className="rounded-lg border border-border px-2 text-text-muted hover:text-text-primary" aria-label={copy.unlink} title={copy.unlink} data-testid={`${testId}-clear`}><X size={14} /></button>}
    </div>
    {open && <div className="absolute right-0 z-30 mt-1 w-full min-w-64 max-w-[min(24rem,90vw)] rounded-lg border border-border bg-surface p-2 shadow-xl">
      <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={copy.searchEntries} aria-label={copy.searchEntries} role="combobox" aria-expanded aria-controls={listId} aria-activedescendant={total ? `${listId}-${active}` : undefined}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setActive(Math.min(total - 1, active + 1)); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(Math.max(0, active - 1)); }
          else if (event.key === 'Enter') { event.preventDefault(); if (active < hits.length) pick(hits[active].id); else if (canCreate) void create(); }
          else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
        }}
        className="w-full rounded-md border border-border bg-deep px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-accent-gold" data-testid={`${testId}-search`} />
      <ul id={listId} role="listbox" className="mt-1 max-h-56 overflow-y-auto text-sm">
        {hits.map((entry, index) => <li key={entry.id} id={`${listId}-${index}`} role="option" aria-selected={entry.id === value} onMouseEnter={() => setActive(index)} onClick={() => pick(entry.id)} className={`flex cursor-pointer justify-between gap-2 rounded px-2 py-1.5 ${index === active ? 'bg-elevated text-text-primary' : 'text-text-secondary'}`} data-testid={`${testId}-option-${entry.id}`}><span className="truncate">{entry.title}</span><span className="shrink-0 text-xs text-text-muted">{typeName(entry.type)}</span></li>)}
        {!hits.length && <li className="px-2 py-1.5 text-xs text-text-muted">{copy.noMatches}</li>}
      </ul>
      {onCreate && <div className={`mt-1 flex items-center gap-1 border-t border-border pt-2 ${active === hits.length && canCreate ? 'text-text-primary' : ''}`}>
        <button type="button" disabled={!canCreate || creating} id={`${listId}-${hits.length}`} onClick={() => void create()} className="flex flex-1 items-center gap-1.5 truncate rounded px-2 py-1.5 text-left text-sm text-accent-gold hover:bg-elevated disabled:opacity-50" data-testid={`${testId}-create`}><Plus size={14} className="shrink-0" /><span className="truncate">{creating ? copy.creating : copy.createAs.replace('{name}', query.trim() || copy.untitled)}</span></button>
        <button type="button" onClick={() => step(-1)} className="rounded p-1 text-text-muted hover:text-text-primary" aria-label={copy.prevType} title={copy.prevType} data-testid={`${testId}-type-prev`}><ChevronLeft size={14} /></button>
        <span className="min-w-20 text-center text-xs text-text-secondary" data-testid={`${testId}-type`} data-type={type}>{typeName(type)}</span>
        <button type="button" onClick={() => step(1)} className="rounded p-1 text-text-muted hover:text-text-primary" aria-label={copy.nextType} title={copy.nextType} data-testid={`${testId}-type-next`}><ChevronRight size={14} /></button>
      </div>}
      {failed && <p role="alert" className="mt-1 text-xs text-danger">{copy.createFailed}</p>}
    </div>}
  </div>;
}
