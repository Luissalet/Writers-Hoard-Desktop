import { useMemo, useState } from 'react';
import { Biome, type BiomeId, type RuinKind } from '../core/types';
import type { SettlementRank } from '../core/settlements';
import type { BrushTip, Falloff, LandOp, PaintFilter, TerrainOp } from '../core/edits';
import type { PointKind } from '../core/paintCommit';
export type { PointKind };
import { biomeName } from '../core/gazetteer';
import { biomeLocaleKey } from '../core/biomeKeys';
import { BIOME_COLORS } from '../core/render';
import { useTranslation } from '@/i18n/useTranslation';

/** The swatch colour for a biome, from the same table the raster map uses. */
function swatch(b: BiomeId): string {
  const c = BIOME_COLORS[b];
  return c ? `rgb(${c[0]},${c[1]},${c[2]})` : '#888';
}

/**
 * The brush box.
 *
 * One rule governs the layout: the tool decides which options are even shown.
 * A biome picker while the terrain brush is selected is not just noise, it is a
 * lie about what the next stroke will do.
 */

/**
 * Three kinds of gesture, not ten modes.
 *
 * The old list had a mode for every noun — marker, label, erase, remove, rename,
 * road — and that hid the fact that they are not the same KIND of thing:
 *
 *   a brush covers area          coast, relief, biome     radius, strength
 *   a line is a polyline         river                    drawn, not stamped
 *   a point is an object         town, ruin, name, pin    placed, then edited
 *
 * An object is not paint: you put it down, and afterwards you rename it or
 * delete it — in the thing's own view, not with a second tool aimed at it. That
 * is why `rename` and `remove` are gone from here entirely, and why `marker`,
 * `label` and the marker eraser collapsed into one `point`.
 *
 * And every tool now has a negative on Ctrl instead of an eraser of its own.
 */
export type PaintMode =
  | 'off'
  // the brush
  | 'terrain' | 'land' | 'biome'
  // el pincel de LUGARES: dónde puede el enrejado regional sembrar granjas,
  // aldeas, abadías… (Ctrl = vaciar la zona). No pone lugares uno a uno — eso
  // es Punto — sino el PERMISO por zonas, guardado como edición.
  | 'places'
  // the line
  | 'river'
  // the object
  | 'point'
  // and the two that are neither: two clicks and an A* between them, and a
  // frontier that is nudged, poured or lassoed onto ground that already exists
  | 'road' | 'frontera'
  // MOVER: coger lo que ya existe y llevarlo a otro sitio. No pinta nada; es
  // el único modo cuyo gesto es el arrastre sobre una cosa que ya está ahí.
  | 'move';

export interface PaintTool {
  mode: PaintMode;
  terrainOp: TerrainOp;
  landOp: LandOp;
  biome: BiomeId;
  /** Brush radius in world cells. */
  radius: number;
  strength: number;
  softness: number;
  /** How the paint fades from the middle out. */
  curve: Falloff;
  /** The shape of the head. */
  tip: BrushTip;
  /** Degrees. Squares use it; ridges take theirs from the direction of the drag. */
  angle: number;
  /** How broken a ragged rim is. */
  jitter: number;
  /** How much longer than wide a ridge is. */
  aspect: number;
  /** How far the stroke fades towards its two ends. */
  taper: number;
  /** Where the stroke may land at all. Obeyed by the biome brush. */
  only: PaintFilter;
  /** River width in cells. */
  riverWidth: number;
  marker: 'settlement' | 'ruin';
  ruin: RuinKind;
  rank: SettlementRank;
  labelStyle: 'region' | 'water' | 'range' | 'settlement' | 'note';
  labelText: string;
  /** Road tool: a trade artery or a local track. */
  roadMajor: boolean;
  /** What the point tool puts down. */
  point: PointKind;
  /** Which country the frontier brush hands ground to. -1 is unclaimed. */
  realm: number;
  /** How the frontier is drawn: freehand, bucket, straight-edged lasso, curved lasso. */
  realmTool: 'brush' | 'fill' | 'poly' | 'curve';
  /** What stops the bucket. */
  realmBound: 'coast' | 'river' | 'ridge';
}

// eslint-disable-next-line react-refresh/only-export-components -- Shared by the paint canvas and panel as one tool contract.
export const DEFAULT_PAINT_TOOL: PaintTool = {
  mode: 'off',
  terrainOp: 'raise',
  landOp: 'land',
  biome: Biome.TemperateForest,
  radius: 9,
  strength: 0.75,
  softness: 0.55,
  curve: 'smooth',
  tip: 'round',
  angle: 0,
  jitter: 0.5,
  aspect: 2.6,
  taper: 0,
  only: {},
  /** Cells, as stored. 0,01 cell is ~390 m of water on a 1024-wide world — a
   *  river you ferry across. The old default of 2 cells was ~78 km wide and
   *  sits off the end of the width track, so the readout would have lied about
   *  the first river anyone drew until they touched the slider. */
  riverWidth: 2,
  marker: 'settlement',
  ruin: 'tower',
  rank: 'town',
  roadMajor: false,
  labelStyle: 'region',
  labelText: '',
  point: 'town',
  /** The first country, not −1. −1 is what Ctrl already does, so a tool whose
   *  resting state is its own negative unclaims the first province the reader
   *  paints — before they have chosen anybody at all. */
  realm: 0,
  realmTool: 'brush',
  /** The sea is the one edge every world has. On a dry continent `river` stops
   *  nowhere and the bucket runs all the way to the shore, which reads as a
   *  broken control rather than as a world without rivers. */
  realmBound: 'coast',
};

interface ModeSpec { id: PaintMode; label: string; hint: string; negative: string }

