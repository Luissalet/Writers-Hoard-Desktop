import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookUser, ChevronDown, ChevronRight, Footprints, Map as MapIcon, RefreshCw, Undo2 } from 'lucide-react';
import { db } from '@/db';
import { useTranslation } from '@/i18n/useTranslation';
import { fromDayNumber } from '@/engines/timeline/worldCalendar';
import { LEDGER_KINDS, type LedgerEntry, type LedgerKind } from '@/engines/writings/continuity/types';
import type { TravelMode } from '@/engines/worldgen/core/travel';
import { useContinuityReport } from '@/services/continuity/useContinuityReport';
import { characterStateAt, dayText, type ContinuityReport } from '@/services/continuity/report';
import { addLedgerEntry, removeLedgerEntry, revertContinuity, setIntentional, setTravelMode, type ContinuityReceipt } from '@/services/continuity/ledgerOps';
import { parseCellPoint, searchWorldPlaces, type WorldPlaceHit } from '@/services/continuity/worldPlaces';
import { useWorldEraScope } from '@/services/worldEras/hooks';
import type { Writing } from '@/types';

const MODES: TravelMode[] = ['foot', 'horse', 'cart', 'boat', 'ship'];
const VERDICT_STYLE: Record<string, string> = {
  impossible: 'border-red-500/50 bg-red-500/10 text-red-300',
  tight: 'border-amber-500/50 bg-amber-500/10 text-amber-300',
  comfortable: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  unknown: 'border-border bg-elevated text-text-muted',
};
const input = 'w-full rounded-md border border-border bg-elevated px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-gold';
const linkButton = 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-elevated hover:text-text-primary';

type Undo = { label: string; run: () => Promise<void> };

interface ContinuityPanelProps {
  projectId: string;
  writing: Pick<Writing, 'id' | 'title' | 'chapter'>;
  /** The chapter-metadata writer the editor uses, so an applied date goes through the same path. */
  onUpdateWriting: (id: string, changes: Partial<Writing>) => Promise<void>;
}

/**
 * Continuity beside the manuscript: the travel check for the open chapter and
 * the state ledger (what each character knows, carries, where they are, whether
 * they live). Same report as the map trail and the AI bridge tools.
 */
export default function ContinuityPanel({ projectId, writing, onUpdateWriting }: ContinuityPanelProps) {
  const { t } = useTranslation();
  const scope = useWorldEraScope(projectId);
  const { report, loading, error, refresh } = useContinuityReport(projectId, { eraId: scope.eraId });
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<'travel' | 'state'>('travel');
  const [undo, setUndo] = useState<Undo | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (label: string, action: () => Promise<Undo['run'] | void>) => {
    setFailure(null);
    try {
      const back = await action();
      setUndo(back ? { label, run: back } : null);
    } catch (e) { setFailure(e instanceof Error ? e.message : String(e)); }
  };
  const receiptUndo = (receipt: ContinuityReceipt) => () => revertContinuity(projectId, receipt);

  return (
    <section aria-label={t('continuity.title')} data-testid="continuity-panel" className="overflow-hidden rounded-xl border border-border bg-surface shadow-lg shadow-black/10">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          <Footprints size={15} className="text-accent-gold" aria-hidden="true" />
          <h2 className="text-xs font-bold text-text-primary">{t('continuity.title')}</h2>
          {report && <ProblemCount report={report} writingId={writing.id} />}
        </button>
        <button type="button" onClick={refresh} className="rounded p-1 text-text-dim hover:bg-elevated hover:text-text-primary" aria-label={t('continuity.refresh')} title={t('continuity.refresh')}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div className="space-y-3 p-3">
          <div role="tablist" className="grid grid-cols-2 gap-1 rounded-lg bg-deep p-1">
            {(['travel', 'state'] as const).map((id) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} data-testid={`continuity-tab-${id}`} onClick={() => setTab(id)}
                className={`rounded-md px-1.5 py-1.5 text-[10px] ${tab === id ? 'bg-elevated font-semibold text-accent-gold shadow-sm' : 'text-text-muted hover:text-text-primary'}`}>
                {t(`continuity.tab.${id}`)}
              </button>
            ))}
          </div>
          {undo && (
            <div className="flex items-center justify-between rounded-md bg-elevated px-2 py-1 text-[10px] text-text-muted">
              <span className="truncate">{undo.label}</span>
              <button type="button" data-testid="continuity-undo" onClick={() => void run(t('continuity.undo'), async () => { await undo.run(); })} className={linkButton}><Undo2 size={11} aria-hidden="true" />{t('continuity.undo')}</button>
            </div>
          )}
          {(failure || error) && <p role="alert" className="text-[10px] text-red-300">{failure ?? error}</p>}
          {!report ? <p className="text-[10px] text-text-dim">{t('continuity.loading')}</p>
            : tab === 'travel'
              ? <TravelTab report={report} projectId={projectId} eraId={scope.eraId} writingId={writing.id} run={run} receiptUndo={receiptUndo} onUpdateWriting={onUpdateWriting} />
              : <StateTab report={report} projectId={projectId} eraId={scope.eraId} writing={writing} run={run} receiptUndo={receiptUndo} />}
        </div>
      )}
    </section>
  );
}

