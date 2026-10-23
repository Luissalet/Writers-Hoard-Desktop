import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Wand2 } from 'lucide-react';
import Modal from '@/components/common/Modal';
import type { CodexEntry, CodexEntryType } from '@/types';
import { CARD_GUIDES, cardGuide, guideAnswers } from '@/engines/codex/guides';
import { generateId } from '@/utils/idGenerator';

const field = 'w-full rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-gold';
const button = 'inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated disabled:opacity-40';

/** A card made by answering a few questions, one at a time. */
export default function GuidedCardDialog({ projectId, open, locale, onClose, onCreate }: { projectId: string; open: boolean; locale: string; onClose: () => void; onCreate: (entry: CodexEntry) => Promise<void> }) {
  const lang = locale === 'en' ? 'en' : 'es';
  const [type, setType] = useState<CodexEntryType | null>(null);
  const [title, setTitle] = useState('');
  const [answers, setAnswers] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const guide = type ? cardGuide(type) : undefined;
  const reset = () => { setType(null); setTitle(''); setAnswers([]); setStep(0); };
  const close = () => { reset(); onClose(); };
  const finish = async () => {
    if (!guide || !title.trim() || busy) return;
    setBusy(true);
    try {
      const { fields, content } = guideAnswers(guide, answers, lang);
      const now = Date.now();
      await onCreate({ id: generateId('codex'), projectId, type: guide.type, title: title.trim(), fields, content, tags: [], relations: [], createdAt: now, updatedAt: now });
      close();
    } finally { setBusy(false); }
  };
  const total = guide ? guide.steps.length + 1 : 0;
  const current = guide && step > 0 ? guide.steps[step - 1] : undefined;
  const copy = lang === 'es'
    ? { title: 'Ficha guiada', pick: '¿Qué quieres crear?', name: 'Nombre', back: 'Atrás', next: 'Siguiente', skip: 'Saltar', done: 'Crear ficha', step: 'Paso {n} de {t}' }
    : { title: 'Guided card', pick: 'What do you want to create?', name: 'Name', back: 'Back', next: 'Next', skip: 'Skip', done: 'Create card', step: 'Step {n} of {t}' };
  return <Modal open={open} onClose={close} busy={busy} dismissible={!title.trim() && !answers.some(Boolean)} title={copy.title}>
    <div className="space-y-4" data-testid="guided-card">
      {!guide ? <>
        <p className="text-sm text-text-muted">{copy.pick}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{CARD_GUIDES.map(item => <button key={item.type} type="button" data-testid={`guided-type-${item.type}`} className={button} onClick={() => { setType(item.type); setStep(0); }}><Wand2 size={14} aria-hidden="true" />{item.name[lang]}</button>)}</div>
      </> : <>
        <p className="text-xs uppercase tracking-wider text-text-dim" data-testid="guided-step">{copy.step.replace('{n}', String(step + 1)).replace('{t}', String(total))} · {guide.name[lang]}</p>
        {step === 0 ? <label className="block space-y-1.5 text-sm text-text-muted">{copy.name}<input autoFocus data-testid="guided-title" className={field} maxLength={200} value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && title.trim()) setStep(1); }} /></label>
          : current && <label className="block space-y-1.5 text-sm text-text-primary"><span className="font-serif text-lg">{current.question[lang]}</span><span className="block text-xs text-text-muted">{current.hint[lang]}</span><textarea autoFocus data-testid="guided-answer" rows={4} className={field} value={answers[step - 1] ?? ''} onChange={event => setAnswers(previous => { const next = [...previous]; next[step - 1] = event.target.value; return next; })} /></label>}
        <div className="h-1 w-full overflow-hidden rounded bg-elevated"><div className="h-full bg-accent-gold transition-all" style={{ width: `${((step + 1) / total) * 100}%` }} /></div>
        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" className={button} onClick={() => (step === 0 ? reset() : setStep(step - 1))}><ArrowLeft size={14} />{copy.back}</button>
          <div className="flex gap-2">
            {step > 0 && step < total - 1 && <button type="button" className={button} data-testid="guided-skip" onClick={() => setStep(step + 1)}>{copy.skip}</button>}
            {step < total - 1
              ? <button type="button" className={button} data-testid="guided-next" disabled={!title.trim()} onClick={() => setStep(step + 1)}>{copy.next}<ArrowRight size={14} /></button>
              : <button type="button" className={`${button} border-accent-gold text-accent-gold`} data-testid="guided-done" disabled={busy || !title.trim()} onClick={() => void finish()}><Check size={14} />{copy.done}</button>}
          </div>
        </div>
      </>}
    </div>
  </Modal>;
}
