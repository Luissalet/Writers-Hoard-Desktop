import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link2, Plus, Swords, Trash2, X } from 'lucide-react';
import { db } from '@/db';
import { useTranslation } from '@/i18n/useTranslation';
import { navigateTo } from '@/engines/_shared/anchoring';
import { useEnginePane } from '@/engines/_shared/EnginePaneContext';
import { searchCompendium } from '@/engines/compendium/srd';
import { prepareEncounter } from '@/engines/prepBlocks/operations';
import { parseEncounterList } from '@/engines/prepBlocks/markdown';
import { normalizeEncounter, whileTyping, PREP_LIMITS, type EncounterData, type EncounterLink, type EncounterRow } from '@/engines/prepBlocks/model';
import type { CodexBlockHost } from '../codexBlocks/model';
import { prepCopy, type PrepCopy } from './copy';
import { prepBoxClass, prepButtonClass, prepFieldClass, prepPrimaryClass, usePrepEditable, usePrepProject } from './shared';

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

function LinkPicker({ projectId, c, onPick, index }: { projectId?: string; c: PrepCopy; onPick: (link: EncounterLink) => void; index: number }) {
  const [query, setQuery] = useState('');
  const found = useLiveQuery(async () => {
    const word = query.trim(); if (word.length < 2) return { monsters: [], cards: [] };
    const monsters = (await searchCompendium(word, { kind: 'monster' }, 6)).hits;
    const cards = projectId ? (await db.codexEntries.where('projectId').equals(projectId).filter(entry => fold(entry.title).includes(fold(word))).limit(6).toArray()) : [];
    return { monsters, cards };
  }, [query, projectId]);
  const none = query.trim().length >= 2 && found && !found.monsters.length && !found.cards.length;
  return <div className="mt-1 rounded-lg border border-border bg-deep p-2" data-testid={`prep-encounter-picker-${index}`}>
    <input className={`${prepFieldClass} w-full`} autoFocus aria-label={c.linkSearch} placeholder={c.linkSearch} data-testid={`prep-encounter-search-${index}`} value={query} onChange={event => setQuery(event.target.value)} />
    <ul className="mt-1 max-h-48 overflow-y-auto text-sm">
      {found?.monsters.map(hit => <li key={`m-${hit.id}`}><button type="button" className="w-full rounded px-2 py-1 text-left text-text-primary hover:bg-elevated" data-testid={`prep-encounter-pick-monster-${hit.id}`} onClick={() => onPick({ kind: 'monster', id: hit.id, label: hit.name })}>{hit.name} <span className="text-text-muted">· {c.monsterGroup} · {hit.summary}</span></button></li>)}
      {found?.cards.map(entry => <li key={`c-${entry.id}`}><button type="button" className="w-full rounded px-2 py-1 text-left text-text-primary hover:bg-elevated" data-testid={`prep-encounter-pick-card-${entry.id}`} onClick={() => onPick({ kind: 'card', id: entry.id, label: entry.title })}>{entry.title} <span className="text-text-muted">· {c.cardGroup}</span></button></li>)}
      {none && <li className="px-2 py-1 text-text-muted">{c.noResults}</li>}
    </ul>
  </div>;
}

