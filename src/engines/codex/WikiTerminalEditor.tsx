import type { WorldWikiOptions } from '@/types/worldWiki';
import { WIKI_DEFAULT_OPENING, WIKI_PHOSPHORS, WIKI_TERMINAL_LIMITS, patchWikiTerminal, type WikiOpeningCommand, type WikiPhosphor, type WikiTerminalOptions } from '@/services/wikiProfiles/terminal';

const control = 'min-h-10 min-w-0 rounded-lg border border-border bg-deep px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';
type Change = (patch: Partial<WorldWikiOptions> | ((current: WorldWikiOptions) => Partial<WorldWikiOptions>)) => void;

/** Phosphor palette, CRT scanlines, dithered pictures, boot line and the "New here?" commands. Terminal and Shell only. */
export default function WikiTerminalEditor({ options, change, locale }: { options: WorldWikiOptions; change: Change; locale: 'es' | 'en' }) {
  const es = locale === 'es';
  if (options.layout !== 'terminal' && options.layout !== 'shell') return null;
  const terminal = options.terminal, opening = terminal?.opening ?? [];
  const patch = (next: Partial<WikiTerminalOptions>) => change(current => ({ terminal: patchWikiTerminal(current.terminal, next) }));
  const setOpening = (next: WikiOpeningCommand[]) => patch({ opening: next });
  const editOpening = (index: number, edit: Partial<WikiOpeningCommand>) => setOpening(opening.map((item, at) => at === index ? { ...item, ...edit } : item));
  return <div className="space-y-3 sm:col-span-2" data-testid="wiki-terminal-editor">
    <p className="text-sm font-semibold text-text-primary">{es ? 'Extras de terminal' : 'Terminal extras'}</p>
    <div className="flex flex-wrap items-end gap-4">
      <label className="grid gap-1 text-sm">{es ? 'Fósforo' : 'Phosphor'}<select data-testid="wiki-terminal-phosphor" className={control} value={terminal?.phosphor ?? ''} onChange={event => patch({ phosphor: (event.target.value || undefined) as WikiPhosphor | undefined })}><option value="">{es ? 'Ninguno (usa los colores)' : 'None (use the colours)'}</option>{(Object.keys(WIKI_PHOSPHORS) as WikiPhosphor[]).map(id => <option key={id} value={id}>{WIKI_PHOSPHORS[id].name[locale]}</option>)}</select></label>
      <label className="inline-flex items-center gap-2 text-sm"><input data-testid="wiki-terminal-scanlines" type="checkbox" className="accent-accent-gold" checked={!!terminal?.scanlines} onChange={event => patch({ scanlines: event.target.checked })} />{es ? 'Líneas de pantalla CRT' : 'CRT scanlines'}</label>
      <label className="inline-flex items-center gap-2 text-sm"><input data-testid="wiki-terminal-dither" type="checkbox" className="accent-accent-gold" checked={!!terminal?.dither} onChange={event => patch({ dither: event.target.checked })} />{es ? 'Imágenes con tramado (dither)' : 'Dithered pictures'}</label>
    </div>
    {terminal?.phosphor && <p className="text-xs text-text-muted">{es ? 'Mientras haya un fósforo elegido, sustituye al tema y a los colores propios.' : 'While a phosphor is chosen it replaces the theme and any custom colours.'}</p>}
    <label className="grid gap-1 text-sm">{es ? 'Línea de arranque' : 'Boot line'}<input type="text" data-testid="wiki-terminal-boot" className={control} maxLength={WIKI_TERMINAL_LIMITS.bootLine} value={terminal?.bootLine ?? ''} onChange={event => patch({ bootLine: event.target.value })} /></label>
    {options.layout === 'shell'
      ? <div className="grid gap-1 text-sm"><span>{es ? 'Lista «¿Primera vez por aquí?»' : '"New here?" list'}</span>
        {opening.map((item, index) => <div key={index} data-testid="wiki-terminal-opening-row" className="flex flex-wrap items-center gap-2">
          <input type="text" data-testid="wiki-terminal-opening-command" aria-label={es ? `Comando ${index + 1}` : `Command ${index + 1}`} className={`${control} w-48`} maxLength={WIKI_TERMINAL_LIMITS.command} value={item.command} onChange={event => editOpening(index, { command: event.target.value })} />
          <input type="text" data-testid="wiki-terminal-opening-note" aria-label={es ? `Nota ${index + 1}` : `Note ${index + 1}`} className={`${control} min-w-0 flex-1`} maxLength={WIKI_TERMINAL_LIMITS.note} value={item.note ?? ''} onChange={event => editOpening(index, { note: event.target.value || undefined })} />
          <button type="button" data-testid="wiki-terminal-opening-remove" className={control} onClick={() => setOpening(opening.filter((_, at) => at !== index))}>{es ? 'Quitar' : 'Remove'}</button>
        </div>)}
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="wiki-terminal-opening-add" className={control} disabled={opening.length >= WIKI_TERMINAL_LIMITS.opening} onClick={() => setOpening([...opening, { command: '' }])}>{es ? 'Añadir comando' : 'Add command'}</button>
          <button type="button" data-testid="wiki-terminal-opening-defaults" className={control} onClick={() => setOpening(WIKI_DEFAULT_OPENING.map(item => ({ ...item })))}>{es ? 'Usar comandos básicos' : 'Use the basic commands'}</button>
        </div></div>
      : <p className="text-xs text-text-muted">{es ? 'La lista de comandos de inicio necesita el diseño Shell, que trae la línea de comandos.' : 'The opening command list needs the Shell layout, which has the command line.'}</p>}
  </div>;
}
