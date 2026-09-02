import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Crosshair, ExternalLink, Globe, Plus, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import TagInput from '@/components/common/TagInput';
import { toast } from '@/components/common/toast';
import AnnotationSurface from '@/engines/annotations/components/AnnotationSurface';
import { getAnchorAdapter, navigateTo } from '@/engines/_shared/anchoring';
import { findPlaceAppearances, MIN_APPEARANCE_NAME_LENGTH, useAppearanceWritings } from '../appearances';
import { ATLAS_PLACE_KINDS, type AtlasDivergence, type AtlasPlace, type AtlasPlaceKind } from '../types';
import { GEOCODE_MAX_QUERY_LENGTH, parseNominatimResults, type GeocodeHit } from '../geocode';
import { loadAtlasMapPrefs, saveAtlasMapPrefs } from '../mapPrefs';
import { consumePick } from './picks';
import { EditorHeader, Field, inputClass, labelClass, selectClass, textareaClass } from './fields';
import { useRowDraft } from './useRowDraft';

/** What the inputs hold: strings where the row has numbers or lists. */
interface PlaceDraft {
  name: string;
  kind: AtlasPlaceKind;
  aliases: string[];
  country: string;
  address: string;
  lat: string;
  lon: string;
  parentId: string;
  era: string;
  fictional: boolean;
  description: string;
  realNotes: string;
  sources: string;
  tags: string[];
}

function toDraft(place: AtlasPlace): PlaceDraft {
  return {
    name: place.name,
    kind: place.kind,
    aliases: place.aliases,
    country: place.country ?? '',
    address: place.address ?? '',
    lat: place.lat === undefined ? '' : String(place.lat),
    lon: place.lon === undefined ? '' : String(place.lon),
    parentId: place.parentId ?? '',
    era: place.era ?? '',
    fictional: place.fictional,
    description: place.description,
    realNotes: place.realNotes,
    sources: place.sources.join('\n'),
    tags: place.tags,
  };
}

