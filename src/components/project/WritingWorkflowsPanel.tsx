import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import { useLocaleStore } from '@/stores/localeStore';
import { useAiStore } from '@/stores/aiStore';
import { createWritingWorkflow, generateWorkflowStep, listWorkflowMaterials, parseWritingWorkflowDraft, promoteWorkflowStep, saveWritingWorkflow } from '@/services/writingWorkflows';
import type { WritingWorkflow, WritingWorkflowKind, WorkflowStep } from '@/types/writingWorkflow';

const field = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary focus:border-accent-gold focus:outline-none';
const button = 'rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:border-accent-gold focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';

export default function WritingWorkflowsPanel({ projectId }: { projectId: string }) {
  return <WorkflowEditor key={projectId} projectId={projectId} />;
}

function WorkflowEditor({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const locale = useLocaleStore(s => s.locale);
  const es = locale === 'es';
  const text = (a: string, b: string) => es ? a : b;
  const enabled = useAiStore(s => s.config.enabled);
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const material = useLiveQuery(() => listWorkflowMaterials(projectId), [projectId]);
  const key = `writing-workflow-draft:${projectId}`;
  const [draft, setDraft] = useState<WritingWorkflow | null>(() => {
    try { return parseWritingWorkflowDraft(localStorage.getItem(key)); } catch { return null; }
  });
  const [stepId, setStepId] = useState('');
  const [kind, setKind] = useState<WritingWorkflowKind>('reportage');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [createdWritingId, setCreatedWritingId] = useState<string | null>(null);
  const active = draft?.steps.find(s => s.id === stepId) ?? draft?.steps[0];
  // A local recovery copy survives leaving the panel before an explicit save.
  useEffect(() => {
    try { if (draft) localStorage.setItem(key, JSON.stringify(draft)); else localStorage.removeItem(key); }
    catch { setError(es ? 'No se pudo guardar la copia de recuperación. Guarda el proceso antes de salir.' : 'Recovery copy could not be saved. Save the workflow before leaving.'); }
  }, [draft, key, es]);
  const act = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const changeStep = (changes: Partial<WorkflowStep>) => {
    if (draft && active) setDraft({ ...draft, steps: draft.steps.map(s => s.id === active.id ? { ...s, ...changes } : s) });
  };
  const save = async () => {
    if (!draft) return;
    const saved = await saveWritingWorkflow(projectId, draft);
    setDraft(saved);
    setNotice(text('Proceso guardado.', 'Workflow saved.'));
    return saved;
  };
  return <section className="space-y-5" aria-label={text('Procesos de escritura', 'Writing workflows')}>
    <div>
      <h3 className="text-base font-semibold text-text-primary">{text('Del material al texto', 'From material to text')}</h3>
      <p className="mt-1 max-w-prose text-sm text-text-secondary">{text('Organiza tu trabajo en pasos editables. Puedes escribir a mano, omitir pasos y volver a versiones anteriores.', 'Organize your work in editable steps. Write by hand, skip steps and return to earlier versions.')}</p>
    </div>
    <fieldset disabled={busy} className="flex flex-wrap items-end gap-2">
      <label className="min-w-40 flex-1 text-sm text-text-secondary">{text('Nombre del proceso', 'Workflow name')}<input className={field} value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label className="text-sm text-text-secondary">{text('Tipo', 'Type')}<select className={field} value={kind} onChange={e => setKind(e.target.value as WritingWorkflowKind)}><option value="reportage">{text('Reportaje', 'Reportage')}</option><option value="essay">{text('Ensayo', 'Essay')}</option><option value="narrative">{text('Narrativa', 'Narrative')}</option></select></label>
      <button type="button" className={button} onClick={() => void act(async () => { if (draft) await save(); const created = await createWritingWorkflow(projectId, kind, title, locale); setDraft(created); setStepId(created.steps[0].id); setTitle(''); })}>{text('Crear proceso', 'Create workflow')}</button>
    </fieldset>
    {!!project?.writingWorkflows?.length && <label className="block text-sm text-text-secondary">{text('Continuar un proceso', 'Continue a workflow')}<select disabled={busy} className={field} value={draft?.id ?? ''} onChange={e => { const id = e.target.value; void act(async () => { if (draft) await save(); const fresh = await db.projects.get(projectId); setDraft(fresh?.writingWorkflows?.find(w => w.id === id) ?? null); setStepId(''); }); }}><option value="" disabled>{text('Selecciona un proceso', 'Choose a workflow')}</option>{project.writingWorkflows.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}</select></label>}
    {draft && active && <fieldset disabled={busy} className="space-y-4">
      <label className="block text-sm text-text-secondary">{text('Título', 'Title')}<input className={field} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
      <details className="border-y border-border py-3"><summary className="cursor-pointer text-sm text-text-primary">{text('Material del proyecto', 'Project material')} ({draft.materials.length})</summary><p className="my-2 text-xs text-text-secondary">{text('La IA recibe solo el material seleccionado, los pasos anteriores y el contexto editorial del proyecto. Usa el modelo configurado; puede ser remoto.', 'AI receives selected material, previous steps and the project editorial context. It uses your configured model, which may be remote.')}</p><div className="max-h-52 space-y-2 overflow-y-auto">{material?.length ? material.map(m => <label key={`${m.kind}:${m.id}`} className="flex items-start gap-2 text-sm text-text-primary"><input type="checkbox" className="mt-1 accent-accent-gold" checked={draft.materials.some(r => r.kind === m.kind && r.id === m.id)} onChange={e => setDraft({ ...draft, materials: e.target.checked ? [...draft.materials, { kind: m.kind, id: m.id }] : draft.materials.filter(r => !(r.kind === m.kind && r.id === m.id)) })} /><span className="break-words">{m.title}</span></label>) : <p className="text-sm text-text-secondary">{text('Añade notas, escritos, recortes o referencias al proyecto para seleccionarlos aquí.', 'Add notes, writings, clippings or references to the project to select them here.')}</p>}</div></details>
      <div className="flex flex-wrap gap-2" aria-label={text('Pasos', 'Steps')}>{draft.steps.map((s, i) => <button key={s.id} type="button" className={`${button} ${active.id === s.id ? 'border-accent-gold text-accent-gold' : ''}`} aria-pressed={active.id === s.id} onClick={() => setStepId(s.id)}>{i + 1}. {s.title}{s.skipped ? text(' · omitido', ' · skipped') : s.completed ? text(' · completo', ' · done') : ''}</button>)}</div>
      {material && draft.materials.some(r => !material.some(m => m.id === r.id && m.kind === r.kind)) && <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary"><span>{text('Hay referencias a material eliminado.', 'Some material references were deleted.')}</span><button type="button" className={button} onClick={() => setDraft({ ...draft, materials: draft.materials.filter(r => material.some(m => m.id === r.id && m.kind === r.kind)) })}>{text('Quitar referencias ausentes', 'Remove missing references')}</button></div>}
      <label className="block text-sm text-text-secondary">{text('Nombre del paso', 'Step name')}<input className={field} value={active.title} onChange={e => changeStep({ title: e.target.value })} /></label>
      <label className="block text-sm text-text-secondary">{text('Instrucciones', 'Instructions')}<textarea className={field} rows={3} value={active.instructions} onChange={e => changeStep({ instructions: e.target.value })} /></label>
      <div className="flex flex-wrap gap-5 text-sm text-text-primary"><label><input type="checkbox" checked={active.skipped} onChange={e => changeStep({ skipped: e.target.checked })} /> {text('Omitir este paso', 'Skip this step')}</label><label><input type="checkbox" checked={active.completed} onChange={e => changeStep({ completed: e.target.checked })} /> {text('Marcar como completo', 'Mark as done')}</label></div>
      <label className="block text-sm text-text-secondary">{text('Tu texto', 'Your text')}<textarea className={`${field} min-h-52`} rows={10} value={active.output} onChange={e => changeStep({ output: e.target.value })} /></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} onClick={() => void act(async () => { await save(); })}>{text('Guardar proceso', 'Save workflow')}</button>
        <button type="button" className={button} onClick={() => void act(async () => { const copy = await createWritingWorkflow(projectId, draft.kind, `${draft.title} (${text('copia', 'copy')})`, locale); setDraft(await saveWritingWorkflow(projectId, { ...copy, materials: draft.materials, steps: structuredClone(draft.steps) })); setNotice(text('Copia guardada como un proceso nuevo.', 'Copy saved as a new workflow.')); })}>{text('Guardar como nuevo proceso', 'Save as new workflow')}</button>
        <button type="button" className={button} disabled={!enabled || active.skipped} onClick={() => void act(async () => { const saved = await save(); if (!saved) return; const result = await generateWorkflowStep(projectId, saved, active.id); const next = { ...saved, steps: saved.steps.map(s => s.id === active.id ? { ...s, output: result } : s) }; setDraft(next); setDraft(await saveWritingWorkflow(projectId, next, 'ai')); setNotice(text('Propuesta guardada. Revisa los hechos y las atribuciones.', 'Proposal saved. Review facts and attribution.')); })}>{text('Proponer con IA', 'Suggest with AI')}</button>
        <button type="button" className={button} disabled={!active.output.trim()} onClick={() => void act(async () => { await save(); setCreatedWritingId(await promoteWorkflowStep(projectId, draft.id, active.id)); setNotice(text('Disponible en Escritos. El texto de origen se conserva.', 'Available in Writings. The source text is preserved.')); })}>{text('Crear escrito', 'Create writing')}</button>
        {createdWritingId && <button type="button" className={button} onClick={() => navigate(`/project/${encodeURIComponent(projectId)}/writings?writing=${encodeURIComponent(createdWritingId)}`)}>{text('Abrir escrito', 'Open writing')}</button>}
      </div>
      {!enabled && <p className="text-xs text-text-secondary">{text('Activa y configura la IA en Ajustes para generar propuestas. Puedes completar todos los pasos a mano.', 'Enable and configure AI in Settings to generate proposals. You can complete all steps by hand.')}</p>}
      {!!draft.history.length && <details className="border-t border-border pt-3"><summary className="cursor-pointer text-sm text-text-primary">{text('Versiones anteriores', 'Previous versions')} ({draft.history.length})</summary><ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">{[...draft.history].reverse().map(h => <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-secondary"><span>{new Date(h.createdAt).toLocaleString(locale)}</span><button type="button" className={button} onClick={() => void act(async () => { const saved = await save(); if (saved) setDraft(await saveWritingWorkflow(projectId, { ...saved, steps: structuredClone(h.steps) }, 'restore')); })}>{text('Restaurar pasos', 'Restore steps')}</button></li>)}</ul></details>}
    </fieldset>}
    {busy && <p role="status" className="text-sm text-text-secondary">{text('Procesando…', 'Working…')}</p>}
    {notice && <p role="status" className="text-sm text-text-secondary">{notice}</p>}
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
  </section>;
}
