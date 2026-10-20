import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, Eye, LoaderCircle, Save } from 'lucide-react';
import { db } from '@/db';
import { updateProject } from '@/db/operations';
import { useTranslation } from '@/i18n/useTranslation';
import { buildWorldWiki, exportWorldWiki, loadWorldWikiData, wikiCopy, WIKI_TYPES, type WorldWikiOptions } from '@/services/worldWikiExport';
import type { CodexEntry, WorldMap } from '@/types';
import { wikiPresentationCopy } from './wikiPresentationCopy';

const control = 'min-h-9 rounded-lg border border-border bg-deep px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';
const button = `${control} inline-flex items-center justify-center gap-2 hover:bg-elevated disabled:cursor-not-allowed`;
export default function WikiExportControl({ projectId, entries }: { projectId: string; entries: CodexEntry[] }) {
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const maps = useLiveQuery(() => db.worldMaps.where('projectId').equals(projectId).toArray(), [projectId]) ?? [];
  return project ? <WikiExportForm key={projectId} projectId={projectId} entries={entries} maps={maps} initial={project.wikiOptions ?? {}} /> : null;
}

function WikiExportForm({ projectId, entries, maps, initial }: { projectId: string; entries: CodexEntry[]; maps: WorldMap[]; initial: WorldWikiOptions }) {
  const { locale } = useTranslation(); const copy = wikiCopy(locale); const presentation = wikiPresentationCopy[locale];
  const [options, setOptions] = useState<WorldWikiOptions>(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'done' | 'error' | 'saved' | null>(null);
  const [preview, setPreview] = useState(''); const [previewWidth, setPreviewWidth] = useState<'desktop' | 'tablet' | 'phone'>('desktop');
  const types = options.types ?? WIKI_TYPES;
  const selected = entries.filter(entry => entry.projectId === projectId && types.includes(entry.type) && !options.excludedEntryIds?.includes(entry.id)).length;
  const valid = selected > 0 || options.includeMaps !== false && maps.some(map => !options.excludedMapIds?.includes(map.id));
  const fields = [...new Set(entries.filter(entry => types.includes(entry.type)).flatMap(entry => [...Object.keys(entry.fields), ...Object.keys(entry.referenceFields ?? {})]))].sort((a, b) => a.localeCompare(b));
  const change = (next: Partial<WorldWikiOptions>) => { setOptions(current => ({ ...current, ...next })); setStatus(null); };
  const omit = (key: 'excludedEntryIds' | 'excludedMapIds' | 'excludedFields', id: string, included: boolean) => change({ [key]: included ? (options[key] ?? []).filter(value => value !== id) : [...new Set([...(options[key] ?? []), id])] });
  const run = async (work: () => Promise<void>) => { if (busy) return; setBusy(true); setStatus(null); try { await work(); } catch { setStatus('error'); } finally { setBusy(false); } };
  const booleanOption = (key: 'includeMaps' | 'includeImages' | 'includeCover' | 'includeMedia', label: string, defaultValue: boolean) => <label className="inline-flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" className="accent-accent-gold" disabled={busy} checked={options[key] ?? defaultValue} onChange={event => change({ [key]: event.target.checked })} />{label}</label>;
  return <details className="mb-5 border-b border-border pb-4">
    <summary className="w-fit cursor-pointer rounded text-sm text-text-muted hover:text-accent-gold focus-visible:outline-2 focus-visible:outline-accent-gold"><span className="inline-flex items-center gap-2"><Download size={15} aria-hidden="true" />{copy.export}</span></summary>
    <div className="space-y-4 pt-4">
      <p className="max-w-2xl text-sm text-text-muted">{copy.description}</p>
      <fieldset disabled={busy} className="flex flex-wrap gap-x-5 gap-y-2"><legend className="mb-2 text-sm font-semibold text-text-primary">{copy.contents}</legend>{WIKI_TYPES.map(type => <label key={type} className="inline-flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" checked={types.includes(type)} onChange={event => change({ types: event.target.checked ? [...types, type] : types.filter(value => value !== type) })} className="accent-accent-gold" />{copy.types[type]}</label>)}</fieldset>
      <div className="flex flex-wrap gap-x-6 gap-y-2">{booleanOption('includeMaps', copy.mapOption, true)}{booleanOption('includeImages', copy.images, true)}{booleanOption('includeMedia', locale === 'es' ? 'Incluir audio y vídeo vinculados' : 'Include linked audio and video', true)}{booleanOption('includeCover', presentation.cover, false)}</div>
      <details className="rounded border border-border p-3"><summary className="cursor-pointer text-sm text-text-primary">{presentation.documents}</summary><div className="mt-3 max-h-60 space-y-2 overflow-y-auto">{entries.filter(entry => entry.projectId === projectId && types.includes(entry.type)).map(entry => <label key={entry.id} className="flex items-center gap-2 text-sm text-text-primary"><input className="accent-accent-gold" type="checkbox" disabled={busy} checked={!options.excludedEntryIds?.includes(entry.id)} onChange={event => omit('excludedEntryIds', entry.id, event.target.checked)} />{entry.title}</label>)}{options.includeMaps !== false && maps.map(map => <label key={map.id} className="flex items-center gap-2 text-sm text-text-primary"><input className="accent-accent-gold" type="checkbox" disabled={busy} checked={!options.excludedMapIds?.includes(map.id)} onChange={event => omit('excludedMapIds', map.id, event.target.checked)} />{copy.maps}: {map.title}</label>)}</div></details>
      {fields.length > 0 && <details className="rounded border border-border p-3"><summary className="cursor-pointer text-sm text-text-primary">{presentation.fields}</summary><div className="mt-3 flex max-h-48 flex-wrap gap-x-5 gap-y-2 overflow-y-auto">{fields.map(field => <label key={field} className="inline-flex items-center gap-2 text-sm text-text-primary"><input className="accent-accent-gold" type="checkbox" disabled={busy} checked={!options.excludedFields?.includes(field)} onChange={event => omit('excludedFields', field, event.target.checked)} />{field}</label>)}</div></details>}
      <fieldset disabled={busy} className="flex flex-wrap items-end gap-4"><legend className="mb-2 text-sm font-semibold text-text-primary">{presentation.presentation}</legend>
        <label className="flex flex-col gap-1 text-sm text-text-primary">{presentation.theme}<select className={control} value={options.theme ?? 'parchment'} onChange={event => change({ theme: event.target.value as WorldWikiOptions['theme'] })}>{(['parchment', 'paper', 'night', 'forest'] as const).map(theme => <option key={theme} value={theme}>{presentation[theme]}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-sm text-text-primary">{presentation.layout}<select className={control} value={options.layout ?? 'sidebar'} onChange={event => change({ layout: event.target.value as WorldWikiOptions['layout'] })}>{(['sidebar', 'journal'] as const).map(layout => <option key={layout} value={layout}>{presentation[layout]}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-sm text-text-primary">{presentation.font}<select className={control} value={options.font ?? 'serif'} onChange={event => change({ font: event.target.value as WorldWikiOptions['font'] })}>{(['serif', 'sans'] as const).map(font => <option key={font} value={font}>{presentation[font]}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-sm text-text-primary">{presentation.accent}<input className="h-10 w-12 rounded border border-border" type="color" value={options.accent ?? '#755516'} onChange={event => change({ accent: event.target.value })} /></label><button className={button} type="button" onClick={() => change({ accent: undefined })}>{presentation.reset}</button>
      </fieldset>
      <p className="max-w-2xl text-xs leading-relaxed text-text-muted">{presentation.hideHelp}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || !valid} className={button} onClick={() => { void run(async () => { const artifact = buildWorldWiki(await loadWorldWikiData(projectId, { ...options, locale }), { ...options, locale }); setPreview(artifact.html); }); }}><Eye size={16} />{presentation.preview}</button>
        <button type="button" disabled={busy || !valid} className={button} onClick={() => { void run(async () => { await exportWorldWiki(projectId, { ...options, locale }); setStatus('done'); }); }}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}{busy ? copy.busy : copy.download}</button>
        <button type="button" disabled={busy} className={button} onClick={() => { void run(async () => { await updateProject(projectId, { wikiOptions: options }); setStatus('saved'); }); }}><Save size={16} />{presentation.save}</button><span className="text-xs text-text-muted">{selected} {copy.entries}</span>
      </div>
      {!valid && <p className="text-sm text-text-muted">{copy.emptySelection}</p>}
      {status && <p role={status === 'error' ? 'alert' : 'status'} className={`text-sm ${status === 'error' ? 'text-danger' : 'text-text-muted'}`}>{status === 'saved' ? presentation.saved : copy[status]}</p>}
      {preview && <div className="space-y-3 border-t border-border pt-4"><div className="flex flex-wrap items-center gap-2">{(['desktop', 'tablet', 'phone'] as const).map(width => <button key={width} className={button} aria-pressed={previewWidth === width} onClick={() => setPreviewWidth(width)}>{presentation[width]}</button>)}<button className={`${button} ml-auto`} onClick={() => setPreview('')}>{copy.close}</button></div><div className="max-w-full overflow-auto bg-surface p-2"><iframe title={presentation.previewTitle} sandbox="allow-scripts" srcDoc={preview} className="mx-auto block h-[32rem] max-w-full border border-border bg-white" style={{ width: previewWidth === 'phone' ? 390 : previewWidth === 'tablet' ? 768 : '100%' }} /></div></div>}
    </div>
  </details>;
}
