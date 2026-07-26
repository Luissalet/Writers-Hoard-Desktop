import { useMemo, useState } from 'react';
import { Biome, type BiomeId, type RuinKind } from '../core/types';
import type { SettlementRank } from '../core/settlements';
import type { BrushTip, Falloff, LandOp, PaintFilter, TerrainOp } from '../core/edits';
import type { PointKind } from '../core/paintCommit';
export type { PointKind };
import { biomeName } from '../core/gazetteer';
import { BIOME_COLORS } from '../core/render';

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
  // the line
  | 'river'
  // the object
  | 'point'
  // and the one that is neither: two clicks and an A* between them
  | 'road';

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
}

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
  riverWidth: 2,
  marker: 'settlement',
  ruin: 'tower',
  rank: 'town',
  roadMajor: false,
  labelStyle: 'region',
  labelText: '',
  point: 'town',
};

interface ModeSpec { id: PaintMode; label: string; hint: string; negative: string }

const GROUPS: { title: string; note: string; modes: ModeSpec[] }[] = [
  {
    title: 'Pincel',
    note: 'Cubre superficie. Radio, fuerza y dureza.',
    modes: [
      { id: 'land', label: 'Costa', hint: 'Crear tierra donde había mar', negative: 'hunde la tierra en el mar' },
      { id: 'terrain', label: 'Relieve', hint: 'Levantar, suavizar, afilar, escalonar', negative: 'hace lo contrario de la operación elegida' },
      { id: 'biome', label: 'Bioma', hint: 'Pintar vegetación y terreno', negative: 'se lo devuelve al clasificador' },
    ],
  },
  {
    title: 'Trazo',
    note: 'Una línea, no un disco.',
    modes: [
      { id: 'river', label: 'Río', hint: 'Trazar un cauce a mano', negative: 'borra los ríos que cruces, tuyos o del generador' },
    ],
  },
  {
    title: 'Punto',
    note: 'Cosas: se colocan, y luego se editan o se borran donde viven.',
    modes: [
      { id: 'point', label: 'Colocar', hint: 'Pon una ciudad, una ruina, un rótulo o una chincheta', negative: 'borra lo que haya debajo' },
      { id: 'road', label: 'Camino', hint: 'Pincha dos poblaciones y la ruta se calcula sola', negative: 'borra el camino que pinches' },
    ],
  },
];

const MODES: ModeSpec[] = [
  { id: 'off', label: 'Mano', hint: 'Mover y hacer zoom sin pintar', negative: '' },
  ...GROUPS.flatMap((g) => g.modes),
];

/** What the point tool puts down. */
const POINTS: { id: PointKind; label: string; hint: string }[] = [
  { id: 'capital', label: 'Capital', hint: 'La sede de un reino' },
  { id: 'city', label: 'Ciudad', hint: 'Una ciudad' },
  { id: 'town', label: 'Villa', hint: 'Una villa' },
  { id: 'village', label: 'Aldea', hint: 'Una aldea' },
  { id: 'ruin', label: 'Ruina', hint: 'Algo abandonado' },
  { id: 'label', label: 'Rótulo', hint: 'Un nombre escrito sobre el mapa' },
  { id: 'waypoint', label: 'Chincheta', hint: 'Una marca tuya, con color y nota, que no forma parte del mundo' },
];

const TERRAIN_OPS: { id: TerrainOp; label: string }[] = [
  { id: 'raise', label: 'Levantar' },
  { id: 'lower', label: 'Hundir' },
  { id: 'smooth', label: 'Suavizar' },
  { id: 'sharpen', label: 'Afilar' },
  { id: 'flatten', label: 'Aplanar' },
  { id: 'terrace', label: 'Escalonar' },
  { id: 'roughen', label: 'Rugosear' },
  { id: 'gully', label: 'Barrancos' },
  { id: 'grab', label: 'Agarrar' },
];

/**
 * The four heads, with a drawing of each.
 *
 * A word is not enough here — "cresta" tells you nothing until you have used it
 * once — so each chip shows the footprint it stamps. The shapes are drawn to the
 * same scale as one another, which is also the honest thing: a ridge really does
 * reach further than a disc of the same size.
 */
