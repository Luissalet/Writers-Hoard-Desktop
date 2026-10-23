// The dice tray: pick dice (or type 2d6+1d8+3, 4d6kh3), roll with advantage
// or disadvantage against a target, see natural 20s and 1s called out, keep
// the last rolls and the formulas you use, in the dice set you like.
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Dices, Minus, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { db } from '@/db';
import { DICE_SETS, addDie, describeRoll, diceSetColours, nudgeModifier, rollDice, type DiceMode, type DiceRoll, type DiceSet } from './dice';
import { clearDiceLog, logDiceRoll, removeDiceFormula, saveDiceFormula } from './operations';

const control = 'min-h-9 rounded-lg border border-border bg-deep px-2 text-sm text-text-primary';
const button = 'inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-text-primary hover:bg-elevated disabled:opacity-50';
const SIDES = [4, 6, 8, 10, 12, 20, 100] as const;
const SET_KEY = 'wh.dice.set', MOTION_KEY = 'wh.dice.throw';

const COPY = {
  es: { title: 'Dados', expression: 'Tirada', roll: 'Tirar', clearPool: 'Vaciar', mode: 'Modo', normal: 'Normal', advantage: 'Con ventaja', disadvantage: 'Con desventaja', target: 'Dificultad (opcional)', label: 'Para qué (opcional)', nat20: '¡20 natural!', nat1: '1 natural', pass: 'Supera', miss: 'Falla', vs: 'contra', history: 'Últimas tiradas', none: 'Aún no hay tiradas.', clear: 'Borrar historial', again: 'Repetir', formulas: 'Fórmulas guardadas', formulaName: 'Nombre de la fórmula', saveFormula: 'Guardar fórmula', noFormulas: 'Guarda las tiradas que repites (ataque, daño, iniciativa).', remove: 'Quitar', set: 'Juego de dados', throw: 'Animar la tirada', sets: { black: 'Negro básico', bone: 'Hueso', brass: 'Latón', seaglass: 'Vidrio de mar', oxblood: 'Sangre de buey', world: 'Color del mundo' }, invalid: 'No entiendo esa tirada. Prueba con 1d20+5, 2d6+1d8 o 4d6kh3.', limit: 'Demasiados dados: hasta 100 por tirada.', kept: 'se queda', dropped: 'descartado', help: 'Pulsa los dados para añadirlos. kh3 se queda con los 3 más altos y kl1 con el más bajo; d% es un d100.' },
  en: { title: 'Dice', expression: 'Roll', roll: 'Roll', clearPool: 'Clear', mode: 'Mode', normal: 'Normal', advantage: 'Advantage', disadvantage: 'Disadvantage', target: 'Target (optional)', label: 'What for (optional)', nat20: 'Natural 20!', nat1: 'Natural 1', pass: 'Pass', miss: 'Miss', vs: 'vs', history: 'Last rolls', none: 'No rolls yet.', clear: 'Clear history', again: 'Roll again', formulas: 'Saved formulas', formulaName: 'Formula name', saveFormula: 'Save formula', noFormulas: 'Save the rolls you repeat (attack, damage, initiative).', remove: 'Remove', set: 'Dice set', throw: 'Animate the throw', sets: { black: 'Basic black', bone: 'Bone', brass: 'Brass', seaglass: 'Sea glass', oxblood: 'Oxblood', world: 'World colour' }, invalid: 'I can\'t read that roll. Try 1d20+5, 2d6+1d8 or 4d6kh3.', limit: 'Too many dice: up to 100 per roll.', kept: 'kept', dropped: 'dropped', help: 'Click dice to add them. kh3 keeps the highest 3 and kl1 the lowest; d% is a d100.' },
};

const readPref = (key: string, fallback: string) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const writePref = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* per-device nicety only */ } };