function ProblemCount({ report, writingId }: { report: ContinuityReport; writingId: string }) {
  const count = report.legs.filter((l) => (l.verdict === 'impossible' || l.reason === 'no-route') && l.intentional === undefined && (l.to.writingId === writingId || l.from.writingId === writingId)).length
    + report.stateFindings.filter((f) => f.intentional === undefined && f.writingId === writingId).length;
  return count ? <span data-testid="continuity-problems" className="rounded-full bg-red-500/20 px-1.5 text-[10px] font-semibold text-red-300">{count}</span> : null;
}

type Run = (label: string, action: () => Promise<Undo['run'] | void>) => Promise<void>;

function chapterName(report: ContinuityReport, writingId: string): string {
  const c = report.chapters.find((row) => row.writingId === writingId);
  return c ? (c.chapter !== null ? `${c.chapter}. ${c.title}` : c.title) : '?';
}

function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));
}

function IntentionalControl({ note, onSave, onClear, testId }: { note?: string; onSave: (note: string) => void; onClear: () => void; testId: string }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? '');
  if (note !== undefined && !editing) {
    return (
      <div className="flex items-center gap-1 text-[10px] text-text-muted">
        <span className="rounded bg-elevated px-1">{t('continuity.intentional')}</span>
        <span className="min-w-0 flex-1 truncate" title={note}>{note}</span>
        <button type="button" onClick={onClear} className={linkButton}>{t('continuity.unmark')}</button>
      </div>
    );
  }
  if (!editing) return <button type="button" data-testid={`${testId}-mark`} onClick={() => setEditing(true)} className={linkButton}>{t('continuity.markIntentional')}</button>;
  return (
    <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { onSave(draft); setEditing(false); } }}>
      <input data-testid={`${testId}-note`} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('continuity.intentionalNote')} className={input} />
      <button type="submit" className={linkButton}>{t('continuity.save')}</button>
      <button type="button" onClick={() => setEditing(false)} className={linkButton}>{t('continuity.cancel')}</button>
    </form>
  );
}

