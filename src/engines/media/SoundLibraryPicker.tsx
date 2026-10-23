// The built-in sound library: browse by category or search, listen, and add a
// sound to the project's sounds (made on this device, no download).
import { useEffect, useRef, useState } from 'react';
import { SOUND_CATEGORIES, SOUND_CATEGORY_LABELS, SOUND_LIBRARY, addLibrarySound, renderLibrarySound, wavBlob, type SoundCategory } from './soundLibrary';
import type { LocalMediaAsset } from './types';

const control = 'min-h-8 rounded border border-border bg-deep px-2 text-xs text-text-primary';
const button = 'min-h-8 rounded border border-border px-2 text-xs text-text-primary hover:bg-elevated disabled:opacity-50';

export default function SoundLibraryPicker({ projectId, locale, onAdded }: { projectId: string; locale: 'es' | 'en'; onAdded?: (asset: LocalMediaAsset) => void }) {
  const es = locale === 'es';
  const [category, setCategory] = useState<SoundCategory | ''>(''), [query, setQuery] = useState(''), [added, setAdded] = useState<string[]>([]), [playing, setPlaying] = useState('');
  const audio = useRef<HTMLAudioElement | null>(null), url = useRef('');
  const stop = () => { audio.current?.pause(); if (url.current) URL.revokeObjectURL(url.current); url.current = ''; setPlaying(''); };
  useEffect(() => () => { audio.current?.pause(); if (url.current) URL.revokeObjectURL(url.current); }, []);
  const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const shown = SOUND_LIBRARY.filter(sound => (!category || sound.category === category) && (!query.trim() || fold(`${sound.es} ${sound.en}`).includes(fold(query.trim()))));
  return <details data-testid="sound-library" className="my-3 rounded-lg border border-border p-2 text-xs text-text-primary">
    <summary className="cursor-pointer">{es ? 'Biblioteca de sonidos (sin descargas)' : 'Sound library (no downloads)'}</summary>
    <div className="mt-2 flex flex-wrap gap-2">
      <select data-testid="sound-library-category" aria-label={es ? 'Categoría' : 'Category'} className={control} value={category} onChange={event => setCategory(event.target.value as SoundCategory | '')}>
        <option value="">{es ? 'Todas' : 'All'}</option>{SOUND_CATEGORIES.map(value => <option key={value} value={value}>{SOUND_CATEGORY_LABELS[value][locale]}</option>)}
      </select>
      <input data-testid="sound-library-search" type="search" aria-label={es ? 'Buscar sonido' : 'Find a sound'} placeholder={es ? 'Buscar…' : 'Search…'} className={`${control} min-w-0 flex-1`} value={query} onChange={event => setQuery(event.target.value)} />
    </div>
    <ul className="mt-2 space-y-1">{shown.map(sound => <li key={sound.id} data-testid={`sound-library-item-${sound.id}`} className="flex flex-wrap items-center gap-2">
      <span className="min-w-0 flex-1">{sound[locale]} <span className="text-text-muted">· {SOUND_CATEGORY_LABELS[sound.category][locale]} · {sound.seconds} s{sound.loop ? (es ? ' · en bucle' : ' · loops') : ''}</span></span>
      <button type="button" data-testid={`sound-library-preview-${sound.id}`} className={button} onClick={() => {
        if (playing === sound.id) { stop(); return; }
        stop(); url.current = URL.createObjectURL(wavBlob(renderLibrarySound(sound.id)));
        audio.current ??= new Audio(); audio.current.src = url.current; audio.current.loop = false; setPlaying(sound.id);
        void audio.current.play().catch(() => setPlaying(''));
      }}>{playing === sound.id ? (es ? 'Parar' : 'Stop') : (es ? 'Escuchar' : 'Listen')}</button>
      <button type="button" data-testid={`sound-library-add-${sound.id}`} className={button} disabled={added.includes(sound.id)} onClick={() => { void addLibrarySound(projectId, sound.id, locale).then(asset => { setAdded(list => [...list, sound.id]); onAdded?.(asset); }); }}>{added.includes(sound.id) ? (es ? 'Añadido' : 'Added') : (es ? 'Añadir al proyecto' : 'Add to project')}</button>
    </li>)}</ul>
    {!shown.length && <p className="mt-2 text-text-muted">{es ? 'Ningún sonido coincide.' : 'No sound matches.'}</p>}
  </details>;
}