export const TIPS: { id: BrushTip; label: string; hint: string; draw: React.ReactNode }[] = [
  {
    id: 'round', label: 'Redonda', hint: 'El disco de siempre. Colinas, manchas, casi todo',
    draw: <circle cx="12" cy="12" r="7.5" />,
  },
  {
    id: 'square', label: 'Cuadrada', hint: 'Bordes rectos y girables: mesetas, cortes, bancales',
    draw: <rect x="4.7" y="4.7" width="14.6" height="14.6" rx="1" />,
  },
  {
    id: 'ragged', label: 'Rota', hint: 'Borde mordido por ruido: costas, bosques, nada que parezca dibujado a compás',
    draw: <path d="M12 3.6 16 5.2 19.2 8.6 19.9 12.8 17.6 16.9 13.8 19.7 9.6 20 5.7 17.6 3.9 13.6 4.6 9.1 7.6 5.5Z" />,
  },
  {
    id: 'ridge', label: 'Cresta', hint: 'Una elipse que sigue el arrastre: cordilleras, dunas, escarpes',
    draw: <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-24 12 12)" />,
  },
];

export const CURVES: { id: Falloff; label: string; hint: string }[] = [
  { id: 'smooth', label: 'Suave', hint: 'Se apaga poco a poco. Colinas' },
  { id: 'sharp', label: 'Aguda', hint: 'Cae deprisa desde el centro. Picos y crestas' },
  { id: 'linear', label: 'Recta', hint: 'Se apaga a ritmo constante. Conos y taludes' },
  { id: 'flat', label: 'Plana', hint: 'Todo o nada. Mesetas con pared' },
];

const RUINS: { id: RuinKind; label: string }[] = [
  { id: 'city', label: 'Ciudad' },
  { id: 'fort', label: 'Fuerte' },
  { id: 'tower', label: 'Torre' },
  { id: 'temple', label: 'Templo' },
  { id: 'stones', label: 'Piedras' },
  { id: 'bridge', label: 'Puente' },
  { id: 'mine', label: 'Mina' },
  { id: 'wall', label: 'Muralla' },
];


const LABEL_STYLES: { id: PaintTool['labelStyle']; label: string }[] = [
  { id: 'region', label: 'Región' },
  { id: 'water', label: 'Agua' },
  { id: 'range', label: 'Sierra' },
  { id: 'settlement', label: 'Lugar' },
  { id: 'note', label: 'Nota' },
];

/** Biomes worth offering as a brush, grouped the way a painter would reach for them. */
const BIOME_GROUPS: { title: string; ids: BiomeId[] }[] = [
  { title: 'Bosque', ids: [Biome.TemperateForest, Biome.BorealForest, Biome.TropicalForest, Biome.TropicalRainforest, Biome.TemperateRainforest, Biome.MonsoonForest, Biome.MontaneForest, Biome.CloudForest, Biome.RiparianForest] },
  { title: 'Abierto', ids: [Biome.Grassland, Biome.Savanna, Biome.Steppe, Biome.Shrubland, Biome.Chaparral, Biome.Tundra, Biome.AlpineMeadow] },
  { title: 'Árido', ids: [Biome.Desert, Biome.Erg, Biome.Reg, Biome.Badlands, Biome.ColdDesert, Biome.SaltFlat] },
  { title: 'Agua y hielo', ids: [Biome.Marsh, Biome.PeatBog, Biome.SaltMarsh, Biome.Mangrove, Biome.Beach, Biome.Glacier, Biome.IceCap, Biome.Alpine] },
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
  busy?: boolean;
}

