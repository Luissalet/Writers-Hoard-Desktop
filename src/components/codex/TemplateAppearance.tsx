import IconPicker from '@/components/common/IconPicker';
import {ProjectIcon} from '@/components/common/ProjectIcon';
import type {CodexTemplate} from '@/engines/codex/templateTypes';
import {effectiveTemplatePresentation} from '@/engines/codex/templateHierarchy';
import {templatePresentationCopy} from '@/engines/codex/templatePresentationCopy';
import {codexTypeColors,codexTypeIcons} from './codexTypeMeta';
export default function TemplateAppearance({draft,templates,locale,onChange}:{draft:CodexTemplate;templates:CodexTemplate[];locale:'es'|'en';onChange:(draft:CodexTemplate)=>void}){
  const c=templatePresentationCopy[locale],effective=effectiveTemplatePresentation(draft,templates),color=effective.color??codexTypeColors[draft.category];
  const field='w-full min-w-0 rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-text-primary';
  return <section className="space-y-3 rounded-lg border border-border p-4" aria-label={c.title} data-testid="template-appearance">
    <h3 className="font-semibold text-sm text-text-primary">{c.title}</h3><p className="text-xs leading-relaxed text-text-muted">{c.help}</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2"><span className="block text-sm text-text-muted">{c.icon}</span><div className="flex flex-wrap items-center gap-2"><IconPicker value={effective.icon} color={color} onChange={icon=>onChange({...draft,icon})} size="sm"/><button type="button" className="text-xs text-accent-gold underline underline-offset-2" onClick={()=>onChange({...draft,icon:undefined})}>{c.reset}</button></div></div>
      <label className="space-y-2 text-sm text-text-muted">{c.color}<div className="flex flex-wrap items-center gap-2"><input type="color" aria-label={c.color} value={color} onChange={event=>onChange({...draft,color:event.target.value})} className="h-9 w-14 rounded border border-border bg-elevated p-1"/><button type="button" className="text-xs text-accent-gold underline underline-offset-2" onClick={()=>onChange({...draft,color:undefined})}>{c.reset}</button></div></label>
      <label className="space-y-2 text-sm text-text-muted">{c.image}<select aria-label={c.image} className={field} value={draft.imageLayout??''} onChange={event=>onChange({...draft,imageLayout:event.target.value?event.target.value as CodexTemplate['imageLayout']:undefined})}><option value="">{c.inherit}</option><option value="portrait">{c.portrait}</option><option value="landscape">{c.landscape}</option><option value="none">{c.none}</option></select></label>
      <label className="space-y-2 text-sm text-text-muted">{c.visibility}<select aria-label={c.visibility} className={field} value={draft.hiddenFromPickers===undefined?'':String(draft.hiddenFromPickers)} onChange={event=>onChange({...draft,hiddenFromPickers:event.target.value===''?undefined:event.target.value==='true'})}><option value="">{c.inherit}</option><option value="false">{c.visible}</option><option value="true">{c.hidden}</option></select></label>
      <label className="space-y-2 text-sm text-text-muted">{c.privacy}<select data-testid="template-private" aria-label={c.privacy} className={field} value={draft.privateType===undefined?'':String(draft.privateType)} onChange={event=>onChange({...draft,privateType:event.target.value===''?undefined:event.target.value==='true'})}><option value="">{c.inherit}</option><option value="false">{c.public}</option><option value="true">{c.private}</option></select></label>
    </div>
    <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted" aria-label={c.current}><ProjectIcon name={effective.icon} fallback={codexTypeIcons[draft.category]} size={18} style={{color}}/><span>{effective.imageLayout?c[effective.imageLayout]:c.legacy} · {effective.hiddenFromPickers?c.hidden:c.visible}{effective.privateType?` · ${c.privateTag}`:''}</span></div>
  </section>;
}
