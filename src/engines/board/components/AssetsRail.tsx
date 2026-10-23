// The board's assets rail: the project's pictures (the Gallery's) to search
// and put on the board with a click or by dragging, and the project's sounds
// (Sound and video, the sound library) to listen to.
import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ImagePlus, Play, Square } from 'lucide-react';
import { db } from '@/db';

import { BOARD_ASSET_MIME, imageFile } from './boardAssets';

export default function AssetsRail({ projectId, locale, onAdd }: { projectId: string; locale: string; onAdd: (file: File) => void }) {
  const es = locale !== 'en';
  const pictures = useLiveQuery(() => db.inspirationImages.where('projectId').equals(projectId).toArray(), [projectId]);
  const sounds = useLiveQuery(() => db.localMediaAssets.where('projectId').equals(projectId).filter(asset => asset.kind === 'audio').toArray(), [projectId]);
  const [query, setQuery] = useState(''), [playing, setPlaying] = useState(''), audio = useRef<HTMLAudioElement | null>(null), url = useRef('');
  const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const label = (picture: { notes: string; tags: string[] }) => picture.notes.split('\n')[0].trim() || picture.tags[0] || (es ? 'Imagen' : 'Picture');
  const match = (text: string) => !query.trim() || fold(text).includes(fold(query.trim()));
  const shownPictures = (pictures ?? []).filter(picture => match(`${picture.notes} ${picture.tags.join(' ')}`));
  const shownSounds = (sounds ?? []).filter(sound => match(`${sound.title} ${sound.tags.join(' ')}`));
  const stop = () => { audio.current?.pause(); if (url.current) URL.revokeObjectURL(url.current); url.current = ''; setPlaying(''); };
  return <section className="space-y-2" data-testid="board-assets" aria-label={es ? 'Recursos del proyecto' : 'Project assets'}>
    <h3 className="text-sm font-medium text-text-primary">{es ? 'Recursos' : 'Assets'}</h3>
    <input className="w-full rounded border border-border bg-deep px-2 py-1 text-xs text-text-primary" placeholder={es ? 'Buscar…' : 'Search…'} aria-label={es ? 'Buscar recursos' : 'Search assets'} data-testid="board-assets-search" value={query} onChange={event => setQuery(event.target.value)} />
    {!shownPictures.length && !shownSounds.length && <p className="text-xs text-text-muted">{es ? 'Las imágenes de la Galería y los sonidos del proyecto aparecen aquí.' : 'The Gallery\'s pictures and the project\'s sounds appear here.'}</p>}
    <ul className="grid grid-cols-2 gap-2">{shownPictures.map(picture => <li key={picture.id} className="rounded border border-border p-1 text-[11px] text-text-primary" data-testid={`board-asset-${label(picture)}`}>
      <button type="button" draggable className="block w-full" title={es ? 'Añadir al tablero (o arrástrala)' : 'Add to the board (or drag it)'} onDragStart={event => { event.dataTransfer.setData(BOARD_ASSET_MIME, picture.id); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => void imageFile(picture.imageData, label(picture)).then(onAdd)} data-testid="board-asset-add">
        <img src={picture.thumbnailData ?? picture.imageData} alt="" className="h-16 w-full rounded object-cover" /><span className="mt-1 flex items-center gap-1 truncate"><ImagePlus className="h-3 w-3 shrink-0" />{label(picture)}</span>
      </button>
    </li>)}</ul>
    {shownSounds.length > 0 && <ul className="space-y-1">{shownSounds.map(sound => <li key={sound.id} className="flex items-center gap-1 text-[11px] text-text-primary" data-testid={`board-sound-${sound.title}`}><button type="button" className="rounded p-1 hover:bg-elevated" aria-label={playing === sound.id ? (es ? 'Parar' : 'Stop') : (es ? 'Escuchar' : 'Listen')} data-testid="board-asset-listen" onClick={() => { if (playing === sound.id) { stop(); return; } stop(); url.current = URL.createObjectURL(sound.blob); audio.current ??= new Audio(); audio.current.src = url.current; setPlaying(sound.id); void audio.current.play().catch(() => setPlaying('')); }}>{playing === sound.id ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}</button><span className="truncate">{sound.title}</span></li>)}</ul>}
  </section>;
}
