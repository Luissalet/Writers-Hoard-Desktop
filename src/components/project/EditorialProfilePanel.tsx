import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Loader2, Save } from 'lucide-react';
import { useLocaleStore } from '@/stores/localeStore';
import { useAiStore } from '@/stores/aiStore';
import { createLocalDraftStore } from '@/hooks/localDraftStore';
import type { EditorialProfile } from '@/types/editorial';
import { EDITORIAL_LIMITS, EditorialProfileError, getEditorialProfile, previewEditorialVoice, proposeEditorialVoice, saveEditorialProfile, validateEditorialProfile } from '@/services/editorialProfile';

const copy = {
  es: {
    title: 'Voz y contexto', description: 'Define cómo quieres escribir y qué debe tener presente la asistencia de este proyecto.',
    enabled: 'Aplicar el perfil guardado a la asistencia del proyecto', voice: 'Voz del autor', audience: 'Para quién escribes', rules: 'Criterios de escritura y revisión', context: 'Contexto y límites del proyecto', examples: 'Muestra de tu escritura',
    voiceHint: 'Ritmo, vocabulario, tono o punto de vista.', audienceHint: 'Lectores y conocimientos que puedes dar por supuestos.', rulesHint: 'Por ejemplo: atribuir las declaraciones, conservar citas textuales o evitar explicaciones redundantes.', contextHint: 'Hechos de tu historia, enfoque del artículo o preguntas abiertas. Este contexto no sustituye las fuentes.', examplesHint: 'Pega entre 100 y 6000 caracteres de un texto propio para proponer una voz.',
    derive: 'Proponer voz desde la muestra', proposal: 'Propuesta de voz · revisa antes de usar', use: 'Usar esta propuesta', save: 'Guardar perfil', saved: 'Perfil guardado', dirty: 'Cambios sin guardar', loading: 'Cargando perfil…', retry: 'Reintentar',
    error: 'No se pudo completar la operación. Conservamos los cambios para que puedas reintentar.', conflict: 'El perfil cambió en otra vista. Tus cambios siguen aquí; puedes copiarlos antes de cargar la versión guardada.', reload: 'Descartar cambios y cargar perfil guardado', sampleError: 'Revisa la longitud de la muestra o del fragmento.',
    preview: 'Comparar la voz', passage: 'Fragmento de prueba (30–2000 caracteres)', compare: 'Generar comparación', plain: 'Sin perfil', guided: 'Con este perfil', original: 'Original',
    privacy: 'Solo los campos que escribas aquí se incorporan al perfil. La asistencia utiliza la conexión IA configurada, que puede ser remota. La comparación hace dos generaciones y no modifica tus escritos.',
    active: 'El perfil guardado acompaña al copiloto, los procesos de escritura, el análisis y la revisión. Las fuentes se consultan con los controles de cada herramienta.',
  },
  en: {
    title: 'Voice and context', description: 'Define how you want to write and what assistance for this project should keep in mind.',
    enabled: 'Apply the saved profile to project assistance', voice: 'Author voice', audience: 'Who you write for', rules: 'Writing and review criteria', context: 'Project context and boundaries', examples: 'A sample of your writing',
    voiceHint: 'Rhythm, vocabulary, tone or point of view.', audienceHint: 'Readers and knowledge you can assume.', rulesHint: 'For example: attribute statements, preserve quotations or avoid redundant explanations.', contextHint: 'Story facts, article angle or open questions. This context does not replace sources.', examplesHint: 'Paste 100–6000 characters of your own writing to propose a voice.',
    derive: 'Propose voice from sample', proposal: 'Proposed voice · review before using', use: 'Use this proposal', save: 'Save profile', saved: 'Profile saved', dirty: 'Unsaved changes', loading: 'Loading profile…', retry: 'Retry',
    error: 'The operation could not be completed. Your changes are retained so you can retry.', conflict: 'The profile changed in another view. Your changes are still here; copy them before loading the saved version.', reload: 'Discard changes and load saved profile', sampleError: 'Check the sample or passage length.',
    preview: 'Compare the voice', passage: 'Test passage (30–2000 characters)', compare: 'Generate comparison', plain: 'Without profile', guided: 'With this profile', original: 'Original',
    privacy: 'Only fields you enter here become part of the profile. Assistance uses your configured AI connection, which may be remote. Comparison runs two generations and does not change your writing.',
    active: 'The saved profile accompanies the copilot, writing workflows, analysis and review. Sources remain subject to each tool’s context controls.',
  },
};
const field = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-gold';
const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:border-accent-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';

