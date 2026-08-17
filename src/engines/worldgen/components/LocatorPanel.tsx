// ============================================
// El localizador — buscar un sitio y volar a él
// ============================================
// La pieza que faltaba del trío «localizador / tecla Inicio / pila de vistas»
// (todo-2d-cohesion): Inicio y Retroceso ya viven en el 2D, pero encontrar un
// sitio POR NOMBRE obligaba a abrir el Índice — que al pulsar salta al 3D,
// porque su trabajo es otro (el manuscrito). Este panel busca en el mismo
// pozo (el atlas: pueblos, ruinas, accidentes, reinos) MÁS los rótulos que el
// lector escribió — que no entran en el atlas y eran imposibles de encontrar —
// y vuela la cámara COMPARTIDA sin cambiar de vista: donde estés, te lleva.
//
// Ctrl+F lo abre en las tres vistas; Esc lo cierra; ↑↓ y Enter navegan.
//
// ── 2026-08-15 · lo que le faltaba para ser un BUSCADOR y no una lista ──
//
//  1. EL EMPAREJADO PLEGA TILDES. Era `name.toLocaleLowerCase('es').includes(q)`,
//     sin normalizar, en un motor cuyo gazetteer es prosa castellana POR
//     DISEÑO: 9 de las 94 plantillas de nombre de `core/naming.ts` llevan
//     tilde o eñe, y no están repartidas al azar — son 2 de las 4 del RÍO
//     («Río {n}») y 2 de las 4 del OCÉANO. Es decir: escribir «rio» no
//     encontraba la mitad de los ríos con nombre del mundo. Ahora la consulta
//     y el nombre se pliegan igual (NFD sin diacríticos), así que «rio
//     sombrio» encuentra «Río Sombrío» y «cañada» se encuentra tecleando
//     «canada».
//  2. ORDEN POR CÓMO ENCAJA, NO SÓLO POR IMPORTANCIA. Ordenar por importancia
//     a secas dejaba la aldea cuyo nombre tecleaste ENTERO por debajo de la
//     capital que sólo lo contiene dentro. Primero lo que empieza por lo
//     tecleado, luego lo que empieza una palabra, luego lo que lo contiene; y
//     dentro de cada grupo sí manda la importancia.
//  3. CON LA CAJA VACÍA, LO QUE TIENES CERCA. Un buscador que no ofrece nada
//     hasta que teclees obliga a saberte el nombre ANTES de buscarlo, que es
//     justo lo que no sabes en un mundo recién generado. Ahora se abre con lo
//     importante que hay alrededor de donde está la cámara, con su distancia.

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Search } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { buildAtlas } from '../core/atlas';
import { EARTH_KM } from '../core/camera';
import { foldForSearch as fold, matchRank } from '../core/searchText';
import type { WorldData } from '../core/types';
import type { HumanGeography } from '../core/settlements';

interface LocatorHit {
  key: string;
  name: string;
  /** El nombre ya plegado: se paga una vez por sitio, no una por tecla. */
  folded: string;
  kindLabel: string;
  x: number;
  y: number;
  importance: number;
}


interface LocatorPanelProps {
  world: WorldData;
  geography: HumanGeography | null;
  open: boolean;
  onClose: () => void;
  /**
   * Dónde está mirando la cámara compartida, en normalizado.
   *
   * Van dos números y no un objeto a propósito: un `{u,v}` construido en el
   * JSX del padre estrena identidad en cada dibujo, y la lista de «cerca de
   * aquí» recorre el atlas entero — se recalcularía por cada latido del
   * viewport en vez de por cada movimiento de verdad.
   */
  atU?: number;
  atV?: number;
  /** Volar la cámara compartida a estas celdas de mundo, sin cambiar de vista.
   *  El nombre viaja con el vuelo: es lo que la chincheta de llegada rotula. */
  onFly: (x: number, y: number, name: string) => void;
}

