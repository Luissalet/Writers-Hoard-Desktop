import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Dices } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { outcomeFor, rollCheck } from '@/engines/prepBlocks/check';
import { checkHeadline, checkRollText, normalizeCheck, whileTyping, type CheckData } from '@/engines/prepBlocks/model';
import type { CodexBlockHost } from '../codexBlocks/model';
import { SKILLS, prepCopy } from './copy';
import { prepBoxClass, prepButtonClass, prepFieldClass, prepPrimaryClass, usePrepEditable, usePrepProject } from './shared';

export default function CheckBlockView({ node, updateAttributes, extension, editor, selected }: NodeViewProps) {
  const { locale } = useTranslation(), lang = locale === 'en' ? 'en' : 'es', c = prepCopy[lang];
  const projectId = usePrepProject(extension.options as CodexBlockHost);
  const data = whileTyping(() => normalizeCheck(node.attrs.data)), editable = usePrepEditable(editor);
  const set = (patch: Partial<CheckData>) => {
    const next = { ...data, ...patch };
    // A new difficulty re-reads the roll already on the block.
    if (next.result && 'dc' in patch) next.result = { ...next.result, outcome: outcomeFor(next.result.total, next.dc) };
    updateAttributes({ data: next });
  };
  const result = data.result;
  return <NodeViewWrapper as="div" contentEditable={false} data-testid="prep-check" data-prep-kind="check" className={prepBoxClass(selected)}>
    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{c.check}</p>
    {editable ? <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_5rem_5rem_minmax(0,1.4fr)]">
      <input className={prepFieldClass} list="prep-skills" aria-label={c.skill} placeholder={c.skill} data-testid="prep-check-skill" value={data.skill} onChange={event => set({ skill: event.target.value })} />
      <datalist id="prep-skills">{SKILLS[lang].map(skill => <option key={skill} value={skill} />)}</datalist>
      <input className={prepFieldClass} type="number" min={1} max={40} aria-label={c.dc} placeholder={c.dc} data-testid="prep-check-dc" value={data.dc ?? ''} onChange={event => set({ dc: event.target.value === '' ? null : Number(event.target.value) })} />
      <input className={prepFieldClass} type="number" min={-30} max={30} aria-label={c.bonus} placeholder="+0" data-testid="prep-check-bonus" value={data.bonus} onChange={event => set({ bonus: Number(event.target.value) || 0 })} />
      <select className={prepFieldClass} aria-label={c.mode} data-testid="prep-check-mode" value={data.mode} onChange={event => set({ mode: event.target.value as CheckData['mode'] })}><option value="normal">{c.normal}</option><option value="advantage">{c.advantage}</option><option value="disadvantage">{c.disadvantage}</option></select>
      <input className={`${prepFieldClass} sm:col-span-4`} aria-label={c.note} placeholder={c.note} data-testid="prep-check-note" value={data.note} onChange={event => set({ note: event.target.value })} />
    </div> : <p className="text-sm text-text-primary" data-testid="prep-check-text">{checkHeadline(data)}{data.note ? ` — ${data.note}` : ''}</p>}
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {editable && <button type="button" className={prepPrimaryClass} data-testid="prep-check-roll" onClick={() => updateAttributes({ data: rollCheck(data, projectId) })}><Dices size={15} aria-hidden="true" />{result ? c.rollAgain : c.roll}</button>}
      <span className="font-mono text-sm text-text-primary" data-testid="prep-check-result" role="status">{result ? `${checkRollText(data)} · ${result.detail}` : c.notRolled}</span>
      {editable && result && <button type="button" className={prepButtonClass} data-testid="prep-check-clear" onClick={() => set({ result: null })}>{c.clear}</button>}
    </div>
  </NodeViewWrapper>;
}
