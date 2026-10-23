import { bindEraOperation, useWorldEraScope, useEraProject, useEraRows } from '@/services/worldEras/hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { saveAs } from 'file-saver';
import { Dice5, Download, Plus, Save, Trash2, Upload } from 'lucide-react';
import type { EngineComponentProps } from '@/engines/_types';
import { useTranslation } from '@/i18n/useTranslation';
import ConfirmDialog from '@/engines/_shared/components/ConfirmDialog';
import { useDeepLinkParam } from '@/engines/_shared';
import { createSheet, exportSheet, parseSheetImport, presets, sourceLinks, type CharacterSheet, type SheetPreset } from './types';
import { deleteSheet as deleteSheetScoped, saveSheet as saveSheetScoped, SheetConflict } from './operations';
import { sheetDraftStore, type SheetDraft } from './drafts';
import { sheetCopy } from './copy';
import { button, gold, input } from './uiStyles';
import { Field } from './ui';
import SheetEditor from './SheetEditor';
import { reconcileCocSheet, resolveCocSheet } from './cocRules';
import {FIVE_E_SOURCE,reconcileFiveESheet} from './fiveE';
import CompendiumPanel from '@/engines/compendium/CompendiumPanel';
import EncounterPanel from '@/engines/encounters/EncounterPanel';
import DiceTray from '@/engines/dice/DiceTray';
import TableRulesPanel from './TableRulesPanel';
import { addMonsterToFight } from '@/engines/encounters/fromSources';