export function DieFace({ value, sides, kept, set, worldColour, spin, title }: { value: number; sides: number; kept: boolean; set: DiceSet; worldColour?: string; spin: boolean; title: string }) {
  const colours = diceSetColours(set, worldColour);
  const shape = sides === 4 ? 'polygon(50% 4%, 96% 92%, 4% 92%)' : sides === 6 ? 'inset(0 round 18%)' : sides === 8 ? 'polygon(50% 2%, 98% 50%, 50% 98%, 2% 50%)' : sides === 10 || sides === 100 ? 'polygon(50% 2%, 96% 40%, 80% 96%, 20% 96%, 4% 40%)' : sides === 12 ? 'polygon(50% 2%, 90% 22%, 98% 66%, 72% 98%, 28% 98%, 2% 66%, 10% 22%)' : 'polygon(50% 1%, 95% 26%, 95% 74%, 50% 99%, 5% 74%, 5% 26%)';
  return <span title={title} data-testid="dice-face" data-sides={sides} data-kept={kept} className={`wh-die relative inline-flex h-11 w-11 items-center justify-center text-sm font-bold ${spin ? 'wh-die-throw' : ''}`} style={{ opacity: kept ? 1 : 0.38 }}>
    <span aria-hidden className="absolute inset-0" style={{ clipPath: shape, background: colours.face, boxShadow: `inset 0 0 0 2px ${colours.edge}` }} />
    <span className="relative" style={{ color: colours.ink, textDecoration: kept ? undefined : 'line-through' }}>{value}</span>
  </span>;
}

