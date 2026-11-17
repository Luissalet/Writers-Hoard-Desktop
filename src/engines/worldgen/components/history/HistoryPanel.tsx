import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Dices, Pause, Play } from 'lucide-react';
import { useEnginePane } from '@/engines/_shared/EnginePaneContext';
import { useEraNavigate } from '@/services/worldEras/navigation';
import { useTranslation } from '@/i18n/useTranslation';
import { toast } from '@/components/common/toast';
import { fill, historyActions, historyPinNotes } from '../../history/i18n';
import { politiesAt } from '../../history/simulate';
import { acceptedKeys, acceptProposals, saveHistorySettings, sendHistoryToTimeline } from '../../history/store';
import { eventText, historyProposals, ruinCauseText, type HistoryLang, type ProposalGroup } from '../../history/text';
import { HISTORY_LIMITS, type HistoryEventKind, type HistoryPin, type HistorySettings } from '../../history/types';
import type { WorldHistoryLens } from '../../history/useWorldHistory';

type Tab = 'events' | 'realms' | 'ruins' | 'names' | 'pins' | 'cards';
const TABS: Tab[] = ['events', 'realms', 'ruins', 'names', 'pins', 'cards'];
const KINDS: HistoryEventKind[] = ['polity-founded', 'city-founded', 'annexed', 'war', 'peace', 'conquest', 'sack', 'abandoned', 'flood', 'collapse', 'dynasty', 'migration', 'cession'];
const GROUPS: ProposalGroup[] = ['realm', 'dynasty', 'ruler', 'war', 'treaty', 'ruin'];

const btn = 'rounded bg-white/10 px-2 py-0.5 hover:bg-white/20 disabled:opacity-40';
const field = 'rounded bg-black/30 px-1.5 py-0.5 text-[11px] text-white outline-none ring-1 ring-white/10 focus:ring-amber-400/60';

/**
 * The history lens: settings and fixed facts, a year slider that redraws the
 * borders, the chronicle, realms, ruins, place names, and the Codex cards the
 * author may accept.
 */
