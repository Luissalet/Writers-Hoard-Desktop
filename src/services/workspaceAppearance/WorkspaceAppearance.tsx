import { useId, useState } from 'react';
import { ChevronDown, Palette, Save } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useWorkspaceAppearance } from './useWorkspaceAppearance';
import { getWorkspaceAppearance, resetWorkspaceAppearance, saveWorkspaceAppearance, WorkspaceAppearanceConflict } from './store';
import { recordUndoable, UndoStaleError } from '@/services/undoJournal';
import { t } from '@/i18n/useTranslation';
import SavedThemes, { type ThemeTarget } from './SavedThemes';
import { appearanceReplaceReceipt, applyThemeValues, undoAppearanceReplace, type WorkspaceTheme } from './themeLibrary';
import { THEME_PRESETS, accentWithHue, hexToHsl, presetPatch } from './themePresets';
import { MAX_BACKGROUND_BYTES, validateRaster } from './validation';
import { appearanceFonts, workspaceEffects, type AppearanceRead, type AppearanceScope, type WorkspaceAppearanceValues } from './types';
const field = 'mt-1 min-h-9 w-full rounded-lg border border-border bg-elevated px-2 py-1 text-sm text-text-primary';
const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated disabled:opacity-50';
interface Draft { read: AppearanceRead; patch: WorkspaceAppearanceValues; error?: string; saved?: boolean }
export default function WorkspaceAppearance(scope: AppearanceScope) {
  const { locale } = useTranslation(), es = locale === 'es', id = useId();
  const { appearance } = useWorkspaceAppearance(scope), key = JSON.stringify([scope.projectId, scope.eraId ?? null]);
  const { appearance: baseAppearance } = useWorkspaceAppearance({ projectId: scope.projectId });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}), [busy, setBusy] = useState(false), [pending, setPending] = useState<{ theme: WorkspaceTheme; target: ThemeTarget } | null>(null);
  const draft: Draft | undefined = drafts[key] ?? (appearance ? { read: appearance, patch: {} } : undefined), values = { ...draft?.read.effective, ...draft?.patch };
  const update = (patch: WorkspaceAppearanceValues) => { if (appearance) setDrafts(previous => ({ ...previous, [key]: { ...(previous[key] ?? { read: appearance, patch: {} }), patch: { ...previous[key]?.patch, ...patch }, saved: false } })); };
  const load = () => appearance && setDrafts(previous => ({ ...previous, [key]: { read: appearance, patch: {} } }));
  const save = async (reset = false) => {
    if (!draft || busy) return; setBusy(true);
    try {
      const read = reset ? await resetWorkspaceAppearance(scope, draft.read.revision) : await saveWorkspaceAppearance(scope, draft.patch, draft.read.revision);
      setDrafts(previous => ({ ...previous, [key]: { read, patch: {}, saved: true } }));
    } catch { setDrafts(previous => ({ ...previous, [key]: { ...previous[key], error: es ? 'La apariencia ha cambiado o no se ha podido guardar. Tu borrador sigue aquí; puedes recargar los valores guardados.' : 'Appearance changed or could not save. Your draft is preserved; you can reload saved values.' } })); }
    finally { setBusy(false); }
  };
  const applyTheme = async (theme: WorkspaceTheme, target: ThemeTarget, confirmed = false) => {
    if (!draft || busy) return;
    // The theme replaces the whole look: with unsaved edits in the form, ask first.
    if (!confirmed && Object.keys(draft.patch).length > 0) { setPending({ theme, target }); return; }
    setPending(null); setBusy(true);
    try {
      // Always the revision-checked save, against the revision and values the person SAW (not one fetched at click time).
      const toBase = target === 'base' && !!scope.eraId, seen = toBase ? baseAppearance : draft.read;
      if (!seen) throw Error('appearance_not_loaded');
      const targetScope = toBase ? { projectId: scope.projectId } : scope;
      const saved = await applyThemeValues(targetScope, theme.values, seen.revision);
      const read = toBase ? await getWorkspaceAppearance(scope) : saved;
      setDrafts(previous => ({ ...previous, [key]: { read, patch: {}, saved: true } }));
      // Undo: the previous own values go back, only while nothing was saved after the apply.
      try {
        const receipt = await appearanceReplaceReceipt(targetScope.eraId, seen.own, saved.revision);
        recordUndoable({
          projectId: scope.projectId, kind: 'appearance', label: theme.name,
          notice: t('undo.themeApplied').replace('{title}', theme.name),
          undo: async () => {
            try { await undoAppearanceReplace(scope.projectId, receipt); }
            catch (error) { if (error instanceof WorkspaceAppearanceConflict || (error instanceof Error && error.message === 'picture_gone')) throw new UndoStaleError(); throw error; }
            setDrafts(previous => Object.fromEntries(Object.entries(previous).filter(([name]) => name !== key)));
          },
        });
      } catch { /* No receipt kept: the theme stays applied, there is just no Deshacer. */ }
    } catch { setDrafts(previous => ({ ...previous, [key]: { ...(previous[key] ?? { read: draft.read, patch: {} }), error: es ? 'La apariencia ha cambiado o el tema no se ha podido aplicar. Tu borrador sigue aquí; puedes recargar los valores guardados.' : 'Appearance changed or the theme could not be applied. Your draft is preserved; you can reload saved values.' } })); }
    finally { setBusy(false); }
  };
  const image = async (file?: File) => {
    if (!file || !appearance) return; const targetKey = key, read = appearance; setBusy(true);
    try {
      if (file.size > MAX_BACKGROUND_BYTES) throw Error('image too large');
      const value = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = reject; reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); });
      validateRaster(value);
      await new Promise<void>((resolve, reject) => { const picture = new Image(); picture.onload = () => resolve(); picture.onerror = reject; picture.src = value; });
      setDrafts(previous => ({ ...previous, [targetKey]: { ...(previous[targetKey] ?? { read, patch: {} }), patch: { ...previous[targetKey]?.patch, backgroundImage: value }, saved: false } }));
    } catch { setDrafts(previous => ({ ...previous, [targetKey]: { ...(previous[targetKey] ?? { read, patch: {} }), error: es ? 'Elige una imagen PNG, JPEG o WebP válida de hasta 8 MB.' : 'Choose a valid PNG, JPEG or WebP image up to 8 MB.' } })); }
    finally { setBusy(false); }
  };
  return <details className="workspace-appearance-form max-h-[70%] shrink-0 overflow-auto border-b border-border bg-surface px-4 py-2 text-sm" data-testid="workspace-appearance" onToggle={event => { if (event.currentTarget.open && !draft) load(); }}>
    <summary className="flex min-h-9 cursor-pointer items-center gap-2 rounded text-text-primary"><Palette size={16} aria-hidden="true" />{es ? 'Apariencia' : 'Appearance'}<span className="text-xs text-text-muted">{scope.eraId ? es ? 'Esta era' : 'This era' : es ? 'Base del proyecto' : 'Project base'}</span><ChevronDown size={14} aria-hidden="true" className="appearance-disclosure" /></summary>
    {draft && <fieldset disabled={busy} className="mt-3 space-y-4 pb-2">
      <p className="max-w-prose text-xs text-text-muted">{es ? 'Se aplica al guardar. La imagen se guarda en el proyecto, sin conexión. Las paletas del lector permanecen independientes.' : 'Applied when saved. The image is stored in the project offline. Reader palettes remain independent.'}{scope.eraId && (es ? ' Los campos sin personalizar heredan Base.' : ' Unchanged fields inherit Base.')}</p>
      <div role="group" aria-label={es ? 'Estilos predefinidos' : 'Built-in styles'} className="flex flex-wrap items-center gap-2" data-testid="theme-presets">
        <span className="text-xs text-text-muted">{es ? 'Estilos' : 'Styles'}</span>
        {THEME_PRESETS.map(preset => <button key={preset.id} type="button" data-testid={`theme-preset-${preset.id}`} title={es ? preset.es : preset.en} aria-label={es ? `Estilo ${preset.es}` : `${preset.en} style`} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-2 py-1 text-xs text-text-primary hover:bg-elevated" onClick={() => update(presetPatch(preset))}><span aria-hidden="true" className="inline-block h-5 w-5 rounded-full border border-border" style={{ background: `linear-gradient(135deg, ${preset.values.background} 50%, ${preset.values.accent} 50%)` }} />{es ? preset.es : preset.en}</button>)}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <label>{es ? 'Tema' : 'Theme'}<select className={field} aria-label={es ? 'Tema del espacio' : 'Workspace theme'} value={values.mode ?? 'dark'} onChange={event => update({ mode: event.target.value as 'dark' | 'light', background: event.target.value === 'light' ? '#f3efe6' : '#17191a', accent: event.target.value === 'light' ? '#725221' : '#d5b575' })}><option value="dark">{es ? 'Carbón · original' : 'Charcoal · original'}</option><option value="light">{es ? 'Claro' : 'Light'}</option></select></label>
        <label>{es ? 'Fondo' : 'Background'}<input className={`${field} h-9 p-1`} type="color" aria-label={es ? 'Fondo del espacio' : 'Workspace background'} value={values.background ?? (values.mode === 'light' ? '#f3efe6' : '#17191a')} onChange={event => update({ background: event.target.value })} /></label>
        <label>{es ? 'Acento' : 'Accent'}<input className={`${field} h-9 p-1`} type="color" aria-label={es ? 'Acento del espacio' : 'Workspace accent'} value={values.accent ?? '#d5b575'} onChange={event => update({ accent: event.target.value })} /></label>
        <label>{es ? 'Tono del acento' : 'Accent hue'} · {hexToHsl(values.accent ?? '#d5b575')[0]}°<input className="mt-3 w-full" data-testid="theme-hue" type="range" min="0" max="359" aria-label={es ? 'Tono del acento' : 'Accent hue'} value={hexToHsl(values.accent ?? '#d5b575')[0]} onChange={event => update({ accent: accentWithHue(values.accent ?? '#d5b575', Number(event.target.value)) })} /></label>
        <label>{es ? 'Grano' : 'Grain'} · {values.grain ?? 0}%<input className="mt-3 w-full" type="range" min="0" max="100" aria-label={es ? 'Grano del fondo' : 'Background grain'} value={values.grain ?? 0} onChange={event => update({ grain: Number(event.target.value) })} /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{(['uiFont', 'proseFont'] as const).map(kind => <label key={kind}>{kind === 'uiFont' ? es ? 'Fuente de la interfaz' : 'Interface font' : es ? 'Fuente de prosa del editor' : 'Editor prose font'}<select className={field} aria-label={kind === 'uiFont' ? es ? 'Fuente de la interfaz' : 'Interface font' : es ? 'Fuente de prosa del editor' : 'Editor prose font'} value={values[kind] ?? (kind === 'uiFont' ? 'incumbent' : 'reading')} onChange={event => update({ [kind]: event.target.value })}>{kind === 'proseFont' && <option value="reading">{es ? 'Conservar ajuste de lectura' : 'Keep reading preference'}</option>}{Object.keys(appearanceFonts).map(font => <option key={font} value={font}>{({ incumbent: es ? 'Writer · original' : 'Writer · original', system: es ? 'Sistema sans' : 'System sans', serif: 'Georgia / Charter', humanist: 'Candara / Trebuchet', classic: 'Palatino / Georgia', mono: 'Consolas / monospace' })[font]}</option>)}</select></label>)}</div>
      <p className="text-xs text-text-muted">{es ? 'Se usan fuentes instaladas y alternativas del sistema; no se descargan fuentes.' : 'Uses installed fonts and system fallbacks; no font downloads.'}</p>
      <div className="flex flex-wrap items-center gap-3"><label htmlFor={`${id}-image`} className="min-w-0 flex-1">{es ? 'Imagen local (PNG, JPEG, WebP · hasta 8 MB)' : 'Local image (PNG, JPEG, WebP · up to 8 MB)'}<input id={`${id}-image`} type="file" accept="image/png,image/jpeg,image/webp" className={`${field} max-w-full`} onChange={event => { void image(event.target.files?.[0]); event.target.value = ''; }} /></label><button type="button" className={button} disabled={!values.backgroundImage} onClick={() => update({ backgroundImage: null })}>{es ? 'Quitar imagen' : 'Remove image'}</button>{values.backgroundImage && <img src={values.backgroundImage} alt={es ? 'Fondo seleccionado' : 'Selected background'} className="h-12 w-20 rounded object-cover" />}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>{es ? 'Efecto de fondo' : 'Background effect'}<select className={field} aria-label={es ? 'Efecto de fondo' : 'Background effect'} value={values.effect ?? 'none'} onChange={event => update({ effect: event.target.value as WorkspaceAppearanceValues['effect'] })}>{workspaceEffects.map(effect => <option key={effect} value={effect}>{({ none: es ? 'Ninguno' : 'None', snow: es ? 'Nieve' : 'Snow', rain: es ? 'Lluvia' : 'Rain', embers: es ? 'Brasas' : 'Embers', fireflies: es ? 'Luciérnagas' : 'Fireflies' })[effect]}</option>)}</select></label>
        <label>{es ? 'Intensidad del efecto' : 'Effect intensity'} · {values.effectIntensity ?? 35}%<input className="mt-3 w-full" type="range" min="0" max="100" aria-label={es ? 'Intensidad del efecto' : 'Effect intensity'} value={values.effectIntensity ?? 35} disabled={!values.effect || values.effect === 'none'} onChange={event => update({ effectIntensity: Number(event.target.value) })} /></label>
      </div>
      <p className="text-xs text-text-muted">{es ? 'Los efectos se ocultan con movimiento reducido y en modo de rendimiento.' : 'Effects are hidden with reduced motion and in performance mode.'}</p>
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={values.performance ?? false} onChange={event => update({ performance: event.target.checked })} /><span>{es ? 'Mejorar rendimiento' : 'Boost performance'}<span className="block text-xs text-text-muted">{es ? 'Superficies opacas, sin desenfoque, imagen, grano ni efectos de fondo. Conserva las opciones guardadas.' : 'Opaque surfaces, without blur, background image, grain or effects. Keeps your saved choices.'}</span></span></label>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={Object.keys(draft.patch).length === 0} onClick={() => void save()}><Save size={14} aria-hidden="true" />{busy ? es ? 'Guardando…' : 'Saving…' : es ? 'Guardar apariencia' : 'Save appearance'}</button><button type="button" className={button} onClick={() => void save(true)}>{scope.eraId ? es ? 'Heredar Base' : 'Inherit Base' : es ? 'Restablecer original' : 'Restore original'}</button><button type="button" className={button} onClick={load}>{es ? 'Recargar valores guardados' : 'Reload saved values'}</button></div>
      <SavedThemes scope={scope} values={values} busy={busy} es={es} onApply={(theme, target) => applyTheme(theme, target)} />
      {pending && <div role="group" aria-label={es ? 'Confirmar tema' : 'Confirm theme'} data-testid="theme-apply-confirm" className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-text-primary"><span className="min-w-0 flex-1">{es ? `Tienes cambios sin guardar en este formulario. Aplicar «${pending.theme.name}» sustituye toda la apariencia y los descarta.` : `You have unsaved changes in this form. Applying “${pending.theme.name}” replaces the whole look and discards them.`}</span><button type="button" className={button} data-testid="theme-apply-confirm-no" onClick={() => setPending(null)}>{es ? 'Cancelar' : 'Cancel'}</button><button type="button" className={button} data-testid="theme-apply-confirm-yes" onClick={() => void applyTheme(pending.theme, pending.target, true)}>{es ? 'Aplicar tema' : 'Apply theme'}</button></div>}
      {draft.error && <p role="alert" className="text-text-primary">{draft.error}</p>}{draft.saved && <p role="status" className="text-text-muted">{es ? 'Apariencia guardada.' : 'Appearance saved.'}</p>}
    </fieldset>}
  </details>;
}
