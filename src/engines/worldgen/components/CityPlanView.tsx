import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Dices, Download, Map, Trash2, X } from 'lucide-react';
import { saveAs } from 'file-saver';
import type { WorldData } from '../core/types';
import type { HumanGeography, Settlement } from '../core/settlements';
import { generateCity, type CityParams, type CityPlan, type WardType } from '../city/generate';
import { renderCity } from '../city/render';
import { cityParamsFor } from '../cartography/texture';
import { METRES_PER_CITY_UNIT } from '../region/townPlan';
import type { CartoTheme } from '../cartography/theme';
import type { Ctx } from '../cartography/symbols';
import EditableName from './EditableName';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * City plan panel. A settlement's plan is derived from its own id, so the same
 * town always yields the same streets — which is the whole point: the reader can
 * write about a place and find it unchanged next session. The dice button
 * re-rolls a variant without losing that default.
 */

interface CityPlanViewProps {
  world: WorldData;
  settlement: Settlement;
  /**
   * La geografía humana del mundo, si quien abre la ficha la tiene a mano.
   *
   * De ella salen los CAMINOS que llegan al pueblo, que es lo que decide dónde
   * están las puertas. Es opcional porque `cityParamsFor` sabe mirar la caché
   * del módulo cuando no llega —en el hilo principal siempre está caliente— y
   * porque construirla cuesta cuatro segundos: un plano sin rumbos de camino es
   * una degradación, un modal que se cuelga cuatro segundos al abrirse no.
   */
  geography?: HumanGeography;
  theme: CartoTheme;
  onClose: () => void;
  /**
   * Rename this town. Absent means the caller cannot take edits — the name then
   * simply reads as text rather than pretending to be editable.
   */
  onRename?: (name: string) => void;
  /** Delete this town from the world. The modal closes itself afterwards. */
  onDelete?: () => void;
  /**
   * Bajar al mapa, a las calles de esta ciudad.
   *
   * La otra mitad del relevo: el mapa abre la lámina (acción secundaria) y la
   * lámina devuelve al mapa. Sin esto, editar el plano era un callejón — se
   * cerraba la ventana y la cámara seguía donde estuviera, que después de una
   * búsqueda por el Índice podía ser el otro hemisferio.
   */
  onDescend?: () => void;
  /** Persist a new population. Absent means the reader may look but not set. */
  onPopulation?: (population: number) => void;
}

/**
 * How many people the reader may claim live here.
 *
 * The old control was a "Tamaño" slider running 5–44 in block counts, which is
 * a number about the drawing rather than about the place, and its ceiling was
 * arbitrary. A settlement has a POPULATION; the plan's size follows from it.
 */
const POP_MIN = 50;
const POP_MAX = 1_000_000;

/** Blocks the generator will draw. Measured: 220 blocks ≈ 2 s and ~60 000
 *  buildings, which is where a plan stops being readable anyway. */
const SIZE_MAX = 220;
const SIZE_MIN = 5;

/**
 * Population → plan size, anchored on what this settlement already is.
 *
 * Anchored, not absolute: at the generated population this returns exactly the
 * generated size, so a town nobody has edited draws precisely the plan it drew
 * before. The exponent is below one because bigger towns are DENSER — doubling
 * the people does not double the ground — which is why a city of a million is
 * a few hundred blocks and not three thousand.
 */
function sizeForPopulation(population: number, baseSize: number, basePopulation: number): number {
  const ratio = population / Math.max(1, basePopulation);
  return Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(baseSize * Math.pow(ratio, 0.58))));
}

/** The slider runs in log space: a hamlet and a metropolis both need half the
 *  travel, or everything under ten thousand lives in the first three pixels. */
function popToSlider(pop: number): number {
  const t = (Math.log(pop) - Math.log(POP_MIN)) / (Math.log(POP_MAX) - Math.log(POP_MIN));
  return Math.round(Math.min(1, Math.max(0, t)) * 1000);
}
function sliderToPop(v: number): number {
  const pop = Math.exp(Math.log(POP_MIN) + (v / 1000) * (Math.log(POP_MAX) - Math.log(POP_MIN)));
  // Round to something a person would say: 2 significant figures low down,
  // 3 higher up. Nobody founds a town of 4 137 people.
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(pop)) - 2));
  return Math.max(POP_MIN, Math.round(pop / mag) * mag);
}