export default function DiceTray({ projectId, locale }: { projectId: string; locale: 'es' | 'en' }) {
  const c = COPY[locale];
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const tray = project?.diceTray ?? { log: [], formulas: [] }, worldColour = project?.color;
  const [expression, setExpression] = useState('1d20'), [mode, setMode] = useState<DiceMode>('normal'), [target, setTarget] = useState(''), [label, setLabel] = useState(''), [formulaName, setFormulaName] = useState('');
  const [set, setSetState] = useState<DiceSet>(() => { const saved = readPref(SET_KEY, 'black'); return (DICE_SETS as readonly string[]).includes(saved) ? saved as DiceSet : 'black'; });
  const [animate, setAnimate] = useState(() => readPref(MOTION_KEY, '1') === '1');
  const [pristine, setPristine] = useState(true), [last, setLast] = useState<DiceRoll | null>(null), [spin, setSpin] = useState(0), [error, setError] = useState('');
  const savedLog = project?.diceTray?.log;
  const log = useMemo(() => [...(savedLog ?? [])].reverse(), [savedLog]);
  const roll = async (text = expression, options: { mode?: DiceMode; target?: string; label?: string } = {}) => {
    setError('');
    try {
      const goal = (options.target ?? target).trim();
      const result = rollDice(text, { mode: options.mode ?? mode, ...(goal ? { target: Number(goal) } : {}), label: options.label ?? label });
      setLast(result); setSpin(value => value + 1); setPristine(false);
      await logDiceRoll(projectId, result);
    } catch (failure) { setError(failure instanceof Error && failure.message === 'dice_limit' ? c.limit : c.invalid); }
  };
  const verdict = (item: DiceRoll) => <>{item.natural === 20 && <span data-testid="dice-nat20" className="wh-dice-nat20 rounded-full bg-accent-gold px-2 py-0.5 text-xs font-bold text-deep">{c.nat20}</span>}{item.natural === 1 && <span data-testid="dice-nat1" className="rounded-full bg-danger px-2 py-0.5 text-xs font-bold text-white">{c.nat1}</span>}{item.outcome && <span data-testid="dice-outcome" className={`rounded-full px-2 py-0.5 text-xs ${item.outcome === 'pass' ? 'bg-success/20 text-success' : 'bg-danger/15 text-danger'}`}>{item.outcome === 'pass' ? c.pass : c.miss} ({c.vs} {item.target})</span>}</>;
  return <section className="mx-auto max-w-3xl space-y-5" aria-label={c.title} data-testid="dice-tray">
    <style>{`.wh-die-throw{animation:wh-die-throw .7s cubic-bezier(.2,.8,.3,1)} @keyframes wh-die-throw{0%{transform:translateY(-18px) rotate(-260deg) scale(.6);opacity:0}60%{transform:translateY(3px) rotate(18deg) scale(1.05);opacity:1}100%{transform:none}} .wh-dice-nat20{box-shadow:0 0 14px #e8c26a} @media (prefers-reduced-motion: reduce){.wh-die-throw{animation:none}}`}</style>
    <div className="flex flex-wrap items-center gap-2">{SIDES.map(sides => <button key={sides} type="button" className={button} data-testid={`dice-add-d${sides}`} onClick={() => { setExpression(current => addDie(pristine ? '' : current, sides)); setPristine(false); }}><Dices className="h-4 w-4" />d{sides}</button>)}
      <button type="button" className={button} aria-label="−1" data-testid="dice-mod-down" onClick={() => { setExpression(current => nudgeModifier(current, -1)); setPristine(false); }}><Minus className="h-4 w-4" /></button>
      <button type="button" className={button} aria-label="+1" data-testid="dice-mod-up" onClick={() => { setExpression(current => nudgeModifier(current, 1)); setPristine(false); }}><Plus className="h-4 w-4" /></button>
      <button type="button" className={button} data-testid="dice-clear-pool" onClick={() => { setExpression(''); setPristine(false); }}>{c.clearPool}</button>
    </div>
    <form className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end" onSubmit={event => { event.preventDefault(); void roll(); }}>
      <label className="space-y-1 text-sm text-text-primary">{c.expression}<input className={`${control} w-full font-mono`} data-testid="dice-expression" value={expression} onChange={event => { setExpression(event.target.value); setPristine(false); }} /></label>
      <label className="space-y-1 text-sm text-text-primary">{c.mode}<select className={`${control} w-full`} data-testid="dice-mode" value={mode} onChange={event => setMode(event.target.value as DiceMode)}><option value="normal">{c.normal}</option><option value="advantage">{c.advantage}</option><option value="disadvantage">{c.disadvantage}</option></select></label>
      <label className="space-y-1 text-sm text-text-primary">{c.target}<input className={`${control} w-full`} inputMode="numeric" data-testid="dice-target" value={target} onChange={event => setTarget(event.target.value.replace(/[^\d-]/g, ''))} /></label>
      <button type="submit" className={`${button} bg-accent-gold text-deep hover:bg-accent-amber`} data-testid="dice-roll"><Dices className="h-4 w-4" />{c.roll}</button>
      <label className="space-y-1 text-sm text-text-primary sm:col-span-2">{c.label}<input className={`${control} w-full`} data-testid="dice-label" value={label} onChange={event => setLabel(event.target.value)} /></label>
    </form>
    <p className="text-xs text-text-muted">{c.help}</p>
    {error && <p role="alert" data-testid="dice-error" className="text-sm text-danger">{error}</p>}
    {last && <div data-testid="dice-result" aria-live="polite" className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2" key={spin}>{last.terms.flatMap((term, t) => term.rolls.map((value, i) => <DieFace key={`${t}-${i}`} value={value} sides={term.sides} kept={term.kept[i]} set={set} worldColour={worldColour} spin={animate} title={`d${term.sides}: ${value} (${term.kept[i] ? c.kept : c.dropped})`} />))}{last.modifier !== 0 && <span className="text-sm text-text-muted">{last.modifier > 0 ? `+${last.modifier}` : `−${Math.abs(last.modifier)}`}</span>}</div>
      <p className="mt-3 flex flex-wrap items-center gap-3"><span data-testid="dice-total" className="font-display text-4xl text-accent-gold">{last.total}</span>{verdict(last)}</p>
      <p className="mt-1 font-mono text-xs text-text-muted" data-testid="dice-description">{last.label ? `${last.label}: ` : ''}{describeRoll(last)}</p>
    </div>}
    <fieldset className="flex flex-wrap items-center gap-2 border-t border-border pt-4"><legend className="pr-2 text-sm text-text-muted">{c.set}</legend>
      {DICE_SETS.map(item => { const colours = diceSetColours(item, worldColour); return <button key={item} type="button" aria-pressed={set === item} data-testid={`dice-set-${item}`} onClick={() => { setSetState(item); writePref(SET_KEY, item); }} className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-2 text-xs ${set === item ? 'border-accent-gold text-accent-gold' : 'border-border text-text-primary'}`}><span aria-hidden className="h-4 w-4 rounded" style={{ background: colours.face, boxShadow: `inset 0 0 0 2px ${colours.edge}` }} />{c.sets[item]}</button>; })}
      <label className="ml-auto inline-flex items-center gap-2 text-xs text-text-primary"><input type="checkbox" data-testid="dice-throw" checked={animate} onChange={event => { setAnimate(event.target.checked); writePref(MOTION_KEY, event.target.checked ? '1' : '0'); }} />{c.throw}</label>
    </fieldset>
    <div className="grid gap-5 md:grid-cols-2">
      <section aria-label={c.formulas} className="space-y-2"><h3 className="text-sm font-medium text-text-primary">{c.formulas}</h3>
        {!tray?.formulas.length && <p className="text-xs text-text-muted">{c.noFormulas}</p>}
        <ul className="space-y-1">{tray?.formulas.map(item => <li key={item.id} className="flex items-center gap-2"><button type="button" className={`${button} flex-1 justify-between`} data-testid={`dice-formula-${item.label}`} onClick={() => { setExpression(item.expression); void roll(item.expression, { label: item.label }); }}><span>{item.label}</span><span className="font-mono text-xs text-text-muted">{item.expression}</span></button><button type="button" className={button} aria-label={`${c.remove} ${item.label}`} onClick={() => void removeDiceFormula(projectId, item.id)}><Trash2 className="h-4 w-4" /></button></li>)}</ul>
        <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void saveDiceFormula(projectId, formulaName || label, expression).then(() => setFormulaName('')).catch(() => setError(c.invalid)); }}><input className={`${control} flex-1`} placeholder={c.formulaName} aria-label={c.formulaName} data-testid="dice-formula-name" value={formulaName} onChange={event => setFormulaName(event.target.value)} /><button type="submit" className={button} data-testid="dice-formula-save" disabled={!(formulaName || label).trim()}><Save className="h-4 w-4" />{c.saveFormula}</button></form>
      </section>
      <section aria-label={c.history} className="space-y-2"><div className="flex items-center justify-between"><h3 className="text-sm font-medium text-text-primary">{c.history}</h3>{log.length > 0 && <button type="button" className="text-xs text-text-muted underline" data-testid="dice-history-clear" onClick={() => void clearDiceLog(projectId)}>{c.clear}</button>}</div>
        {!log.length && <p className="text-xs text-text-muted">{c.none}</p>}
        <ol className="max-h-72 space-y-1 overflow-y-auto" data-testid="dice-history">{log.map(item => <li key={item.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-2 py-1 text-xs"><span className="font-mono text-base text-accent-gold">{item.total}</span><span className="text-text-primary">{item.label ?? item.expression}</span>{verdict(item)}<button type="button" className="ml-auto text-text-muted hover:text-text-primary" aria-label={`${c.again}: ${item.expression}`} onClick={() => void roll(item.expression, { mode: item.mode, target: item.target === undefined ? '' : String(item.target), label: item.label ?? '' })}><RotateCcw className="h-3.5 w-3.5" /></button></li>)}</ol>
      </section>
    </div>
  </section>;
}
