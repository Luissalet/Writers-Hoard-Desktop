import { useRef, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { GeneratedWorld } from '../types';
import type { Route, TravelMode, Season } from '../core/travel';
import { MODE_KEY, SEASON_KEY } from '../core/travel';
import { saveJourneyCreativeDraft, type JourneyCreativeDraft } from '../journeyCreative';

const es = {
  develop: 'Desarrollar este viaje', hint: 'Convierte el recorrido o una noche en una idea o escena. Revisa el texto antes de guardarlo en el proyecto.',
  scope: 'Punto de partida', whole: 'Todo el recorrido', night: 'Noche', title: 'Título', content: 'Idea para desarrollar',
  idea: 'Guardar como idea', scene: 'Crear escena', cancel: 'Cancelar', saving: 'Guardando…', saved: 'Guardado en el proyecto, con un vínculo al mundo de origen.',
  failed: 'No se pudo guardar. El texto sigue aquí. Si cambió el mundo, vuelve a abrir el viaje.',
  route: 'Recorrido', conditions: 'Condiciones', distance: 'Distancia estimada', time: 'Horas de viaje estimadas', question: '¿Qué cambia para los personajes durante este trayecto?',
  camp: 'Noche al raso', shelter: 'Parada nocturna', openIdea: 'Abrir ideas', openScene: 'Abrir escenas', again: 'Desarrollar otro momento',
};
const en: typeof es = {
  develop: 'Develop this journey', hint: 'Turn the journey or one night into an idea or scene. Review the text before saving it to the project.',
  scope: 'Starting point', whole: 'The whole journey', night: 'Night', title: 'Title', content: 'Idea to develop',
  idea: 'Save as idea', scene: 'Create scene', cancel: 'Cancel', saving: 'Saving…', saved: 'Saved to the project, linked to the source world.',
  failed: 'Saving failed. Your text is still here. If the world changed, reopen the journey.',
  route: 'Route', conditions: 'Conditions', distance: 'Estimated distance', time: 'Estimated travel hours', question: 'What changes for the characters during this journey?',
  camp: 'Night in the open', shelter: 'Overnight stop', openIdea: 'Open ideas', openScene: 'Open scenes', again: 'Develop another moment',
};

export default function JourneyCreativeCapture({ world, route, stops, mode, season, width, height, sourcePending = false }: {
  world: GeneratedWorld; route: Route; stops: string[]; mode: TravelMode; season: Season; width: number; height: number; sourcePending?: boolean;
}) {
  const { locale, t } = useTranslation();
  const copy = locale === 'en' ? en : es;
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [draft, setDraft] = useState<JourneyCreativeDraft | null>(null);
  const [saved, setSaved] = useState<{ id: string; engine: string } | null>(null);
  const gate = useRef(false);
  const sourceWorld = useRef(world);
  const begin = (night?: number) => {
    sourceWorld.current = structuredClone(world);
    const stage = route.stages.find(row => row.night === night);
    const location = stage ? (stage.nearest?.name ?? `${copy.night} ${stage.night}`) : stops.join(' → ');
    setDraft({ id: crypto.randomUUID(), target: 'note', title: location, location,
      text: `${copy.route}: ${stops.join(' → ')}\n${copy.conditions}: ${t(MODE_KEY[mode])}, ${t(SEASON_KEY[season])}\n${copy.distance}: ${Math.round(stage?.km ?? route.km)} km\n${copy.time}: ${Math.round(stage?.hours ?? route.hours)}\n${stage ? `${stage.rough ? copy.camp : copy.shelter}: ${location}\n` : ''}\n${copy.question}`,
      context: { stops, night: stage?.night, u: stage ? (stage.x + 0.5) / width : undefined, v: stage ? (stage.y + 0.5) / height : undefined, mode, season, km: stage?.km ?? route.km, hours: stage?.hours ?? route.hours },
    });
    setOpen(true); setSaved(null); setError(false);
  };
  const save = async (target: 'note' | 'scene') => {
    if (!draft || gate.current) return;
    gate.current = true; setBusy(true); setError(false);
    try { setSaved(await saveJourneyCreativeDraft(sourceWorld.current, { ...draft, target })); }
    catch { setError(true); }
    finally { gate.current = false; setBusy(false); }
  };
  return <section className="border-t border-border pt-3 text-xs text-text-primary">
    {!open ? <button type="button" disabled={sourcePending} onClick={() => begin()} className="rounded-lg border border-accent-gold/50 px-3 py-2 text-accent-gold hover:bg-elevated disabled:opacity-40">{copy.develop}</button> : saved ? <div className="space-y-2">
      <p role="status">{copy.saved}</p>
      <a className="block text-accent-gold underline underline-offset-4" href={`/project/${encodeURIComponent(world.projectId)}/${saved.engine}`}>{saved.engine === 'notes' ? copy.openIdea : copy.openScene}</a>
      <button type="button" disabled={sourcePending} className="text-text-secondary underline underline-offset-4 disabled:opacity-40" onClick={() => begin()}>{copy.again}</button>
    </div> : draft && <div className="space-y-3">
      <p className="text-text-secondary">{copy.hint}</p>
      <label className="flex flex-col gap-1">{copy.scope}<select disabled={busy || sourcePending} value={draft.context.night ?? ''} onChange={event => begin(event.target.value ? Number(event.target.value) : undefined)} className="rounded border border-border bg-elevated p-2">
        <option value="">{copy.whole}</option>{route.stages.map(stage => <option key={stage.night} value={stage.night}>{copy.night} {stage.night}{stage.nearest ? ` · ${stage.nearest.name}` : ''}</option>)}
      </select></label>
      <label className="flex flex-col gap-1">{copy.title}<input disabled={busy} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} className="rounded border border-border bg-elevated p-2" /></label>
      <label className="flex flex-col gap-1">{copy.content}<textarea disabled={busy} rows={8} value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} className="resize-y rounded border border-border bg-elevated p-2 leading-relaxed" /></label>
      {error && <p role="alert" className="text-danger">{copy.failed}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !draft.title.trim() || !draft.text.trim()} onClick={() => void save('note')} className="rounded border border-border px-3 py-2 hover:bg-elevated disabled:opacity-40">{busy ? copy.saving : copy.idea}</button>
        <button type="button" disabled={busy || !draft.title.trim() || !draft.text.trim()} onClick={() => void save('scene')} className="rounded border border-border px-3 py-2 hover:bg-elevated disabled:opacity-40">{copy.scene}</button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} className="px-2 py-2 text-text-secondary">{copy.cancel}</button>
      </div>
    </div>}
  </section>;
}