export default function CityPlanView({
  world, settlement, geography, theme, onClose, onRename, onDelete, onDescend, onPopulation,
}: CityPlanViewProps) {
  const { t, locale } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [variant, setVariant] = useState(0);
  const [overrides, setOverrides] = useState<Partial<CityParams>>({});
  /**
   * SEGÚN EL ATLAS, O A SU AIRE.
   *
   * Encendido —y lo está de salida— el plano se construye con lo que el mundo
   * sabe del sitio: las puertas caen en los caminos que llegan de verdad, el
   * mar tiene la forma que tiene y el río va por donde va. Apagado, el
   * generador vuelve a inventárselos, que es lo que hace falta para mirar un
   * pueblo suelto sin que el atlas le imponga nada.
   *
   * Encendido NO toca `base`: se pasa el mismo objeto, así que un plano que
   * nadie ha tocado sigue siendo byte a byte el de siempre.
   */
  const [fromAtlas, setFromAtlas] = useState(true);

  const base = useMemo(
    () => cityParamsFor(world, settlement, geography),
    [world, settlement, geography],
  );
  const grounded = useMemo(
    () => (fromAtlas ? base : { ...base, roadBearings: [], shoreLine: null, riverCourse: null }),
    [base, fromAtlas],
  );

  /** Lo que el mundo ha aportado, para que el lector pueda verlo y no adivinarlo. */
  const atlasSummary = useMemo(() => {
    const bits: string[] = [];
    const roads = base.roadBearings?.length ?? 0;
    // Con forma singular, como worldgen.paint.edits: «1 caminos» delataba que
    // la frase se montaba sin mirar el número.
    if (roads) {
      bits.push(t(roads === 1 ? 'worldgen.cityPlan.atlasRoads.one' : 'worldgen.cityPlan.atlasRoads.many')
        .replace('{n}', String(roads)));
    }
    if (base.shoreLine?.length) bits.push(t('worldgen.cityPlan.atlasShore'));
    if (base.riverCourse) {
      // El ancho se guarda en unidades de plano; el lector piensa en metros.
      bits.push(t('worldgen.cityPlan.atlasRiver')
        .replace('{n}', String(Math.round(base.riverCourse.width * METRES_PER_CITY_UNIT))));
    }
    return bits.length ? bits.join(', ') : t('worldgen.cityPlan.atlasNothing');
  }, [base, t]);

  // Two populations on purpose. `pop` is what the reader sees and drags — it
  // updates on every pixel of slider. `settled` is what the PLAN is built from,
  // and it only catches up once the hand stops, because a plan of two hundred
  // blocks costs the better part of two seconds and regenerating it per frame
  // would make the slider feel broken.
  const [pop, setPop] = useState(settlement.population);
  const [settled, setSettled] = useState(settlement.population);
  const settleTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  /** Move the number now, rebuild the plan when the hand stops. */
  const bumpPop = useCallback((v: number) => {
    const n = Math.max(POP_MIN, Math.min(POP_MAX, Math.round(v)));
    setPop(n);
    setOverrides((o) => ({ ...o, size: undefined }));
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => setSettled(n), 260);
  }, []);

  const planSize = useMemo(
    () => overrides.size ?? sizeForPopulation(settled, base.size, base.population),
    [overrides.size, settled, base.size, base.population],
  );

  const plan: CityPlan = useMemo(() => generateCity({
    ...grounded,
    ...overrides,
    size: planSize,
    population: settled,
    seed: variant === 0 ? base.seed : `${base.seed}::v${variant}`,
  }), [grounded, base.seed, overrides, planSize, settled, variant]);

  /** Lo que el pueblo cava por su cuenta, para que el interruptor diga la verdad
   *  mientras nadie lo haya tocado. */
  const planHasMoat = !!plan.fort?.moat;

  const dirty = pop !== settlement.population;
  const save = useCallback(() => {
    if (!onPopulation || !dirty) return;
    onPopulation(pop);
  }, [onPopulation, dirty, pop]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => setSize({ w: host.clientWidth, h: host.clientHeight }));
    ro.observe(host);
    setSize({ w: host.clientWidth, h: host.clientHeight });
    return () => ro.disconnect();
  }, []);

  /**
   * Los textos del plano, en el idioma del lector.
   *
   * `city/render.ts` es motor puro: corre en los bancos y podría correr en un
   * worker, así que no tiene acceso a `useTranslation`. La tabla `WARD_LABEL`
   * que llevaba dentro imprimía español a fuego sobre una ventana que el resto
   * de la aplicación ya tenía traducida — y el subtítulo, con su
   * `toLocaleString('es-ES')`, lo mismo.
   */
  const labelFor = useCallback(
    (ward: WardType) => t(`worldgen.cityPlan.ward.${ward}`),
    [t],
  );
  const subtitle = useMemo(
    () => (plan
      ? t(plan.wall ? 'worldgen.cityPlan.subtitleWalled' : 'worldgen.cityPlan.subtitleOpen')
        .replace('{n}', plan.population.toLocaleString(locale === 'en' ? 'en-GB' : 'es-ES'))
      : ''),
    [plan, t, locale],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 8 || size.h < 8) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderCity(plan, ctx as unknown as Ctx, {
      theme, width: canvas.width, height: canvas.height, labelFor, subtitle,
    });
  }, [plan, theme, size.w, size.h, labelFor, subtitle]);

  const exportPng = useCallback(() => {
    const out = document.createElement('canvas');
    out.width = 2200;
    out.height = 2200;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    // Con los mismos textos que la pantalla: el PNG que se guarda es lo que se
    // está mirando, no una segunda versión en otro idioma.
    renderCity(plan, ctx as unknown as Ctx, {
      theme, width: out.width, height: out.height, labelFor, subtitle,
    });
    out.toBlob((blob) => {
      if (blob) saveAs(blob, `${plan.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}-plano.png`);
    }, 'image/png');
  }, [plan, theme, labelFor, subtitle]);

  const buildings = useMemo(
    () => plan.patches.reduce((n, p) => n + p.buildings.length, 0),
    [plan],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="flex flex-col w-full max-w-5xl h-[min(92vh,900px)] rounded-xl border border-border bg-deep overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-wrap">
          <div className="min-w-0">
            {/* The town's name lives here, where the town is. */}
            <EditableName
              value={settlement.name || plan.name}
              onRename={onRename}
              className="text-sm text-text-primary"
            />
            <div className="text-[11px] text-text-muted">
              {t('worldgen.cityPlan.inhabitants').replace('{n}', pop.toLocaleString('es-ES'))}
              {' · '}{t('worldgen.cityPlan.blocks').replace('{n}', plan.patches.length.toLocaleString('es-ES'))}
              {' · '}{t('worldgen.cityPlan.buildings').replace('{n}', buildings.toLocaleString('es-ES'))}
              {plan.wall
                ? ` · ${t('worldgen.cityPlan.wallStats')
                  .replace('{gates}', String(plan.gates.length))
                  .replace('{towers}', String(plan.towers.length))}`
                : ` · ${t('worldgen.cityPlan.noWalls')}`}
              {pop !== settled && ` · ${t('worldgen.cityPlan.redrawing')}`}
            </div>
            {/* Lo que el mundo pone de su parte, dicho en voz baja debajo. */}
            <div className={`text-[11px] ${fromAtlas ? 'text-accent-gold/70' : 'text-text-muted line-through'}`}>
              {atlasSummary}
            </div>
          </div>

          <div className="flex-1" />

          <Toggle
            label={t('worldgen.cityPlan.fromAtlas')}
            title={t('worldgen.cityPlan.fromAtlasHint')}
            on={fromAtlas}
            onClick={() => setFromAtlas((v) => !v)}
          />
          {/*
            LO QUE SE ELIGE ES LO QUE DECIDIÓ UNA PERSONA, NO DÓNDE ESTÁ EL PUEBLO.
            Aquí había interruptores de «Río» y «Costa». Un río no es una
            preferencia: es el sitio. Ofrecerlo como opción permitía apagarle el
            río a una ciudad fluvial —y ponerle mar a una de tierra adentro— y
            producía un plano que contradecía el mapa a un clic de distancia. El
            emplazamiento sale del atlas y sólo cambia si el pueblo se mueve; lo
            que se elige aquí es lo que mandó construir su señor.
          */}
          <Toggle label={t('worldgen.cityPlan.toggleWalls')} on={overrides.walls ?? base.walls} onClick={() => setOverrides((o) => ({ ...o, walls: !(o.walls ?? base.walls) }))} />
          <Toggle label={t('worldgen.cityPlan.toggleCitadel')} on={overrides.citadel ?? base.citadel} onClick={() => setOverrides((o) => ({ ...o, citadel: !(o.citadel ?? base.citadel) }))} />
          <Toggle label={t('worldgen.cityPlan.toggleCathedral')} title={t('worldgen.cityPlan.toggleCathedralHint')} on={overrides.cathedral ?? base.cathedral ?? true} onClick={() => setOverrides((o) => ({ ...o, cathedral: !(o.cathedral ?? base.cathedral ?? true) }))} />
          <Toggle label={t('worldgen.cityPlan.toggleMoat')} title={t('worldgen.cityPlan.toggleMoatHint')} on={overrides.moat ?? planHasMoat} onClick={() => setOverrides((o) => ({ ...o, moat: !(o.moat ?? planHasMoat) }))} />

          <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
            {t('worldgen.cityPlan.population')}
            <input
              type="range" min={0} max={1000} step={1}
              value={popToSlider(pop)}
              onChange={(e) => bumpPop(sliderToPop(Number(e.target.value)))}
              className="w-28 accent-accent-gold"
              title={t('worldgen.cityPlan.populationHint')}
            />
            <input
              type="number" min={POP_MIN} max={POP_MAX} step={50}
              value={pop}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) bumpPop(v);
              }}
              className="w-20 px-1 py-0.5 rounded border border-border bg-elevated text-[11px] text-text-primary"
            />
          </label>

          {onPopulation && (
            <button
              onClick={save}
              disabled={!dirty}
              title={dirty ? t('worldgen.cityPlan.saveTitle') : t('worldgen.cityPlan.noChanges')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] border transition ${
                dirty
                  ? 'border-accent-gold/50 bg-accent-gold/15 text-accent-gold hover:bg-accent-gold/25'
                  : 'border-border bg-elevated text-text-muted opacity-50 cursor-default'
              }`}
            >
              <Check size={12} /> {t('worldgen.cityPlan.save')}
            </button>
          )}

          {onDelete && (
            <IconBtn
              title={t('worldgen.cityPlan.deleteTitle')}
              onClick={() => { onDelete(); onClose(); }}
              danger
            >
              <Trash2 size={14} />
            </IconBtn>
          )}
          {onDescend && (
            <IconBtn
              title={t('worldgen.cityPlan.descend')}
              onClick={() => { onDescend(); onClose(); }}
            >
              <Map size={14} />
            </IconBtn>
          )}
          <IconBtn title={t('worldgen.cityPlan.variant')} onClick={() => setVariant((v) => v + 1)}><Dices size={14} /></IconBtn>
          <IconBtn title={t('worldgen.cityPlan.exportPng')} onClick={exportPng}><Download size={14} /></IconBtn>
          <IconBtn title={t('worldgen.cityPlan.close')} onClick={onClose}><X size={14} /></IconBtn>
        </div>

        <div ref={hostRef} className="flex-1 min-h-0 relative bg-deep">
          <canvas ref={canvasRef} className="block absolute inset-0" />
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, on, onClick, title }: {
  label: string; on: boolean; onClick: () => void; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`px-2 py-1 rounded text-[11px] border transition ${
        on
          ? 'border-accent-gold/50 bg-accent-gold/15 text-accent-gold'
          : 'border-border bg-elevated text-text-muted hover:text-text-primary'
      }`}
    >
      {label}
    </button>
  );
}

function IconBtn({ title, onClick, danger, children }: {
  title: string; onClick: () => void; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-7 h-7 grid place-items-center rounded border bg-elevated transition ${
        danger
          ? 'border-border text-text-muted hover:text-danger hover:border-danger/50'
          : 'border-border text-text-muted hover:text-text-primary hover:border-accent-gold/50'
      }`}
    >
      {children}
    </button>
  );
}
