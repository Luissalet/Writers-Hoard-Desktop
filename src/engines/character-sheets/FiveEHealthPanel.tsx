// Hit points at the table on a 5e character sheet: damage by an amount
// (temporary hit points absorb it first; at 0 the character falls unconscious
// and starts death saves), healing up to the maximum, temporary hit points,
// a death-save roll (10+ success, 1 counts twice, 20 is back on their feet
// with 1 HP) and the conditions as chips.
import { useState } from 'react';
import { Heart, Skull, Swords, Shield } from 'lucide-react';
import type { CharacterSheet, SheetRoll } from './types';
import { randomDie } from './mechanics';
import { deathSaveSheet, damageSheet, healSheet, resource, setConditions, sheetConditions, withResource } from './fiveEHealth';
import { ENCOUNTER_CONDITIONS, conditionLabel } from '@/engines/encounters/model';
import { button, input } from './uiStyles';

export default function FiveEHealthPanel({ sheet, locale, update, addRoll }: { sheet: CharacterSheet; locale: 'es' | 'en'; update: (change: (sheet: CharacterSheet) => CharacterSheet) => void; addRoll: (roll: SheetRoll) => void }) {
  const es = locale === 'es', [amount, setAmount] = useState('');
  const hp = resource(sheet, 'hp'), temp = resource(sheet, 'tempHp'), successes = resource(sheet, 'deathSuccess')?.current ?? 0, failures = resource(sheet, 'deathFail')?.current ?? 0;
  const conditions = sheetConditions(sheet), value = Math.max(0, Math.floor(Number(amount) || 0));
  if (!hp) return null;
  const outcomeText = { success: es ? 'éxito' : 'success', failure: es ? 'fallo' : 'failure', stable: es ? 'estable' : 'stable', dead: es ? 'muerto' : 'dead', revived: es ? '¡vuelve con 1 PG!' : 'back with 1 HP!' };
  return <section className="space-y-3 rounded-xl border border-border p-3" aria-label={es ? 'Puntos de golpe en partida' : 'Hit points in play'} data-testid="five-e-health">
    <div className="flex flex-wrap items-center gap-3">
      <p className="font-display text-2xl text-text-primary" data-testid="five-e-hp"><Heart className="mr-1 inline h-5 w-5 text-danger" />{hp.current} / {hp.max}{temp?.current ? <span className="ml-2 text-base text-sky-400" data-testid="five-e-temp">+{temp.current}</span> : null}</p>
      <input className={`${input} w-24`} inputMode="numeric" aria-label={es ? 'Cantidad' : 'Amount'} data-testid="five-e-amount" value={amount} onChange={event => setAmount(event.target.value.replace(/\D/g, ''))} />
      <button type="button" className={button} data-testid="five-e-damage" disabled={!value} onClick={() => { update(current => damageSheet(current, value)); setAmount(''); }}><Swords className="h-4 w-4" />{es ? 'Daño' : 'Damage'}</button>
      <button type="button" className={button} data-testid="five-e-heal" disabled={!value} onClick={() => { update(current => healSheet(current, value)); setAmount(''); }}><Heart className="h-4 w-4" />{es ? 'Curar' : 'Heal'}</button>
      <button type="button" className={button} data-testid="five-e-temp-set" disabled={!value || !temp} onClick={() => { update(current => withResource(current, 'tempHp', Math.max(resource(current, 'tempHp')?.current ?? 0, value))); setAmount(''); }}><Shield className="h-4 w-4" />{es ? 'PG temporales' : 'Temp HP'}</button>
    </div>
    {hp.current === 0 && <div className="flex flex-wrap items-center gap-3" data-testid="five-e-death">
      <span className="text-sm text-text-primary">{es ? 'Salvaciones contra muerte' : 'Death saves'}: <span className="text-success" data-testid="five-e-death-successes">{'●'.repeat(successes)}{'○'.repeat(Math.max(0, 3 - successes))}</span> <span className="text-danger" data-testid="five-e-death-failures">{'●'.repeat(failures)}{'○'.repeat(Math.max(0, 3 - failures))}</span></span>
      <button type="button" className={button} data-testid="five-e-death-roll" disabled={failures >= 3 || successes >= 3} onClick={() => { const roll = randomDie(20); update(current => deathSaveSheet(current, roll).sheet); addRoll({ id: crypto.randomUUID(), at: Date.now(), label: es ? 'Salvación contra muerte' : 'Death save', expression: 'd20', dice: [roll], total: roll, outcome: roll >= 20 ? 'critical' : roll === 1 ? 'fumble' : roll >= 10 ? 'success' : 'failure', target: 10 }); }}><Skull className="h-4 w-4" />{es ? 'Tirar salvación' : 'Roll a death save'}</button>
      {failures >= 3 && <span className="text-sm text-danger">{outcomeText.dead}</span>}{successes >= 3 && <span className="text-sm text-success">{outcomeText.stable}</span>}
    </div>}
    <div className="flex flex-wrap items-center gap-1" data-testid="five-e-conditions">
      {conditions.map(name => <button key={name} type="button" className="rounded-full bg-accent-plum/20 px-2 py-0.5 text-xs text-text-primary hover:line-through" data-testid={`five-e-condition-${name}`} title={es ? 'Quitar' : 'Remove'} onClick={() => update(current => setConditions(current, sheetConditions(current).filter(item => item !== name)))}>{conditionLabel(name, locale)}</button>)}
      <select className={`${input} w-auto text-xs`} aria-label={es ? 'Añadir estado' : 'Add condition'} data-testid="five-e-condition-add" value="" onChange={event => { const name = event.target.value; if (name) update(current => setConditions(current, [...sheetConditions(current), name])); }}><option value="">{es ? '+ Estado' : '+ Condition'}</option>{ENCOUNTER_CONDITIONS.filter(name => !conditions.includes(name)).map(name => <option key={name} value={name}>{conditionLabel(name, locale)}</option>)}</select>
    </div>
  </section>;
}