/** '' → unset; a finite number within ±limit → itself; anything else → NaN, which Save refuses. */
function parseCoord(text: string, limit: number): number | undefined {
  if (text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : NaN;
}

// Optional fields go back as `undefined`, not '': Dexie's update() deletes the
// key, so a cleared address does not linger as an empty string in backups.
function fromDraft(draft: PlaceDraft, untitled: string): Partial<AtlasPlace> {
  return {
    name: draft.name.trim() || untitled,
    kind: draft.kind,
    aliases: draft.aliases,
    country: draft.country.trim() || undefined,
    address: draft.address.trim() || undefined,
    lat: parseCoord(draft.lat, 90),
    lon: parseCoord(draft.lon, 180),
    parentId: draft.parentId || undefined,
    era: draft.era.trim() || undefined,
    fictional: draft.fictional,
    description: draft.description,
    realNotes: draft.realNotes,
    sources: draft.sources.split('\n').map((line) => line.trim()).filter(Boolean),
    tags: draft.tags,
  };
}

/** The place and everything below it: a place cannot sit inside itself or inside its own child. */
function subtreeOf(rootId: string, places: AtlasPlace[]): Set<string> {
  const ids = new Set([rootId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const place of places) {
      if (place.parentId && ids.has(place.parentId) && !ids.has(place.id)) {
        ids.add(place.id);
        grew = true;
      }
    }
  }
  return ids;
}

function CoordInput({ value, limit, label, invalid, onChange }: {
  value: string; limit: number; label: string; invalid: boolean; onChange: (value: string) => void;
}) {
  return (
    <div className="w-36">
      <input
        type="number" step="any" min={-limit} max={limit}
        value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={label} aria-label={label}
        className={`${inputClass} ${invalid ? 'border-danger' : ''}`}
      />
    </div>
  );
}

/** How long the name field rests before the manuscript is searched for it (ms). */
const APPEARANCE_DEBOUNCE_MS = 300;

/**
 * The value as it stood `delayMs` ago: the name being typed, settled. The
 * manuscript scan is cheap but not free, and a keystroke is not a name.
 */
function useSettled(value: string, delayMs: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

/**
 * The chapters that name the place, each one a jump to the chapter — the
 * Codex's "appears in", for a place. Name and aliases; the name only once it
 * has rested and is long enough to mean something.
 */
function AppearsIn({ projectId, name, aliases }: { projectId: string; name: string; aliases: string[] }) {
  const { t } = useTranslation();
  const settledName = useSettled(name, APPEARANCE_DEBOUNCE_MS);
  const { items: writings } = useAppearanceWritings(projectId);
  // A key rather than the array: a fresh `aliases` array with the same
  // names must not rescan the manuscript.
  const names = [settledName.trim().length >= MIN_APPEARANCE_NAME_LENGTH ? settledName : '', ...aliases].filter(Boolean);
  const namesKey = names.join('\u0000');
  const appearances = useMemo(
    () => findPlaceAppearances(namesKey ? namesKey.split('\u0000') : [], writings),
    [namesKey, writings],
  );

  // The same jump the Codex and global search make, so the chapter opens on
  // the chapter rather than on the list of them.
  const openWriting = (writingId: string) => {
    const adapter = getAnchorAdapter('writings');
    if (adapter) adapter.navigateToEntity(writingId, projectId);
    else navigateTo(`/project/${encodeURIComponent(projectId)}/writings?writing=${encodeURIComponent(writingId)}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted" data-testid="place-appears-in">
      <BookOpen size={12} className="text-accent-gold" />
      {appearances.length === 0 ? (
        <span className="text-text-dim">{t('realAtlas.place.appearsNowhere')}</span>
      ) : (
        <>
          <span>{t('realAtlas.place.appearsIn')}</span>
          {appearances.map((appearance) => (
            <button
              key={appearance.writingId}
              type="button"
              onClick={() => openWriting(appearance.writingId)}
              title={appearance.title}
              className="max-w-[12rem] truncate rounded-md border border-border bg-elevated px-2 py-0.5 text-text-primary transition hover:border-accent-gold/40 hover:text-accent-gold"
            >
              {appearance.chapter !== undefined
                ? t('realAtlas.place.chapterShort').replace('{n}', String(appearance.chapter))
                : appearance.title}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

/**
 * Where "find coordinates" is: a consent notice first, then the hits to pick
 * from. The search and its results carry the id of the place they were made
 * for: the engine remounts the editor per place, but should it ever reuse
 * one, an answer that arrives after the selection moved on is dropped rather
 * than offered for the wrong place.
 */
type Geocoding =
  | { kind: 'idle' }
  | { kind: 'consent' }
  | { kind: 'searching'; placeId: string }
  | { kind: 'results'; placeId: string; query: string; hits: GeocodeHit[] };

/** The desktop shell's geocoder, or null in the browser build (where the button does not exist). */
function geocoder() {
  return typeof window !== 'undefined' ? window.electronAPI?.atlas?.geocode ?? null : null;
}

/**
 * Coordinates clicked on the map for "pick on the map", delivered once per
 * `seq`. They land in the draft, not in the row: the author may have typed
 * into other fields meanwhile, and Save stays the only thing that writes.
 * The engine drops the pick once it is saved or the selection moves on, and
 * `seq` is unique for the session (`picks.ts`), so a remounted editor
 * cannot apply it a second time over a value the writer corrected by hand.
 */
export interface CoordinatePick {
  placeId: string;
  lat: number;
  lon: number;
  seq: number;
}


interface PlaceEditorProps {
  projectId: string;
  place: AtlasPlace;
  /** Every place of the project: the parent picker needs the siblings. */
  places: AtlasPlace[];
  /** Every divergence of the project; the editor picks out this place's. */
  divergences: AtlasDivergence[];
  onSave: (changes: Partial<AtlasPlace>) => Promise<void>;
  onDelete: () => Promise<void>;
  onAddDivergence: () => void;
  onOpenDivergence: (id: string) => void;
  /** Switch to the map and wait for a click that fills the coordinates. */
  onPickOnMap: () => void;
  coordinatePick: CoordinatePick | null;
}

export default function PlaceEditor({
  projectId, place, places, divergences, onSave, onDelete, onAddDivergence, onOpenDivergence, onPickOnMap, coordinatePick,
}: PlaceEditorProps) {
  const { t, locale } = useTranslation();
  const untitled = t('realAtlas.place.untitled');
  const { draft, patch, changes, dirty } = useRowDraft(place, toDraft, (d) => fromDraft(d, untitled));
  const [geocoding, setGeocoding] = useState<Geocoding>({ kind: 'idle' });
  const geocode = geocoder();
  // Render-adjust: a search or its results belong to one place. Should the
  // editor be shown another place, they are forgotten before they can be
  // offered for it (the engine keys the editor by place, so this is the belt
  // to that pair of braces).
  if ('placeId' in geocoding && geocoding.placeId !== place.id) setGeocoding({ kind: 'idle' });

  // Render-adjust, like the draft itself: the pick is applied exactly once,
  // and only to the place it was made for. `consumePick` remembers across
  // remounts; the local state keeps a re-render (or StrictMode's second
  // render) from asking it twice for the same pick.
  const [appliedPick, setAppliedPick] = useState(0);
  if (coordinatePick && coordinatePick.seq !== appliedPick && coordinatePick.placeId === place.id) {
    setAppliedPick(coordinatePick.seq);
    if (consumePick(coordinatePick)) patch({ lat: String(coordinatePick.lat), lon: String(coordinatePick.lon) });
  }
  const pickedUnsaved = coordinatePick !== null && coordinatePick.placeId === place.id
    && draft.lat === String(coordinatePick.lat) && draft.lon === String(coordinatePick.lon)
    && (place.lat !== coordinatePick.lat || place.lon !== coordinatePick.lon);

  const latInvalid = Number.isNaN(changes.lat);
  const lonInvalid = Number.isNaN(changes.lon);
  const hasCoords = changes.lat !== undefined && changes.lon !== undefined && !latInvalid && !lonInvalid;
  const excluded = subtreeOf(place.id, places);
  const here = divergences.filter((d) => d.placeId === place.id);

  // window.open, not <a href>: Electron's window-open handler hands http(s) to
  // the OS browser, whereas a plain link would navigate the app shell itself.
  const openInOsm = () => {
    const { lat, lon } = changes;
    window.open(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=14/${lat}/${lon}`, '_blank', 'noopener');
  };

  /** What Nominatim is asked: the name and, when the writer gave one, the country — the address would over-constrain a historical place. */
  const geocodeQuery = () =>
    [draft.name.trim(), draft.country.trim()].filter(Boolean).join(', ').slice(0, GEOCODE_MAX_QUERY_LENGTH);

  const runGeocode = async () => {
    if (!geocode) return;
    const q = geocodeQuery();
    if (!q) {
      toast.info(t('realAtlas.geocode.needName'));
      return;
    }
    const placeId = place.id;
    setGeocoding({ kind: 'searching', placeId });
    // Only the search still pending for this place may settle the state: an
    // answer the writer cancelled meanwhile, or one for another place, is
    // stale and dropped.
    const settle = (next: Geocoding) => {
      setGeocoding((current) => (current.kind === 'searching' && current.placeId === placeId ? next : current));
    };
    try {
      const response = await geocode(q, locale);
      if (!response.ok) {
        toast.error(t('realAtlas.geocode.failed'));
        console.error('[real-atlas] geocode failed', response.code, response.error);
        settle({ kind: 'idle' });
        return;
      }
      const hits = parseNominatimResults(response.results);
      if (!hits.length) toast.info(t('realAtlas.geocode.noResults'));
      settle(hits.length ? { kind: 'results', placeId, query: q, hits } : { kind: 'idle' });
    } catch (error) {
      console.error('[real-atlas] geocode failed', error);
      toast.error(t('realAtlas.geocode.failed'));
      setGeocoding({ kind: 'idle' });
    }
  };

  /** The button: the first time in a project it asks before anything leaves the machine. */
  const startGeocode = async () => {
    const prefs = await loadAtlasMapPrefs(projectId);
    if (prefs.geocodeConsent) await runGeocode();
    else setGeocoding({ kind: 'consent' });
  };

  const acceptGeocode = async () => {
    await saveAtlasMapPrefs(projectId, { geocodeConsent: true });
    await runGeocode();
  };

  /** A hit goes into the draft like a pick on the map does; the country only fills an empty field. */
  const chooseHit = (hit: GeocodeHit) => {
    patch({
      lat: String(hit.lat),
      lon: String(hit.lon),
      ...(hit.country && !draft.country.trim() ? { country: hit.country } : {}),
    });
    setGeocoding({ kind: 'idle' });
  };

  return (
    <div className="space-y-5">
      <EditorHeader
        title={changes.name ?? ''}
        saveLabel={t('realAtlas.place.save')}
        canSave={dirty && !latInvalid && !lonInvalid}
        onSave={async () => {
          await onSave(changes);
          toast.success(t('realAtlas.place.saved'));
        }}
        deleteLabel={t('realAtlas.place.delete')}
        deleteConfirm={t('realAtlas.place.deleteConfirm')}
        onDelete={onDelete}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t('realAtlas.place.name')} className="sm:col-span-2">
          <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} className={inputClass} />
        </Field>
        <Field label={t('realAtlas.place.kind')}>
          <select value={draft.kind} onChange={(e) => patch({ kind: e.target.value as AtlasPlaceKind })} className={selectClass}>
            {ATLAS_PLACE_KINDS.map((kind) => <option key={kind} value={kind}>{t(`realAtlas.kind.${kind}`)}</option>)}
          </select>
        </Field>
        <Field label={t('realAtlas.place.parent')}>
          <select value={draft.parentId} onChange={(e) => patch({ parentId: e.target.value })} className={selectClass}>
            <option value="">{t('realAtlas.place.noParent')}</option>
            {places.filter((p) => !excluded.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label={t('realAtlas.place.aliases')} className="sm:col-span-2">
          <TagInput tags={draft.aliases} onChange={(aliases) => patch({ aliases })} placeholder={t('realAtlas.place.aliasesPlaceholder')} />
        </Field>
        <div className="sm:col-span-2">
          <AppearsIn projectId={projectId} name={draft.name} aliases={draft.aliases} />
        </div>
        <Field label={t('realAtlas.place.country')}>
          <input value={draft.country} onChange={(e) => patch({ country: e.target.value })} className={inputClass} />
        </Field>
        <Field label={t('realAtlas.place.address')}>
          <input value={draft.address} onChange={(e) => patch({ address: e.target.value })} className={inputClass} />
        </Field>
        <div className="sm:col-span-2">
          <span className={labelClass}>{t('realAtlas.place.coordinates')}</span>
          <div className="flex flex-wrap items-center gap-2">
            <CoordInput value={draft.lat} limit={90} label={t('realAtlas.place.lat')} invalid={latInvalid} onChange={(lat) => patch({ lat })} />
            <CoordInput value={draft.lon} limit={180} label={t('realAtlas.place.lon')} invalid={lonInvalid} onChange={(lon) => patch({ lon })} />
            <button
              type="button"
              onClick={onPickOnMap}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-muted transition hover:border-accent-gold/40 hover:text-text-primary"
            >
              <Crosshair size={12} />
              {t('realAtlas.map.pickOnMap')}
            </button>
            {geocode && (
              <button
                type="button"
                onClick={() => void startGeocode()}
                disabled={geocoding.kind === 'searching'}
                title={t('realAtlas.geocode.hint')}
                className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-muted transition hover:border-accent-gold/40 hover:text-text-primary disabled:cursor-wait disabled:opacity-60"
              >
                <Globe size={12} />
                {geocoding.kind === 'searching' ? t('realAtlas.geocode.searching') : t('realAtlas.geocode.find')}
              </button>
            )}
            {hasCoords && (
              <button type="button" onClick={openInOsm} className="flex items-center gap-1 text-xs text-accent-gold hover:underline">
                <ExternalLink size={12} />
                {t('realAtlas.place.openInOsm')}
              </button>
            )}
          </div>
          {pickedUnsaved && <p className="mt-1 text-xs text-accent-gold">{t('realAtlas.map.picked')}</p>}
          {geocoding.kind === 'consent' && (
            <div role="alertdialog" aria-label={t('realAtlas.geocode.find')} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-accent-gold/40 bg-elevated px-3 py-2">
              <p className="min-w-0 flex-1 text-xs text-text-primary">{t('realAtlas.geocode.consent')}</p>
              <button type="button" onClick={() => void acceptGeocode()} className="rounded-md bg-accent-gold px-2.5 py-1 text-xs font-semibold text-deep transition hover:bg-accent-amber">
                {t('realAtlas.geocode.accept')}
              </button>
              <button type="button" onClick={() => setGeocoding({ kind: 'idle' })} className="rounded-md border border-border px-2.5 py-1 text-xs text-text-muted transition hover:text-text-primary">
                {t('common.cancel')}
              </button>
            </div>
          )}
          {geocoding.kind === 'results' && (
            <div className="mt-2 rounded-lg border border-border bg-elevated">
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
                <p className="min-w-0 truncate text-[11px] uppercase tracking-wide text-text-dim" title={geocoding.query}>
                  {t('realAtlas.geocode.resultsFor').replace('{query}', () => geocoding.query)}
                </p>
                <button type="button" onClick={() => setGeocoding({ kind: 'idle' })} aria-label={t('common.close')} title={t('common.close')} className="text-text-dim transition hover:text-text-primary"><X size={13} /></button>
              </div>
              <ul>
                {geocoding.hits.map((hit, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => chooseHit(hit)} className="flex w-full items-start gap-2 px-3 py-1.5 text-left transition hover:bg-accent-gold/10">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-text-primary">{hit.name}</span>
                        <span className="block text-[10px] uppercase tracking-wide text-text-dim">{hit.kind}{hit.country ? ` · ${hit.country}` : ''}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-text-muted">{hit.lat}, {hit.lon}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="border-t border-border px-3 py-1 text-[10px] text-text-dim">{t('realAtlas.geocode.attribution')}</p>
            </div>
          )}
        </div>
        <Field label={t('realAtlas.place.era')}>
          <input value={draft.era} onChange={(e) => patch({ era: e.target.value })} placeholder={t('realAtlas.place.eraPlaceholder')} className={inputClass} />
        </Field>
        <label className="flex items-start gap-2 cursor-pointer sm:pt-6">
          <input type="checkbox" checked={draft.fictional} onChange={(e) => patch({ fictional: e.target.checked })} className="mt-1 accent-accent-gold" />
          <span>
            <span className="block text-sm text-text-primary">{t('realAtlas.place.fictional')}</span>
            <span className="block text-xs text-text-dim">{t('realAtlas.place.fictionalHint')}</span>
          </span>
        </label>
        <Field label={t('realAtlas.place.description')} className="sm:col-span-2">
          <textarea rows={4} value={draft.description} onChange={(e) => patch({ description: e.target.value })} placeholder={t('realAtlas.place.descriptionPlaceholder')} className={textareaClass} />
        </Field>
        <Field label={t('realAtlas.place.realNotes')} className="sm:col-span-2">
          <textarea rows={4} value={draft.realNotes} onChange={(e) => patch({ realNotes: e.target.value })} placeholder={t('realAtlas.place.realNotesPlaceholder')} className={textareaClass} />
        </Field>
        <Field label={t('realAtlas.place.sources')} className="sm:col-span-2">
          <textarea rows={3} value={draft.sources} onChange={(e) => patch({ sources: e.target.value })} placeholder={t('realAtlas.place.sourcesPlaceholder')} className={textareaClass} />
        </Field>
        <Field label={t('realAtlas.place.tags')} className="sm:col-span-2">
          <TagInput tags={draft.tags} onChange={(tags) => patch({ tags })} />
        </Field>
      </div>

      <section className="border-t border-border pt-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className={labelClass}>{t('realAtlas.place.divergencesHere')}</h3>
          <button
            type="button"
            onClick={onAddDivergence}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-accent-gold/10 text-accent-gold rounded-lg hover:bg-accent-gold/20 transition"
          >
            <Plus size={12} />
            {t('realAtlas.divergences.new')}
          </button>
        </div>
        {here.length === 0 ? (
          <p className="text-sm text-text-dim">{t('realAtlas.place.noDivergences')}</p>
        ) : (
          <ul className="space-y-1">
            {here.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => onOpenDivergence(d.id)}
                  className="w-full text-left px-3 py-2 rounded-lg border border-border bg-elevated hover:border-accent-gold/40 transition"
                >
                  <span className="block truncate text-sm text-text-primary">{d.title}</span>
                  <span className="block text-[10px] uppercase tracking-wide text-text-dim">
                    {t(`realAtlas.category.${d.category}`)}{d.since ? ` · ${d.since}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="pt-2 border-t border-border">
        <AnnotationSurface projectId={projectId} engineId="real-atlas" entityId={place.id} layout="stack" />
      </div>
    </div>
  );
}