export default function EncounterBlockView({ node, updateAttributes, extension, editor, selected, getPos }: NodeViewProps) {
  const { locale } = useTranslation(), lang = locale === 'en' ? 'en' : 'es', c = prepCopy[lang];
  const projectId = usePrepProject(extension.options as CodexBlockHost), pane = useEnginePane();
  const data = whileTyping(() => normalizeEncounter(node.attrs.data, true)), editable = usePrepEditable(editor);
  const [picking, setPicking] = useState<number | null>(null), [pasting, setPasting] = useState(false), [pasted, setPasted] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const project = useLiveQuery(async () => (projectId ? db.projects.get(projectId) : undefined), [projectId]);
  const existing = data.encounterId ? project?.encounters?.find(item => item.id === data.encounterId) : undefined;
  const canOpen = !!projectId && !!project?.enabledEngines.includes('character-sheets');
  const set = (patch: Partial<EncounterData>) => updateAttributes({ data: { ...data, ...patch } });
  const setRow = (index: number, patch: Partial<EncounterRow>) => set({ rows: data.rows.map((row, at) => at === index ? { ...row, ...patch } : row) });
  const latest = (): EncounterData => { const position = getPos(); const current = typeof position === 'number' ? editor.state.doc.nodeAt(position) : null; return normalizeEncounter(current?.attrs.data ?? node.attrs.data); };
  const open = () => { if (projectId) (pane?.navigate ?? navigateTo)(`/project/${encodeURIComponent(projectId)}/character-sheets?view=fight`); };
  const prepare = async () => {
    if (busy) return; const fresh = latest();
    if (!projectId) { setStatus(c.needProject); return; }
    if (!fresh.rows.length) { setStatus(c.needRows); return; }
    setBusy(true);
    try {
      const made = await prepareEncounter(projectId, fresh, c.combatTitle);
      updateAttributes({ data: { ...fresh, encounterId: made.encounter.id } });
      setStatus(`${c.prepared.replace('{title}', made.encounter.title).replace('{n}', String(made.combatants))}${made.unlinked.length ? ` ${c.unlinked.replace('{names}', made.unlinked.join(', '))}` : ''}`);
    } catch { setStatus(c.failed2); } finally { setBusy(false); }
  };
  return <NodeViewWrapper as="div" contentEditable={false} data-testid="prep-encounter" data-prep-kind="encounter" className={prepBoxClass(selected)}>
    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{c.encounter}</p>
    {editable ? <>
      <input className={`${prepFieldClass} w-full`} aria-label={c.encounterTitle} placeholder={c.encounterTitle} data-testid="prep-encounter-title" value={data.title} onChange={event => set({ title: event.target.value })} />
      <ul className="mt-2 space-y-2">{data.rows.map((row, index) => <li key={index} data-testid={`prep-encounter-row-${index}`}>
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${prepFieldClass} w-16`} type="number" min={1} max={PREP_LIMITS.count} aria-label={c.count} data-testid={`prep-encounter-count-${index}`} value={row.count} onChange={event => setRow(index, { count: Math.max(1, Number(event.target.value) || 1) })} />
          <input className={`${prepFieldClass} min-w-40 flex-1`} aria-label={c.creature} placeholder={c.creature} data-testid={`prep-encounter-name-${index}`} value={row.name} onChange={event => setRow(index, { name: event.target.value })} />
          {row.link ? <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs text-text-primary" data-testid={`prep-encounter-linked-${index}`}><Link2 size={12} aria-hidden="true" />{row.link.label || row.link.id}<button type="button" className="rounded p-0.5 hover:bg-elevated" aria-label={c.unlink} data-testid={`prep-encounter-unlink-${index}`} onClick={() => setRow(index, { link: null })}><X size={12} aria-hidden="true" /></button></span>
            : <button type="button" className={prepButtonClass} data-testid={`prep-encounter-link-${index}`} aria-expanded={picking === index} onClick={() => setPicking(picking === index ? null : index)}><Link2 size={14} aria-hidden="true" />{c.link}</button>}
          <button type="button" className={prepButtonClass} aria-label={c.removeRow} data-testid={`prep-encounter-remove-${index}`} onClick={() => set({ rows: data.rows.filter((_, at) => at !== index) })}><Trash2 size={14} aria-hidden="true" /></button>
        </div>
        {picking === index && <LinkPicker projectId={projectId} c={c} index={index} onPick={link => { setRow(index, { link, name: row.name || link.label }); setPicking(null); }} />}
      </li>)}</ul>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={prepButtonClass} data-testid="prep-encounter-add" disabled={data.rows.length >= PREP_LIMITS.rows} onClick={() => set({ rows: [...data.rows, { name: '', count: 1, link: null }] })}><Plus size={14} aria-hidden="true" />{c.addRow}</button>
        <button type="button" className={prepButtonClass} data-testid="prep-encounter-paste" aria-expanded={pasting} onClick={() => setPasting(!pasting)}>{c.pasteList}</button>
      </div>
      {pasting && <div className="mt-2 space-y-2"><textarea className={`${prepFieldClass} w-full py-1`} rows={4} aria-label={c.pasteList} placeholder={c.pasteHint} data-testid="prep-encounter-paste-text" value={pasted} onChange={event => setPasted(event.target.value)} />
        <button type="button" className={prepButtonClass} data-testid="prep-encounter-paste-apply" onClick={() => { const rows = parseEncounterList(pasted); if (rows.length) { set({ rows: rows.slice(0, PREP_LIMITS.rows) }); setPasted(''); setPasting(false); } }}>{c.pasteApply}</button></div>}
    </> : <ul className="list-disc pl-5 text-sm text-text-primary">{data.rows.map((row, index) => <li key={index}>{row.count > 1 ? `${row.count}× ` : ''}{row.name}</li>)}</ul>}
    {editable && <div className="mt-3 flex flex-wrap items-center gap-2">
      {existing && canOpen && <button type="button" className={prepPrimaryClass} data-testid="prep-encounter-open" onClick={open}><Swords size={15} aria-hidden="true" />{c.open}</button>}
      <button type="button" className={existing && canOpen ? prepButtonClass : prepPrimaryClass} data-testid="prep-encounter-prepare" disabled={busy || !data.rows.length} onClick={() => void prepare()}><Swords size={15} aria-hidden="true" />{existing ? c.prepareAnother : c.prepare}</button>
      {existing && <span className="text-xs text-text-muted" data-testid="prep-encounter-existing">{c.existing}: {existing.title} ({existing.combatants.length})</span>}
    </div>}
    {status && <p className="mt-2 text-sm text-text-primary" role="status" data-testid="prep-encounter-status">{status}</p>}
  </NodeViewWrapper>;
}