function TravelTab({ report, projectId, eraId, writingId, run, receiptUndo, onUpdateWriting }: { report: ContinuityReport; projectId: string; eraId?: string; writingId: string; run: Run; receiptUndo: (r: ContinuityReceipt) => () => Promise<void>; onUpdateWriting: ContinuityPanelProps['onUpdateWriting'] }) {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const [all, setAll] = useState(false);
  const writings = useLiveQuery(() => db.writings.where('projectId').equals(projectId).toArray(), [projectId]);
  const legs = report.legs.filter((leg) => all || leg.to.writingId === writingId || leg.from.writingId === writingId);
  const travellers = [...new Set(legs.map((leg) => leg.characterId))];
  const base = `/project/${encodeURIComponent(projectId)}`;
  return (
    <div className="space-y-2" data-testid="continuity-travel">
      <div className="flex gap-1 text-[10px]">
        {[false, true].map((value) => (
          <button key={String(value)} type="button" onClick={() => setAll(value)} className={`rounded px-2 py-0.5 ${all === value ? 'bg-elevated text-accent-gold' : 'text-text-muted'}`}>{t(value ? 'continuity.allChapters' : 'continuity.thisChapter')}</button>
        ))}
      </div>
      {!report.calendar && <p className="text-[10px] text-text-dim">{t('continuity.noCalendar')}</p>}
      {report.pendingWorlds.length > 0 && <p className="text-[10px] text-text-dim">{t('continuity.pending')}</p>}
      {!legs.length && <p className="text-[10px] text-text-dim">{t('continuity.noLegs')}</p>}
      <ul className="space-y-2">
        {legs.map((leg) => {
          const name = report.titles[leg.characterId] ?? leg.characterId;
          const dest = writings?.find((w) => w.id === leg.to.writingId);
          return (
            <li key={leg.id} data-testid="continuity-leg" data-verdict={leg.verdict} className={`space-y-1 rounded-lg border p-2 ${VERDICT_STYLE[leg.verdict]}`}>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-text-primary">{name}</span>
                <span className="text-[10px] font-semibold">{t(`continuity.verdict.${leg.verdict}`)}{leg.reason ? ` · ${t(`continuity.reason.${leg.reason}`)}` : ''}</span>
              </div>
              <p className="text-[10px] text-text-muted">{leg.from.label} ({chapterName(report, leg.from.writingId)}) → {leg.to.label} ({chapterName(report, leg.to.writingId)})</p>
              {leg.neededDays !== null && (
                <p className="text-[10px] text-text-muted">
                  {leg.availableDays !== null ? fill(t('continuity.days'), { needed: leg.neededDays.toLocaleString(locale), available: leg.availableDays.toLocaleString(locale) }) : `${leg.neededDays.toLocaleString(locale)} d`}{leg.km !== null ? ` · ${leg.km.toLocaleString(locale)} km` : ''}
                </p>
              )}
              {leg.minStart !== undefined && report.calendar && (
                <div className="flex items-center justify-between gap-2 text-[10px]">
                  <span>{fill(t('continuity.earliest'), { date: dayText(report.calendar, leg.minStart) })}</span>
                  {dest && (
                    <button type="button" data-testid="continuity-apply-date" className={linkButton} onClick={() => void run(t('continuity.applyDate'), async () => {
                      const calendar = report.calendar!;
                      const chapter = report.chapters.find((c) => c.writingId === dest.id);
                      const length = chapter?.start != null && chapter.end != null ? chapter.end - chapter.start : 0;
                      const previous = { worldDate: dest.worldDate, worldDateEnd: dest.worldDateEnd };
                      await onUpdateWriting(dest.id, { worldDate: fromDayNumber(calendar, leg.minStart!), worldDateEnd: dest.worldDateEnd ? fromDayNumber(calendar, leg.minStart! + length) : undefined });
                      return () => onUpdateWriting(dest.id, previous);
                    })}>{t('continuity.applyDate')}</button>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1">
                <button type="button" className={linkButton} onClick={() => navigate(`${base}/writings?writing=${encodeURIComponent(leg.to.writingId)}`)}>{t('continuity.openChapter')}</button>
                <button type="button" data-testid="continuity-open-map" className={linkButton} onClick={() => navigate(`${base}/worldgen?world=${encodeURIComponent(leg.to.worldId)}&trail=${encodeURIComponent(leg.characterId)}`)}><MapIcon size={11} aria-hidden="true" />{t('continuity.openMap')}</button>
                <button type="button" className={linkButton} onClick={() => navigate(`${base}/codex?entry=${encodeURIComponent(leg.characterId)}`)}><BookUser size={11} aria-hidden="true" />{t('continuity.openCodex')}</button>
              </div>
              {(leg.verdict === 'impossible' || leg.verdict === 'tight' || leg.reason === 'no-route' || leg.intentional !== undefined) && (
                <IntentionalControl testId="continuity-leg" note={leg.intentional}
                  onSave={(note) => void run(t('continuity.intentional'), async () => receiptUndo(await setIntentional(projectId, leg.characterId, leg.id, note, eraId)))}
                  onClear={() => void run(t('continuity.unmark'), async () => receiptUndo(await setIntentional(projectId, leg.characterId, leg.id, null, eraId)))} />
              )}
            </li>
          );
        })}
      </ul>
      {travellers.length > 0 && (
        <div className="space-y-1 border-t border-border pt-2">
          <p className="text-[10px] uppercase tracking-wider text-text-dim">{t('continuity.travelMode')}</p>
          {travellers.map((id) => {
            const character = report.characters.find((c) => c.id === id);
            return (
              <label key={id} className="flex items-center justify-between gap-2 text-[11px] text-text-primary">
                <span className="truncate">{report.titles[id]}</span>
                <select data-testid="continuity-mode" value={character?.continuity.travelMode ?? 'foot'} className="rounded border border-border bg-elevated px-1 py-0.5 text-[10px]"
                  onChange={(e) => void run(t('continuity.travelMode'), async () => receiptUndo(await setTravelMode(projectId, id, e.target.value as TravelMode, eraId)))}>
                  {MODES.map((mode) => <option key={mode} value={mode}>{t(`continuity.mode.${mode}`)}</option>)}
                </select>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function describeLine(report: ContinuityReport, line: LedgerEntry, t: (key: string) => string): string {
  const name = (id?: string) => (id ? report.titles[id] ?? id : '');
  const what = line.kind === 'location' ? line.place?.label
    : line.kind === 'learns' || line.kind === 'actsOn' ? line.fact ?? name(line.entryId) ?? line.seedId
      : line.kind === 'gains' || line.kind === 'loses' || line.kind === 'uses' ? `${line.item ?? name(line.itemId)}${line.toId ? ` → ${name(line.toId)}` : ''}`
        : line.text ?? '';
  return `${t(`continuity.kind.${line.kind}`)}${what ? `: ${what}` : ''}`;
}

function StateTab({ report, projectId, eraId, writing, run, receiptUndo }: { report: ContinuityReport; projectId: string; eraId?: string; writing: ContinuityPanelProps['writing']; run: Run; receiptUndo: (r: ContinuityReceipt) => () => Promise<void> }) {
  const { t } = useTranslation();
  const [characterId, setCharacterId] = useState('');
  const current = report.characters.find((c) => c.id === characterId) ?? report.characters[0];
  const ownChapter = report.chapters.find((c) => c.writingId === writing.id)?.chapter ?? null;
  const [chapterPick, setChapterPick] = useState<number | null>(null);
  const chapter = chapterPick ?? ownChapter;
  const numbered = report.chapters.filter((c) => c.chapter !== null);
  const state = useMemo(() => (current && chapter !== null ? characterStateAt(report, current.id, chapter) : null), [report, current, chapter]);
  const name = (id?: string) => (id ? report.titles[id] ?? id : '');
  if (!current) return <p className="text-[10px] text-text-dim">{t('continuity.noCharacters')}</p>;
  const lines = (current.continuity.ledger ?? []).filter((line) => line.writingId === writing.id);
  const findings = report.stateFindings.filter((f) => f.writingId === writing.id);
  return (
    <div className="space-y-3" data-testid="continuity-state">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-text-dim">{t('continuity.character')}
          <select data-testid="continuity-character" value={current.id} onChange={(e) => setCharacterId(e.target.value)} className={input}>
            {report.characters.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
        <label className="text-[10px] text-text-dim">{t('continuity.chapter')}
          <select data-testid="continuity-chapter" value={chapter ?? ''} onChange={(e) => setChapterPick(e.target.value === '' ? null : Number(e.target.value))} className={input}>
            {numbered.map((c) => <option key={c.writingId} value={c.chapter!}>{c.chapter}. {c.title}</option>)}
          </select>
        </label>
      </div>
      {state ? (
        <dl className="space-y-1 rounded-lg bg-deep p-2 text-[11px]" data-testid="continuity-state-at">
          <p className="text-[10px] uppercase tracking-wider text-text-dim">{t('continuity.stateAt')} {chapter}</p>
          <Row label={t('continuity.location')} value={state.location?.label} />
          <Row label={t('continuity.knows')} value={state.knows.map((k) => k.fact ?? name(k.entryId) ?? k.seedId).join(' · ')} />
          <Row label={t('continuity.carries')} value={state.carries.map((c) => c.item ?? name(c.itemId)).join(' · ')} />
          <Row label={t('continuity.condition')} value={state.condition?.text} />
          <Row label={t('continuity.alive')} value={state.alive ? '✓' : fill(t('continuity.dead'), { chapter: state.diedIn ? chapterName(report, state.diedIn) : '' })} />
        </dl>
      ) : <p className="text-[10px] text-text-dim">{t('continuity.noChapterNumber')}</p>}

      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wider text-text-dim">{t('continuity.lines')}</p>
        <ul className="space-y-1">
          {lines.map((line) => (
            <li key={line.id} data-testid="continuity-line" className="flex items-center justify-between gap-2 rounded-md bg-elevated px-2 py-1 text-[11px] text-text-primary">
              <span className="min-w-0 truncate">{describeLine(report, line, t)}{line.source === 'judge' ? <span className="ml-1 text-[9px] text-text-dim">({t('continuity.fromJudge')})</span> : null}</span>
              <button type="button" className={linkButton} onClick={() => void run(t('continuity.remove'), async () => receiptUndo(await removeLedgerEntry(projectId, current.id, line.id, eraId)))}>{t('continuity.remove')}</button>
            </li>
          ))}
        </ul>
        <AddLine report={report} projectId={projectId} eraId={eraId} characterId={current.id} writingId={writing.id} run={run} receiptUndo={receiptUndo} />
      </div>

      <div className="space-y-1 border-t border-border pt-2">
        <p className="text-[10px] uppercase tracking-wider text-text-dim">{t('continuity.findings')}</p>
        {!findings.length && <p className="text-[10px] text-text-dim">{t('continuity.noFindings')}</p>}
        <ul className="space-y-1">
          {findings.map((f) => (
            <li key={f.id} data-testid="continuity-finding" data-kind={f.kind} className={`space-y-1 rounded-md border px-2 py-1 text-[11px] ${f.intentional !== undefined ? VERDICT_STYLE.unknown : VERDICT_STYLE.impossible}`}>
              <p>{fill(t(`continuity.finding.${f.kind}`), { character: name(f.characterId), detail: f.kind === 'item-not-carried' ? (report.titles[f.detail] ?? f.detail) : f.detail, other: f.otherWritingId ? chapterName(report, f.otherWritingId) : '' })}</p>
              <IntentionalControl testId="continuity-finding" note={f.intentional}
                onSave={(note) => void run(t('continuity.intentional'), async () => receiptUndo(await setIntentional(projectId, f.characterId, f.id, note, eraId)))}
                onClear={() => void run(t('continuity.unmark'), async () => receiptUndo(await setIntentional(projectId, f.characterId, f.id, null, eraId)))} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
      <dt className="text-text-dim">{label}</dt>
      <dd className="break-words text-text-primary">{value || '—'}</dd>
    </div>
  );
}

function AddLine({ report, projectId, eraId, characterId, writingId, run, receiptUndo }: { report: ContinuityReport; projectId: string; eraId?: string; characterId: string; writingId: string; run: Run; receiptUndo: (r: ContinuityReceipt) => () => Promise<void> }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<LedgerKind>('location');
  const [label, setLabel] = useState('');
  const [point, setPoint] = useState('');
  const [fact, setFact] = useState('');
  const [seedId, setSeedId] = useState('');
  const [itemId, setItemId] = useState('');
  const [item, setItem] = useState('');
  const [toId, setToId] = useState('');
  const [text, setText] = useState('');
  const [placeQuery, setPlaceQuery] = useState('');
  const [foundPlaces, setPlaceHits] = useState<WorldPlaceHit[]>([]);
  const [placeSearching, setPlaceSearching] = useState(false);
  const [worldPick, setWorldPick] = useState<{ label: string; worldId: string; x: number; y: number } | null>(null);
  const [coordWorld, setCoordWorld] = useState('');
  const typedPoint = parseCellPoint(placeQuery);
  const placeHits = placeQuery.trim() && !typedPoint ? foundPlaces : [];
  useEffect(() => {
    if (!placeQuery.trim() || parseCellPoint(placeQuery)) return;
    let live = true;
    const timer = window.setTimeout(() => {
      setPlaceSearching(true);
      void searchWorldPlaces(projectId, placeQuery, { eraId, limit: 12 })
        .then((result) => { if (live) setPlaceHits(result.hits); })
        .catch(() => { if (live) setPlaceHits([]); })
        .finally(() => { if (live) setPlaceSearching(false); });
    }, 250);
    return () => { live = false; window.clearTimeout(timer); setPlaceSearching(false); };
  }, [placeQuery, projectId, eraId]);
  const codex = useLiveQuery(() => db.codexEntries.where('projectId').equals(projectId).toArray(), [projectId]);
  const seeds = useLiveQuery(() => db.seeds.where('projectId').equals(projectId).toArray(), [projectId]);
  // Map points the story already uses: story event places and ledger points.
  const points = useMemo(() => {
    const seen = new Map<string, { label: string; worldId: string; x: number; y: number }>();
    for (const list of Object.values(report.appearances)) for (const a of list) seen.set(`${a.worldId}|${a.x}|${a.y}`, { label: a.label, worldId: a.worldId, x: a.x, y: a.y });
    return [...seen.entries()];
  }, [report]);
  const items = (codex ?? []).filter((e) => e.type === 'item');
  const knownFacts = useMemo(() => [...new Set(report.placed.filter((p) => p.entry.kind === 'learns' && p.entry.fact).map((p) => p.entry.fact!))], [report]);
  const submit = () => void run(t('continuity.add'), async () => {
    const picked = worldPick ?? points.find(([key]) => key === point)?.[1];
    const entry: Partial<LedgerEntry> = { writingId, kind, source: 'author' };
    if (kind === 'location') entry.place = { label: label || picked?.label || '', ...(picked ? { worldId: picked.worldId, x: picked.x, y: picked.y } : {}) };
    if (kind === 'learns' || kind === 'actsOn') { entry.fact = fact; if (seedId) entry.seedId = seedId; }
    if (kind === 'gains' || kind === 'loses' || kind === 'uses') { if (itemId) entry.itemId = itemId; if (item) entry.item = item; if (kind === 'loses' && toId) entry.toId = toId; }
    if (text) entry.text = text;
    const receipt = await addLedgerEntry(projectId, characterId, entry, eraId);
    setLabel(''); setPoint(''); setWorldPick(null); setPlaceQuery(''); setFact(''); setSeedId(''); setItemId(''); setItem(''); setToId(''); setText('');
    return receiptUndo(receipt);
  });
  return (
    <form className="space-y-1 rounded-lg border border-dashed border-border p-2" data-testid="continuity-add" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <select data-testid="continuity-add-kind" value={kind} onChange={(e) => setKind(e.target.value as LedgerKind)} className={input}>
        {LEDGER_KINDS.map((k) => <option key={k} value={k}>{t(`continuity.kind.${k}`)}</option>)}
      </select>
      {kind === 'location' && (
        <>
          <input data-testid="continuity-add-place" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('continuity.field.place')} className={input} />
          <select data-testid="continuity-add-point" value={point} onChange={(e) => setPoint(e.target.value)} className={input} aria-label={t('continuity.field.mapPoint')}>
            <option value="">{t('continuity.field.noMapPoint')}</option>
            {points.map(([key, p]) => <option key={key} value={key}>{p.label} ({Math.round(p.x)}, {Math.round(p.y)})</option>)}
          </select>
          {report.worlds.length > 0 && (
            <div className="space-y-1">
              <input data-testid="continuity-place-search" value={placeQuery} onChange={(e) => setPlaceQuery(e.target.value)} placeholder={t('continuity.field.searchPlace')} aria-label={t('continuity.field.searchPlace')} className={input} />
              {placeSearching && <p className="text-[10px] text-text-dim">{t('continuity.field.searching')}</p>}
              {typedPoint && (
                <div className="flex items-center gap-1">
                  {report.worlds.length > 1 && (
                    <select value={coordWorld || report.worlds[0].id} onChange={(e) => setCoordWorld(e.target.value)} className={input} aria-label={t('continuity.field.world')}>
                      {report.worlds.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  )}
                  <button type="button" data-testid="continuity-place-point" className={linkButton} onClick={() => {
                    const worldId = coordWorld || report.worlds[0].id;
                    setWorldPick({ label: label || `${typedPoint.x}, ${typedPoint.y}`, worldId, x: typedPoint.x, y: typedPoint.y });
                    setPlaceQuery('');
                  }}>{fill(t('continuity.field.usePoint'), { x: typedPoint.x, y: typedPoint.y })}</button>
                </div>
              )}
              {placeHits.length > 0 && (
                <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border bg-deep p-1" data-testid="continuity-place-hits">
                  {placeHits.map((hit) => (
                    <li key={`${hit.worldId}|${hit.key}`}>
                      <button type="button" data-testid="continuity-place-hit" className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-0.5 text-left text-[11px] text-text-primary hover:bg-elevated"
                        onClick={() => { setWorldPick({ label: hit.name, worldId: hit.worldId, x: hit.x, y: hit.y }); if (!label) setLabel(hit.name); setPlaceQuery(''); setPlaceHits([]); }}>
                        <span className="truncate">{hit.name}</span>
                        <span className="shrink-0 text-[10px] text-text-dim">{report.worlds.length > 1 ? `${report.worlds.find((w) => w.id === hit.worldId)?.name ?? ''} · ` : ''}{Math.round(hit.x)}, {Math.round(hit.y)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!placeSearching && placeQuery.trim() && !typedPoint && !placeHits.length && <p className="text-[10px] text-text-dim">{t('continuity.field.noPlaces')}</p>}
              {worldPick && (
                <p data-testid="continuity-place-picked" className="flex items-center justify-between gap-2 rounded bg-elevated px-1.5 py-0.5 text-[10px] text-text-muted">
                  <span className="truncate">{fill(t('continuity.field.pickedPlace'), { place: worldPick.label, x: Math.round(worldPick.x), y: Math.round(worldPick.y) })}</span>
                  <button type="button" className={linkButton} onClick={() => setWorldPick(null)}>{t('continuity.field.clearPlace')}</button>
                </p>
              )}
            </div>
          )}
        </>
      )}
      {(kind === 'learns' || kind === 'actsOn') && (
        <>
          <input data-testid="continuity-add-fact" list="continuity-facts" value={fact} onChange={(e) => setFact(e.target.value)} placeholder={t('continuity.field.fact')} className={input} />
          <datalist id="continuity-facts">{knownFacts.map((f) => <option key={f} value={f} />)}</datalist>
          <select value={seedId} onChange={(e) => setSeedId(e.target.value)} className={input} aria-label={t('continuity.field.seed')}>
            <option value="">{t('continuity.field.seed')}: {t('continuity.field.none')}</option>
            {(seeds ?? []).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </>
      )}
      {(kind === 'gains' || kind === 'loses' || kind === 'uses') && (
        <>
          <select data-testid="continuity-add-item" value={itemId} onChange={(e) => setItemId(e.target.value)} className={input} aria-label={t('continuity.field.item')}>
            <option value="">{t('continuity.field.item')}: {t('continuity.field.none')}</option>
            {items.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
          <input data-testid="continuity-add-item-text" value={item} onChange={(e) => setItem(e.target.value)} placeholder={t('continuity.field.itemText')} className={input} />
          {kind === 'loses' && (
            <select value={toId} onChange={(e) => setToId(e.target.value)} className={input} aria-label={t('continuity.field.to')}>
              <option value="">{t('continuity.field.to')}: {t('continuity.field.none')}</option>
              {report.characters.filter((c) => c.id !== characterId).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          )}
        </>
      )}
      {kind === 'condition' && <input data-testid="continuity-add-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('continuity.field.text')} className={input} />}
      <button type="submit" data-testid="continuity-add-submit" className="w-full rounded-md bg-accent-gold/20 px-2 py-1 text-[11px] font-semibold text-accent-gold hover:bg-accent-gold/30">{t('continuity.add')}</button>
    </form>
  );
}