const GROUPS: { title: string; note: string; modes: ModeSpec[] }[] = [
  {
    title: 'worldgen.paint.group.brush',
    note: 'worldgen.paint.group.brush.note',
    modes: [
      { id: 'land', label: 'worldgen.paint.mode.land', hint: 'worldgen.paint.mode.land.hint', negative: 'worldgen.paint.mode.land.negative' },
      { id: 'terrain', label: 'worldgen.paint.mode.terrain', hint: 'worldgen.paint.mode.terrain.hint', negative: 'worldgen.paint.mode.terrain.negative' },
      { id: 'biome', label: 'worldgen.paint.mode.biome', hint: 'worldgen.paint.mode.biome.hint', negative: 'worldgen.paint.mode.biome.negative' },
      { id: 'places', label: 'worldgen.paint.mode.places', hint: 'worldgen.paint.mode.places.hint', negative: 'worldgen.paint.mode.places.negative' },
    ],
  },
  {
    title: 'worldgen.paint.group.stroke',
    note: 'worldgen.paint.group.stroke.note',
    modes: [
      { id: 'river', label: 'worldgen.paint.mode.river', hint: 'worldgen.paint.mode.river.hint', negative: 'worldgen.paint.mode.river.negative' },
    ],
  },
  {
    title: 'worldgen.paint.group.point',
    note: 'worldgen.paint.group.point.note',
    modes: [
      { id: 'point', label: 'worldgen.paint.mode.point', hint: 'worldgen.paint.mode.point.hint', negative: 'worldgen.paint.mode.point.negative' },
      { id: 'road', label: 'worldgen.paint.mode.road', hint: 'worldgen.paint.mode.road.hint', negative: 'worldgen.paint.mode.road.negative' },
      { id: 'frontera', label: 'worldgen.paint.mode.frontera', hint: 'worldgen.paint.mode.frontera.hint', negative: 'worldgen.paint.mode.frontera.negative' },
      { id: 'move', label: 'worldgen.paint.mode.move', hint: 'worldgen.paint.mode.move.hint', negative: '' },
    ],
  },
];

const MODES: ModeSpec[] = [
  { id: 'off', label: 'worldgen.paint.mode.off', hint: 'worldgen.paint.mode.off.hint', negative: '' },
  ...GROUPS.flatMap((g) => g.modes),
];

/** What the point tool puts down. */
const POINTS: { id: PointKind; label: string; hint: string }[] = [
  { id: 'capital', label: 'worldgen.paint.point.capital', hint: 'worldgen.paint.point.capital.hint' },
  { id: 'city', label: 'worldgen.paint.point.city', hint: 'worldgen.paint.point.city.hint' },
  { id: 'town', label: 'worldgen.paint.point.town', hint: 'worldgen.paint.point.town.hint' },
  { id: 'village', label: 'worldgen.paint.point.village', hint: 'worldgen.paint.point.village.hint' },
  { id: 'ruin', label: 'worldgen.paint.point.ruin', hint: 'worldgen.paint.point.ruin.hint' },
  { id: 'volcano', label: 'worldgen.paint.point.volcano', hint: 'worldgen.paint.point.volcano.hint' },
  { id: 'cave', label: 'worldgen.paint.point.cave', hint: 'worldgen.paint.point.cave.hint' },
  { id: 'waterfall', label: 'worldgen.paint.point.waterfall', hint: 'worldgen.paint.point.waterfall.hint' },
  { id: 'gorge', label: 'worldgen.paint.point.gorge', hint: 'worldgen.paint.point.gorge.hint' },
  { id: 'hotspring', label: 'worldgen.paint.point.hotspring', hint: 'worldgen.paint.point.hotspring.hint' },
  { id: 'label', label: 'worldgen.paint.point.label', hint: 'worldgen.paint.point.label.hint' },
  { id: 'waypoint', label: 'worldgen.paint.point.waypoint', hint: 'worldgen.paint.point.waypoint.hint' },
];

const TERRAIN_OPS: { id: TerrainOp; label: string }[] = [
  { id: 'raise', label: 'worldgen.paint.op.raise' },
  { id: 'lower', label: 'worldgen.paint.op.lower' },
  { id: 'smooth', label: 'worldgen.paint.op.smooth' },
  { id: 'sharpen', label: 'worldgen.paint.op.sharpen' },
  { id: 'flatten', label: 'worldgen.paint.op.flatten' },
  { id: 'terrace', label: 'worldgen.paint.op.terrace' },
  { id: 'roughen', label: 'worldgen.paint.op.roughen' },
  { id: 'gully', label: 'worldgen.paint.op.gully' },
  { id: 'grab', label: 'worldgen.paint.op.grab' },
];

/**
 * The four heads, with a drawing of each.
 *
 * A word is not enough here — "cresta" tells you nothing until you have used it
 * once — so each chip shows the footprint it stamps. The shapes are drawn to the
 * same scale as one another, which is also the honest thing: a ridge really does
 * reach further than a disc of the same size.
 */
// eslint-disable-next-line react-refresh/only-export-components -- The 2D and 3D paint panels intentionally share these JSX previews.
export const TIPS: { id: BrushTip; label: string; hint: string; draw: React.ReactNode }[] = [
  {
    id: 'round', label: 'worldgen.paint.tip.round', hint: 'worldgen.paint.tip.round.hint',
    draw: <circle cx="12" cy="12" r="7.5" />,
  },
  {
    id: 'square', label: 'worldgen.paint.tip.square', hint: 'worldgen.paint.tip.square.hint',
    draw: <rect x="4.7" y="4.7" width="14.6" height="14.6" rx="1" />,
  },
  {
    id: 'ragged', label: 'worldgen.paint.tip.ragged', hint: 'worldgen.paint.tip.ragged.hint',
    draw: <path d="M12 3.6 16 5.2 19.2 8.6 19.9 12.8 17.6 16.9 13.8 19.7 9.6 20 5.7 17.6 3.9 13.6 4.6 9.1 7.6 5.5Z" />,
  },
  {
    id: 'ridge', label: 'worldgen.paint.tip.ridge', hint: 'worldgen.paint.tip.ridge.hint',
    draw: <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-24 12 12)" />,
  },
];

