import { useMemo } from 'react';
import { Biome, type BiomeId, type RuinKind } from '../core/types';
import type { SettlementRank } from '../core/settlements';
import type { LandOp, TerrainOp } from '../core/edits';
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

export type PaintMode = 'off' | 'terrain' | 'land' | 'biome' | 'river' | 'marker' | 'label' | 'erase';

export interface PaintTool {
  mode: PaintMode;
  terrainOp: TerrainOp;
  landOp: LandOp;
  biome: BiomeId;
  /** Brush radius in world cells. */
  radius: number;
  strength: number;
  softness: number;
  /** River width in cells. */
  riverWidth: number;
  marker: 'settlement' | 'ruin';
  ruin: RuinKind;
  rank: SettlementRank;
  labelStyle: 'region' | 'water' | 'range' | 'settlement' | 'note';
  labelText: string;
}

export const DEFAULT_PAINT_TOOL: PaintTool = {
  mode: 'off',
  terrainOp: 'raise',
  landOp: 'land',
  biome: Biome.TemperateForest,
  radius: 9,
  strength: 0.75,
  softness: 0.55,
  riverWidth: 2,
  marker: 'settlement',
  ruin: 'tower',
  rank: 'town',
  labelStyle: 'region',
  labelText: '',
};

const MODES: { id: PaintMode; label: string; hint: string }[] = [
  { id: 'off', label: 'Mano', hint: 'Mover y hacer zoom sin pintar' },
  { id: 'land', label: 'Costa', hint: 'Crear tierra o hundirla en el mar' },
  { id: 'terrain', label: 'Relieve', hint: 'Levantar, hundir, suavizar o rugosear' },
  { id: 'biome', label: 'Bioma', hint: 'Pintar vegetación y terreno' },
  { id: 'river', label: 'Río', hint: 'Trazar un cauce a mano' },
  { id: 'marker', label: 'Marca', hint: 'Colocar una ciudad o una ruina' },
  { id: 'label', label: 'Rótulo', hint: 'Escribir un nombre en el mapa' },
  { id: 'erase', label: 'Borrar', hint: 'Quitar marcas y rótulos de una zona' },
];

const TERRAIN_OPS: { id: TerrainOp; label: string }[] = [
  { id: 'raise', label: 'Levantar' },
  { id: 'lower', label: 'Hundir' },
  { id: 'smooth', label: 'Suavizar' },
  { id: 'flatten', label: 'Aplanar' },
  { id: 'roughen', label: 'Rugosear' },
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

const RANKS: { id: SettlementRank; label: string }[] = [
  { id: 'capital', label: 'Capital' },
  { id: 'city', label: 'Ciudad' },
  { id: 'town', label: 'Villa' },
  { id: 'village', label: 'Aldea' },
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
  const active = tool.mode !== 'off';
  const hint = useMemo(() => MODES.find((m) => m.id === tool.mode)?.hint ?? '', [tool.mode]);

  return (
    <div className="flex flex-col gap-3 text-[11px] text-white/80">
      <div className="flex items-center justify-between">
        <span className="uppercase tracking-wider text-[10px] text-white/45">Pincel</span>
        {busy && <span className="text-[10px] text-amber-300/80">aplicando…</span>}
      </div>

      <div className="grid grid-cols-4 gap-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            title={m.hint}
            onClick={() => set('mode', m.id)}
            className={`px-1.5 py-1.5 rounded text-[10px] transition ${
              tool.mode === m.id
                ? 'bg-amber-400/85 text-black font-medium'
                : 'bg-white/8 hover:bg-white/15'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-white/40 leading-snug -mt-1">{hint}</p>

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

      {tool.mode === 'marker' && (
        <div className="flex flex-col gap-2">
          <Row label="Qué colocar">
            <div className="grid grid-cols-2 gap-1">
              <Chip on={tool.marker === 'settlement'} onClick={() => set('marker', 'settlement')}>Poblado</Chip>
              <Chip on={tool.marker === 'ruin'} onClick={() => set('marker', 'ruin')}>Ruina</Chip>
            </div>
          </Row>
          {tool.marker === 'settlement' ? (
            <Row label="Rango">
              <div className="grid grid-cols-4 gap-1">
                {RANKS.map((r) => (
                  <Chip key={r.id} on={tool.rank === r.id} onClick={() => set('rank', r.id)}>{r.label}</Chip>
                ))}
              </div>
            </Row>
          ) : (
            <Row label="Tipo de ruina">
              <div className="grid grid-cols-4 gap-1">
                {RUINS.map((r) => (
                  <Chip key={r.id} on={tool.ruin === r.id} onClick={() => set('ruin', r.id)}>{r.label}</Chip>
                ))}
              </div>
            </Row>
          )}
          <p className="text-[10px] text-white/40 leading-snug">
            Se nombra solo en la lengua de la zona. Un clic la coloca.
          </p>
        </div>
      )}

      {tool.mode === 'label' && (
        <div className="flex flex-col gap-2">
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
              {LABEL_STYLES.map((s) => (
                <Chip key={s.id} on={tool.labelStyle === s.id} onClick={() => set('labelStyle', s.id)}>{s.label}</Chip>
              ))}
            </div>
          </Row>
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

      {(tool.mode === 'terrain' || tool.mode === 'land' || tool.mode === 'biome' || tool.mode === 'erase') && (
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
          {tool.mode !== 'erase' && (
            <>
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
            </>
          )}
        </div>
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-white/45">{label}</span>
      {children}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-1 py-1 rounded text-[10px] transition ${
        on ? 'bg-amber-400/85 text-black font-medium' : 'bg-white/8 hover:bg-white/15'
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