export default function PaintPanel({
  tool, onChange, strokeCount, canUndo, canRedo, onUndo, onRedo, onClear, onExport,
  cellKm, busy,
}: PaintPanelProps) {
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
  const isBrush = tool.mode === 'terrain' || tool.mode === 'land' || tool.mode === 'biome';
  const byElev = tool.only.minElev !== undefined || tool.only.maxElev !== undefined;
  const bySlope = tool.only.minSlope !== undefined || tool.only.maxSlope !== undefined;
  const [openHead, setOpenHead] = useState(false);
  const [openWhere, setOpenWhere] = useState(false);
  const spec = useMemo(() => MODES.find((m) => m.id === tool.mode), [tool.mode]);
  const hint = spec?.hint ?? '';
  const negative = spec?.negative ?? '';

  return (
    <div className="flex flex-col gap-3 text-[11px] text-white/80">
      <div className="flex items-center justify-between">
        <span className="uppercase tracking-wider text-[10px] text-white/45">Pincel</span>
        {busy && <span className="text-[10px] text-amber-300/80">aplicando…</span>}
      </div>

      <button
        onClick={() => set('mode', 'off')}
        className={`px-2 py-1.5 rounded text-[11px] transition ${
          tool.mode === 'off' ? 'bg-amber-400/85 text-black font-medium' : 'bg-white/10 hover:bg-white/20'
        }`}
      >
        Mano — mover y hacer zoom sin tocar nada
      </button>

      {GROUPS.map((g) => (
        <div key={g.title} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/60">{g.title}</span>
            <span className="text-[9px] text-white/40 truncate">{g.note}</span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {g.modes.map((m) => (
              <button
                key={m.id}
                title={m.hint}
                onClick={() => set('mode', m.id)}
                className={`px-1.5 py-1.5 rounded text-[11px] transition ${
                  tool.mode === m.id
                    ? 'bg-amber-400/85 text-black font-medium'
                    : 'bg-white/10 hover:bg-white/20'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      {active && (
        <p className="text-[11px] text-white/70 leading-snug rounded bg-white/[0.06] px-2 py-1.5">
          {hint}.
          {negative && (
            <>
              <br />
              <strong className="text-amber-200">Ctrl</strong> {negative}.
            </>
          )}
        </p>
      )}

      {tool.mode === 'terrain' && (
        <Row label="Operación">
          <div className="grid grid-cols-3 gap-1">
            {TERRAIN_OPS.map((o) => (
              <Chip key={o.id} on={tool.terrainOp === o.id} onClick={() => set('terrainOp', o.id)}>
                {o.label}
              </Chip>
            ))}
          </div>
        </Row>
      )}

      {tool.mode === 'land' && (
        <Row label="Costa">
          <div className="grid grid-cols-2 gap-1">
            <Chip on={tool.landOp === 'land'} onClick={() => set('landOp', 'land')}>Tierra</Chip>
            <Chip on={tool.landOp === 'sea'} onClick={() => set('landOp', 'sea')}>Mar</Chip>
          </div>
        </Row>
      )}

      {tool.mode === 'biome' && (
        <div className="flex flex-col gap-2">
          <Row label={`Bioma — ${biomeName(tool.biome)}`}>
            <div className="flex flex-col gap-1.5">
              {BIOME_GROUPS.map((g) => (
                <div key={g.title}>
                  <div className="text-[9px] uppercase tracking-wider text-white/35 mb-0.5">{g.title}</div>
                  <div className="flex flex-wrap gap-1">
                    {g.ids.map((b) => (
                      <button
                        key={b}
                        title={biomeName(b)}
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
          <Row label="Qué colocar">
            <div className="grid grid-cols-4 gap-1">
              {POINTS.map((k) => (
                <Chip key={k.id} on={tool.point === k.id} onClick={() => set('point', k.id)} title={k.hint}>
                  {k.label}
                </Chip>
              ))}
            </div>
          </Row>

          {tool.point === 'ruin' && (
            <Row label="Tipo de ruina">
              <div className="grid grid-cols-4 gap-1">
                {RUINS.map((r) => (
                  <Chip key={r.id} on={tool.ruin === r.id} onClick={() => set('ruin', r.id)}>{r.label}</Chip>
                ))}
              </div>
            </Row>
          )}

          {tool.point === 'label' && (
            <>
              <Row label="Texto">
                <input
                  value={tool.labelText}
                  onChange={(e) => set('labelText', e.target.value)}
                  placeholder="Escribe el nombre…"
                  className="w-full px-2 py-1 rounded bg-black/40 border border-white/15 text-[11px] text-white/90 outline-none focus:border-amber-400/60"
                />
              </Row>
              <Row label="Estilo">
                <div className="grid grid-cols-5 gap-1">
                  {LABEL_STYLES.map((st) => (
                    <Chip key={st.id} on={tool.labelStyle === st.id} onClick={() => set('labelStyle', st.id)}>{st.label}</Chip>
                  ))}
                </div>
              </Row>
            </>
          )}

          <p className="text-[10px] text-white/55 leading-snug">
            {tool.point === 'waypoint'
              ? 'La chincheta es tuya, no del mundo: no se pierde al regenerar y no forma parte de las ediciones. Puedes poner varias seguidas; el nombre, el color y la nota se los pones en la pestaña Chinchetas.'
              : 'Se nombra solo en la lengua de la zona. Después, para cambiarle el nombre o quitarlo, pínchalo: una ciudad abre su plano y lo demás se edita en el Índice.'}
          </p>
        </div>
      )}

      {tool.mode === 'river' && (
        <Slider
          label="Anchura"
          value={tool.riverWidth}
          min={1}
          max={6}
          step={0.5}
          format={(v) => `${v.toFixed(1)} celdas`}
          onChange={(v) => set('riverWidth', v)}
        />
      )}

      {tool.mode === 'road' && (
        <div className="flex flex-col gap-2">
          <Row label="Clase">
            <div className="flex gap-1">
              <Chip on={!tool.roadMajor} onClick={() => set('roadMajor', false)}>Camino</Chip>
              <Chip on={tool.roadMajor} onClick={() => set('roadMajor', true)}>Calzada real</Chip>
            </div>
          </Row>
          <p className="text-[10px] text-white/55 leading-snug">
            Pincha una población y luego otra: la ruta se calcula buscando pasos y evitando
            pantanos, igual que los caminos que trazó el generador. Un camino a mano seguía la
            línea recta que dibujaras y no sabía nada del terreno que cruzaba.
          </p>
        </div>
      )}

      {isBrush && (
        <div className="flex flex-col gap-2">
          <Slider
            label="Tamaño"
            value={tool.radius}
            min={1}
            max={60}
            step={1}
            format={(v) => (cellKm ? `${v} celdas · ${Math.round(v * cellKm)} km` : `${v} celdas`)}
            onChange={(v) => set('radius', v)}
          />
          <Slider
            label="Fuerza"
            value={tool.strength}
            min={0.05}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set('strength', v)}
          />
          <Slider
            label="Borde"
            value={tool.softness}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v < 0.15 ? 'duro' : v > 0.8 ? 'muy suave' : `${Math.round(v * 100)}%`)}
            onChange={(v) => set('softness', v)}
          />

          <Fold
            title="Cabeza"
            summary={`${TIPS.find((t) => t.id === tool.tip)?.label ?? 'Redonda'}`
              + `${tool.curve !== 'smooth' ? ` · ${CURVES.find((c) => c.id === tool.curve)?.label}` : ''}`
              + `${tool.taper > 0.001 ? ' · afilada' : ''}`}
            open={openHead}
            onToggle={() => setOpenHead(!openHead)}
          >
            <div className="grid grid-cols-4 gap-1">
              {TIPS.map((t) => (
                <button
                  key={t.id}
                  title={t.hint}
                  onClick={() => set('tip', t.id)}
                  className={`flex flex-col items-center gap-0.5 py-1 rounded text-[9px] transition ${
                    tool.tip === t.id ? 'bg-amber-400/85 text-black font-medium' : 'bg-white/10 hover:bg-white/20'
                  }`}
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" opacity={0.85}>
                    {t.draw}
                  </svg>
                  {t.label}
                </button>
              ))}
            </div>

            <Row label="Caída">
              <div className="grid grid-cols-4 gap-1">
                {CURVES.map((c) => (
                  <Chip key={c.id} title={c.hint} on={tool.curve === c.id} onClick={() => set('curve', c.id)}>
                    {c.label}
                  </Chip>
                ))}
              </div>
            </Row>

            {(tool.tip === 'square' || tool.tip === 'ridge') && (
              <Slider
                label={tool.tip === 'ridge' ? 'Ángulo (si no arrastras)' : 'Ángulo'}
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
                label="Rotura"
                value={tool.jitter}
                min={0}
                max={1}
                step={0.05}
                format={(v) => (v < 0.1 ? 'casi redonda' : `${Math.round(v * 100)}%`)}
                onChange={(v) => set('jitter', v)}
              />
            )}
            {tool.tip === 'ridge' && (
              <Slider
                label="Alargamiento"
                value={tool.aspect}
                min={1.2}
                max={6}
                step={0.2}
                format={(v) => `${v.toFixed(1)}×`}
                onChange={(v) => set('aspect', v)}
              />
            )}
            <Slider
              label="Afilado"
              value={tool.taper}
              min={0}
              max={1}
              step={0.05}
              format={(v) => (v < 0.03 ? 'sin afilar' : `${Math.round(v * 100)}%`)}
              onChange={(v) => set('taper', v)}
            />
            <p className="text-[10px] text-white/45 leading-snug">
              El afilado adelgaza el trazo hacia sus dos extremos, para que una estribación
              termine en punta en vez de cortarse en seco. Dibújalo entero de un arrastre: se
              mide sobre la longitud del trazo, no sobre el tiempo.
            </p>
          </Fold>
        </div>
      )}

      {tool.mode === 'biome' && (
        <Fold
          title="Dónde puede caer"
          summary={filterSummary(tool.only)}
          open={openWhere}
          onToggle={() => setOpenWhere(!openWhere)}
        >
          <div className="grid grid-cols-3 gap-1">
            <Chip on={!tool.only.where} onClick={() => setOnly({ where: undefined })} title="Sin restricción">Todo</Chip>
            <Chip on={tool.only.where === 'land'} onClick={() => setOnly({ where: 'land' })} title="Salta el mar">Tierra</Chip>
            <Chip on={tool.only.where === 'sea'} onClick={() => setOnly({ where: 'sea' })} title="Salta la tierra">Mar</Chip>
          </div>

          <Gate
            label="Por altura"
            on={byElev}
            onToggle={() => setOnly(byElev ? { minElev: undefined, maxElev: undefined } : { minElev: 0, maxElev: 2000 })}
          >
            <Slider
              label="Desde" value={tool.only.minElev ?? 0} min={-500} max={6000} step={50}
              format={(v) => `${v} m`} onChange={(v) => setOnly({ minElev: v })}
            />
            <Slider
              label="Hasta" value={tool.only.maxElev ?? 6000} min={-500} max={6000} step={50}
              format={(v) => `${v} m`} onChange={(v) => setOnly({ maxElev: v })}
            />
          </Gate>

          <Gate
            label="Por pendiente"
            on={bySlope}
            onToggle={() => setOnly(bySlope ? { minSlope: undefined, maxSlope: undefined } : { minSlope: 0, maxSlope: 60 })}
          >
            <Slider
              label="Desde" value={tool.only.minSlope ?? 0} min={0} max={400} step={10}
              format={(v) => `${v} m/celda`} onChange={(v) => setOnly({ minSlope: v })}
            />
            <Slider
              label="Hasta" value={tool.only.maxSlope ?? 400} min={0} max={400} step={10}
              format={(v) => (v >= 400 ? 'sin tope' : `${v} m/celda`)} onChange={(v) => setOnly({ maxSlope: v })}
            />
          </Gate>

          <p className="text-[10px] text-white/45 leading-snug">
            La regla se guarda dentro del trazo, así que el bioma sigue respetándola cuando el
            mundo se vuelve a generar. Con <strong className="text-amber-200">Ctrl</strong> se
            borra sin regla: lo que has pintado siempre se puede quitar.
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
          ↶ Deshacer
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="flex-1 px-2 py-1.5 rounded bg-white/8 hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-white/8 text-[10px]"
        >
          ↷ Rehacer
        </button>
      </div>
      <div className="flex items-center justify-between text-[10px] text-white/40">
        <span>{strokeCount === 0 ? 'sin ediciones' : `${strokeCount} ${strokeCount === 1 ? 'edición' : 'ediciones'}`}</span>
        <div className="flex gap-2">
          {onExport && strokeCount > 0 && (
            <button onClick={onExport} className="hover:text-white/80 underline decoration-dotted">
              copiar
            </button>
          )}
          {strokeCount > 0 && (
            <button onClick={onClear} className="hover:text-red-300 underline decoration-dotted">
              limpiar
            </button>
          )}
        </div>
      </div>

      {active && (
        <p className="text-[10px] text-white/35 leading-snug">
          Arrastra para pintar. Mantén <kbd className="px-1 rounded bg-white/10">Espacio</kbd> o usa
          el botón central para mover el mapa sin pintar.
        </p>
      )}
    </div>
  );
}

/** What the "dónde" rule amounts to, in one line, so a folded panel still tells the truth. */
function filterSummary(f: PaintFilter): string {
  const bits: string[] = [];
  if (f.where === 'land') bits.push('sólo tierra');
  if (f.where === 'sea') bits.push('sólo mar');
  if (f.minElev !== undefined || f.maxElev !== undefined) {
    bits.push(`${f.minElev ?? '−∞'}–${f.maxElev ?? '∞'} m`);
  }
  if (f.minSlope !== undefined || f.maxSlope !== undefined) {
    bits.push(`pendiente ${f.minSlope ?? 0}–${f.maxSlope ?? '∞'}`);
  }
  return bits.length ? bits.join(' · ') : 'en cualquier sitio';
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
