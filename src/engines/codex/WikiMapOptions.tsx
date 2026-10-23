import type { WorldWikiOptions } from '@/types/worldWiki';

const control = 'min-h-9 rounded-lg border border-border bg-deep px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold';

/** How the exported wiki treats its maps: pan and zoom, illustration layers, clouds and ambience sound. Everything is off by default. */
export default function WikiMapOptions({ options, change, locale, busy }: { options: WorldWikiOptions; change: (patch: Partial<WorldWikiOptions>) => void; locale: 'es' | 'en'; busy: boolean }) {
  const es = locale === 'es';
  const toggle = (key: 'mapArtwork' | 'mapClouds' | 'mapAmbience', label: string) => <label className="inline-flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" className="accent-accent-gold" data-testid={`wiki-${key}`} disabled={busy} checked={options[key] === true} onChange={event => change({ [key]: event.target.checked || undefined })} />{label}</label>;
  return <fieldset disabled={busy} className="flex flex-wrap items-end gap-x-6 gap-y-2" data-testid="wiki-map-options">
    <legend className="mb-2 text-sm font-semibold text-text-primary">{es ? 'Mapas de la wiki' : 'Wiki maps'}</legend>
    <label className="grid gap-1 text-sm text-text-primary">{es ? 'Mover y ampliar' : 'Pan and zoom'}
      <select className={control} data-testid="wiki-map-navigation" value={options.mapNavigation ?? ''} onChange={event => change({ mapNavigation: (event.target.value || undefined) as WorldWikiOptions['mapNavigation'] })}>
        <option value="">{es ? 'No (mapa fijo)' : 'Off (fixed map)'}</option>
        <option value="contained">{es ? 'Dentro del marco' : 'Contained in the frame'}</option>
        <option value="free">{es ? 'Libre' : 'Free'}</option>
      </select>
    </label>
    {toggle('mapArtwork', es ? 'Capas de ilustración' : 'Illustration layers')}
    {toggle('mapClouds', es ? 'Nubes' : 'Clouds')}
    {toggle('mapAmbience', es ? 'Sonido ambiente (con botón)' : 'Ambience sound (with button)')}
  </fieldset>;
}
