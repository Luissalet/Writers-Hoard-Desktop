import { useEffect, useMemo, useRef, useState } from 'react';
import { saveAs } from 'file-saver';
import { useLiveQuery } from 'dexie-react-hooks';
import { Map as MapIcon } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { useTranslation } from '@/i18n/useTranslation';
import { WorldDateField } from '@/engines/timeline/components/WorldDateField';
import { useWorldCalendar, worldDateText } from '@/engines/timeline/useWorldCalendar';
import { parseWorldDate } from '@/engines/timeline/worldCalendar';
import { useEraNavigate } from '@/services/worldEras/navigation';
import { listEraRows } from '@/services/worldEras/store';
import type { WorldEraScope } from '@/services/worldEras/types';
import type { CodexEntry, Writing } from '@/types';
import { generateId } from '@/utils/idGenerator';
import { THEMES } from '../cartography/theme';
import { FOG_OPS, fogChapters, type FogOp } from '../core/readerFog';
import type { GeneratedWorld } from '../types';
import { inWorldMapCopy } from './copy';
import { exportPlate } from './export';
import { mapOrigins } from './knowledge';
import { insertMapPlate } from './manuscript';
import { PLATE_WIDTH } from './plate';
import { openCartographerSource, plateForMap, routesForMap, type CartographerSource } from './source';
import { changeInWorldMap, defaultMapCalendars, MAX_MARKS, MAX_REACH, MIN_REACH, validateInWorldMap } from './store';
import { PLATE_FORMATS, type InWorldMap } from './types';

const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-elevated focus-visible:outline-accent-gold disabled:opacity-50';
const field = 'block w-full min-h-9 rounded-lg border border-border bg-elevated px-2 py-1 text-sm text-text-primary';
const label = 'min-w-0 space-y-1 text-xs text-text-muted';
const originValue = (key: InWorldMap['origin']) => key.kind + ':' + key.id;

interface Props {
  scope: WorldEraScope;
  row: GeneratedWorld;
  target: string | null;
  clearTarget: () => void;
}

export default function InWorldMapPanel({ scope, row, target, clearTarget }: Props) {
  const { locale } = useTranslation();
  const copy = inWorldMapCopy[locale];
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const active = target ?? selection;
  const closeCheck = useRef<(() => boolean) | null>(null);
  const allowLeave = () => closeCheck.current?.() ?? true;
  const close = () => { if (allowLeave()) { setOpen(false); setSelection(null); clearTarget(); } };
  const edit = (id: string | null) => {
    if (id === active || !allowLeave()) return;
    setOpen(true); clearTarget(); setSelection(id); setEditorVersion(version => version + 1);
  };
  return <>
    <button type="button" className={button} onClick={() => setOpen(true)} data-testid="in-world-maps">
      <MapIcon size={17} aria-hidden="true" />{copy.title}
      {!!row.inWorldMaps?.length && <span className="tabular-nums text-text-muted">{row.inWorldMaps.length}</span>}
    </button>
    <Modal open={open || !!target} onClose={close} title={copy.title} wide>
      {(open || target) && <div className="space-y-4">
        <nav className="flex flex-wrap gap-2" aria-label={copy.saved}>
          <button type="button" aria-pressed={!active} className={button} onClick={() => edit(null)}>{copy.newMap}</button>
          {row.inWorldMaps?.map(map => <button type="button" key={map.id} className={button} aria-pressed={map.id === active}
            onClick={() => edit(map.id)}>{map.title}</button>)}
        </nav>
        <MapEditor key={target ?? editorVersion} scope={scope} row={row} initial={row.inWorldMaps?.find(map => map.id === active)}
          closeCheck={closeCheck} onSaved={id => { setOpen(true); clearTarget(); setSelection(id); if (!id) setEditorVersion(version => version + 1); }} />
      </div>}
    </Modal>
  </>;
}

