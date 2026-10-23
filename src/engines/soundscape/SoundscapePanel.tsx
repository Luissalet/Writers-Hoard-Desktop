// The soundscape mixer: name a soundscape, add scenes, put the project's
// sounds on strips (loop or one-shot) with their level, choose the live scene,
// listen and stop; one-shots fire with a click. It sits with the project's
// ambience, so it keeps playing while you move between tools.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Play, Plus, Square, Trash2, Zap } from 'lucide-react';
import { db } from '@/db';
import { SOUNDSCAPE_LIMITS, createSoundscape, type SoundScene, type SoundStrip, type Soundscape } from './model';
import { SoundscapeConflict, saveSoundscapes } from './operations';
import { SoundscapeMixer } from './mixer';

const control = 'min-h-8 rounded border border-border bg-deep px-2 text-xs text-text-primary';
const button = 'inline-flex min-h-8 items-center gap-1 rounded border border-border px-2 text-xs text-text-primary hover:bg-elevated disabled:opacity-50';

export default function SoundscapePanel({ projectId, locale }: { projectId: string; locale: 'es' | 'en' }) {
  const es = locale === 'es';
  const list = useLiveQuery(async () => (await db.projects.get(projectId))?.soundscapes ?? { revision: 0, items: [] }, [projectId]);
  const sounds = useLiveQuery(() => db.localMediaAssets.where('projectId').equals(projectId).filter(asset => asset.kind === 'audio').toArray(), [projectId]);
  const [selected, setSelected] = useState(''), [name, setName] = useState(''), [error, setError] = useState(''), [layers, setLayers] = useState(0), [listening, setListening] = useState(false);
  const mixer = useRef<SoundscapeMixer | null>(null);
  useEffect(() => () => { mixer.current?.stop(); mixer.current = null; }, []);
  const items = useMemo(() => list?.items ?? [], [list]);
  const soundscape = items.find(item => item.id === selected) ?? items[0];
  const live = soundscape?.scenes.find(scene => scene.id === soundscape.liveSceneId) ?? soundscape?.scenes[0];
  const title = (assetId: string) => sounds?.find(asset => asset.id === assetId)?.title ?? (es ? 'Sonido que ya no está' : 'Missing sound');
  const save = async (change: (items: Soundscape[]) => Soundscape[]) => {
    if (!list) return; setError('');
    try { await saveSoundscapes(projectId, change(structuredClone(list.items)), list.revision); }
    catch (failure) { setError(failure instanceof SoundscapeConflict ? (es ? 'Cambió en otra ventana; vuelve a intentarlo.' : 'Changed in another window; try again.') : (es ? 'No se pudo guardar.' : 'Could not save.')); }
  };
  const edit = (change: (item: Soundscape) => void) => { if (!soundscape) return; void save(all => all.map(item => { if (item.id !== soundscape.id) return item; const next = structuredClone(item); change(next); return next; })); };
  const editScene = (sceneId: string, change: (scene: SoundScene) => void) => edit(item => { const scene = item.scenes.find(entry => entry.id === sceneId); if (scene) change(scene); });
  const listen = async (scene: SoundScene) => { if (!soundscape) return; mixer.current ??= new SoundscapeMixer(); const count = await mixer.current.listen(soundscape, scene); setLayers(count); setListening(true); };
  const stop = () => { mixer.current?.stop(); mixer.current = null; setListening(false); setLayers(0); };
  return <section className="mt-3 space-y-2 rounded-lg border border-border p-2 text-xs text-text-primary" data-testid="soundscape" aria-label={es ? 'Paisaje sonoro' : 'Soundscape'}>
    <div className="flex flex-wrap items-center gap-2">
      <strong className="text-sm">{es ? 'Paisaje sonoro' : 'Soundscape'}</strong>
      {items.length > 0 && <select className={control} aria-label={es ? 'Paisaje sonoro' : 'Soundscape'} data-testid="soundscape-select" value={soundscape?.id ?? ''} onChange={event => { stop(); setSelected(event.target.value); }}>{items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
      <form className="inline-flex gap-1" onSubmit={event => { event.preventDefault(); if (!name.trim()) return; const created = createSoundscape(name); created.scenes[0].name = es ? 'Escena 1' : 'Scene 1'; void save(all => [...all, created]).then(() => setSelected(created.id)); setName(''); }}><input className={control} placeholder={es ? 'Nuevo paisaje…' : 'New soundscape…'} aria-label={es ? 'Nombre del paisaje sonoro' : 'Soundscape name'} data-testid="soundscape-name" value={name} onChange={event => setName(event.target.value)} /><button type="submit" className={button} data-testid="soundscape-create" disabled={!name.trim() || items.length >= SOUNDSCAPE_LIMITS.soundscapes}><Plus className="h-3 w-3" />{es ? 'Crear' : 'Create'}</button></form>
      {soundscape && <span className="ml-auto inline-flex items-center gap-2">{listening ? <button type="button" className={button} data-testid="soundscape-stop" onClick={stop}><Square className="h-3 w-3" />{es ? 'Detener' : 'Stop'}</button> : <button type="button" className={button} data-testid="soundscape-listen" disabled={!live?.strips.some(strip => strip.kind === 'loop')} onClick={() => live && void listen(live)}><Play className="h-3 w-3" />{es ? 'Escuchar' : 'Listen'}</button>}<span data-testid="soundscape-layers" className="text-text-muted">{listening ? (es ? `${layers} capas sonando` : `${layers} layers on`) : ''}</span></span>}
    </div>
    {error && <p role="alert" className="text-danger">{error}</p>}
    {!items.length && <p className="text-text-muted">{es ? 'Junta varios sonidos del proyecto (los de la biblioteca o los tuyos) en escenas: los bucles suenan juntos y los efectos se disparan con un clic.' : 'Put several of the project\'s sounds (library or your own) into scenes: loops play together and effects fire with a click.'}</p>}
    {soundscape && <>
      <label className="flex items-center gap-2">{es ? 'Volumen general' : 'Master'}<input type="range" min={0} max={1} step={0.05} className="accent-accent-gold" data-testid="soundscape-master" value={soundscape.master} onChange={event => { const value = Number(event.target.value); mixer.current?.masterLevel(value); edit(item => { item.master = value; }); }} /></label>
      <div className="flex flex-wrap gap-1" role="tablist" aria-label={es ? 'Escenas' : 'Scenes'}>{soundscape.scenes.map(scene => <button key={scene.id} type="button" role="tab" aria-selected={scene.id === live?.id} data-testid={`soundscape-scene-${scene.name}`} className={`rounded px-2 py-1 ${scene.id === live?.id ? 'bg-accent-gold/15 text-accent-gold' : 'text-text-muted hover:bg-elevated'}`} onClick={() => { edit(item => { item.liveSceneId = scene.id; }); if (listening) void listen(scene); }}>{scene.name}</button>)}
        <button type="button" className={button} data-testid="soundscape-add-scene" disabled={soundscape.scenes.length >= SOUNDSCAPE_LIMITS.scenes} onClick={() => edit(item => { const scene = { id: crypto.randomUUID(), name: `${es ? 'Escena' : 'Scene'} ${item.scenes.length + 1}`, strips: [] }; item.scenes.push(scene); item.liveSceneId = scene.id; })}><Plus className="h-3 w-3" />{es ? 'Escena' : 'Scene'}</button>
      </div>
      {live && <div className="space-y-1" data-testid="soundscape-strips">
        <input className={`${control} w-full`} aria-label={es ? 'Nombre de la escena' : 'Scene name'} data-testid="soundscape-scene-name" defaultValue={live.name} key={live.id} onBlur={event => { const value = event.target.value.trim(); if (value && value !== live.name) editScene(live.id, scene => { scene.name = value; }); }} />
        {live.strips.map((strip: SoundStrip) => <div key={strip.id} className="flex flex-wrap items-center gap-2 rounded border border-border p-1" data-testid="soundscape-strip">
          <span className="min-w-0 flex-1 truncate">{title(strip.assetId)}</span>
          <select className={control} aria-label={es ? 'Tipo' : 'Kind'} data-testid="soundscape-strip-kind" value={strip.kind} onChange={event => editScene(live.id, scene => { const target = scene.strips.find(item => item.id === strip.id); if (target) target.kind = event.target.value as SoundStrip['kind']; })}><option value="loop">{es ? 'Bucle' : 'Loop'}</option><option value="oneshot">{es ? 'Efecto' : 'One-shot'}</option></select>
          <input type="range" min={0} max={1} step={0.05} aria-label={es ? 'Intensidad' : 'Intensity'} data-testid="soundscape-strip-gain" className="accent-accent-gold" value={strip.gain} onChange={event => { const value = Number(event.target.value); mixer.current?.level(strip.id, value); editScene(live.id, scene => { const target = scene.strips.find(item => item.id === strip.id); if (target) target.gain = value; }); }} />
          {strip.kind === 'oneshot' && <button type="button" className={button} data-testid="soundscape-fire" onClick={() => { mixer.current ??= new SoundscapeMixer(); void mixer.current.fire(soundscape, strip.assetId, strip.gain); }}><Zap className="h-3 w-3" />{es ? 'Disparar' : 'Fire'}</button>}
          <button type="button" className="rounded p-1 text-text-muted hover:bg-elevated" aria-label={es ? 'Quitar' : 'Remove'} onClick={() => editScene(live.id, scene => { scene.strips = scene.strips.filter(item => item.id !== strip.id); })}><Trash2 className="h-3 w-3" /></button>
        </div>)}
        {live.strips.length < SOUNDSCAPE_LIMITS.strips && <select className={`${control} w-full`} aria-label={es ? 'Añadir un sonido' : 'Add a sound'} data-testid="soundscape-add-strip" value="" onChange={event => { const assetId = event.target.value; if (assetId) editScene(live.id, scene => { scene.strips.push({ id: crypto.randomUUID(), assetId, kind: 'loop', gain: 0.7 }); }); }}><option value="">{sounds?.length ? (es ? '+ Añadir un sonido del proyecto' : '+ Add a project sound') : (es ? 'Añade sonidos con la biblioteca de abajo' : 'Add sounds with the library below')}</option>{sounds?.map(asset => <option key={asset.id} value={asset.id}>{asset.title}</option>)}</select>}
        <button type="button" className={button} data-testid="soundscape-delete" onClick={() => { stop(); void save(all => all.filter(item => item.id !== soundscape.id)); setSelected(''); }}><Trash2 className="h-3 w-3" />{es ? 'Borrar paisaje' : 'Delete soundscape'}</button>
        {soundscape.scenes.length > 1 && <button type="button" className={button} onClick={() => edit(item => { item.scenes = item.scenes.filter(scene => scene.id !== live.id); item.liveSceneId = item.scenes[0].id; })}><Trash2 className="h-3 w-3" />{es ? 'Borrar escena' : 'Delete scene'}</button>}
      </div>}
    </>}
  </section>;
}
