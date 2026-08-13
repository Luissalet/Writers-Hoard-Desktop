import { useMemo, useState } from 'react';
import { Search, AlertTriangle } from 'lucide-react';
import type { WorldData } from '../core/types';
import type { HumanGeography } from '../core/settlements';
import {
  buildAtlas, buildIndex, describePlace, reconcile, snapshotPositions,
  LINK_KIND_KEY, RELATION_KEY,
  type AtlasPlace, type ManuscriptLink,
} from '../core/atlas';
import EditableName from './EditableName';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * The map as an index of the manuscript.
 *
 * The engine has held the place registry and the link model for a while; this
 * is the part the reader can see. Three jobs, and the third is the one that
 * decides whether the feature is trustworthy:
 *
 *   · what does the book say about THIS place — the card;
 *   · where in the world does the book actually happen — the index;
 *   · and what broke — the orphan list, because a reader who changes a
 *     parameter and silently loses a character's birthplace will never rely on
 *     the feature again.
 *
 * The links come from the host application. With none supplied the panel says
 * so plainly rather than pretending to be empty.
 */

interface AtlasPanelProps {
  world: WorldData;
  geography: HumanGeography;
  links: ManuscriptLink[];
  /** The place the reader last clicked on the carta. */
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  /**
   * Rename the selected place.
   *
   * The index is where the things without a view of their own live — a sea, a
   * sierra, a realm, a ruin. A town has its plan; these have this list, and
   * both routes emit the same position-keyed `rename` edit.
   */
  onRename?: (key: string, name: string) => void;
  /** Delete the selected place from the world. */
  onDelete?: (key: string) => void;
  /** Centre the map on a place. */
  onFlyTo?: (x: number, y: number) => void;
  /** Open the host's own editor for a linked item. */
  onOpenLink?: (link: ManuscriptLink) => void;
}

const KIND_KEY: Record<string, string> = {
  settlement: 'worldgen.atlas.kind.settlement', ruin: 'worldgen.atlas.kind.ruin',
  realm: 'worldgen.atlas.kind.realm', feature: 'worldgen.atlas.kind.feature',
  landmark: 'worldgen.atlas.kind.landmark', region: 'worldgen.atlas.kind.region',
};