// eslint-disable-next-line react-refresh/only-export-components -- The 2D and 3D paint panels intentionally share one falloff vocabulary.
export const CURVES: { id: Falloff; label: string; hint: string }[] = [
  { id: 'smooth', label: 'worldgen.paint.curve.smooth', hint: 'worldgen.paint.curve.smooth.hint' },
  { id: 'sharp', label: 'worldgen.paint.curve.sharp', hint: 'worldgen.paint.curve.sharp.hint' },
  { id: 'linear', label: 'worldgen.paint.curve.linear', hint: 'worldgen.paint.curve.linear.hint' },
  { id: 'flat', label: 'worldgen.paint.curve.flat', hint: 'worldgen.paint.curve.flat.hint' },
];

const RUINS: { id: RuinKind; label: string }[] = [
  { id: 'city', label: 'worldgen.paint.ruin.city' },
  { id: 'fort', label: 'worldgen.paint.ruin.fort' },
  { id: 'tower', label: 'worldgen.paint.ruin.tower' },
  { id: 'temple', label: 'worldgen.paint.ruin.temple' },
  { id: 'stones', label: 'worldgen.paint.ruin.stones' },
  { id: 'bridge', label: 'worldgen.paint.ruin.bridge' },
  { id: 'mine', label: 'worldgen.paint.ruin.mine' },
  { id: 'wall', label: 'worldgen.paint.ruin.wall' },
];


/**
 * Four ways to redraw a frontier, each with what the gesture IS written out.
 *
 * Not one of these four is guessable from its name: "cubo" does not say that it
 * stops at the coast, and neither lasso says whether it follows the mouse or the
 * corners you click. A chip without its sentence is a chip the reader tries once
 * — on a real province, of a real country — and then has to undo.
 */
const REALM_TOOLS: { id: PaintTool['realmTool']; label: string; hint: string }[] = [
  { id: 'brush', label: 'worldgen.paint.realmTool.brush', hint: 'worldgen.paint.realmTool.brush.hint' },
  { id: 'fill', label: 'worldgen.paint.realmTool.fill', hint: 'worldgen.paint.realmTool.fill.hint' },
  { id: 'poly', label: 'worldgen.paint.realmTool.poly', hint: 'worldgen.paint.realmTool.poly.hint' },
  { id: 'curve', label: 'worldgen.paint.realmTool.curve', hint: 'worldgen.paint.realmTool.curve.hint' },
];

/** What stops the bucket. The coast always does; the other two add the edges a
 *  reader is pointing at when they say "up to the river". */
const REALM_BOUNDS: { id: PaintTool['realmBound']; label: string; hint: string }[] = [
  { id: 'coast', label: 'worldgen.paint.realmBound.coast', hint: 'worldgen.paint.realmBound.coast.hint' },
  { id: 'river', label: 'worldgen.paint.realmBound.river', hint: 'worldgen.paint.realmBound.river.hint' },
  { id: 'ridge', label: 'worldgen.paint.realmBound.ridge', hint: 'worldgen.paint.realmBound.ridge.hint' },
];

const LABEL_STYLES: { id: PaintTool['labelStyle']; label: string }[] = [
  { id: 'region', label: 'worldgen.paint.labelStyle.region' },
  { id: 'water', label: 'worldgen.paint.labelStyle.water' },
  { id: 'range', label: 'worldgen.paint.labelStyle.range' },
  { id: 'settlement', label: 'worldgen.paint.labelStyle.settlement' },
  { id: 'note', label: 'worldgen.paint.labelStyle.note' },
];

/** Biomes worth offering as a brush, grouped the way a painter would reach for them. */
const BIOME_GROUPS: { title: string; ids: BiomeId[] }[] = [
  { title: 'worldgen.paint.biomeGroup.forest', ids: [Biome.TemperateForest, Biome.BorealForest, Biome.TropicalForest, Biome.TropicalRainforest, Biome.TemperateRainforest, Biome.MonsoonForest, Biome.MontaneForest, Biome.CloudForest, Biome.RiparianForest] },
  { title: 'worldgen.paint.biomeGroup.open', ids: [Biome.Grassland, Biome.Savanna, Biome.Steppe, Biome.Shrubland, Biome.Chaparral, Biome.Tundra, Biome.AlpineMeadow] },
  { title: 'worldgen.paint.biomeGroup.arid', ids: [Biome.Desert, Biome.Erg, Biome.Reg, Biome.Badlands, Biome.ColdDesert, Biome.SaltFlat] },
  { title: 'worldgen.paint.biomeGroup.waterIce', ids: [Biome.Marsh, Biome.PeatBog, Biome.SaltMarsh, Biome.Mangrove, Biome.Beach, Biome.Glacier, Biome.IceCap, Biome.Alpine] },
];

interface PaintPanelProps {
  tool: PaintTool;
  onChange: (tool: PaintTool) => void;
  strokeCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onExport?: () => void;
  /** Cells per screen pixel, so the brush size can be shown in real terms. */
  cellKm?: number;
  /**
   * The countries the frontier tool can hand ground to, in the order geography
   * produced them: `tool.realm` is the INDEX into this array, which is what a
   * stored `realm` edit means. Optional because the panel opens before the
   * world has any geography, and a picker of nothing is better than a crash.
   */
  realms?: { id: number; name: string; hue: number }[];
  busy?: boolean;
}

/**
 * A 0–1000 track over a distance on the ground, logarithmic.
 *
 * Shared, because the brush and the river ask the reader the same question —
 * how much ground does this cover — over a range spanning four orders of
 * magnitude, and a linear track spends nine tenths of its travel on sizes
 * nobody picks.
 */
