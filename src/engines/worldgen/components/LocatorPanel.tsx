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

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { buildAtlas } from '../core/atlas';
import type { WorldData } from '../core/types';
import type { HumanGeography } from '../core/settlements';

interface LocatorHit {
  key: string;
  name: string;
  kindLabel: string;
  x: number;
  y: number;
  importance: number;
}

/** Los mismos rótulos de tipo que usa el Índice, para que las dos búsquedas
 *  hablen igual. */
const KIND_KEY: Record<string, string> = {
  settlement: 'worldgen.atlas.kind.settlement',
  ruin: 'worldgen.atlas.kind.ruin',
  feature: 'worldgen.atlas.kind.feature',
  realm: 'worldgen.atlas.kind.realm',
};

interface LocatorPanelProps {
  world: WorldData;
  geography: HumanGeography | null;
  open: boolean;
  onClose: () => void;
  /** Volar la cámara compartida a estas celdas de mundo, sin cambiar de vista. */
  onFly: (x: number, y: number) => void;
}

export default function LocatorPanel({ world, geography, open, onClose, onFly }: LocatorPanelProps) {
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
        kindLabel: KIND_KEY[p.kind] ? t(KIND_KEY[p.kind]) : p.kind,
        x: p.x, y: p.y,
        importance: p.importance,
      });
    }
    for (const pl of world.painted?.labels ?? []) {
      out.push({
        key: `label:${pl.x},${pl.y}`,
        name: pl.text,
        kindLabel: t('worldgen.hover.yourLabel'),
        x: pl.x, y: pl.y,
        // Lo que el lector escribió va delante de lo que el generador nombró.
        importance: 1.2,
      });
    }
    return out;
  }, [open, world, geography, t]);

  const results = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('es');
    if (!q) return [];
    return pool
      .filter((p) => p.name.toLocaleLowerCase('es').includes(q))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 24);
  }, [pool, query]);

  if (!open) return null;

  const fly = (hit: LocatorHit) => {
    onFly(hit.x, hit.y);
    onClose();
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
            else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(results.length - 1, c + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
            else if (e.key === 'Enter' && results.length) { e.preventDefault(); fly(results[Math.min(cursor, results.length - 1)]); }
          }}
          placeholder={t('worldgen.locator.placeholder')}
          className="flex-1 bg-transparent outline-none text-[11px] text-white/85 placeholder:text-white/25"
        />
        <kbd className="text-[9px] text-white/30 border border-white/15 rounded px-1">Esc</kbd>
      </label>
      {query.trim() && (
        results.length ? (
          <div className="flex flex-col gap-0.5 max-h-56 overflow-y-auto">
            {results.map((p, i) => (
              <button
                key={p.key}
                onClick={() => fly(p)}
                onMouseEnter={() => setCursor(i)}
                className={`flex items-center justify-between px-1.5 py-1 rounded text-left text-[11px] text-white/80 ${
                  i === cursor ? 'bg-white/10' : 'hover:bg-white/8'
                }`}
              >
                <span className="truncate">{p.name}</span>
                <span className="text-[9px] text-white/30 ml-2 shrink-0">{p.kindLabel}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="px-1.5 py-1 text-[10px] text-white/35">{t('worldgen.locator.empty')}</p>
        )
      )}
    </div>
  );
}
