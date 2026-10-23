import { useState } from 'react';
import type { WorldWikiOptions } from '@/types/worldWiki';
import { WIKI_COLOR_KEYS, type WikiColors } from '@/services/wikiProfiles/appearance';
import { WIKI_PALETTES, WIKI_PALETTE_GROUPS, WIKI_PALETTE_NAME_MAX, addCustomWikiPalette, completeWikiColors, deleteCustomWikiPalette, matchingWikiPalette, renameCustomWikiPalette, wikiPaletteColors, type WikiPaletteGroup } from '@/services/wikiProfiles/palettes';

const control = 'min-h-10 min-w-0 rounded-lg border border-border bg-deep px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';
const small = `${control} min-h-9 hover:bg-elevated`;
type Change = (patch: Partial<WorldWikiOptions> | ((current: WorldWikiOptions) => Partial<WorldWikiOptions>)) => void;

export function Swatches({ colors, testId }: { colors?: Partial<WikiColors>; testId?: string }) {
  const full = completeWikiColors(colors);
  return <span data-testid={testId} className="inline-flex overflow-hidden rounded border border-border" aria-hidden="true">{WIKI_COLOR_KEYS.map(key => <span key={key} className="h-5 w-5" style={{ background: full[key] }} />)}</span>;
}

const errors = (es: boolean): Record<string, string> => ({
  wiki_palette_name_invalid: es ? `Escribe un nombre de hasta ${WIKI_PALETTE_NAME_MAX} caracteres.` : `Enter a name of up to ${WIKI_PALETTE_NAME_MAX} characters.`,
  wiki_palette_name_taken: es ? 'Ya tienes una paleta con ese nombre.' : 'You already have a palette with that name.',
  wiki_palette_limit: es ? 'Has llegado al máximo de paletas guardadas; borra alguna.' : 'You reached the saved palette limit; delete one first.',
  wiki_palette_missing: es ? 'Esa paleta ya no existe.' : 'That palette no longer exists.',
});

/** Catalogue of named palettes plus the author's own saved ones. Picking only fills the five colours. */
export default function WikiPalettePicker({ options, change, locale }: { options: WorldWikiOptions; change: Change; locale: 'es' | 'en' }) {
  const es = locale === 'es', custom = options.customPalettes ?? [];
  const [name, setName] = useState(''), [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null), [problem, setProblem] = useState('');
  const current = matchingWikiPalette(options.colors, custom);
  const attempt = (work: () => void) => { setProblem(''); try { work(); } catch (error) { setProblem(errors(es)[(error as Error).message] ?? (error as Error).message); } };
  const apply = (id: string) => { const colors = wikiPaletteColors(id, custom); if (colors) change({ colors }); };
  return <div className="space-y-3 sm:col-span-2" data-testid="wiki-palette-picker">
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-sm">{es ? 'Paleta' : 'Palette'}
        <select data-testid="wiki-palette-select" className={control} value={current} onChange={event => event.target.value && apply(event.target.value)}>
          <option value="">{options.colors ? (es ? 'Personalizada (colores actuales)' : 'Custom (current colours)') : (es ? 'Sin paleta propia (usa el tema)' : 'No palette (uses the theme)')}</option>
          {(Object.keys(WIKI_PALETTE_GROUPS) as WikiPaletteGroup[]).map(group => <optgroup key={group} label={WIKI_PALETTE_GROUPS[group][locale]}>{WIKI_PALETTES.filter(item => item.group === group).map(item => <option key={item.id} value={item.id}>{item.name[locale]}</option>)}</optgroup>)}
          {custom.length > 0 && <optgroup label={es ? 'Mis paletas' : 'My palettes'}>{custom.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>}
        </select>
      </label>
      <Swatches testId="wiki-palette-swatches" colors={options.colors} />
      <button type="button" data-testid="wiki-palette-clear" className={small} disabled={!options.colors} onClick={() => change({ colors: undefined })}>{es ? 'Volver al tema' : 'Back to the theme'}</button>
    </div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-sm">{es ? 'Nombre de mi paleta' : 'My palette name'}<input type="text" data-testid="wiki-palette-name" className={control} maxLength={WIKI_PALETTE_NAME_MAX} value={name} onChange={event => setName(event.target.value)} /></label>
      <button type="button" data-testid="wiki-palette-save" className={small} onClick={() => attempt(() => { change({ customPalettes: addCustomWikiPalette(custom, name, options.colors) }); setName(''); })}>{es ? 'Guardar mi paleta' : 'Save my palette'}</button>
    </div>
    {problem && <p role="alert" data-testid="wiki-palette-error" className="text-sm text-danger">{problem}</p>}
    {custom.length > 0 && <ul data-testid="wiki-palette-custom" className="space-y-2" aria-label={es ? 'Mis paletas guardadas' : 'My saved palettes'}>
      {custom.map(item => <li key={item.id} data-testid="wiki-palette-row" className="flex flex-wrap items-center gap-2">
        <Swatches colors={item.colors} />
        {renaming?.id === item.id
          ? <><input type="text" data-testid="wiki-palette-rename-input" aria-label={es ? 'Nuevo nombre' : 'New name'} className={control} maxLength={WIKI_PALETTE_NAME_MAX} value={renaming.name} onChange={event => setRenaming({ id: item.id, name: event.target.value })} />
            <button type="button" data-testid="wiki-palette-rename-ok" className={small} onClick={() => attempt(() => { change({ customPalettes: renameCustomWikiPalette(custom, item.id, renaming.name) }); setRenaming(null); })}>{es ? 'Aceptar' : 'OK'}</button>
            <button type="button" data-testid="wiki-palette-rename-cancel" className={small} onClick={() => { setRenaming(null); setProblem(''); }}>{es ? 'Cancelar' : 'Cancel'}</button></>
          : <><span className="mr-auto min-w-0 text-sm">{item.name}</span>
            <button type="button" data-testid="wiki-palette-apply" className={small} onClick={() => apply(item.id)}>{es ? 'Usar' : 'Use'}</button>
            <button type="button" data-testid="wiki-palette-rename" className={small} onClick={() => { setProblem(''); setRenaming({ id: item.id, name: item.name }); }}>{es ? 'Renombrar' : 'Rename'}</button>
            <button type="button" data-testid="wiki-palette-delete" className={small} onClick={() => attempt(() => change({ customPalettes: deleteCustomWikiPalette(custom, item.id) }))}>{es ? 'Borrar' : 'Delete'}</button></>}
      </li>)}
    </ul>}
    <p className="text-xs text-text-muted">{es ? 'Las paletas guardadas viajan con el perfil (copias de seguridad y clones incluidos); pulsa «Guardar preferencias» para conservarlas.' : 'Saved palettes travel with the profile (backups and clones included); press "Save preferences" to keep them.'}</p>
  </div>;
}