export default function CharacterSheetsEngine({ projectId }: EngineComponentProps) {
  return <Workspace key={projectId} projectId={projectId} />;
}
function Workspace({ projectId }: EngineComponentProps) {
  const { locale } = useTranslation(); const c = sheetCopy[locale];
  const scope = useWorldEraScope(projectId);
  const saveSheet = bindEraOperation(saveSheetScoped, scope.eraId, 3);
  const deleteSheet = bindEraOperation(deleteSheetScoped, scope.eraId, 3);
  const project = useEraProject(projectId);
  const entries = useEraRows<import('@/types').CodexEntry>('codexEntries', projectId);
  const [journal] = useState(() => sheetDraftStore(projectId, scope.eraId));
  const [, rerender] = useState(0);
  const drafts = Object.fromEntries(journal);
  const setDrafts = (change: (current: Record<string, SheetDraft>) => Record<string, SheetDraft>) => {
    const before = Object.fromEntries(journal), next = change(before);
    for (const [key, draft] of Object.entries(next)) if (draft !== before[key]) journal.set(key, draft);
    for (const key of Object.keys(before)) if (!next[key]) journal.delete(key);
    rerender(value => value + 1);
  };
  const [view, setView] = useState<'sheets' | 'compendium' | 'fight' | 'dice' | 'rules'>('sheets');
  const [selected, setSelected] = useState(''); const [preset, setPreset] = useState<SheetPreset>('5e-character');
  const [query, setQuery] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [status, setStatus] = useState(''); const [conflict, setConflict] = useState(false);
  const [confirmation, setConfirmation] = useState<null | { message: string; action: () => void | Promise<void> }>(null);
  const importRef = useRef<HTMLInputElement>(null); const pending = useRef(false);
  const deepLink = useDeepLinkParam('entity'); const [seenLink, setSeenLink] = useState(''); const viewLink = useDeepLinkParam('view'); const [seenView, setSeenView] = useState('');
  if (viewLink && viewLink !== seenView) { setSeenView(viewLink); if (viewLink === 'rules') setView('rules'); }
  const sheets = useMemo(() => project?.characterSheets ?? [], [project?.characterSheets]);
  const id = selected || sheets[0]?.id || Object.keys(drafts)[0] || '';
  const active = drafts[id]; const rawSheet = active?.sheet ?? sheets.find(item => item.id === id);
  const sheet = useMemo(() => rawSheet ? resolveCocSheet(rawSheet) : undefined, [rawSheet]);
  useEffect(() => { if (deepLink && deepLink !== seenLink && sheets.some(item => item.id === deepLink)) { setSelected(deepLink); setSeenLink(deepLink); setConflict(false); } }, [deepLink, seenLink, sheets]);
  const update = (change: (sheet: CharacterSheet) => CharacterSheet) => {
    if (!sheet || busy) return;
    setDrafts(current => { const before=resolveCocSheet(current[sheet.id]?.sheet ?? sheet);return { ...current, [sheet.id]: { sheet: reconcileFiveESheet(reconcileCocSheet(change(structuredClone(before)),before),before), base: current[sheet.id] ? current[sheet.id].base : sheet.revision || null } }; }); setStatus('');
  };
  const perform = async (action: () => Promise<void>) => {
    if (pending.current) return; pending.current = true; setBusy(true); setError('');
    try { await action(); } catch (err) { if (err instanceof SheetConflict) { setConflict(true); setError(c.conflict); } else setError(c.error); }
    finally { pending.current = false; setBusy(false); }
  };
  const removeDraft = (key: string) => setDrafts(current => { const next = { ...current }; delete next[key]; return next; });
  const save = (asNew = false) => {
    if (!sheet) return;
    void perform(async () => {
      const draft = asNew ? { ...structuredClone(sheet), id: crypto.randomUUID(), revision: 0, createdAt: Date.now() } : sheet;
      const saved = await saveSheet(projectId, draft, asNew ? null : active ? active.base : sheet.revision);
      removeDraft(sheet.id); setSelected(saved.id); setConflict(false); setStatus(c.saved);
    });
  };
  const confirm = (message: string, action: () => void | Promise<void>) => setConfirmation({ message, action });
  if (!project) return <p className="p-5 text-text-muted">…</p>;
  const documents = [...sheets, ...Object.values(drafts).map(item => item.sheet).filter(item => !sheets.some(saved => saved.id === item.id))];
  const visible = documents.filter(item => (drafts[item.id]?.sheet.title ?? item.title).toLowerCase().includes(query.toLowerCase()));
  return <section className="flex h-full min-h-0 flex-col bg-deep" aria-label={c.title} data-testid="character-sheets">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5"><div><h2 className="flex items-center gap-2 font-display text-2xl text-text-primary"><Dice5 aria-hidden="true" size={24} />{c.title}</h2><p className="mt-2 max-w-prose text-sm text-text-muted">{c.intro}</p></div><div className="flex flex-wrap items-end gap-2">
      <Field label={c.preset}><select className={input} aria-label={c.preset} value={preset} onChange={event => setPreset(event.target.value as SheetPreset)}>{presets.map((item, index) => <option key={item} value={item}>{c.categories[index]}</option>)}</select></Field>
      <button className={button} disabled={busy} onClick={() => { const next = createSheet(preset); setDrafts(current => ({ ...current, [next.id]: { sheet: next, base: null } })); setSelected(next.id); setConflict(false); setError(''); setStatus(''); }}><Plus size={16} />{c.new}</button>
      <button className={button} disabled={busy} onClick={() => importRef.current?.click()}><Upload size={16} />{c.import}</button>
      <input ref={importRef} type="file" accept="application/json,.json" className="hidden" aria-label={c.import} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
        void perform(async () => { try { if (file.size > 8000000) throw new Error(); const next = parseSheetImport(await file.text()); if (next.linkedEntryId && !entries.some(entry => entry.id === next.linkedEntryId)) next.linkedEntryId = undefined; setDrafts(current => ({ ...current, [next.id]: { sheet: next, base: null } })); setSelected(next.id); setConflict(false); setStatus(c.unsaved); } catch { setError(c.importError); } });
      }} />
    </div></header>
    <div role="tablist" aria-label={locale === 'es' ? 'Vista' : 'View'} className="flex gap-1 border-b border-border px-5 py-2">{(['sheets', 'compendium', 'fight', 'dice', 'rules'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={view === value} data-testid={`sheets-view-${value}`} onClick={() => setView(value)} className={`rounded-lg px-3 py-1.5 text-sm ${view === value ? 'bg-accent-gold/15 text-accent-gold' : 'text-text-muted hover:bg-surface'}`}>{({ sheets: locale === 'es' ? 'Hojas' : 'Sheets', compendium: locale === 'es' ? 'Compendio' : 'Compendium', fight: locale === 'es' ? 'Combate' : 'Fight', dice: locale === 'es' ? 'Dados' : 'Dice', rules: locale === 'es' ? 'Reglas de la mesa' : 'Table rules' })[value]}</button>)}</div>
    {view === 'compendium' && <div className="min-h-0 flex-1 overflow-y-auto p-5"><CompendiumPanel projectId={projectId} eraId={scope.eraId} locale={locale} onAddToFight={monster => { void addMonsterToFight(projectId, monster, 1, locale === 'es' ? 'Combate' : 'Fight').catch(() => setError(c.error)); }} /></div>}
    {view === 'dice' && <div className="min-h-0 flex-1 overflow-y-auto p-5"><DiceTray projectId={projectId} locale={locale} /></div>}
    {view === 'rules' && <div className="min-h-0 flex-1 overflow-y-auto p-5"><TableRulesPanel projectId={projectId} locale={locale} /></div>}
    {view === 'fight' && <div className="min-h-0 flex-1 overflow-y-auto p-5"><EncounterPanel projectId={projectId} locale={locale} sheets={sheets} /></div>}
    {view === 'sheets' && <div className="flex min-h-0 flex-1 flex-col overflow-auto md:flex-row"><nav className="shrink-0 border-b border-border p-3 md:w-60 md:overflow-y-auto md:border-r md:border-b-0" aria-label={c.title}>
      <div className="md:hidden"><Field label={locale === 'es' ? 'Ficha activa' : 'Current sheet'}><select className={input} aria-label={locale === 'es' ? 'Ficha activa' : 'Current sheet'} value={id} disabled={busy} onChange={event => { setSelected(event.target.value); setConflict(false); setError(''); setStatus(''); }}>{!documents.length && <option value="">{c.none}</option>}{documents.map(item => <option key={item.id} value={item.id}>{drafts[item.id]?.sheet.title || item.title || c.new}{drafts[item.id] ? ' *' : ''}</option>)}</select></Field></div>
      <div className="hidden md:block"><input className={input} aria-label={locale === 'es' ? 'Buscar ficha' : 'Find sheet'} placeholder={locale === 'es' ? 'Buscar ficha…' : 'Find sheet…'} value={query} onChange={event => setQuery(event.target.value)} />
      {visible.map(item => <button key={item.id} className={`mt-2 w-full rounded-lg p-3 text-left focus-visible:outline-2 focus-visible:outline-accent-gold ${id === item.id ? 'bg-elevated text-accent-gold' : 'text-text-primary hover:bg-surface'}`} disabled={busy} aria-current={id === item.id ? 'page' : undefined} onClick={() => { setSelected(item.id); setConflict(false); setError(''); setStatus(''); }}><span className="block break-words text-sm">{drafts[item.id]?.sheet.title || item.title || c.new}{drafts[item.id] ? ' *' : ''}</span><span className="mt-1 block text-xs text-text-muted">{(drafts[item.id]?.sheet??item).fiveE?FIVE_E_SOURCE.title:c.categories[presets.indexOf(item.preset)]}</span></button>)}
    </div></nav><main className="min-w-0 flex-1 space-y-5 p-5 md:overflow-y-auto">{!sheet ? <p className="py-12 text-center text-text-muted">{c.empty}</p> : <>
      <div className="flex flex-wrap items-end gap-3"><div className="min-w-48 flex-1"><Field label={c.name}><input className={`${input} font-display text-lg`} maxLength={300} aria-label={c.name} value={sheet.title} onChange={event => update(current => ({ ...current, title: event.target.value }))} /></Field></div>
        <button className={gold} disabled={busy || !sheet.title.trim() || !active} onClick={() => save()}><Save size={16} />{c.save}</button>
        <button className={button} disabled={busy} onClick={() => { try { saveAs(new Blob([exportSheet(sheet)], { type: 'application/json' }), `${sheet.title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 80) || 'sheet'}.json`); } catch { setError(c.error); } }}><Download size={16} />{c.export}</button>
        <button className={button} disabled={busy || !sheet.title.trim()} onClick={() => save(true)}>{c.copy}</button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm"><span className={active ? 'text-accent-gold' : 'text-text-muted'}>{active ? c.unsaved : c.saved}</span>{active && <button className={button} disabled={busy} onClick={() => confirm(c.discardHelp, () => { removeDraft(sheet.id); setSelected(sheets.some(item => item.id === sheet.id) ? sheet.id : ''); setConflict(false); setError(''); })}>{c.discard}</button>}{sheets.some(item => item.id === sheet.id) && <button className={`${button} text-danger`} disabled={busy} onClick={() => confirm(c.deleteHelp, () => perform(async () => { await deleteSheet(projectId, sheet.id, active?.base ?? sheet.revision); removeDraft(sheet.id); setSelected(''); setConflict(false); }))}><Trash2 size={16} />{c.delete}</button>}</div>
      {error && <div role="alert" className="rounded-lg border border-danger/40 p-3 text-sm text-danger">{error}{conflict && <div className="mt-3 flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => save(true)}>{c.copy}</button><button className={button} disabled={busy} onClick={() => confirm(c.discardHelp, () => { removeDraft(sheet.id); setConflict(false); setError(''); })}>{c.reload}</button></div>}</div>}
      {status && <p role="status" className="text-sm text-text-muted">{status}</p>}
      <Field label={c.codex}><select className={input} aria-label={c.codex} value={sheet.linkedEntryId ?? ''} onChange={event => update(current => ({ ...current, linkedEntryId: event.target.value || undefined }))}><option value="">{c.none}</option>{sheet.linkedEntryId && !entries.some(entry => entry.id === sheet.linkedEntryId) && <option value={sheet.linkedEntryId}>{locale === 'es' ? 'Entrada no disponible' : 'Entry unavailable'}</option>}{entries.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></Field>
      <fieldset disabled={busy}><SheetEditor key={sheet.id} sheet={sheet} sheets={sheets} tableRules={project.tableRules} locale={locale} update={update} confirm={confirm} report={setError} status={setStatus} /></fieldset>
      <footer className="border-t border-border pt-4"><p className="max-w-prose text-sm text-text-muted">{sheet.preset==='coc7'?(locale==='es'?'Los máximos automáticos siguen las características; los ajustes manuales se conservan. Las acciones de Partida aplican heridas y cordura al borrador. Guarda para conservar los resultados.':'Automatic maxima follow characteristics; manual overrides persist. Play actions apply wounds and sanity to the draft. Save to keep the results.'):c.manual}</p>{sourceLinks[sheet.preset] && <p className="mt-3 flex flex-wrap gap-3 text-xs text-text-muted">{c.sources}: {(sheet.fiveE?[{title:FIVE_E_SOURCE.title,url:FIVE_E_SOURCE.url}]:sourceLinks[sheet.preset]!).map(source => <a key={source.url} className="text-accent-gold underline underline-offset-4" href={source.url} target="_blank" rel="noreferrer noopener">{source.title}</a>)}</p>}</footer>
    </>}</main></div>}
    <ConfirmDialog open={!!confirmation} message={confirmation?.message ?? ''} destructive onCancel={() => setConfirmation(null)} onConfirm={async () => { const action = confirmation?.action; setConfirmation(null); await action?.(); }} />
  </section>;
}
