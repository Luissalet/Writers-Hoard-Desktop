import { useId, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Download, Pencil, Trash2, Upload, X } from 'lucide-react';
import { addTheme, deleteTheme, importThemes, readThemeLibrary, renameTheme, themesFromJson, themesToJson, WorkspaceThemeError, type WorkspaceTheme } from './themeLibrary';
import type { AppearanceScope, WorkspaceAppearanceValues } from './types';
const field = 'mt-1 min-h-9 min-w-0 rounded-lg border border-border bg-elevated px-2 py-1 text-sm text-text-primary';
const button = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-elevated disabled:opacity-50';
const MAX_FILE_BYTES = 24 * 1024 * 1024;
export type ThemeTarget = 'scope' | 'base';

function message(error: unknown, es: boolean, action: 'save' | 'rename' | 'import' | 'delete'): string {
  const code = error instanceof WorkspaceThemeError ? error.code : '';
  if (code === 'name') return es ? 'Pon un nombre de 1 a 60 letras.' : 'Give it a name of 1 to 60 characters.';
  if (code === 'name_taken') return es ? 'Ya hay un tema con ese nombre. Elige otro.' : 'A theme with that name already exists. Pick another.';
  if (code === 'full') return es ? 'La biblioteca está llena (hasta 40 temas y 32 MB). Elimina alguno.' : 'The library is full (up to 40 themes and 32 MB). Delete some.';
  if (code === 'image') return es ? 'La imagen del tema no es un PNG, JPEG o WebP válido de hasta 8 MB.' : 'The theme picture is not a valid PNG, JPEG or WebP up to 8 MB.';
  if (code === 'not_found' || code === 'conflict') return es ? 'La biblioteca cambió mientras tanto. Inténtalo de nuevo.' : 'The library changed meanwhile. Try again.';
  if (action === 'import' || code === 'file') return es ? 'Ese archivo no es un tema válido. Elige un .json exportado desde Apariencia.' : 'That file is not a valid theme. Choose a .json exported from Appearance.';
  return es ? 'No se ha podido completar. Inténtalo de nuevo.' : 'Could not complete. Try again.';
}
const Swatch = ({ values }: { values: WorkspaceAppearanceValues }) => <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 overflow-hidden rounded-full border border-border" style={{ background: `linear-gradient(135deg, ${values.background ?? (values.mode === 'light' ? '#f3efe6' : '#17191a')} 50%, ${values.accent ?? '#d5b575'} 50%)` }} />;