export default function AtlasPanel({
  world, geography, links, selectedKey, onSelect, onRename, onDelete, onFlyTo, onOpenLink,
}: AtlasPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const atlas = useMemo(() => buildAtlas(world, geography), [world, geography]);
  const index = useMemo(() => buildIndex(atlas, links), [atlas, links]);
  const fixes = useMemo(
    () => (index.orphans.length
      ? reconcile(atlas, world, index.orphans, snapshotPositions(atlas))
      : []),
    [atlas, world, index.orphans],
  );

  const selected = selectedKey ? atlas.byKey.get(selectedKey) ?? null : null;
  const selectedLinks = selectedKey ? index.byPlace.get(selectedKey) ?? [] : [];

  const withContent = useMemo(() => {
    const out: { place: AtlasPlace; count: number }[] = [];
    for (const [key, list] of index.byPlace) {
      const place = atlas.byKey.get(key);
      if (place) out.push({ place, count: list.length });
    }
    return out.sort((a, b) => b.count - a.count || a.place.name.localeCompare(b.place.name, 'es'));
  }, [index, atlas]);

  const results = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('es');
    if (!q) return [];
    return atlas.places
      .filter((p) => p.name && p.name.toLocaleLowerCase('es').includes(q))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 24);
  }, [atlas, query]);

  return (
    <div className="flex flex-col gap-3 text-[11px] text-white/80">
      <label className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-white/6 border border-white/10">
        <Search size={12} className="text-white/35" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('worldgen.atlas.searchPlaceholder')}
          className="flex-1 bg-transparent outline-none text-[11px] placeholder:text-white/25"
        />
      </label>

      {results.length > 0 && (
        <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
          {results.map((p) => (
            <button
              key={p.key}
              onClick={() => { onSelect(p.key); onFlyTo?.(p.x, p.y); }}
              className="flex items-center justify-between px-1.5 py-1 rounded hover:bg-white/8 text-left"
            >
              <span className="truncate">{p.name}</span>
              <span className="text-[9px] text-white/30 ml-2 shrink-0">
                {KIND_KEY[p.kind] ? t(KIND_KEY[p.kind]) : p.kind}
                {index.byPlace.has(p.key) ? ` · ${index.byPlace.get(p.key)!.length}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ---- the card ---- */}
      {selected ? (
        <div className="flex flex-col gap-1.5 border-t border-white/10 pt-2">
          <div className="flex items-baseline justify-between gap-2">
            <EditableName
              value={selected.name}
              onRename={onRename ? ((name) => onRename(selected.key, name)) : undefined}
              className="text-[13px] text-white/90 min-w-0"
            />
            <span className="text-[9px] text-white/35 shrink-0">{KIND_KEY[selected.kind] ? t(KIND_KEY[selected.kind]) : selected.kind}</span>
          </div>
          {describePlace(selected, selectedLinks, t).map((line, i) => (
            <p key={i} className="text-[10px] text-white/60 leading-snug">{line}</p>
          ))}
          {selectedLinks.length === 0 && (
            <p className="text-[10px] text-white/35 leading-snug">
              {t('worldgen.atlas.noLinks')}
            </p>
          )}
          <div className="flex flex-col gap-0.5 mt-1">
            {selectedLinks.map((l) => (
              <button
                key={`${l.kind}:${l.id}`}
                onClick={() => onOpenLink?.(l)}
                disabled={!onOpenLink}
                className="flex items-baseline justify-between gap-2 px-1.5 py-1 rounded hover:bg-white/8 text-left disabled:hover:bg-transparent"
              >
                <span className="truncate text-white/80">{l.title}</span>
                <span className="text-[9px] text-white/30 shrink-0">
                  {l.relation ? t(RELATION_KEY[l.relation]) : (l.where ?? t(LINK_KIND_KEY[l.kind]))}
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 mt-1">
            <button
              onClick={() => onFlyTo?.(selected.x, selected.y)}
              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-[10px]"
            >
              {t('worldgen.atlas.goTo')}
            </button>
            {onDelete && (
              <button
                onClick={() => { onDelete(selected.key); onSelect(null); }}
                title={t('worldgen.atlas.removeTitle')}
                className="px-2 py-1 rounded bg-white/10 hover:bg-red-500/25 hover:text-red-200 text-[10px]"
              >
                {t('worldgen.atlas.remove')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-[10px] text-white/40 leading-snug border-t border-white/10 pt-2">
          {t('worldgen.atlas.selectHint')}
        </p>
      )}

      {/* ---- where the book happens ---- */}
      <div className="border-t border-white/10 pt-2 flex flex-col gap-1">
        <div className="text-[10px] uppercase tracking-wider text-white/35">
          {t('worldgen.atlas.whereBookHappens')}
        </div>
        {links.length === 0 ? (
          <p className="text-[10px] text-white/40 leading-snug">
            {t('worldgen.atlas.nothingLinked')}
          </p>
        ) : (
          <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
            {withContent.map(({ place, count }) => (
              <button
                key={place.key}
                onClick={() => { onSelect(place.key); onFlyTo?.(place.x, place.y); }}
                className={`flex items-center justify-between px-1.5 py-1 rounded text-left ${
                  place.key === selectedKey ? 'bg-amber-400/15' : 'hover:bg-white/8'
                }`}
              >
                <span className="truncate">{place.name}</span>
                <span className="text-[9px] text-white/35 ml-2 shrink-0 tabular-nums">{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ---- what broke ---- */}
      {fixes.length > 0 && (
        <div className="border-t border-white/10 pt-2 flex flex-col gap-1">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-300/80">
            <AlertTriangle size={11} /> {t('worldgen.atlas.orphanCount').replace('{n}', String(fixes.length))}
          </div>
          <p className="text-[10px] text-white/40 leading-snug">
            {t('worldgen.atlas.orphanNote')}
          </p>
          <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
            {fixes.map((f, i) => (
              <div key={i} className="text-[10px] leading-snug px-1.5 py-1">
                <span className="text-white/70">{f.link.title}</span>
                {f.suggestion ? (
                  <span className="text-white/40">
                    {' '}→ {t('worldgen.atlas.suggestion').replace('{name}', f.suggestion.name)}
                    {f.by === 'name'
                      ? ` ${t('worldgen.atlas.sameName')}`
                      : ` ${t('worldgen.atlas.cellsAway').replace('{n}', String(Math.round(f.distanceCells)))}`}
                  </span>
                ) : (
                  <span className="text-white/30"> · {t('worldgen.atlas.noCandidate')}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