export default function HistoryPanel({ lens, projectId, worldId, worldTitle, onFocus }: {
  lens: WorldHistoryLens;
  projectId: string;
  worldId: string;
  worldTitle: string;
  onFocus: (x: number, y: number) => void;
}) {
  const { t, locale } = useTranslation();
  const pane = useEnginePane(), navigate = useEraNavigate();
  const lang: HistoryLang = locale === 'en' ? 'en' : 'es';
  const { history, names, input, record, year, setYear } = lens;
  const [draft, setDraft] = useState<HistorySettings>(record.settings);
  useEffect(() => setDraft(record.settings), [record.settings]);
  const [tab, setTab] = useState<Tab>('events');
  const [linkedEvent, setLinkedEvent] = useState<string | null>(null);
  const ruinCards = useLiveQuery(
    () => tab === 'ruins' ? acceptedKeys(record, { projectId, eraId: lens.eraId }) : new Set<string>(),
    [tab, record, projectId, lens.eraId],
  );
  const [kind, setKind] = useState<HistoryEventKind | ''>('');
  const [untilYear, setUntilYear] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedRevision, setSavedRevision] = useState<number>();
  const refreshing = lens.pending || (savedRevision !== undefined && record.revision < savedRevision);
  useEffect(() => {
    if (savedRevision !== undefined && record.revision >= savedRevision) setSavedRevision(undefined);
  }, [record.revision, savedRevision]);

  const save = async (patch: Partial<HistorySettings>) => {
    setBusy(true);
    try {
      const { record: saved } = await saveHistorySettings(projectId, worldId, patch, lens.eraId);
      setSavedRevision(saved.revision);
      toast.success(t('worldgen.history.simulated'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };

  useEffect(() => {
    if (!playing || !history) return;
    const timer = window.setInterval(() => {
      if (year >= history.endYear) { setPlaying(false); return; }
      setYear(Math.min(history.endYear, year + Math.max(history.step, Math.round((history.endYear - history.startYear) / 120 / history.step) * history.step)));
    }, 250);
    return () => window.clearInterval(timer);
  }, [playing, year, history, setYear]);

  const at = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const p of input?.places ?? []) m.set(p.key, { x: p.x, y: p.y });
    for (const r of input?.ruins ?? []) m.set(r.key, { x: r.x, y: r.y });
    return m;
  }, [input]);
  const focusPlace = (key?: string) => { const p = key ? at.get(key) : undefined; if (p) onFocus(p.x, p.y); };

  const settingsForm = (
    <div className="grid grid-cols-2 gap-1.5" data-testid="history-settings">
      <label className="col-span-2 flex items-center gap-1">
        <span className="w-24 text-white/60">{t('worldgen.history.seed')}</span>
        <input data-testid="history-seed" className={`${field} min-w-0 flex-1`} value={draft.seed} onChange={(e) => setDraft({ ...draft, seed: e.target.value })} />
        <button type="button" className={btn} title={t('worldgen.history.randomSeed')} aria-label={t('worldgen.history.randomSeed')}
          onClick={() => setDraft({ ...draft, seed: Math.random().toString(36).slice(2, 10) })}><Dices size={12} /></button>
      </label>
      <label className="col-span-2 flex items-center gap-1">
        <span className="w-24 text-white/60">{t('worldgen.history.centuries')}</span>
        <input type="range" min={HISTORY_LIMITS.centuries.min} max={HISTORY_LIMITS.centuries.max} value={draft.centuries} className="flex-1"
          onChange={(e) => setDraft({ ...draft, centuries: Number(e.target.value) })} />
        <input data-testid="history-centuries" type="number" min={HISTORY_LIMITS.centuries.min} max={HISTORY_LIMITS.centuries.max} className={`${field} w-12`} value={draft.centuries}
          onChange={(e) => setDraft({ ...draft, centuries: Number(e.target.value) })} />
      </label>
      <label className="col-span-2 flex items-center gap-1">
        <span className="w-24 text-white/60">{t('worldgen.history.aggression')}</span>
        <input data-testid="history-aggression" type="range" min={0} max={100} value={Math.round(draft.aggression * 100)} className="flex-1"
          onChange={(e) => setDraft({ ...draft, aggression: Number(e.target.value) / 100 })} />
        <span className="w-8 text-right tabular-nums">{Math.round(draft.aggression * 100)}</span>
      </label>
      <label className="col-span-2 flex items-center gap-1">
        <span className="w-24 text-white/60">{t('worldgen.history.endYear')}</span>
        <input data-testid="history-end-year" type="number" className={`${field} w-20`} value={draft.endYear} onChange={(e) => setDraft({ ...draft, endYear: Number(e.target.value) })} />
        <button type="button" data-testid="history-simulate" disabled={busy} onClick={() => void save({ seed: draft.seed, centuries: draft.centuries, aggression: draft.aggression, endYear: draft.endYear })}
          className="ml-auto rounded bg-amber-400/85 px-2 py-0.5 font-medium text-black disabled:opacity-40">{t('worldgen.history.simulate')}</button>
      </label>
    </div>
  );

  if (!history || !names || !input) {
    return (
      <div className="flex flex-col gap-2 text-[11px] text-white/80" data-testid="history-panel">
        {settingsForm}
        <p className="text-white/45">{lens.pending ? t('worldgen.history.building') : t('worldgen.history.needsPlaces')}</p>
      </div>
    );
  }

  const ctx: TabCtx = { lens, projectId, worldId, lang, busy: busy || refreshing, setBusy, save, history, names, input };
  const standing = politiesAt(history, year);
  const summary = fill(t('worldgen.history.summary'), { realms: history.polities.length, events: history.events.length, ruins: history.ruins.length });
  return (
    <div className="flex flex-col gap-2 text-[11px] text-white/80" data-testid="history-panel">
      {settingsForm}
      <p className="text-white/50" data-testid="history-summary">{summary}{lens.pending ? ` · ${t('worldgen.history.building')}` : ''}</p>
      <div className="flex items-center gap-1.5">
        <button type="button" className={btn} data-testid="history-play" aria-label={playing ? t('worldgen.history.pause') : t('worldgen.history.play')}
          onClick={() => { if (year >= history.endYear) setYear(history.startYear); setPlaying((p) => !p); }}>{playing ? <Pause size={12} /> : <Play size={12} />}</button>
        <input data-testid="history-year" type="range" min={history.startYear} max={history.endYear} step={1} value={year} className="flex-1"
          aria-label={t('worldgen.history.year')} onChange={(e) => { setPlaying(false); setYear(Number(e.target.value)); }} />
        <span className="w-28 text-right tabular-nums text-amber-200" data-testid="history-year-label">{names.year(year)}</span>
      </div>
      <div>
        <div className="mb-0.5 text-white/50">{t('worldgen.history.standing')}</div>
        <div className="flex flex-wrap gap-1" data-testid="history-standing">
          {standing.map((p) => (
            <button key={p.key} type="button" onClick={() => { lens.setFocus(lens.focus === p.key ? null : p.key); focusPlace(p.seat); }}
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${lens.focus === p.key ? 'bg-white/25' : 'bg-white/10 hover:bg-white/20'}`}>
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: `hsl(${p.hue} 60% 50%)` }} />{p.name}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-white/10 pb-1" role="tablist">
        {TABS.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} data-testid={`history-tab-${id}`} onClick={() => setTab(id)}
            className={`rounded px-1.5 py-0.5 ${tab === id ? 'bg-amber-400/80 text-black' : 'bg-white/5 hover:bg-white/15'}`}>{t(`worldgen.history.tab.${id}`)}</button>
        ))}
      </div>
      {tab === 'events' && chronicle()}
      {tab === 'realms' && realmList()}
      {tab === 'ruins' && ruinList()}
      {tab === 'names' && nameList()}
      {tab === 'pins' && <PinsTab ctx={ctx} />}
      {tab === 'cards' && <CardsTab ctx={ctx} />}
    </div>
  );

  function chronicle() {
    const shown = history!.events.filter((e) => (!kind || e.kind === kind) && (!untilYear || e.year <= year));
    const linked = shown.find((e) => e.id === linkedEvent);
    const list = shown.slice(-250).reverse();
    if (linked && !list.includes(linked)) list.push(linked);
    const canTimeline = lens.enabledEngines.includes('timeline');
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1">
          <select className={field} value={kind} onChange={(e) => { setLinkedEvent(null); setKind(e.target.value as HistoryEventKind | ''); }} data-testid="history-kind">
            <option value="">{t('worldgen.history.allKinds')}</option>
            {KINDS.map((k) => <option key={k} value={k}>{t(`worldgen.history.kind.${k}`)}</option>)}
          </select>
          <label className="flex items-center gap-1"><input type="checkbox" checked={untilYear} onChange={(e) => setUntilYear(e.target.checked)} />{t('worldgen.history.untilYear')}</label>
        </div>
        <button type="button" className={btn} data-testid="history-to-timeline" disabled={busy || refreshing || !canTimeline} title={canTimeline ? undefined : t('worldgen.history.timelineOff')}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await sendHistoryToTimeline(projectId, worldId, history!, names!, lang, fill(t('worldgen.history.timelineTitle'), { world: worldTitle }), lens.eraId);
              toast.success(fill(t('worldgen.history.sentToTimeline'), { n: r.created.length }));
            } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
          }}>{t('worldgen.history.toTimeline')}</button>
        <ol className="max-h-72 overflow-y-auto" data-testid="history-events">
          {list.map((e) => (
            <li key={e.id} ref={e.id === linkedEvent ? (node) => node?.scrollIntoView({ block: 'nearest' }) : undefined}
              className={e.id === linkedEvent ? 'rounded bg-white/15' : undefined}>
              <button type="button" className="flex w-full gap-2 rounded px-1 py-0.5 text-left hover:bg-white/10" onClick={() => { setYear(e.year); focusPlace(e.toPlace ?? e.place); }}>
                <span className="w-24 shrink-0 tabular-nums text-white/50">{names!.year(e.year)}</span>
                <span className={e.pinned ? 'text-amber-200' : ''}>{eventText(e, names!, lang)}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  function realmList() {
    return (
      <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto" data-testid="history-realms">
        {history!.polities.map((p) => (
          <li key={p.key} className="rounded bg-white/5 p-1.5">
            <div className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: `hsl(${p.hue} 60% 50%)` }} />
              <button type="button" className="font-medium hover:underline" onClick={() => { setYear(p.founded); lens.setFocus(p.key); focusPlace(p.seat); }}>{p.name}</button>
              <span className="text-white/50">{names!.year(p.founded)} – {p.fell === undefined ? t('worldgen.history.stillStands') : names!.year(p.fell)}</span>
            </div>
            <div className="text-white/55">{t('worldgen.history.language')}: {names!.lang(p.langId)} · {names!.place(p.seat)}</div>
            <details>
              <summary className="cursor-pointer text-white/55">{t('worldgen.history.dynasties')} ({p.dynasties.length})</summary>
              {p.dynasties.map((d) => (
                <div key={d.key} className="pl-2">
                  <span className="text-white/80">{d.name}</span> <span className="text-white/45">{names!.year(d.from)} – {names!.year(d.to)}</span>
                  <div className="pl-2 text-white/50">{d.rulers.map((r) => r.name).join(', ')}</div>
                </div>
              ))}
            </details>
            <button type="button" className={`${btn} mt-1`} disabled={busy} onClick={() => {
              const pin: HistoryPin = { id: `pin-${Date.now().toString(36)}`, kind: 'realm-exists', polity: p.key, year };
              void save({ pins: [...record.settings.pins, pin] });
            }}>{t('worldgen.history.pinRealmHere')} ({names!.year(year)})</button>
          </li>
        ))}
      </ul>
    );
  }

  function ruinList() {
    if (!history!.ruins.length) return <p className="text-white/45">{t('worldgen.history.noRuins')}</p>;
    return (
      <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto" data-testid="history-ruins">
        {history!.ruins.map((r) => {
          const realmKey = `realm:${r.polity}`;
          const cardId = r.polity && ruinCards?.has(realmKey) ? record.accepted[realmKey] : undefined;
          return (
            <li key={r.ruin} className="rounded bg-white/5 p-1">
              <button type="button" className="w-full rounded text-left hover:bg-white/10" onClick={() => { setYear(Math.max(history!.startYear, r.fell - 1)); focusPlace(r.ruin); }}>
                <span className="font-medium">{r.name}</span>{' '}
                <span className="text-white/55">{names!.year(r.founded)} ? {names!.year(r.fell)}</span>
                <div className="text-white/60">{t('worldgen.history.cause')}: {ruinCauseText(r.cause, lang)}{r.by ? ` ${t('worldgen.history.by')} ${names!.polity(r.by)}` : ''}{r.polity ? ` ? ${names!.polity(r.polity)}` : ''}</div>
              </button>
              <div className="mt-1 flex flex-wrap gap-1">
                <button type="button" className={btn} onClick={() => {
                  setYear(r.fell);
                  setKind('');
                  setLinkedEvent(r.eventId);
                  setTab('events');
                  focusPlace(r.ruin);
                }}>{historyActions[lang].openRuinEvent}</button>
                {cardId && lens.enabledEngines.includes('codex') && <button type="button" className={btn} onClick={() => {
                  const query = new URLSearchParams({ entry: cardId });
                  if (lens.eraId) query.set('era', lens.eraId);
                  const destination = `/project/${encodeURIComponent(projectId)}/codex?${query}`;
                  if (pane?.navigate) pane.navigate(destination); else navigate(destination);
                }}>{historyActions[lang].openRealmCard}</button>}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  function nameList() {
    if (!history!.toponyms.length) return <p className="text-white/45">{t('worldgen.history.noNames')}</p>;
    return (
      <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto" data-testid="history-names">
        {history!.toponyms.map((n) => (
          <li key={n.place}>
            <button type="button" className="w-full rounded bg-white/5 p-1 text-left hover:bg-white/10" onClick={() => focusPlace(n.place)}>
              {fill(t('worldgen.history.substrate'), { name: n.name, lang: names!.lang(n.langId), ruler: names!.lang(n.rulerLangId), since: names!.year(n.since) })}
              {n.alternative ? <div className="text-white/50">{fill(t('worldgen.history.alternative'), { name: n.alternative })}</div> : null}
            </button>
          </li>
        ))}
      </ul>
    );
  }

}


interface TabCtx {
  lens: WorldHistoryLens;
  projectId: string;
  worldId: string;
  lang: HistoryLang;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  save: (patch: Partial<HistorySettings>) => Promise<void>;
  history: NonNullable<WorldHistoryLens['history']>;
  names: NonNullable<WorldHistoryLens['names']>;
  input: NonNullable<WorldHistoryLens['input']>;
}

function PinsTab({ ctx }: { ctx: TabCtx }) {
  const { t } = useTranslation();
  const { lens, history, names, input, busy, save, lang } = ctx;
  const { record, year } = lens;
  const [pinKind, setPinKind] = useState<HistoryPin['kind']>('city-falls');
  const [target, setTarget] = useState('');
  const [by, setBy] = useState('');
  const [pinYear, setPinYear] = useState(year);
  const places = [...input.places.map((p) => ({ key: p.key, name: p.name })), ...input.ruins.map((r) => ({ key: r.key, name: r.name }))].sort((a, b) => a.name.localeCompare(b.name));
  const realms = [...history.polities].sort((a, b) => a.name.localeCompare(b.name));
  const notes = history.notes.flatMap((note) => {
    if (!note.startsWith('pin:')) return [];
    const separator = note.lastIndexOf(':');
    return [{ id: note.slice(4, separator), reason: note.slice(separator + 1) }];
  });
  return (
    <div className="flex flex-col gap-1.5" data-testid="history-pins">
      {record.settings.pins.length ? (
        <ul className="flex flex-col gap-1">
          {record.settings.pins.map((p) => (
            <li key={p.id} className="flex items-center gap-1 rounded bg-white/5 p-1">
              <span className="flex-1">
                {t(`worldgen.history.pin.${p.kind}`)} {names.year(p.year)}: {p.kind === 'realm-exists' ? names.polity(p.polity) : `${names.place(p.place)}${p.by ? ` (${names.polity(p.by)})` : ''}`}
                {notes.filter((n) => n.id === p.id).map((n) => <div key={n.reason} className="text-amber-200/80">{historyPinNotes[lang][n.reason] ?? t(`worldgen.history.pinNote.${n.reason}`)}</div>)}
              </span>
              <button type="button" className={btn} disabled={busy} onClick={() => void save({ pins: record.settings.pins.filter((q) => q.id !== p.id) })}>{t('worldgen.history.removePin')}</button>
            </li>
          ))}
        </ul>
      ) : <p className="text-white/45">{t('worldgen.history.noPins')}</p>}
      <div className="flex flex-col gap-1 rounded bg-white/5 p-1.5">
        <select className={field} value={pinKind} data-testid="history-pin-kind" onChange={(e) => { setPinKind(e.target.value as HistoryPin['kind']); setTarget(''); }}>
          <option value="city-falls">{t('worldgen.history.pin.city-falls')}</option>
          <option value="realm-exists">{t('worldgen.history.pin.realm-exists')}</option>
        </select>
        <select className={field} value={target} data-testid="history-pin-target" onChange={(e) => setTarget(e.target.value)}
          aria-label={pinKind === 'realm-exists' ? t('worldgen.history.pinRealm') : t('worldgen.history.pinPlace')}>
          <option value="">{pinKind === 'realm-exists' ? t('worldgen.history.pinRealm') : t('worldgen.history.pinPlace')}</option>
          {pinKind === 'realm-exists'
            ? realms.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)
            : places.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
        </select>
        {pinKind === 'city-falls' && (
          <select className={field} value={by} onChange={(e) => setBy(e.target.value)} aria-label={t('worldgen.history.pinBy')}>
            <option value="">{t('worldgen.history.pinBy')}: {t('worldgen.history.anyone')}</option>
            {realms.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
        )}
        <div className="flex items-center gap-1">
          <span className="text-white/60">{t('worldgen.history.year')}</span>
          <input type="number" className={`${field} w-20`} value={pinYear} data-testid="history-pin-year" onChange={(e) => setPinYear(Number(e.target.value))} />
          <button type="button" className={`${btn} ml-auto`} disabled={busy || !target} data-testid="history-pin-add" onClick={() => {
            const id = `pin-${Date.now().toString(36)}`;
            const pin: HistoryPin = pinKind === 'realm-exists' ? { id, kind: pinKind, polity: target, year: pinYear } : { id, kind: pinKind, place: target, year: pinYear, ...(by ? { by } : {}) };
            void save({ pins: [...record.settings.pins, pin] });
          }}>{t('worldgen.history.addPin')}</button>
        </div>
      </div>
    </div>
  );
}

function CardsTab({ ctx }: { ctx: TabCtx }) {
  const { t } = useTranslation();
  const { lens, history, names, busy, setBusy, projectId, worldId, lang } = ctx;
  const { record } = lens;
  const all = useMemo(() => historyProposals(history, names, lang), [history, names, lang]);
  const [groups, setGroups] = useState<ProposalGroup[]>(['realm', 'dynasty', 'war', 'treaty', 'ruin']);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const done = useLiveQuery(() => acceptedKeys(record, { projectId, eraId: lens.eraId }), [record, projectId, lens.eraId]) ?? new Set<string>();
  const list = all.filter((p) => groups.includes(p.group));
  const open = list.filter((p) => !done.has(p.key));
  const canCodex = lens.enabledEngines.includes('codex');
  const accept = async (keys: Set<string>) => {
    setBusy(true);
    try {
      const r = await acceptProposals(projectId, worldId, all.filter((p) => keys.has(p.key)), lens.eraId);
      toast.success(fill(t('worldgen.history.acceptedToast'), { n: r.created.length }));
      setPicked(new Set());
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-1" data-testid="history-cards">
      <p className="text-white/50">{canCodex ? t('worldgen.history.cardsHint') : t('worldgen.history.codexOff')}</p>
      <div className="flex flex-wrap gap-1">
        {GROUPS.map((g) => (
          <label key={g} className="flex items-center gap-1 rounded bg-white/5 px-1">
            <input type="checkbox" checked={groups.includes(g)} onChange={(e) => setGroups(e.target.checked ? [...groups, g] : groups.filter((x) => x !== g))} />
            {t(`worldgen.history.group.${g}`)}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        <button type="button" className={btn} data-testid="history-accept-selected" disabled={busy || !canCodex || !picked.size} onClick={() => void accept(picked)}>{fill(t('worldgen.history.acceptSelected'), { n: picked.size })}</button>
        <button type="button" className={btn} data-testid="history-accept-all" disabled={busy || !canCodex || !open.length} onClick={() => void accept(new Set(open.map((p) => p.key)))}>{fill(t('worldgen.history.acceptAll'), { n: open.length })}</button>
      </div>
      <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
        {list.slice(0, 400).map((p) => (
          <li key={p.key} className="flex items-start gap-1 rounded px-1 py-0.5 hover:bg-white/5">
            <input type="checkbox" className="mt-0.5" disabled={done.has(p.key)} checked={done.has(p.key) || picked.has(p.key)} aria-label={p.title}
              onChange={(e) => { const next = new Set(picked); if (e.target.checked) next.add(p.key); else next.delete(p.key); setPicked(next); }} />
            <span className="flex-1">
              <span className="font-medium">{p.title}</span> <span className="text-white/45">{t(`worldgen.history.group.${p.group}`)}</span>
              {done.has(p.key) ? <span className="ml-1 text-emerald-300/80">{t('worldgen.history.accepted')}</span> : null}
              <div className="text-white/50">{p.paragraphs[0]}</div>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