function MapEditor({ scope, row, initial, closeCheck, onSaved }: {
  scope: WorldEraScope; row: GeneratedWorld; initial?: InWorldMap;
  closeCheck: React.RefObject<(() => boolean) | null>; onSaved: (id: string | null) => void;
}) {
  const { locale } = useTranslation();
  const copy = inWorldMapCopy[locale];
  const navigate = useEraNavigate();
  const resolved = useWorldCalendar(scope.projectId);
  const calendar = resolved?.calendar ?? defaultMapCalendars[locale];
  const projectId = scope.projectId, eraId = scope.eraId;
  const [source, setSource] = useState<CartographerSource>();
  const [sourceError, setSourceError] = useState(false);
  const [sourceAttempt, retrySource] = useState(0);
  const [snapshot] = useState(row);
  const [base, setBase] = useState(initial ?? null);
  const [draft, setDraft] = useState<InWorldMap>(() => initial ?? {
    id: generateId('inworld-map'), title: copy.untitled, origin: { kind: 'culture', id: '' },
    date: { year: 1 }, reach: 0.11, distortion: 0.65, themeId: row.presentation?.theme ?? 'antique', marks: [],
  });
  const [dateText, setDateText] = useState<string>();
  const dateInput = dateText ?? worldDateText(calendar, draft.date);
  const [brush, setBrush] = useState<FogOp | ''>('');
  const [radius, setRadius] = useState(0);
  const [writingId, setWritingId] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [rendered, setRendered] = useState<InWorldMap>();
  const [routes, setRoutes] = useState<ReturnType<typeof routesForMap>>();
  const [plate, setPlate] = useState<ReturnType<typeof plateForMap>>();
  const [image, setImage] = useState('');
  const [mapPoint, setMapPoint] = useState({ x: 0.5, y: 0.5 });
  const entries = useLiveQuery(() => listEraRows<CodexEntry>(scope, 'codexEntries'), [scope.projectId, scope.eraId]) ?? [];
  const writings = (useLiveQuery(() => listEraRows<Writing>(scope, 'writings'), [scope.projectId, scope.eraId]) ?? [])
    .filter(writing => !writing.isGoogleDoc && !writing.manuscriptSource).sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0));
  const origins = useMemo(() => source ? mapOrigins(source.world) : [], [source]);
  const chapters = useMemo(() => source ? fogChapters(source.edits) : [], [source]);
  const currentDate = useMemo(() => parseWorldDate(calendar, dateInput), [calendar, dateInput]);
  const model = useMemo(() => currentDate ? {
    ...draft, title: draft.title.trim(), date: currentDate, origin: draft.origin.id ? draft.origin : origins[0]?.key ?? draft.origin,
  } : undefined, [draft, currentDate, origins]);

  useEffect(() => {
    let alive = true, timer: number | undefined;
    const load = async () => {
      try {
        const opened = await openCartographerSource(snapshot, { projectId, eraId });
        if (!alive) return;
        if (opened.ok) setSource(opened.source);
        else if (opened.code === 'generating') timer = window.setTimeout(() => void load(), 1400);
        else setSourceError(true);
      } catch { if (alive) setSourceError(true); }
    };
    timer = window.setTimeout(() => void load(), 25);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [snapshot, projectId, eraId, sourceAttempt]);

  useEffect(() => {
    if (!source || !initial || rendered || resolved === undefined) return;
    const timer = window.setTimeout(() => {
      try {
        validateInWorldMap(initial, calendar);
        const prepared = routesForMap(source, initial, calendar);
        setPlate(plateForMap(source, initial, calendar, locale, prepared));
        setRoutes(prepared); setRendered(initial);
      } catch { setStatus(copy.unavailable); }
    }, 25);
    return () => window.clearTimeout(timer);
  }, [calendar, copy.unavailable, initial, locale, rendered, resolved, source]);

  useEffect(() => {
    if (!plate) return;
    const url = URL.createObjectURL(new Blob([plate.svg], { type: 'image/svg+xml;charset=utf-8' }));
    setImage(url);
    return () => URL.revokeObjectURL(url);
  }, [plate]);

  const matches = !!rendered && JSON.stringify(rendered) === JSON.stringify(model);
  const dirty = base ? JSON.stringify(base) !== JSON.stringify(model) : !!rendered || !!dateText || draft.title !== copy.untitled
    || !!draft.origin.id || draft.marks.length > 0 || draft.entryId !== undefined || draft.chapter !== undefined
    || draft.reach !== 0.11 || draft.distortion !== 0.65 || draft.themeId !== (snapshot.presentation?.theme ?? 'antique');
  useEffect(() => {
    const check = () => !busy && (!dirty || window.confirm(copy.discard));
    closeCheck.current = check;
    return () => { if (closeCheck.current === check) closeCheck.current = null; };
  }, [busy, closeCheck, copy.discard, dirty]);

  function draw(map: InWorldMap, reuse = false) {
    if (!source) return;
    validateInWorldMap(map, calendar);
    const prepared = reuse && routes ? routes : routesForMap(source, map, calendar);
    setPlate(plateForMap(source, map, calendar, locale, prepared));
    setRoutes(prepared);
    setRendered(map);
  }

  async function update() {
    if (!source || !model || busy) return;
    setStatus(copy.updating); setBusy(true);
    await new Promise(resolve => window.setTimeout(resolve, 25));
    try {
      const reuse = !!rendered && originValue(rendered.origin) === originValue(model.origin)
        && JSON.stringify(rendered.date) === JSON.stringify(model.date) && rendered.reach === model.reach;
      draw(model, reuse); setStatus('');
    } catch { setStatus(copy.unavailable); }
    finally { setBusy(false); }
  }

  function correct(x: number, y: number) {
    if (!matches || !plate || !model || !brush || model.marks.length >= MAX_MARKS) return;
    const at = plate.unproject(x * PLATE_WIDTH, y * plate.height);
    if (!at) return;
    const next = { ...model, marks: [...model.marks, { ...at, radius: radius || defaultRadius, op: brush }] };
    setDraft(next); draw(next, true);
  }

  async function perform(action: () => Promise<void>, error: string) {
    setBusy(true); setStatus('');
    try { await action(); }
    catch { setStatus(error); }
    finally { setBusy(false); }
  }

  const defaultRadius = Math.max(3, Math.round((source?.world.data.width ?? 240) / 40));
  const updateDraft = (patch: Partial<InWorldMap>) => setDraft(current => ({ ...current, ...patch }));

  return <div className="space-y-4" data-testid="in-world-map-editor">
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className={label}>{copy.name}<input className={field} maxLength={120} value={draft.title} onChange={event => updateDraft({ title: event.target.value })} /></label>
      <label className={label}>{copy.origin}<select className={field} value={originValue(model?.origin ?? draft.origin)} onChange={event => {
        const origin = origins.find(candidate => originValue(candidate.key) === event.target.value);
        if (origin) updateDraft({ origin: origin.key });
      }}>
        {!origins.length && <option value={originValue(draft.origin)}>—</option>}
        {origins.length > 0 && !origins.some(origin => originValue(origin.key) === originValue(model?.origin ?? draft.origin)) && <option value={originValue(draft.origin)}>—</option>}
        <optgroup label={copy.culture}>{origins.filter(origin => origin.key.kind === 'culture').map(origin =>
          <option key={originValue(origin.key)} value={originValue(origin.key)}>{origin.name} · {origin.placeName}</option>)}</optgroup>
        <optgroup label={copy.place}>{origins.filter(origin => origin.key.kind === 'place').map(origin =>
          <option key={originValue(origin.key)} value={originValue(origin.key)}>{origin.name}</option>)}</optgroup>
      </select></label>
      <WorldDateField calendar={calendar} label={copy.date} value={dateInput} onChange={setDateText} testId="in-world-map-date" />
      <label className={label}>{copy.style}<select className={field} value={draft.themeId} onChange={event => updateDraft({ themeId: event.target.value })}>
        {THEMES.map(theme => <option key={theme.id} value={theme.id}>{copy.styles[theme.id as keyof typeof copy.styles]}</option>)}
      </select></label>
      <label className={label}>{copy.reach} · {Math.round(draft.reach * 100)} %
        <input className="block w-full accent-accent-gold" type="range" min={MIN_REACH} max={MAX_REACH} step=".005" value={draft.reach} onChange={event => updateDraft({ reach: Number(event.target.value) })} /></label>
      <label className={label}>{copy.distortion} · {Math.round(draft.distortion * 100)} %
        <input className="block w-full accent-accent-gold" type="range" min="0" max="1" step=".01" value={draft.distortion} onChange={event => updateDraft({ distortion: Number(event.target.value) })} /></label>
      <label className={label}>{copy.chapter}<select className={field} value={draft.chapter ?? ''} onChange={event => updateDraft({ chapter: event.target.value ? Number(event.target.value) : undefined })}>
        <option value="">{copy.noChapter}</option>
        {[...new Set([...(draft.chapter ? [draft.chapter] : []), ...chapters])].sort((a, b) => a - b).map(chapter => <option key={chapter}>{chapter}</option>)}
      </select></label>
      <div className="flex items-end gap-2">
        <label className={label + ' flex-1'}>{copy.card}<select className={field} value={draft.entryId ?? ''} onChange={event => updateDraft({ entryId: event.target.value || undefined })}>
          <option value="">{copy.noCard}</option>
          {entries.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
        </select></label>
        {entries.some(entry => entry.id === draft.entryId) && <button type="button" className={button} onClick={() => {
          if (closeCheck.current?.()) navigate('/project/' + encodeURIComponent(scope.projectId) + '/codex?entry=' + encodeURIComponent(draft.entryId!));
        }}>{copy.openCard}</button>}
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={button} disabled={busy || !model?.title.trim() || !origins.length} onClick={() => void update()}>{copy.preview}</button>
      <button type="button" className={button} disabled={busy || !matches || (!!base && !dirty)} onClick={() => void perform(async () => {
        if (!rendered) return;
        const next = rendered;
        await changeInWorldMap(scope, row.id, { id: next.id, before: base, after: next });
        setBase(next); setDraft(next); setRendered(next); setStatus(copy.savedNotice); onSaved(next.id);
      }, copy.saveError)}>{copy.save}</button>
      {base && <button type="button" className={button} disabled={busy} onClick={() => {
        if (window.confirm(copy.removeConfirm)) void perform(async () => {
          await changeInWorldMap(scope, row.id, { id: base.id, before: base, after: null });
          onSaved(null);
        }, copy.saveError);
      }}>{copy.remove}</button>}
      {!source && !sourceError && <span className="text-sm text-text-muted">{copy.pending}</span>}
      {sourceError && <button type="button" className={button} onClick={() => { setSourceError(false); retrySource(n => n + 1); }}>{copy.unavailable} ↻</button>}
      {source && !origins.length && <span className="text-sm text-text-muted">{copy.empty}</span>}
      {plate && !matches && !busy && <span className="text-sm text-text-muted">{copy.stale}</span>}
    </div>
    {plate && <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className={label}>{copy.brush}<select className={field} value={brush} onChange={event => setBrush(event.target.value as FogOp | '')}>
          <option value="">{copy.noBrush}</option>
          {FOG_OPS.map(op => <option key={op} value={op}>{copy[op]}</option>)}
        </select></label>
        {brush && <label className={label}>{copy.brushSize}<input className={field} type="number" min={1}
          max={Math.min(4096, (source?.world.data.width ?? 240) / 2)} value={radius || defaultRadius}
          onChange={event => setRadius(Math.max(1, Math.min(4096, Number(event.target.value) || 1)))} /></label>}
        <button type="button" className={button} disabled={busy || !matches || !model?.marks.length} onClick={() => {
          if (!model) return;
          const next = { ...model, marks: model.marks.slice(0, -1) }; setDraft(next); draw(next, true);
        }}>{copy.undo}</button>
      </div>
      {brush && <p className="text-xs text-text-muted">{copy.brushTip}</p>}
      {image && <div className="relative overflow-hidden rounded-lg border border-border">
        <img src={image} alt={rendered?.title ?? copy.title} className="block w-full" data-testid="in-world-map-plate" />
        {brush && <button type="button" aria-label={copy.brush} className="group absolute inset-0 cursor-crosshair focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-accent-gold"
          data-testid="in-world-map-brush-target"
          onClick={event => {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (event.detail === 0) correct(mapPoint.x, mapPoint.y);
            else correct((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
          }} onKeyDown={event => {
            const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
            if (!delta) return;
            event.preventDefault();
            setMapPoint(point => ({ x: Math.max(.04, Math.min(.96, point.x + delta[0] * .015)), y: Math.max(.18, Math.min(.94, point.y + delta[1] * .015)) }));
          }}>
          <span className="pointer-events-none absolute hidden h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/60 group-focus-visible:block"
            style={{ left: mapPoint.x * 100 + '%', top: mapPoint.y * 100 + '%' }} />
        </button>}
      </div>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
        <span>{copy.seen} · {Math.round(plate.shares.seen * 100)} %</span><span>{copy.heard} · {Math.round(plate.shares.heard * 100)} %</span>
        <span>{copy.hide} · {Math.round(plate.shares.hidden * 100)} %</span>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label={copy.download}>
          {PLATE_FORMATS.map(format => <button type="button" key={format} className={button} disabled={busy || !matches} onClick={() => {
            void perform(async () => { const exported = await exportPlate(plate, rendered!.title, format); saveAs(exported.blob, exported.filename); }, copy.exportError);
          }}>{format.toUpperCase()}</button>)}
        </div>
        <label className={label + ' min-w-36 flex-1'}>{copy.writing}<select className={field} value={writingId} onChange={event => setWritingId(event.target.value)}>
          <option value="">{copy.selectWriting}</option>
          {writings.map(writing => <option key={writing.id} value={writing.id}>{writing.chapter ? writing.chapter + " · " : ""}{writing.title}</option>)}
        </select></label>
        <button type="button" className={button} disabled={busy || !matches || !writingId} onClick={() => {
          void perform(async () => {
            const result = await insertMapPlate({ ...scope }, scope.projectId, writingId, rendered!.title, plate);
            setStatus((result as { inserted?: boolean }).inserted === false ? copy.alreadyInserted : copy.inserted);
          }, copy.insertError);
        }}>{copy.insert}</button>
      </div>
    </div>}
    {status && <p role="status" className="text-sm text-text-primary">{status}</p>}
  </div>;
}
