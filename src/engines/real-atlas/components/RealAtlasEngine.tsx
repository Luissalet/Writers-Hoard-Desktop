import { useMemo, useState, type ReactNode } from 'react';
import { MapPin, Plus, Search, Sparkles, Split } from 'lucide-react';
import type { EngineComponentProps } from '@/engines/_types';
import { EngineSpinner, useDeepLinkParam } from '@/engines/_shared';
import EmptyState from '@/components/common/EmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { generateId } from '@/utils/idGenerator';
import { foldForSearch } from '@/engines/worldgen/core/searchText';
import { useAtlasDivergences, useAtlasPlaces } from '../hooks';
import { ATLAS_PLACE_KINDS, type AtlasDivergence, type AtlasPlace, type AtlasPlaceKind } from '../types';
import type { LonLat } from '../geo';
import PlaceEditor, { type CoordinatePick } from './PlaceEditor';
import { nextPickSeq } from './picks';
import DivergenceEditor from './DivergenceEditor';
import AtlasMap, { type MapRequest } from './AtlasMap';
import { divergenceCountLabel } from './labels';

type Tab = 'places' | 'divergences' | 'map';
type KindFilter = AtlasPlaceKind | 'all';
interface PlaceRow { place: AtlasPlace; depth: number }

/**
 * Filter by name or alias (accent- and case-insensitive, same fold as the
 * worldgen index), then order as a tree: each place right after its parent,
 * indented, when the parent survived the filter; otherwise at the top level.
 * `seen` is insurance against a parent cycle in imported data — without it two
 * places pointing at each other would silently vanish from the list.
 */
function placeRows(places: AtlasPlace[], query: string, kind: KindFilter): PlaceRow[] {
  const q = foldForSearch(query.trim());
  const visible = places.filter((p) =>
    (kind === 'all' || p.kind === kind)
    && (!q || foldForSearch(p.name).includes(q) || p.aliases.some((alias) => foldForSearch(alias).includes(q))));
  const ids = new Set(visible.map((p) => p.id));
  const parentOf = (p: AtlasPlace) => (p.parentId && ids.has(p.parentId) ? p.parentId : undefined);
  const rows: PlaceRow[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | undefined, depth: number) => {
    for (const p of visible) {
      if (parentOf(p) !== parentId || seen.has(p.id)) continue;
      seen.add(p.id);
      rows.push({ place: p, depth });
      walk(p.id, depth + 1);
    }
  };
  walk(undefined, 0);
  for (const p of visible) if (!seen.has(p.id)) rows.push({ place: p, depth: 0 });
  return rows;
}

const rowClass = (active: boolean) =>
  `w-full text-left px-3 py-2 rounded-lg border transition ${
    active ? 'border-accent-gold bg-accent-gold/10' : 'border-border bg-elevated hover:border-accent-gold/40'
  }`;
const titleClass = (active: boolean) => `min-w-0 truncate text-sm ${active ? 'text-accent-gold' : 'text-text-primary'}`;
const metaClass = 'flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-text-dim';

function TabButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition ${
        active ? 'text-accent-gold border-b-2 border-accent-gold bg-accent-gold/5' : 'text-text-muted hover:text-text-primary'
      }`}
    >
      {label}
      <span className="text-xs text-text-dim">{count}</span>
    </button>
  );
}

function NewButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs bg-accent-gold/10 text-accent-gold rounded-lg hover:bg-accent-gold/20 transition"
    >
      <Plus size={13} />
      {label}
    </button>
  );
}

/** List on the left, editor (or a hint) on the right; stacked below `lg`. */
function Columns({ list, count, editor, hint }: { list: ReactNode; count: string; editor: ReactNode; hint: string }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4 items-start">
      <aside className="space-y-2">
        {list}
        <p className="text-xs text-text-dim">{count}</p>
      </aside>
      <section className="min-w-0">
        {editor ?? <p className="py-16 text-center text-sm text-text-dim">{hint}</p>}
      </section>
    </div>
  );
}

export default function RealAtlasEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const places = useAtlasPlaces(projectId);
  const divergences = useAtlasDivergences(projectId);
  const [tab, setTab] = useState<Tab>('places');
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [selectedDivergenceId, setSelectedDivergenceId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');

  // The map is mounted the first time its tab opens and kept mounted (hidden)
  // after that: its view, mode and loaded basemap survive a trip to the editor
  // and back. Requests travel to it as {placeId, seq} so each is applied once.
  const [mapVisited, setMapVisited] = useState(false);
  const [pickRequest, setPickRequest] = useState<MapRequest | null>(null);
  const [focusRequest, setFocusRequest] = useState<MapRequest | null>(null);
  const [coordinatePick, setCoordinatePick] = useState<CoordinatePick | null>(null);
  const openMap = () => {
    setMapVisited(true);
    setTab('map');
  };

  // Deep link (?place=<id>) from backlinks and global search. Render-adjust with
  // an `applied` guard, same as codex: the parameter stays in the URL, so without
  // it every re-render would drag the author back to the linked row. The anchor
  // adapter sends divergence ids through the same parameter. With the map open
  // the link centres and selects there instead of leaving for the list.
  const deepLinkedId = useDeepLinkParam('place');
  const [appliedDeepLink, setAppliedDeepLink] = useState<string | null>(null);
  if (deepLinkedId && deepLinkedId !== appliedDeepLink) {
    if (places.items.some((p) => p.id === deepLinkedId)) {
      setAppliedDeepLink(deepLinkedId);
      setSelectedPlaceId(deepLinkedId);
      if (tab === 'map') setFocusRequest({ placeId: deepLinkedId, seq: (focusRequest?.seq ?? 0) + 1 });
      else setTab('places');
    } else if (divergences.items.some((d) => d.id === deepLinkedId)) {
      setAppliedDeepLink(deepLinkedId);
      setSelectedDivergenceId(deepLinkedId);
      setTab('divergences');
    }
  }

  // Selection is an id, never a row: rows are replaced on every refresh. A
  // selection whose row is gone (deleted from the bridge, a project sweep) is
  // dropped rather than left pointing at nothing.
  const selectedPlace = places.items.find((p) => p.id === selectedPlaceId) ?? null;
  const selectedDivergence = divergences.items.find((d) => d.id === selectedDivergenceId) ?? null;
  if (selectedPlaceId && !selectedPlace && !places.loading) setSelectedPlaceId(null);
  if (selectedDivergenceId && !selectedDivergence && !divergences.loading) setSelectedDivergenceId(null);
  // A pick is for the place it was made for, while that place is the one
  // open: once the selection moves on it is dropped here, so the editor does
  // not find it again when it remounts and re-apply it over a corrected value.
  if (coordinatePick && coordinatePick.placeId !== selectedPlaceId) setCoordinatePick(null);

  const rows = useMemo(() => placeRows(places.items, query, kind), [places.items, query, kind]);

  /** A new row, from the list button (no coordinates) or from a click on the map (with them). */
  const createPlace = async (at?: LonLat) => {
    const now = Date.now();
    const place: AtlasPlace = {
      id: generateId('place'), projectId, name: t('realAtlas.place.untitled'), kind: 'city', aliases: [],
      ...(at ? { lat: Number(at.lat.toFixed(5)), lon: Number(at.lon.toFixed(5)) } : {}),
      description: '', realNotes: '', sources: [], fictional: false, tags: [], createdAt: now, updatedAt: now,
    };
    await places.addItem(place);
    // A filter that hides the row it just created would read as a failed click.
    setQuery('');
    setKind('all');
    setSelectedPlaceId(place.id);
    setTab('places');
  };

  const openPlaceEditor = (id: string) => {
    setSelectedPlaceId(id);
    setTab('places');
  };

  /** The editor asks for coordinates: the map takes over until the next click. */
  const pickOnMap = (placeId: string) => {
    setPickRequest({ placeId, seq: (pickRequest?.seq ?? 0) + 1 });
    openMap();
  };

  /**
   * The map answers a pick. Nothing is written: the coordinates go into the
   * editor's draft, so typed work there is not overwritten and Save stays the
   * one place a row changes from the editor.
   */
  const receivePick = (placeId: string, coords: LonLat) => {
    setCoordinatePick({ placeId, lat: Number(coords.lat.toFixed(5)), lon: Number(coords.lon.toFixed(5)), seq: nextPickSeq() });
    openPlaceEditor(placeId);
  };

  /** The editor's Save. The pick, if any, is in the row now (or was overridden by hand): either way it has been consumed. */
  const savePlace = async (id: string, changes: Partial<AtlasPlace>) => {
    await places.editItem(id, changes);
    setCoordinatePick(null);
  };

  /** A drag, "place on the map" or its undo: a direct write, rounded to about a metre. */
  const movePlace = (id: string, coords: LonLat | null) =>
    places.editItem(id, coords
      ? { lat: Number(coords.lat.toFixed(5)), lon: Number(coords.lon.toFixed(5)) }
      : { lat: undefined, lon: undefined });

  const createDivergence = async (placeId?: string) => {
    const now = Date.now();
    const row: AtlasDivergence = {
      id: generateId('divergence'), projectId, ...(placeId ? { placeId } : {}), title: t('realAtlas.divergence.untitled'),
      category: 'other', reality: '', fiction: '', reason: '', tags: [], createdAt: now, updatedAt: now,
    };
    await divergences.addItem(row);
    setSelectedDivergenceId(row.id);
    setTab('divergences');
  };

  const deletePlace = async (id: string) => {
    await places.removeItem(id);
    setSelectedPlaceId(null);
    // deleteAtlasPlace unanchors the place's divergences in the same
    // transaction; the divergences hook did not see that write.
    await divergences.refresh();
  };

  const openDivergence = (id: string) => {
    setSelectedDivergenceId(id);
    setTab('divergences');
  };

  // Initial load only — post-write refreshes never flip `loading` back.
  if (places.loading || divergences.loading) return <EngineSpinner />;

  const count = (key: string, n: number) => t(key).replace('{count}', String(n));
  const placeName = (id?: string) => places.items.find((p) => p.id === id)?.name;
  const located = places.items.filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number').length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">{t('realAtlas.intro')}</p>
      <div role="tablist" className="flex border-b border-border">
        <TabButton active={tab === 'places'} label={t('realAtlas.tabs.places')} count={places.items.length} onClick={() => setTab('places')} />
        <TabButton active={tab === 'divergences'} label={t('realAtlas.tabs.divergences')} count={divergences.items.length} onClick={() => setTab('divergences')} />
        <TabButton active={tab === 'map'} label={t('realAtlas.tabs.map')} count={located} onClick={openMap} />
      </div>

      {/* Both panels stay mounted and one is hidden: switching tabs (which the
          place editor itself does when adding a divergence) must not throw away
          a draft the author has not saved yet. */}
      <div role="tabpanel" hidden={tab !== 'places'}>
        {places.items.length === 0 ? (
          <EmptyState
            icon={<MapPin size={40} />}
            title={t('realAtlas.places.empty')}
            message={t('realAtlas.places.emptyHint')}
            action={{ label: t('realAtlas.places.new'), onClick: () => void createPlace() }}
          />
        ) : (
          <Columns
            count={count('realAtlas.places.count', rows.length)}
            hint={t('realAtlas.places.selectHint')}
            list={(
              <>
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('realAtlas.places.search')}
                    className="w-full pl-8 pr-3 py-1.5 bg-elevated border border-border rounded-lg text-sm text-text-primary placeholder:text-text-dim outline-none focus:border-accent-gold transition"
                  />
                </div>
                <div className="flex gap-2">
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as KindFilter)}
                    className="flex-1 min-w-0 px-2 py-1.5 text-xs bg-elevated border border-border rounded-lg text-text-muted outline-none focus:border-accent-gold transition cursor-pointer"
                  >
                    <option value="all">{t('realAtlas.places.allKinds')}</option>
                    {ATLAS_PLACE_KINDS.map((k) => <option key={k} value={k}>{t(`realAtlas.kind.${k}`)}</option>)}
                  </select>
                  <NewButton label={t('realAtlas.places.new')} onClick={() => void createPlace()} />
                </div>
                <ul className="space-y-1">
                  {rows.map(({ place, depth }) => {
                    const active = place.id === selectedPlaceId;
                    return (
                      <li key={place.id} style={{ paddingLeft: depth * 14 }}>
                        <button type="button" onClick={() => setSelectedPlaceId(place.id)} className={rowClass(active)}>
                          <span className="flex items-center gap-1.5">
                            <span className={titleClass(active)}>{place.name}</span>
                            {place.fictional && (
                              <span title={t('realAtlas.place.fictional')} className="shrink-0 text-accent-plum-light"><Sparkles size={12} /></span>
                            )}
                          </span>
                          <span className={metaClass}>{t(`realAtlas.kind.${place.kind}`)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            editor={selectedPlace && (
              <PlaceEditor
                // One editor per place: a geocoding search still in flight
                // for the previous selection must never land in this one.
                key={selectedPlace.id}
                projectId={projectId}
                place={selectedPlace}
                places={places.items}
                divergences={divergences.items}
                onSave={(changes) => savePlace(selectedPlace.id, changes)}
                onDelete={() => deletePlace(selectedPlace.id)}
                onAddDivergence={() => void createDivergence(selectedPlace.id)}
                onOpenDivergence={openDivergence}
                onPickOnMap={() => pickOnMap(selectedPlace.id)}
                coordinatePick={coordinatePick}
              />
            )}
          />
        )}
      </div>

      {/* Full height minus the app chrome above the engine (header, intro, tabs),
          the same way the board and worldgen canvases size themselves. */}
      {mapVisited && (
        <div role="tabpanel" hidden={tab !== 'map'} className="h-[calc(100vh-15rem)] min-h-[420px]">
          <AtlasMap
            projectId={projectId}
            places={places.items}
            divergences={divergences.items}
            selectedPlaceId={selectedPlaceId}
            onSelect={setSelectedPlaceId}
            onEdit={openPlaceEditor}
            onCreateAt={(coords) => void createPlace(coords)}
            onMove={movePlace}
            pickRequest={pickRequest}
            onPick={receivePick}
            focusRequest={focusRequest}
          />
        </div>
      )}

      <div role="tabpanel" hidden={tab !== 'divergences'}>
        {divergences.items.length === 0 ? (
          <EmptyState
            icon={<Split size={40} />}
            title={t('realAtlas.divergences.empty')}
            message={t('realAtlas.divergences.emptyHint')}
            action={{ label: t('realAtlas.divergences.new'), onClick: () => void createDivergence() }}
          />
        ) : (
          <Columns
            count={divergenceCountLabel(t, divergences.items.length)}
            // No "pick a divergence" key exists; the tab's own hint reads naturally here.
            hint={t('realAtlas.divergences.emptyHint')}
            list={(
              <>
                <div className="flex justify-end">
                  <NewButton label={t('realAtlas.divergences.new')} onClick={() => void createDivergence()} />
                </div>
                <ul className="space-y-1">
                  {divergences.items.map((d) => {
                    const active = d.id === selectedDivergenceId;
                    const where = placeName(d.placeId);
                    return (
                      <li key={d.id}>
                        <button type="button" onClick={() => setSelectedDivergenceId(d.id)} className={rowClass(active)}>
                          <span className={`block ${titleClass(active)}`}>{d.title}</span>
                          <span className={metaClass}>
                            {t(`realAtlas.category.${d.category}`)}
                            {where ? (
                              <span className="min-w-0 truncate normal-case tracking-normal">· {where}</span>
                            ) : (
                              <span className="px-1.5 rounded border border-border text-text-muted">{t('realAtlas.divergences.global')}</span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            editor={selectedDivergence && (
              <DivergenceEditor
                projectId={projectId}
                divergence={selectedDivergence}
                places={places.items}
                onSave={(changes) => divergences.editItem(selectedDivergence.id, changes)}
                onDelete={async () => {
                  await divergences.removeItem(selectedDivergence.id);
                  setSelectedDivergenceId(null);
                }}
              />
            )}
          />
        )}
      </div>
    </div>
  );
}
