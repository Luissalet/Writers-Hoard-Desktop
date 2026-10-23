// The handout templates: pick a style, write the text, see it drawn, and keep it
// in the gallery. Opened from a player-material block; editing a handout that is
// already in the gallery redraws that same picture, so blocks pointing at it stay valid.
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import Modal from '@/components/common/Modal';
import { HANDOUT_LIMITS, HANDOUT_TEMPLATES, HANDOUT_TEMPLATE_NAMES, HOOK_PRESETS, HOOK_PRESET_NAMES, handoutSvgUrl, hookPreset, normalizeHandoutDefinition, type HandoutDefinition, type HookPreset } from '@/engines/prepBlocks/handouts';
import { saveHandout } from '@/engines/prepBlocks/operations';
import type { PrepLang } from '@/engines/prepBlocks/model';
import { prepCopy } from './copy';
import { prepButtonClass, prepFieldClass, prepPrimaryClass } from './shared';

function StudioForm({ projectId, lang, existingId, initial, onSaved, onClose }: { projectId: string; lang: PrepLang; existingId?: string; initial: HandoutDefinition; onSaved: (imageId: string, title: string) => void; onClose: () => void }) {
  const c = prepCopy[lang], [definition, setDefinition] = useState<HandoutDefinition>(initial), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const names = HANDOUT_TEMPLATE_NAMES[definition.template];
  // Kept as typed (spaces and line ends included); it is cleaned when drawn and saved.
  const patch = (change: Partial<HandoutDefinition>) => setDefinition(current => ({ ...current, ...change }));
  const preview = (() => { try { return handoutSvgUrl(definition); } catch { return ''; } })();
  const save = async () => {
    if (busy) return;
    if (!definition.body.trim() && !definition.title.trim()) { setError(c.empty); return; }
    setBusy(true); setError('');
    try { const row = await saveHandout(projectId, definition, existingId); onSaved(row.id, definition.title || row.name || ''); }
    catch { setError(c.saveFailed); } finally { setBusy(false); }
  };
  return <div className="grid gap-4 md:grid-cols-2" data-testid="handout-studio">
    <div className="space-y-2">
      <div role="radiogroup" aria-label={c.template} className="flex flex-wrap gap-2">{HANDOUT_TEMPLATES.map(template => <button key={template} type="button" role="radio" aria-checked={definition.template === template} data-testid={`handout-template-${template}`} className={`${prepButtonClass} ${definition.template === template ? 'border-accent-gold' : ''}`} onClick={() => patch({ template })}>{HANDOUT_TEMPLATE_NAMES[template][lang]}</button>)}</div>
      <select className={`${prepFieldClass} w-full`} aria-label={c.hook} data-testid="handout-hook" value="" onChange={event => { const preset = event.target.value as HookPreset; if (preset) patch(hookPreset(preset, lang)); }}>
        <option value="">{c.hook}</option>{HOOK_PRESETS.map(preset => <option key={preset} value={preset}>{HOOK_PRESET_NAMES[preset][lang]}</option>)}
      </select>
      <input className={`${prepFieldClass} w-full`} maxLength={HANDOUT_LIMITS.title} aria-label={c.title} placeholder={names.titleHint[lang]} data-testid="handout-title" value={definition.title} onChange={event => patch({ title: event.target.value })} />
      <input className={`${prepFieldClass} w-full`} maxLength={HANDOUT_LIMITS.extra} aria-label={c.extra} placeholder={names.extraHint[lang]} data-testid="handout-extra" value={definition.extra} onChange={event => patch({ extra: event.target.value })} />
      <textarea className={`${prepFieldClass} w-full py-1`} rows={9} maxLength={HANDOUT_LIMITS.body} aria-label={c.body} placeholder={definition.template === 'noticeboard' ? (lang === 'es' ? 'Un anuncio por párrafo; la primera línea de cada uno es su título.' : 'One notice per paragraph; the first line of each is its heading.') : c.body} data-testid="handout-body" value={definition.body} onChange={event => patch({ body: event.target.value })} />
      <input className={`${prepFieldClass} w-full`} maxLength={HANDOUT_LIMITS.signature} aria-label={c.signature} placeholder={names.signatureHint[lang]} data-testid="handout-signature" value={definition.signature} onChange={event => patch({ signature: event.target.value })} />
      {error && <p role="alert" className="text-sm text-danger" data-testid="handout-error">{error}</p>}
      <div className="flex flex-wrap gap-2"><button type="button" className={prepPrimaryClass} disabled={busy} data-testid="handout-save" onClick={() => void save()}>{existingId ? c.saveEdit : c.save}</button><button type="button" className={prepButtonClass} data-testid="handout-close" onClick={onClose}>{c.close}</button></div>
    </div>
    <div className="min-w-0 rounded-lg border border-border bg-deep p-2" aria-label={c.preview}>{preview && <img src={preview} alt={definition.title || names[lang]} className="h-auto w-full" data-testid="handout-preview" />}</div>
  </div>;
}

export default function HandoutStudio({ open, projectId, lang, existingId, onSaved, onClose }: { open: boolean; projectId: string; lang: PrepLang; existingId?: string; onSaved: (imageId: string, title: string) => void; onClose: () => void }) {
  const c = prepCopy[lang];
  const row = useLiveQuery(async () => (existingId ? db.inspirationImages.get(existingId) : null), [existingId]);
  const ready = !existingId || row !== undefined;
  const initial = normalizeHandoutDefinition(row?.handout ?? { template: 'letter', lang });
  return <Modal open={open} onClose={onClose} title={c.studio} wide>{open && ready && <StudioForm key={existingId ?? 'new'} projectId={projectId} lang={lang} existingId={row?.handout ? existingId : undefined} initial={initial} onSaved={onSaved} onClose={onClose} />}</Modal>;
}
