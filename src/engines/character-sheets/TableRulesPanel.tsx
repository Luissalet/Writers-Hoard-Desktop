// "Reglas de la mesa": the game system, the rules this table plays differently
// from the usual ones (each marked when changed, each with its own reset), and
// a reorderable list of notes about the evening — when and where we play,
// house rules, food, dress code, anything else.
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { db } from '@/db';
import { button, gold, input } from './uiStyles';
import {
  EMPTY_TABLE_RULES, GROUP_LABELS, SUGGESTED_INFO, SYSTEM_LABELS, TABLE_RULES_LIMITS, TABLE_SYSTEMS, changedRuleIds, moveInfo, newInfo, patchRuleValues, resetAllValues,
  ruleChanged, ruleDefault, ruleValue, rulesFor, type RuleDef, type RuleGroup, type RuleValue, type TableRules, type TableSystem,
} from './tableRules';
import { TableRulesConflict, saveTableRules } from './tableRulesOperations';

const COPY = {
  es: {
    title: 'Reglas de la mesa', intro: 'Cómo juega vuestra mesa: el sistema, lo que habéis cambiado respecto a lo habitual y las notas de la velada. Se guarda con el proyecto.',
    system: 'Sistema de juego', changed: 'Cambiada', usual: 'Habitual', reset: 'Restablecer', resetAll: 'Restablecer todas', resetAllAsk: '¿Volver todas las reglas de este sistema a lo habitual?', yes: 'Sí, restablecer', no: 'Cancelar',
    summary: (n: number) => n ? `${n} ${n === 1 ? 'regla cambiada' : 'reglas cambiadas'} respecto a lo habitual.` : 'Todo como en el reglamento.',
    info: 'Notas de la velada', infoHelp: 'Cuándo y dónde jugáis, reglas de la casa, comida, vestimenta… En el orden que prefieras.', addSection: 'Añadir sección', suggested: 'Sugeridas', sectionTitle: 'Título', sectionText: 'Texto', up: 'Subir', down: 'Bajar', remove: 'Quitar', none: 'Aún no hay notas.',
    conflict: 'Las reglas cambiaron en otra ventana. Vuelve a mirarlas e inténtalo de nuevo.', error: 'No se pudo guardar. Revisa los valores.', usualValue: 'Habitual', yesLabel: 'Sí', noLabel: 'No',
  },
  en: {
    title: 'Table rules', intro: 'How your table plays: the system, what you changed from the usual, and notes about the evening. Saved with the project.',
    system: 'Game system', changed: 'Changed', usual: 'Usual', reset: 'Reset', resetAll: 'Reset all', resetAllAsk: 'Put every rule of this system back to the usual?', yes: 'Yes, reset', no: 'Cancel',
    summary: (n: number) => n ? `${n} ${n === 1 ? 'rule' : 'rules'} changed from the usual.` : 'Everything as written.',
    info: 'Notes for the evening', infoHelp: 'When and where you play, house rules, food, dress code… in the order you prefer.', addSection: 'Add section', suggested: 'Suggested', sectionTitle: 'Title', sectionText: 'Text', up: 'Move up', down: 'Move down', remove: 'Remove', none: 'No notes yet.',
    conflict: 'The rules changed in another window. Look again and retry.', error: 'Could not save. Check the values.', usualValue: 'Usual', yesLabel: 'Yes', noLabel: 'No',
  },
};
const GROUPS: RuleGroup[] = ['creation', 'play', 'rests', 'house'];

/** Uncontrolled text box that saves when it loses focus; `key` remounts it when the stored value changes. */
function BlurText({ value, multiline, label, testId, maxLength, onCommit }: { value: string; multiline?: boolean; label: string; testId: string; maxLength: number; onCommit: (value: string) => void }) {
  const commit = (next: string) => { if (next !== value) onCommit(next); };
  return multiline
    ? <textarea key={value} className={`${input} min-h-20`} aria-label={label} data-testid={testId} maxLength={maxLength} rows={3} defaultValue={value} onBlur={event => commit(event.currentTarget.value)} />
    : <input key={value} className={input} aria-label={label} data-testid={testId} maxLength={maxLength} defaultValue={value} onBlur={event => commit(event.currentTarget.value)} />;
}