function ProfileEditor({ projectId, initial }: { projectId: string; initial: EditorialProfile }) {
  const locale = useLocaleStore(state => state.locale);
  const c = copy[locale];
  const config = useAiStore(state => state.config);
  const recovery = createLocalDraftStore<EditorialProfile>(`wh.editorial-drafts.v1.${projectId}`, (value): value is EditorialProfile => {
    try { validateEditorialProfile(value as EditorialProfile); return true; } catch { return false; }
  });
  const [draft, setDraft] = useState(() => recovery.get('profile') ?? initial);
  const [dirty, setDirty] = useState(() => recovery.has('profile'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [proposal, setProposal] = useState('');
  const [passage, setPassage] = useState('');
  const [comparison, setComparison] = useState<Awaited<ReturnType<typeof previewEditorialVoice>> | null>(null);
  if (!dirty && initial.revision > draft.revision) setDraft(initial);
  const edit = (patch: Partial<EditorialProfile>) => { const next = { ...draft, ...patch }; recovery.set('profile', next); setDraft(next); setDirty(true); setSaved(false); setComparison(null); };
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); }
    catch (reason) { setError(reason instanceof EditorialProfileError ? reason.code === 'conflict' ? c.conflict : reason.code === 'sample' ? c.sampleError : c.error : c.error); }
    finally { setBusy(false); }
  }
  async function save() {
    const next = await saveEditorialProfile(projectId, draft, draft.revision);
    recovery.delete('profile');
    setDraft(next); setDirty(false); setSaved(true);
  }
  const fields = [
    ['voice', c.voice, c.voiceHint, 3], ['audience', c.audience, c.audienceHint, 2],
    ['rules', c.rules, c.rulesHint, 3], ['context', c.context, c.contextHint, 3],
  ] as const;
  return <section aria-label={c.title} className="rounded-xl border border-border bg-surface p-5">
    <h3 className="font-serif text-lg font-semibold text-text-primary">{c.title}</h3>
    <p className="mt-2 max-w-prose text-sm text-text-muted">{c.description}</p>
    <label className="mt-5 flex items-start gap-3 text-sm text-text-primary">
      <input type="checkbox" checked={draft.enabled} disabled={busy} onChange={event => edit({ enabled: event.target.checked })} className="mt-1 accent-accent-gold" />{c.enabled}
    </label>
    <p className="mt-2 max-w-prose text-xs text-text-muted">{c.active}</p>
    <fieldset disabled={busy} className="mt-5 grid gap-5 md:grid-cols-2">
      {fields.map(([key, title, hint, rows]) => <label key={key} className="block text-sm text-text-primary">
        {title}<span className="mb-2 mt-1 block text-xs text-text-muted">{hint}</span>
        <textarea className={field} rows={rows} maxLength={EDITORIAL_LIMITS[key]} value={draft[key]} onChange={event => edit({ [key]: event.target.value })} />
      </label>)}
    </fieldset>
    <details className="mt-5 border-t border-border pt-4">
      <summary className="cursor-pointer text-sm text-text-primary">{c.examples}</summary>
      <label className="mt-3 block text-sm text-text-muted">{c.examplesHint}<textarea className={`${field} mt-2`} rows={5} disabled={busy} maxLength={EDITORIAL_LIMITS.examples} value={draft.examples} onChange={event => { edit({ examples: event.target.value }); setProposal(''); }} /></label>
      <button type="button" className={`${button} mt-3`} disabled={busy || !config.enabled || draft.examples.trim().length < 100} onClick={() => void perform(async () => setProposal(await proposeEditorialVoice(draft.examples, config, locale)))}>{c.derive}</button>
      {proposal && <div className="mt-4"><label className="block text-sm text-text-muted">{c.proposal}<textarea rows={4} maxLength={EDITORIAL_LIMITS.voice} value={proposal} disabled={busy} onChange={event => setProposal(event.target.value)} className={`${field} mt-2`} /></label><button type="button" className={`${button} mt-2`} disabled={busy} onClick={() => { edit({ voice: proposal }); setProposal(''); }}>{c.use}</button></div>}
    </details>
    <details className="mt-4 border-t border-border pt-4">
      <summary className="cursor-pointer text-sm text-text-primary">{c.preview}</summary>
      <label className="mt-3 block text-sm text-text-muted">{c.passage}<textarea rows={3} className={`${field} mt-2`} maxLength={2000} disabled={busy} value={passage} onChange={event => { setPassage(event.target.value); setComparison(null); }} /></label>
      <button type="button" className={`${button} mt-3`} disabled={busy || !config.enabled || passage.trim().length < 30} onClick={() => void perform(async () => setComparison(await previewEditorialVoice(draft, passage, config, locale)))}>{c.compare}</button>
      {comparison && <div className="mt-4 grid gap-5 md:grid-cols-2">{(['plain', 'guided'] as const).map(key => <div key={key}><h4 className="font-medium text-text-primary">{c[key]}</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-text-muted">{comparison[key]}</p></div>)}</div>}
    </details>
    <p className="mt-4 max-w-prose text-xs text-text-muted">{c.privacy}</p>
    {error && <div role="alert" className="mt-3 text-sm text-red-300"><p>{error}</p>{error === c.conflict && <button type="button" className={`${button} mt-2`} disabled={busy} onClick={() => void perform(async () => { setDraft(await getEditorialProfile(projectId)); recovery.delete('profile'); setDirty(false); setSaved(false); })}>{c.reload}</button>}</div>}
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <button type="button" className={button} disabled={busy || !dirty} onClick={() => void perform(save)}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{c.save}</button>
      <span role="status" className="text-sm text-text-muted">{dirty ? c.dirty : saved ? c.saved : ''}</span>
    </div>
  </section>;
}

export default function EditorialProfilePanel({ projectId }: { projectId: string }) {
  const locale = useLocaleStore(state => state.locale);
  const [retry, setRetry] = useState(0);
  const state = useLiveQuery(async () => {
    try { return { profile: await getEditorialProfile(projectId) }; }
    catch { return { profile: null }; }
  }, [projectId, retry]);
  if (!state) return <p role="status" className="text-sm text-text-muted">{copy[locale].loading}</p>;
  if (!state.profile) return <div role="alert"><p>{copy[locale].error}</p><button type="button" className={button} onClick={() => setRetry(value => value + 1)}>{copy[locale].retry}</button></div>;
  return <ProfileEditor key={projectId} projectId={projectId} initial={state.profile} />;
}