export default function LocatorPanel({
  world, geography, open, onClose, atU, atV, onFly,
}: LocatorPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Patrón render-adjust (lección #17): abrir limpia la búsqueda, y cada
  // consulta nueva devuelve el cursor arriba — sin efectos que cascadeen.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) { setQuery(''); setCursor(0); }
  }
  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    setCursor(0);
  }

  useEffect(() => {
    if (!open) return;
    // El foco sí es un efecto: DOM de fuera, tras montarse el panel.
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // El pozo: el atlas entero más los rótulos pintados. Sólo se paga abierto,
  // y una vez por mundo/geografía — el propio atlas ya es memoizable así.
  const pool = useMemo<LocatorHit[]>(() => {
    if (!open || !geography) return [];
    const out: LocatorHit[] = [];
    const atlas = buildAtlas(world, geography);
    for (const p of atlas.places) {
      if (!p.name) continue;
      out.push({
        key: p.key,
        name: p.name,
        folded: fold(p.name),
        // La clave se compone en vez de mirarse en una tabla: las seis clases
        // del atlas YA tienen su rótulo en los locales, y la tabla de aquí
        // sólo listaba cuatro — un hito salía en la lista con la palabra
        // «landmark» en crudo, en inglés, delante del lector.
        kindLabel: t(`worldgen.atlas.kind.${p.kind}`),
        x: p.x, y: p.y,
        importance: p.importance,
      });
    }
    for (const pl of world.painted?.labels ?? []) {
      out.push({
        key: `label:${pl.x},${pl.y}`,
        name: pl.text,
        folded: fold(pl.text),
        kindLabel: t('worldgen.hover.yourLabel'),
        x: pl.x, y: pl.y,
        // Lo que el lector escribió va delante de lo que el generador nombró.
        importance: 1.2,
      });
    }
    return out;
  }, [open, world, geography, t]);

  const results = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return [];
    return pool
      .map((p) => ({ p, r: matchRank(p.folded, q) }))
      .filter((m) => m.r >= 0)
      .sort((a, b) => (
        a.r - b.r
        || b.p.importance - a.p.importance
        // A igual encaje e igual peso, el nombre más corto es el que el lector
        // tenía en la cabeza: «Vado» antes que «Vado de los Cuervos».
        || a.p.name.length - b.p.name.length
      ))
      .slice(0, 24)
      .map((m) => m.p);
  }, [pool, query]);

  /** Km por celda: el mundo entero mide una vuelta al planeta de ancho. */
  const kmPerCell = EARTH_KM / world.width;

  /**
   * Lo importante que hay alrededor de la cámara, para la caja vacía.
   *
   * El peso divide a la distancia en vez de sumarse: así una capital a 300 km
   * puede ganarle a una aldea a 80, pero ninguna capital del otro hemisferio
   * se cuela en una lista que dice «cerca de aquí».
   */
  const nearby = useMemo(() => {
    if (!pool.length || atU === undefined || atV === undefined) return [];
    const cx = atU * world.width, cy = atV * world.height;
    return pool
      .map((p) => {
        // El este y el oeste son el mismo sitio: sin envolver, un pueblo a
        // diez celdas del meridiano sale a un mundo entero de distancia.
        const dx = Math.abs(p.x - cx);
        const wrapped = Math.min(dx, world.width - dx);
        const d = Math.hypot(wrapped, p.y - cy);
        return { p, d, score: d / (0.35 + Math.max(0, p.importance)) };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 8);
  }, [pool, atU, atV, world.width, world.height]);

  const shown = query.trim() ? results : nearby.map((n) => n.p);

  if (!open) return null;

  const fly = (hit: LocatorHit) => {
    onFly(hit.x, hit.y, hit.name);
    onClose();
  };

  const km = (d: number): string => {
    const v = d * kmPerCell;
    return t('worldgen.locator.km').replace('{n}', v < 10 ? v.toFixed(1) : String(Math.round(v)));
  };

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 w-80 rounded-lg border border-border bg-elevated/95 shadow-xl shadow-black/40 backdrop-blur p-2 flex flex-col gap-1.5">
      <label className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-white/6 border border-white/10">
        <Search size={12} className="text-white/35" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(shown.length - 1, c + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
            else if (e.key === 'Enter' && shown.length) { e.preventDefault(); fly(shown[Math.min(cursor, shown.length - 1)]); }
          }}
          placeholder={t('worldgen.locator.placeholder')}
          className="flex-1 bg-transparent outline-none text-[11px] text-white/85 placeholder:text-white/25"
        />
        <kbd className="text-[9px] text-white/30 border border-white/15 rounded px-1">Esc</kbd>
      </label>

      {!query.trim() && nearby.length > 0 && (
        <p className="px-1.5 pt-0.5 text-[9px] uppercase tracking-wide text-white/25 flex items-center gap-1">
          <MapPin size={9} /> {t('worldgen.locator.nearby')}
        </p>
      )}

      {shown.length > 0 ? (
        <div className="flex flex-col gap-0.5 max-h-56 overflow-y-auto">
          {shown.map((p, i) => (
            <button
              key={p.key}
              onClick={() => fly(p)}
              onMouseEnter={() => setCursor(i)}
              className={`flex items-center justify-between px-1.5 py-1 rounded text-left text-[11px] text-white/80 ${
                i === cursor ? 'bg-white/10' : 'hover:bg-white/8'
              }`}
            >
              <span className="truncate">{p.name}</span>
              <span className="text-[9px] text-white/30 ml-2 shrink-0">
                {query.trim() ? p.kindLabel : km(nearby[i]?.d ?? 0)}
              </span>
            </button>
          ))}
        </div>
      ) : query.trim() ? (
        <p className="px-1.5 py-1 text-[10px] text-white/35">{t('worldgen.locator.empty')}</p>
      ) : null}
    </div>
  );
}
