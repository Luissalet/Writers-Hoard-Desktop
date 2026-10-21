import { useState } from 'react';
import { applyTemplateSync, previewTemplateSync, type TemplateSyncOptions, type TemplateSyncPreview } from '@/engines/codex/templateSync';
import type { CodexTemplate } from '@/engines/codex/templateTypes';
const button = 'rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated disabled:opacity-50';
export default function TemplateSyncPanel({ projectId, template, locale, disabled }: { projectId: string; template: CodexTemplate; locale: 'es' | 'en'; disabled: boolean }) {
  const es = locale === 'es';
  const [options, setOptions] = useState<TemplateSyncOptions>({ content: 'empty' });
  const [preview, setPreview] = useState<TemplateSyncPreview>();
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const change = (next: TemplateSyncOptions) => { setOptions(next); setPreview(undefined); setNotice(''); };
  const run = async (apply: boolean) => {
    setBusy(true); setNotice('');
    try {
      if (apply && preview) { const result = await applyTemplateSync(preview); setPreview(undefined); setNotice(es ? `${result.updated} fichas actualizadas; ${result.preserved} valores propios conservados.` : `${result.updated} cards updated; ${result.preserved} authored values preserved.`); }
      else setPreview(await previewTemplateSync(projectId, template.id, options));
    } catch { setPreview(undefined); setNotice(es ? 'Los datos han cambiado o no se pudo sincronizar. Genera otra vista previa.' : 'Data changed or sync failed. Generate a new preview.'); }
    finally { setBusy(false); }
  };
  return <details className="border-t border-border pt-3" data-testid="template-sync-panel">
    <summary className="cursor-pointer text-sm font-semibold text-text-primary py-1">{es ? 'Sincronizar fichas existentes' : 'Sync existing cards'}</summary>
    <fieldset disabled={disabled || busy} className="mt-3 space-y-3 min-w-0">
      <p className="text-xs text-text-muted">{es ? 'Añade propiedades ausentes y bloques a las fichas de este tipo. Los valores escritos se conservan; elige expresamente lo que quieras restablecer.' : 'Add missing properties and blocks to cards of this type. Authored values are preserved; explicitly choose anything to reset.'}</p>
      <label className="flex gap-2 items-center text-sm text-text-primary"><input type="checkbox" checked={!!options.includeSubtypes} onChange={event => change({ ...options, includeSubtypes: event.target.checked })} />{es ? 'Incluir subtipos' : 'Include subtypes'}</label>
      <label className="block text-sm text-text-muted">{es ? 'Bloques por defecto' : 'Default blocks'}<select aria-label={es ? 'Sincronizar bloques' : 'Sync blocks'} className="mt-1 w-full rounded-lg border border-border bg-elevated px-3 py-2 text-text-primary" value={options.content} onChange={event => change({ ...options, content: event.target.value as TemplateSyncOptions['content'] })}>{(es ? ['Solo en fichas sin contenido', 'Conservar todos los bloques', 'Añadir al final', 'Reemplazar el contenido completo'] : ['Only cards without content', 'Keep all blocks', 'Append to the end', 'Replace the entire content']).map((label, i) => <option key={label} value={['empty', 'keep', 'append', 'replace'][i]}>{label}</option>)}</select></label>
      <details><summary className="text-sm text-text-muted cursor-pointer">{es ? 'Restablecer valores concretos' : 'Reset selected values'}</summary><div className="flex flex-wrap gap-x-4 gap-y-2 mt-2">{Object.keys(template.fields).map(key => <label key={key} className="text-sm text-text-primary flex gap-2 items-center"><input type="checkbox" checked={options.resetFields?.includes(key) ?? false} onChange={event => change({ ...options, resetFields: event.target.checked ? [...options.resetFields ?? [], key] : options.resetFields?.filter(item => item !== key) })} />{template.propertyDefinitions?.find(item => item.key === key)?.label ?? key}</label>)}</div></details>
      <button type="button" className={button} onClick={() => void run(false)}>{es ? 'Ver cambios antes de sincronizar' : 'Preview sync changes'}</button>
      {preview && <div className="space-y-2"><ul className="max-h-56 overflow-auto space-y-2 text-sm text-text-primary">{preview.changes.map(change => <li key={change.id} className="border-b border-border pb-2 break-words"><strong>{change.title}</strong><p className="text-xs text-text-muted">{es ? 'Añadir' : 'Add'}: {change.added.join(', ') || '—'} · {es ? 'Restablecer' : 'Reset'}: {change.reset.join(', ') || '—'} · {es ? 'Conservar' : 'Preserve'}: {change.preserved.join(', ') || '—'}{change.bodyChanged ? es ? ' · Cambiar bloques' : ' · Change blocks' : ''}</p></li>)}</ul>{!preview.changes.length && <p className="text-sm text-text-muted">{es ? 'No hay fichas de este tipo.' : 'No cards use this type.'}</p>}<button type="button" className={button} disabled={!preview.changes.some(change => change.added.length || change.reset.length || change.bodyChanged)} onClick={() => void run(true)}>{es ? 'Aplicar estos cambios' : 'Apply these changes'}</button></div>}
    </fieldset>
    {notice && <p role="status" className="mt-2 text-sm text-text-primary">{notice}</p>}
    {disabled && <p className="text-xs text-text-muted mt-2">{es ? 'Guarda la plantilla antes de preparar la sincronización.' : 'Save the template before preparing sync.'}</p>}
  </details>;
}