export default function TableRulesPanel({ projectId, locale }: { projectId: string; locale: 'es' | 'en' }) {
  const c = COPY[locale];
  const live = useLiveQuery(async () => (await db.projects.get(projectId))?.tableRules ?? EMPTY_TABLE_RULES, [projectId]);
  const [saved, setSaved] = useState<TableRules | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [asking, setAsking] = useState(false);
  // Right after a save the live query can lag one tick; the freshest revision wins.
  const rules = live ? (saved && saved.revision > live.revision ? saved : live) : undefined;
  if (!rules) return <p className="p-5 text-text-muted">…</p>;
  const commit = async (change: (current: TableRules) => Pick<TableRules, 'system' | 'values' | 'info'>) => {
    if (busy) return; setBusy(true); setError('');
    try { setSaved(await saveTableRules(projectId, change(rules), rules.revision)); }
    catch (failure) { setError(failure instanceof TableRulesConflict ? c.conflict : c.error); }
    finally { setBusy(false); }
  };
  const setValue = (id: string, value: RuleValue | null) => void commit(current => ({ ...current, values: patchRuleValues(current.values, current.system, { [id]: value }) }));
  const changedCount = changedRuleIds(rules).length;
  const optionLabel = (rule: RuleDef, value: RuleValue) => rule.kind === 'toggle' ? (value ? c.yesLabel : c.noLabel) : rule.kind === 'choice' ? rule.options!.find(item => item.value === value)?.label[locale] ?? String(value) : String(value);

  const control = (rule: RuleDef) => {
    const value = ruleValue(rules, rule.id)!, label = rule.label[locale], testId = `rule-${rule.id}`;
    if (rule.kind === 'toggle') return <input type="checkbox" className="h-5 w-5 accent-accent-gold" aria-label={label} data-testid={testId} checked={value === true} disabled={busy} onChange={event => setValue(rule.id, event.target.checked)} />;
    if (rule.kind === 'choice') return <select className={input} aria-label={label} data-testid={testId} value={String(value)} disabled={busy} onChange={event => setValue(rule.id, event.target.value)}>{rule.options!.map(item => <option key={item.value} value={item.value}>{item.label[locale]}</option>)}</select>;
    if (rule.kind === 'number') return <input type="number" className={`${input} max-w-28`} aria-label={label} data-testid={testId} min={rule.min} max={rule.max} key={String(value)} defaultValue={Number(value)} disabled={busy} onBlur={event => { const next = Number(event.currentTarget.value); if (Number.isInteger(next) && next !== value) setValue(rule.id, next); else event.currentTarget.value = String(value); }} />;
    return <BlurText value={String(value)} multiline label={label} testId={testId} maxLength={TABLE_RULES_LIMITS.text} onCommit={next => setValue(rule.id, next)} />;
  };
  const section = (group: RuleGroup) => {
    const list = rulesFor(rules.system).filter(rule => rule.group === group);
    if (!list.length) return null;
    return <fieldset key={group} className="space-y-3 rounded-xl border border-border p-4" data-testid={`rules-group-${group}`}>
      <legend className="px-2 font-display text-lg text-text-primary">{GROUP_LABELS[group][locale]}</legend>
      {list.map(rule => {
        const changed = ruleChanged(rules, rule), fallback = ruleDefault(rule, rules.system);
        return <div key={rule.id} className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_1fr_auto] sm:items-start" data-testid={`rule-row-${rule.id}`} data-changed={changed ? 'true' : 'false'}>
          <div className="min-w-0 text-sm text-text-primary">{rule.label[locale]}{rule.help && <p className="mt-1 text-xs text-text-muted">{rule.help[locale]}</p>}
            {rule.kind !== 'text' && <p className="mt-1 text-xs text-text-muted">{c.usualValue}: {optionLabel(rule, fallback)}</p>}</div>
          <div className="min-w-0">{control(rule)}</div>
          <div className="flex min-h-9 items-center gap-2 text-xs">
            {changed && <><span className="rounded-full bg-accent-gold/15 px-2 py-0.5 text-accent-gold" data-testid={`rule-changed-${rule.id}`}>{c.changed}</span>
              <button type="button" className={button} data-testid={`rule-reset-${rule.id}`} disabled={busy} onClick={() => setValue(rule.id, null)}><RotateCcw size={14} aria-hidden="true" />{c.reset}</button></>}
          </div>
        </div>;
      })}
    </fieldset>;
  };
  const infoCommit = (change: (info: TableRules['info']) => TableRules['info']) => void commit(current => ({ ...current, info: change(current.info) }));
  const suggestedLeft = SUGGESTED_INFO.filter(item => !rules.info.some(entry => entry.title === item.title[locale]));

  return <section className="mx-auto max-w-3xl space-y-5" aria-label={c.title} data-testid="table-rules" data-revision={rules.revision}>
    <div><h3 className="font-display text-xl text-text-primary">{c.title}</h3><p className="mt-1 max-w-prose text-sm text-text-muted">{c.intro}</p></div>
    {error && <div role="alert" className="rounded-lg border border-danger/40 p-3 text-sm text-danger" data-testid="rules-error">{error}</div>}
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-56 flex-1 space-y-1 text-sm text-text-muted">{c.system}
        <select className={input} aria-label={c.system} data-testid="rules-system" value={rules.system} disabled={busy} onChange={event => void commit(current => ({ ...current, system: event.target.value as TableSystem }))}>{TABLE_SYSTEMS.map(system => <option key={system} value={system}>{SYSTEM_LABELS[system][locale]}</option>)}</select></label>
      <p className="pb-2 text-sm text-text-muted" data-testid="rules-summary">{c.summary(changedCount)}</p>
      {changedCount > 0 && !asking && <button type="button" className={button} data-testid="rules-reset-all" disabled={busy} onClick={() => setAsking(true)}><RotateCcw size={14} aria-hidden="true" />{c.resetAll}</button>}
      {asking && <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label={c.resetAllAsk}><span className="text-text-primary">{c.resetAllAsk}</span>
        <button type="button" className={gold} data-testid="rules-reset-all-confirm" disabled={busy} onClick={() => { setAsking(false); void commit(current => ({ ...current, values: resetAllValues(current.values, current.system) })); }}>{c.yes}</button>
        <button type="button" className={button} data-testid="rules-reset-all-cancel" onClick={() => setAsking(false)}>{c.no}</button></div>}
    </div>
    {GROUPS.map(section)}
    <section className="space-y-3 rounded-xl border border-border p-4" aria-label={c.info} data-testid="rules-info">
      <div><h4 className="font-display text-lg text-text-primary">{c.info}</h4><p className="text-xs text-text-muted">{c.infoHelp}</p></div>
      {!rules.info.length && <p className="text-sm text-text-muted" data-testid="rules-info-empty">{c.none}</p>}
      <ol className="space-y-3">{rules.info.map((item, index) => <li key={item.id} className="space-y-2 rounded-lg border border-border p-3" data-testid={`rules-info-${item.id}`}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-48 flex-1"><BlurText value={item.title} label={c.sectionTitle} testId={`rules-info-title-${index}`} maxLength={TABLE_RULES_LIMITS.title} onCommit={next => { if (next.trim()) infoCommit(list => list.map(entry => entry.id === item.id ? { ...entry, title: next.trim() } : entry)); else setError(c.error); }} /></div>
          <button type="button" className={button} aria-label={c.up} data-testid={`rules-info-up-${index}`} disabled={busy || index === 0} onClick={() => infoCommit(list => moveInfo(list, item.id, -1))}><ArrowUp size={14} aria-hidden="true" /></button>
          <button type="button" className={button} aria-label={c.down} data-testid={`rules-info-down-${index}`} disabled={busy || index === rules.info.length - 1} onClick={() => infoCommit(list => moveInfo(list, item.id, 1))}><ArrowDown size={14} aria-hidden="true" /></button>
          <button type="button" className={`${button} text-danger`} aria-label={c.remove} data-testid={`rules-info-remove-${index}`} disabled={busy} onClick={() => infoCommit(list => list.filter(entry => entry.id !== item.id))}><Trash2 size={14} aria-hidden="true" /></button>
        </div>
        <BlurText value={item.text} multiline label={c.sectionText} testId={`rules-info-text-${index}`} maxLength={TABLE_RULES_LIMITS.text} onCommit={next => infoCommit(list => list.map(entry => entry.id === item.id ? { ...entry, text: next } : entry))} />
      </li>)}</ol>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} data-testid="rules-info-add" disabled={busy || rules.info.length >= TABLE_RULES_LIMITS.info} onClick={() => infoCommit(list => [...list, newInfo(`${c.sectionTitle} ${list.length + 1}`)])}><Plus size={14} aria-hidden="true" />{c.addSection}</button>
        {suggestedLeft.length > 0 && <span className="text-xs text-text-muted">{c.suggested}:</span>}
        {suggestedLeft.map(item => <button key={item.key} type="button" className={button} data-testid={`rules-info-suggest-${item.key}`} disabled={busy || rules.info.length >= TABLE_RULES_LIMITS.info} onClick={() => infoCommit(list => [...list, newInfo(item.title[locale])])}>{item.title[locale]}</button>)}
      </div>
    </section>
  </section>;
}