function groundScale(minKm: number, maxKm: number) {
  const lo = Math.log(minKm);
  const span = Math.log(maxKm) - lo;
  return {
    toPos: (km: number): number => Math.round(1000
      * Math.min(1, Math.max(0, (Math.log(Math.max(minKm, km)) - lo) / span))),
    toKm: (pos: number): number => Math.exp(lo + (pos / 1000) * span),
  };
}

/** The brush's reach on the ground, in kilometres. The floor is about one
 *  canon cell — finer than that the canon cannot draw it either. */
const BRUSH_KM = groundScale(0.15, 2500);

/**
 * A RIVER'S WIDTH ON THE GROUND, in kilometres.
 *
 * `riverWidth` is STORED in world cells and stays that way — every saved edit
 * list replays through `applyEdits` in cells, so moving the stored unit would
 * silently rewrite every river anyone has already drawn. But a cell is ~39 km
 * on a 1024-wide world, so the old 1–6 track offered nothing narrower than a
 * river 39 km across: there was no way to draw a stream, only inland seas.
 * Floor: a brook. Ceiling: the mouth of a great delta.
 */
/**
 * The river track, in CELLS OF WORLD — expressed to the reader in kilometres.
 *
 * A hand-drawn river is carved into the world grid, and `applyEdits` floors the
 * carve at `Math.max(0.8, width)` while the drawn thickness is
 * `Math.min(1, width / 3)`. So the narrowest river this tool can make is about
 * four fifths of a cell, and above three cells it is already at full weight.
 * A previous version ran the slider from 20 m to 5 km, which reads beautifully
 * and was entirely below every one of those floors: the whole track carved an
 * identical 0,8-cell channel and drew an identical one-pixel line. Honest
 * bounds, shown in the ground units the reader thinks in.
 */
const RIVER_CELLS_MIN = 0.8;
const RIVER_CELLS_MAX = 6;

/** Metres under a kilometre, one decimal under ten, whole kilometres above —
 *  so a 20 m stream never reads as "0.0 km", which is what a km-only format
 *  does to everything the new river track can now reach. */
function groundLabel(km: number, t: (key: string) => string): string {
  if (km < 1) return t('worldgen.paint.units.m').replace('{n}', String(Math.round(km * 1000)));
  if (km < 10) return t('worldgen.paint.units.km').replace('{n}', km.toFixed(1));
  return t('worldgen.paint.units.km').replace('{n}', String(Math.round(km)));
}