export default function SavedThemes({ scope, values, busy, es, onApply }: { scope: AppearanceScope; values: WorkspaceAppearanceValues; busy: boolean; es: boolean; onApply: (theme: WorkspaceTheme, target: ThemeTarget) => Promise<void> }) {
  const id = useId(), library = useLiveQuery(readThemeLibrary, []);
  const [name, setName] = useState(''), [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null), [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'error' | 'status'; text: string } | null>(null), [working, setWorking] = useState(false);
  const run = async (action: 'save' | 'rename' | 'import' | 'delete', body: () => Promise<string | void>) => {
    if (working) return; setWorking(true);
    try { const text = await body(); setNotice(text ? { kind: 'status', text } : null); } catch (error) { setNotice({ kind: 'error', text: message(error, es, action) }); } finally { setWorking(false); }
  };
  const save = () => run('save', async () => {
    const look = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null)) as WorkspaceAppearanceValues;
    const { theme } = await addTheme({ name, values: look }); setName(''); return es ? `Tema «${theme.name}» guardado.` : `Theme “${theme.name}” saved.`;
  });
  const exportThemes = async (themes: readonly WorkspaceTheme[], file: string) => {
    const { downloadTextFile, sanitizeFilename } = await import('@/engines/writings/manuscriptExport');
    downloadTextFile(themesToJson(themes), `${sanitizeFilename(file)}.json`, 'application/json');
  };
  const importFile = (file?: File) => file && run('import', async () => {
    if (file.size > MAX_FILE_BYTES) throw new WorkspaceThemeError('file');
    const { added } = await importThemes(await themesFromJson(await file.text()));
    return es ? `${added.length === 1 ? '1 tema importado' : `${added.length} temas importados`}.` : `${added.length === 1 ? '1 theme' : `${added.length} themes`} imported.`;
  });
  const themes = library?.themes ?? [];
  return <section className="space-y-3 rounded-lg border border-border p-3" data-testid="theme-library" aria-label={es ? 'Temas guardados' : 'Saved themes'}>
    <h3 className="text-sm font-medium text-text-primary">{es ? 'Temas guardados' : 'Saved themes'}</h3>
    <p className="max-w-prose text-xs text-text-muted">{es ? 'Guarda la apariencia que ves ahora con un nombre y úsala en cualquier proyecto o era. Los temas son de este equipo, sin conexión.' : 'Save the look you see now under a name and use it in any project or era. Themes belong to this device, offline.'}</p>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label htmlFor={`${id}-name`} className="min-w-0 flex-1 text-xs text-text-muted">{es ? 'Nombre del tema' : 'Theme name'}<input id={`${id}-name`} data-testid="theme-name" className={`${field} w-full`} maxLength={60} value={name} onChange={event => setName(event.target.value)} placeholder={es ? 'Por ejemplo: Escritura nocturna' : 'For example: Night writing'} /></label>
      <button type="submit" className={button} data-testid="theme-save" disabled={busy || working || !name.trim()}>{es ? 'Guardar como tema' : 'Save as theme'}</button>
    </form>
    {themes.length === 0 ? <p className="text-xs text-text-muted" data-testid="theme-empty">{es ? 'Aún no has guardado ningún tema.' : 'No saved themes yet.'}</p> : <ul className="space-y-2" data-testid="theme-list">{themes.map(theme => <li key={theme.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-elevated/50 p-2" data-testid={`theme-row-${theme.id}`}>
      <Swatch values={theme.values} />
      {renaming?.id === theme.id ? <form className="flex min-w-0 flex-1 flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); void run('rename', async () => { await renameTheme(theme.id, renaming.name); setRenaming(null); }); }}>
        <input data-testid={`theme-rename-input-${theme.id}`} aria-label={es ? 'Nuevo nombre del tema' : 'New theme name'} className={`${field} !mt-0 flex-1`} maxLength={60} value={renaming.name} onChange={event => setRenaming({ id: theme.id, name: event.target.value })} />
        <button type="submit" className={button} data-testid={`theme-rename-ok-${theme.id}`} disabled={working}><Check size={14} aria-hidden="true" />{es ? 'Cambiar' : 'Rename'}</button>
        <button type="button" className={button} data-testid={`theme-rename-cancel-${theme.id}`} onClick={() => setRenaming(null)}><X size={14} aria-hidden="true" />{es ? 'Cancelar' : 'Cancel'}</button>
      </form> : <span className="min-w-0 flex-1 truncate text-text-primary" data-testid={`theme-name-${theme.id}`}>{theme.name}{theme.values.backgroundImage && <span className="ml-2 text-xs text-text-muted">{es ? 'con imagen' : 'with picture'}</span>}</span>}
      {renaming?.id !== theme.id && (confirming === theme.id ? <span role="group" aria-label={es ? 'Confirmar eliminación' : 'Confirm deletion'} className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-primary">{es ? `¿Eliminar «${theme.name}»?` : `Delete “${theme.name}”?`}</span>
        <button type="button" className={button} data-testid={`theme-delete-confirm-${theme.id}`} disabled={working} onClick={() => void run('delete', async () => { await deleteTheme(theme.id); setConfirming(null); return es ? 'Tema eliminado.' : 'Theme deleted.'; })}>{es ? 'Sí, eliminar' : 'Yes, delete'}</button>
        <button type="button" className={button} data-testid={`theme-delete-cancel-${theme.id}`} onClick={() => setConfirming(null)}>{es ? 'No' : 'No'}</button>
      </span> : <span className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={button} data-testid={`theme-apply-${theme.id}`} disabled={busy || working} onClick={() => void onApply(theme, 'scope')}>{scope.eraId ? es ? 'Aplicar a esta era' : 'Apply to this era' : es ? 'Aplicar a Base' : 'Apply to Base'}</button>
        {scope.eraId && <button type="button" className={button} data-testid={`theme-apply-base-${theme.id}`} disabled={busy || working} onClick={() => void onApply(theme, 'base')}>{es ? 'Aplicar a Base' : 'Apply to Base'}</button>}
        <button type="button" className={button} data-testid={`theme-rename-${theme.id}`} aria-label={es ? `Renombrar ${theme.name}` : `Rename ${theme.name}`} onClick={() => { setRenaming({ id: theme.id, name: theme.name }); setNotice(null); }}><Pencil size={14} aria-hidden="true" />{es ? 'Renombrar' : 'Rename'}</button>
        <button type="button" className={button} data-testid={`theme-export-${theme.id}`} aria-label={es ? `Exportar ${theme.name}` : `Export ${theme.name}`} onClick={() => void exportThemes([theme], `${es ? 'tema' : 'theme'}-${theme.name}`)}><Download size={14} aria-hidden="true" />{es ? 'Exportar' : 'Export'}</button>
        <button type="button" className={button} data-testid={`theme-delete-${theme.id}`} aria-label={es ? `Eliminar ${theme.name}` : `Delete ${theme.name}`} onClick={() => setConfirming(theme.id)}><Trash2 size={14} aria-hidden="true" />{es ? 'Eliminar' : 'Delete'}</button>
      </span>)}
    </li>)}</ul>}
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={`${id}-import`} className={`${button} cursor-pointer`}><Upload size={14} aria-hidden="true" />{es ? 'Importar temas (.json)' : 'Import themes (.json)'}<input id={`${id}-import`} data-testid="theme-import" type="file" accept="application/json,.json" className="sr-only" onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ''; }} /></label>
      <button type="button" className={button} data-testid="theme-export-all" disabled={themes.length === 0} onClick={() => void exportThemes(themes, es ? 'temas-del-espacio' : 'workspace-themes')}><Download size={14} aria-hidden="true" />{es ? 'Exportar todos' : 'Export all'}</button>
    </div>
    {notice && <p role={notice.kind === 'error' ? 'alert' : 'status'} className={notice.kind === 'error' ? 'text-text-primary' : 'text-text-muted'} data-testid={`theme-${notice.kind}`}>{notice.text}</p>}
  </section>;
}