export default function PaintPanel({
  tool, onChange, strokeCount, canUndo, canRedo, onUndo, onRedo, onClear, onExport,
  cellKm, realms, busy,
}: PaintPanelProps) {
  const { t } = useTranslation();
  const riverKm = groundScale(RIVER_CELLS_MIN * (cellKm ?? 1), RIVER_CELLS_MAX * (cellKm ?? 1));
  const set = <K extends keyof PaintTool>(k: K, v: PaintTool[K]) => onChange({ ...tool, [k]: v });
  const setOnly = (patch: Partial<PaintFilter>) => {
    const only: PaintFilter = { ...tool.only, ...patch };
    // An undefined bound is not a bound: strip it, so the stored edit says
    // nothing at all rather than saying "no limit" in a field.
    for (const k of Object.keys(only) as (keyof PaintFilter)[]) {
      if (only[k] === undefined) delete only[k];
    }
    onChange({ ...tool, only });
  };
  const active = tool.mode !== 'off';
  // The frontier's freehand gesture IS a brush — same radius, same softness,
  // same head — so it gets the same controls. Gated on the mode alone, the one
  // frontier tool that has a size would be the only brush in the panel with no
  // way to set it.
  const isBrush = tool.mode === 'terrain' || tool.mode === 'land' || tool.mode === 'biome'
    || (tool.mode === 'frontera' && tool.realmTool === 'brush');
  const byElev = tool.only.minElev !== undefined || tool.only.maxElev !== undefined;
  const bySlope = tool.only.minSlope !== undefined || tool.only.maxSlope !== undefined;
  const [openHead, setOpenHead] = useState(false);
  const [openWhere, setOpenWhere] = useState(false);
  const spec = useMemo(() => MODES.find((m) => m.id === tool.mode), [tool.mode]);
  const hint = spec?.hint ?? '';
  const negative = spec?.negative ?? '';
  // The chosen country repeated in the row's own heading. The list of swatches
  // is as long as the world has countries and scrolls out of sight under the
  // sub-tools, and a frontier handed to the wrong neighbour looks exactly like
  // one handed to the right one until the border moves.
  const realmName = tool.realm < 0
    ? t('worldgen.paint.realm.unclaimed')
    : (realms?.[tool.realm]?.name ?? '—');

  return (
    <div className="flex flex-col gap-3 text-[11px] text-white/80">
      <div className="flex items-center justify-between">
        <span className="uppercase tracking-wider text-[10px] text-white/45">{t('worldgen.paint.title')}</span>
        {busy && <span className="text-[10px] text-amber-300/80">{t('worldgen.paint.applying')}</span>}
      </div>

      <button
        onClick={() => set('mode', 'off')}
        className={`px-2 py-1.5 rounded text-[11px] transition ${
          tool.mode === 'off' ? 'bg-amber-400/85 text-black font-medium' : 'bg-white/10 hover:bg-white/20'
        }`}
      >
        {t('worldgen.paint.handButton')}
      </button>

      {GROUPS.map((g) => (
        <div key={g.title} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/60">{t(g.title)}</span>
            <span className="text-[9px] text-white/40 truncate">{t(g.note)}</span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {g.modes.map((m) => (
              <button
                key={m.id}
                title={t(m.hint)}
                onClick={() => set('mode', m.id)}
                className={`px-1.5 py-1.5 rounded text-[11px] transition ${
                  tool.mode === m.id
                    ? 'bg-amber-400/85 text-black font-medium'
                    : 'bg-white/10 hover:bg-white/20'
                }`}
              >
                {t(m.label)}
              </button>
            ))}
          </div>
        </div>
      ))}

      {active && (
        <p className="text-[11px] text-white/70 leading-snug rounded bg-white/[0.06] px-2 py-1.5">
          {t(hint)}.
          {negative && (
            <>
              <br />
              <strong className="text-amber-200">{t('worldgen.paint.key.ctrl')}</strong> {t(negative)}.
            </>
          )}
        </p>
      )}

      {tool.mode === 'terrain' && (
        <Row label={t('worldgen.paint.row.operation')}>
          <div className="grid grid-cols-3 gap-1">
            {TERRAIN_OPS.map((o) => (
              <Chip key={o.id} on={tool.terrainOp === o.id} onClick={() => set('terrainOp', o.id)}>
                {t(o.label)}
              </Chip>
            ))}
          </div>
        </Row>
      )}

      {tool.mode === 'land' && (
        <Row label={t('worldgen.paint.row.coast')}>
          <div className="grid grid-cols-2 gap-1">
            <Chip on={tool.landOp === 'land'} onClick={() => set('landOp', 'land')}>{t('worldgen.paint.landOp.land')}</Chip>
            <Chip on={tool.landOp === 'sea'} onClick={() => set('landOp', 'sea')}>{t('worldgen.paint.landOp.sea')}</Chip>
          </div>
        </Row>
      )}

      {tool.mode === 'biome' && (
        <div className="flex flex-col gap-2">
          {/* Por clave de catálogo, con `biomeName` (castellano del gazetteer)
              sólo de reserva: este panel decía «estepa» en una UI en inglés. */}
          <Row label={t('worldgen.paint.row.biome')
            .replace('{n}', (() => { const k = biomeLocaleKey(tool.biome); return k ? t(k) : biomeName(tool.biome); })())}>
            <div className="flex flex-col gap-1.5">
              {BIOME_GROUPS.map((g) => (
                <div key={g.title}>
                  <div className="text-[9px] uppercase tracking-wider text-white/35 mb-0.5">{t(g.title)}</div>
                  <div className="flex flex-wrap gap-1">
                    {g.ids.map((b) => (
                      <button
                        key={b}
                        title={(() => { const k = biomeLocaleKey(b); return k ? t(k) : biomeName(b); })()}
                        onClick={() => set('biome', b)}
                        style={{ background: swatch(b) }}
                        className={`w-5 h-5 rounded-sm border transition ${
                          tool.biome === b ? 'border-white ring-1 ring-white/70' : 'border-black/40 hover:border-white/60'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Row>
        </div>
      )}

      {tool.mode === 'point' && (
        <div className="flex flex-col gap-2">
          <Row label={t('worldgen.paint.row.whatToPlace')}>
            <div className="grid grid-cols-4 gap-1">
              {POINTS.map((k) => (
                <Chip key={k.id} on={tool.point === k.id} onClick={() => set('point', k.id)} title={t(k.hint)}>
                  {t(k.label)}
                </Chip>
              ))}
            </div>
          </Row>

          {tool.point === 'ruin' && (
            <Row label={t('worldgen.paint.row.ruinKind')}>
              <div className="grid grid-cols-4 gap-1">
                {RUINS.map((r) => (
                  <Chip key={r.id} on={tool.ruin === r.id} onClick={() => set('ruin', r.id)}>{t(r.label)}</Chip>
                ))}
              </div>
            </Row>
          )}

          {tool.point === 'label' && (
            <>
              <Row label={t('worldgen.paint.row.text')}>
                <input
                  value={tool.labelText}
                  onChange={(e) => set('labelText', e.target.value)}
                  placeholder={t('worldgen.paint.namePlaceholder')}
                  className="w-full px-2 py-1 rounded bg-black/40 border border-white/15 text-[11px] text-white/90 outline-none focus:border-amber-400/60"
                />
              </Row>
              <Row label={t('worldgen.paint.row.style')}>
                <div className="grid grid-cols-5 gap-1">
                  {LABEL_STYLES.map((st) => (
                    <Chip key={st.id} on={tool.labelStyle === st.id} onClick={() => set('labelStyle', st.id)}>{t(st.label)}</Chip>
                  ))}
                </div>
              </Row>
            </>
          )}

          <p className="text-[10px] text-white/55 leading-snug">
            {tool.point === 'waypoint'
              ? t('worldgen.paint.point.waypointNote')
              : t('worldgen.paint.point.placeNote')}
          </p>
        </div>
      )}

      {tool.mode === 'river' && (
        /*
          A RIVER IS A WIDTH ON THE GROUND, not a count of world cells. The
          track ran 1–6 cells and said so: on a 1024-wide world the narrowest
          river the reader could ask for was 39 km across — the Amazon's mouth
          is 15 — so every drawn river came out as an inland sea. Cells are the
          storage unit and stay the storage unit; what the reader chooses is
          how wide the water is, so that is what the control says.
        */
        cellKm ? (
          <label className="flex flex-col gap-0.5">
            <span className="flex justify-between text-[10px] text-white/45">
              <span>{t('worldgen.paint.slider.width')}</span>
              <span className="tabular-nums text-white/65">{groundLabel(tool.riverWidth * cellKm, t)}</span>
            </span>
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={riverKm.toPos(tool.riverWidth * cellKm)}
              onChange={(e) => set('riverWidth', riverKm.toKm(Number(e.target.value)) / cellKm)}
              className="w-full accent-amber-400"
            />
          </label>
        ) : (
          <Slider
            label={t('worldgen.paint.slider.width')}
            value={tool.riverWidth}
            min={1}
            max={6}
            step={0.5}
            format={(v) => t('worldgen.paint.units.cells').replace('{n}', v.toFixed(1))}
            onChange={(v) => set('riverWidth', v)}
          />
        )
      )}

      {tool.mode === 'road' && (
        <div className="flex flex-col gap-2">
          <Row label={t('worldgen.paint.row.roadClass')}>
            <div className="flex gap-1">
              <Chip on={!tool.roadMajor} onClick={() => set('roadMajor', false)}>{t('worldgen.paint.road.minor')}</Chip>
              <Chip on={tool.roadMajor} onClick={() => set('roadMajor', true)}>{t('worldgen.paint.road.major')}</Chip>
            </div>
          </Row>
          <p className="text-[10px] text-white/55 leading-snug">
            {t('worldgen.paint.road.note')}
          </p>
        </div>
      )}

      {tool.mode === 'frontera' && (
        <div className="flex flex-col gap-2">
          {/*
            THE COUNTRY COMES FIRST, and as a colour rather than as a name in a
            drop-down. Every gesture below hands ground to whatever is chosen
            here, and the political overlay washes that ground in exactly this
            hue — so the swatch is the one thing the reader can check against
            the map before dragging. Everything else about a frontier painted
            for the wrong neighbour looks right.
          */}
          <Row label={t('worldgen.paint.row.realm').replace('{n}', realmName)}>
            <div className="flex flex-col gap-1">
              {realms?.map((r, i) => (
                <button
                  key={r.id}
                  // `realm` in a stored edit is the INDEX into this array, not
                  // the realm's own id. The two agree today, so a picker that
                  // sent the id would look correct until the day they stop —
                  // and then hand every painted province to a neighbour.
                  onClick={() => set('realm', i)}
                  title={r.name}
                  className={`flex items-center gap-2 px-1.5 py-1 rounded text-[11px] text-left transition ${
                    tool.realm === i
                      ? 'bg-amber-400/85 text-black font-medium ring-1 ring-amber-200'
                      : 'bg-white/10 hover:bg-white/20'
                  }`}
                >
                  <span
                    style={{ background: `hsl(${r.hue} 55% 58%)` }}
                    className="w-3.5 h-3.5 rounded-sm border border-black/40 shrink-0"
                  />
                  <span className="truncate">{r.name}</span>
                </button>
              ))}
              <button
                onClick={() => set('realm', -1)}
                className={`flex items-center gap-2 px-1.5 py-1 rounded text-[11px] text-left transition ${
                  tool.realm < 0
                    ? 'bg-amber-400/85 text-black font-medium ring-1 ring-amber-200'
                    : 'bg-white/10 hover:bg-white/20'
                }`}
              >
                {/* Hollow, because unclaimed is not one more country: a filled
                    grey square reads as a grey nation on the map. */}
                <span className="w-3.5 h-3.5 rounded-sm border border-dashed border-white/50 shrink-0" />
                <span className="truncate">{t('worldgen.paint.realm.unclaimed')}</span>
              </button>
            </div>
          </Row>

          {!realms?.length && (
            /* An empty picker with only "sin dueño" in it looks like a tool that
               can do one thing, rather than like a world that has no countries
               yet — and the reader would go looking for the missing control. */
            <p className="text-[10px] text-white/55 leading-snug">
              {t('worldgen.paint.realm.none')}
            </p>
          )}

          <Row label={t('worldgen.paint.row.realmTool')}>
            <div className="flex flex-col gap-1">
              {REALM_TOOLS.map((k) => (
                <button
                  key={k.id}
                  onClick={() => set('realmTool', k.id)}
                  className={`flex flex-col gap-0.5 px-2 py-1 rounded text-left transition ${
                    tool.realmTool === k.id ? 'bg-amber-400/85 text-black' : 'bg-white/10 hover:bg-white/20'
                  }`}
                >
                  <span className="text-[10px] font-medium">{t(k.label)}</span>
                  {/* The sentence is shown, not hovered: a tooltip is no help to
                      the reader deciding which of the four to reach for, and the
                      cost of guessing wrong is a repainted province. */}
                  <span className={`text-[9px] leading-snug ${tool.realmTool === k.id ? 'text-black/70' : 'text-white/45'}`}>
                    {t(k.hint)}
                  </span>
                </button>
              ))}
            </div>
          </Row>

          {tool.realmTool === 'fill' && (
            <Row label={t('worldgen.paint.row.realmBound')}>
              <div className="grid grid-cols-3 gap-1">
                {REALM_BOUNDS.map((b) => (
                  <Chip key={b.id} title={t(b.hint)} on={tool.realmBound === b.id} onClick={() => set('realmBound', b.id)}>
                    {t(b.label)}
                  </Chip>
                ))}
              </div>
              {/* Which edge is in force, spelled out under the chips: a bucket
                  that ran past the river the reader meant to stop at has already
                  swallowed the far bank by the time they see it. */}
              <p className="text-[10px] text-white/45 leading-snug">
                {t(REALM_BOUNDS.find((b) => b.id === tool.realmBound)?.hint ?? '')}
              </p>
            </Row>
          )}
        </div>
      )}

      {isBrush && (
        <div className="flex flex-col gap-2">
          {/*
            THE BRUSH IS A DISTANCE ON THE GROUND, not a count of world cells.
            It used to run 0,125–60 cells, which on a 1024-wide world means a
            floor of five kilometres — and the 2D now draws down to 0,6 m per
            pixel, where a five-kilometre brush is eight screens wide. Cells are
            an implementation detail of the world raster; what the reader is
            choosing is how much ground the brush covers, so that is what the
            control says. Logarithmic, because the useful range runs from a
            hamlet's fields to a continent.

            Below one world cell the stroke barely marks the world raster and
            the CANON re-rasterises it properly at ~153 m — which is why a
            sub-cell brush is a real tool and not a rounding error.
          */}
          {cellKm ? (
            <label className="flex flex-col gap-0.5">
              <span className="flex justify-between text-[10px] text-white/45">
                <span>{t('worldgen.paint.size')}</span>
                <span className="tabular-nums text-white/65">
                  {groundLabel(tool.radius * cellKm, t)}
                  {tool.radius < 1 && <span className="text-white/35"> · {t('worldgen.paint.subCell')}</span>}
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={1000}
                step={1}
                value={BRUSH_KM.toPos(tool.radius * cellKm)}
                onChange={(e) => set('radius', BRUSH_KM.toKm(Number(e.target.value)) / cellKm)}
                className="w-full accent-amber-400"
              />
            </label>
          ) : (
            <Slider
              label={t('worldgen.paint.size')}
              value={tool.radius}
              min={0.02}
              max={60}
              step={0.02}
              format={(v) => t('worldgen.paint.units.cells').replace('{n}', v >= 1 ? String(Math.round(v)) : v.toFixed(3))}
              onChange={(v) => set('radius', v)}
            />
          )}
          <Slider
            label={t('worldgen.paint.slider.strength')}
            value={tool.strength}
            min={0.05}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set('strength', v)}
          />
          <Slider
            label={t('worldgen.paint.slider.edge')}
            value={tool.softness}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v < 0.15 ? t('worldgen.paint.edge.hard') : v > 0.8 ? t('worldgen.paint.edge.verySoft') : `${Math.round(v * 100)}%`)}
            onChange={(v) => set('softness', v)}
          />

          <Fold
            title={t('worldgen.paint.head')}
            summary={`${t(TIPS.find((k) => k.id === tool.tip)?.label ?? 'worldgen.paint.tip.round')}`
              + `${tool.curve !== 'smooth' ? ` · ${t(CURVES.find((c) => c.id === tool.curve)?.label ?? '')}` : ''}`
              + `${tool.taper > 0.001 ? ` · ${t('worldgen.paint.head.tapered')}` : ''}`}
            open={openHead}
            onToggle={() => setOpenHead(!openHead)}
          >
            <div className="grid grid-cols-4 gap-1">
              {TIPS.map((k) => (
                <button
                  key={k.id}
                  title={t(k.hint)}
                  onClick={() => set('tip', k.id)}
                  className={`flex flex-col items-center gap-0.5 py-1 rounded text-[9px] transition ${
                    tool.tip === k.id ? 'bg-amber-400/85 text-black font-medium' : 'bg-white/10 hover:bg-white/20'
                  }`}
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" opacity={0.85}>
                    {k.draw}
                  </svg>
                  {t(k.label)}
                </button>
              ))}
            </div>

            <Row label={t('worldgen.paint.falloff')}>
              <div className="grid grid-cols-4 gap-1">
                {CURVES.map((c) => (
                  <Chip key={c.id} title={t(c.hint)} on={tool.curve === c.id} onClick={() => set('curve', c.id)}>
                    {t(c.label)}
                  </Chip>
                ))}
              </div>
            </Row>

            {(tool.tip === 'square' || tool.tip === 'ridge') && (
              <Slider
                label={tool.tip === 'ridge' ? t('worldgen.paint.slider.angleFree') : t('worldgen.paint.slider.angle')}
                value={tool.angle}
                min={0}
                max={180}
                step={5}
                format={(v) => `${v}°`}
                onChange={(v) => set('angle', v)}
              />
            )}
            {tool.tip === 'ragged' && (
              <Slider
                label={t('worldgen.paint.slider.jitter')}
                value={tool.jitter}
                min={0}
                max={1}
                step={0.05}
                format={(v) => (v < 0.1 ? t('worldgen.paint.jitter.almostRound') : `${Math.round(v * 100)}%`)}
                onChange={(v) => set('jitter', v)}
              />
            )}
            {tool.tip === 'ridge' && (
              <Slider
                label={t('worldgen.paint.slider.aspect')}
                value={tool.aspect}
                min={1.2}
                max={6}
                step={0.2}
                format={(v) => `${v.toFixed(1)}×`}
                onChange={(v) => set('aspect', v)}
              />
            )}
            <Slider
              label={t('worldgen.paint.slider.taper')}
              value={tool.taper}
              min={0}
              max={1}
              step={0.05}
              format={(v) => (v < 0.03 ? t('worldgen.paint.taper.none') : `${Math.round(v * 100)}%`)}
              onChange={(v) => set('taper', v)}
            />
            <p className="text-[10px] text-white/45 leading-snug">
              {t('worldgen.paint.taper.note')}
            </p>
          </Fold>
        </div>
      )}

      {tool.mode === 'biome' && (
        <Fold
          title={t('worldgen.paint.where')}
          summary={filterSummary(tool.only, t)}
          open={openWhere}
          onToggle={() => setOpenWhere(!openWhere)}
        >
          <div className="grid grid-cols-3 gap-1">
            <Chip on={!tool.only.where} onClick={() => setOnly({ where: undefined })} title={t('worldgen.paint.where.all.hint')}>{t('worldgen.paint.where.all')}</Chip>
            <Chip on={tool.only.where === 'land'} onClick={() => setOnly({ where: 'land' })} title={t('worldgen.paint.where.land.hint')}>{t('worldgen.paint.where.land')}</Chip>
            <Chip on={tool.only.where === 'sea'} onClick={() => setOnly({ where: 'sea' })} title={t('worldgen.paint.where.sea.hint')}>{t('worldgen.paint.where.sea')}</Chip>
          </div>

          <Gate
            label={t('worldgen.paint.gate.elevation')}
            on={byElev}
            onToggle={() => setOnly(byElev ? { minElev: undefined, maxElev: undefined } : { minElev: 0, maxElev: 2000 })}
          >
            <Slider
              label={t('worldgen.paint.slider.from')} value={tool.only.minElev ?? 0} min={-500} max={6000} step={50}
              format={(v) => t('worldgen.paint.units.m').replace('{n}', String(v))} onChange={(v) => setOnly({ minElev: v })}
            />
            <Slider
              label={t('worldgen.paint.slider.to')} value={tool.only.maxElev ?? 6000} min={-500} max={6000} step={50}
              format={(v) => t('worldgen.paint.units.m').replace('{n}', String(v))} onChange={(v) => setOnly({ maxElev: v })}
            />
          </Gate>

          <Gate
            label={t('worldgen.paint.gate.slope')}
            on={bySlope}
            onToggle={() => setOnly(bySlope ? { minSlope: undefined, maxSlope: undefined } : { minSlope: 0, maxSlope: 60 })}
          >
            <Slider
              label={t('worldgen.paint.slider.from')} value={tool.only.minSlope ?? 0} min={0} max={400} step={10}
              format={(v) => t('worldgen.paint.units.mPerCell').replace('{n}', String(v))} onChange={(v) => setOnly({ minSlope: v })}
            />
            <Slider
              label={t('worldgen.paint.slider.to')} value={tool.only.maxSlope ?? 400} min={0} max={400} step={10}
              format={(v) => (v >= 400 ? t('worldgen.paint.slope.noCap') : t('worldgen.paint.units.mPerCell').replace('{n}', String(v)))} onChange={(v) => setOnly({ maxSlope: v })}
            />
          </Gate>

          <p className="text-[10px] text-white/45 leading-snug">
            {t('worldgen.paint.where.note.before')}{' '}
            <strong className="text-amber-200">{t('worldgen.paint.key.ctrl')}</strong>{' '}
            {t('worldgen.paint.where.note.after')}
          </p>
        </Fold>
      )}

      <div className="h-px bg-white/10" />

      <div className="flex items-center gap-1">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="flex-1 px-2 py-1.5 rounded bg-white/8 hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-white/8 text-[10px]"
        >
          ↶ {t('worldgen.paint.undo')}
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="flex-1 px-2 py-1.5 rounded bg-white/8 hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-white/8 text-[10px]"
        >
          ↷ {t('worldgen.paint.redo')}
        </button>
      </div>
      <div className="flex items-center justify-between text-[10px] text-white/40">
        <span>{strokeCount === 0 ? t('worldgen.paint.noEdits') : t(strokeCount === 1 ? 'worldgen.paint.edits.one' : 'worldgen.paint.edits.many').replace('{n}', String(strokeCount))}</span>
        <div className="flex gap-2">
          {onExport && strokeCount > 0 && (
            <button onClick={onExport} className="hover:text-white/80 underline decoration-dotted">
              {t('worldgen.paint.copy')}
            </button>
          )}
          {strokeCount > 0 && (
            <button onClick={onClear} className="hover:text-red-300 underline decoration-dotted">
              {t('worldgen.paint.clear')}
            </button>
          )}
        </div>
      </div>

      {active && (
        <p className="text-[10px] text-white/35 leading-snug">
          {t('worldgen.paint.dragHint.before')}{' '}
          <kbd className="px-1 rounded bg-white/10">{t('worldgen.paint.key.space')}</kbd>{' '}
          {t('worldgen.paint.dragHint.after')}
        </p>
      )}
    </div>
  );
}

/** What the "dónde" rule amounts to, in one line, so a folded panel still tells the truth. */
function filterSummary(f: PaintFilter, t: (key: string) => string): string {
  const bits: string[] = [];
  if (f.where === 'land') bits.push(t('worldgen.paint.filter.landOnly'));
  if (f.where === 'sea') bits.push(t('worldgen.paint.filter.seaOnly'));
  if (f.minElev !== undefined || f.maxElev !== undefined) {
    bits.push(t('worldgen.paint.units.m').replace('{n}', `${f.minElev ?? '−∞'}–${f.maxElev ?? '∞'}`));
  }
  if (f.minSlope !== undefined || f.maxSlope !== undefined) {
    bits.push(t('worldgen.paint.filter.slope').replace('{n}', `${f.minSlope ?? 0}–${f.maxSlope ?? '∞'}`));
  }
  return bits.length ? bits.join(' · ') : t('worldgen.paint.filter.anywhere');
}

/**
 * A section that stays out of the way until it is wanted.
 *
 * The brush box grew a head, a curve and a placement rule, and all of it at once
 * is a wall. Folded, each section still shows what it is currently doing — a
 * closed panel that hides an active rule is worse than no panel.
 */
function Fold({ title, summary, open, onToggle, children }: {
  title: string; summary: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded bg-white/[0.05] border border-white/10">
      <button onClick={onToggle} className="w-full flex items-baseline justify-between gap-2 px-2 py-1.5 text-left">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/60">{title}</span>
        <span className="flex items-center gap-1 min-w-0">
          <span className="text-[9px] text-white/45 truncate">{summary}</span>
          <span className="text-white/40 text-[9px]">{open ? '▾' : '▸'}</span>
        </span>
      </button>
      {open && <div className="flex flex-col gap-2 px-2 pb-2">{children}</div>}
    </div>
  );
}

/** A rule you turn on before you tune it. */
function Gate({ label, on, onToggle, children }: {
  label: string; on: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <button onClick={onToggle} className="flex items-center gap-1.5 text-left">
        <span className={`w-3 h-3 rounded-sm border flex items-center justify-center text-[8px] ${
          on ? 'bg-amber-400/85 border-amber-300 text-black' : 'border-white/30'
        }`}
        >
          {on ? '✓' : ''}
        </span>
        <span className="text-[10px] text-white/60">{label}</span>
      </button>
      {on && <div className="flex flex-col gap-1 pl-4">{children}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-white/45">{label}</span>
      {children}
    </div>
  );
}

function Chip({ on, onClick, title, children }: {
  on: boolean; onClick: () => void; title?: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`px-1 py-1 rounded text-[10px] transition ${
        on ? 'bg-amber-400/85 text-black font-medium' : 'bg-white/10 hover:bg-white/20'
      }`}
    >
      {children}
    </button>
  );
}

function Slider({
  label, value, min, max, step, format, onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="flex justify-between text-[10px] text-white/45">
        <span>{label}</span>
        <span className="tabular-nums text-white/65">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-amber-400"
      />
    </label>
  );
}
