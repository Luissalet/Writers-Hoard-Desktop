import { useRef, useState } from 'react';

import { Dice5 } from 'lucide-react';

import type { CharacterSheet, SheetRoll } from './types';

import { d20Check, dualityCheck, rollExpression } from './mechanics';
import { cocRoll } from './cocRules';
import CocPlayPanel from './CocPlayPanel';
import DaggerheartPlayPanel from './DaggerheartPlayPanel';
import FiveEPlayPanel from './FiveEPlayPanel';

import { sheetCopy } from './copy';

import { button, input, titleCase } from './uiStyles';

import { Field, NumberField } from './ui';

import StatsPanel, { type PanelProps } from './StatsPanel';

import ResourcePanel from './ResourcePanel';

import RowsPanel from './RowsPanel';
import SheetPaper from './SheetPaper';

const allTabs = ['play', 'stats', 'resources', 'rows', 'rolls', 'details', 'paper'] as const;

export default function SheetEditor({ sheet, sheets, locale, update, confirm, report, status }: PanelProps & { sheets: CharacterSheet[]; report: (error: string) => void; status: (message: string) => void }) {

  const c = sheetCopy[locale]; const coc = sheet.preset === 'coc7', duality = sheet.preset === 'daggerheart-character';

  const dh=sheet.preset.startsWith('daggerheart'),fiveE=sheet.preset==='5e-character';
  const tabs = allTabs.filter(item=>coc||dh||fiveE||item!=='play');
  const [tab, setTab] = useState<typeof allTabs[number]>(coc||dh?'play':'stats');

  const [target, setTarget] = useState(10), [bonus, setBonus] = useState(0), [mode, setMode] = useState<'normal' | 'advantage' | 'disadvantage'>('normal');

  const [attack, setAttack] = useState(sheet.preset === 'daggerheart-adversary'), [expression, setExpression] = useState('1d20');

  const [showRollControls,setShowRollControls]=useState(false);
  const [difficulty,setDifficulty]=useState<'regular'|'hard'|'extreme'>('regular');

  const [newProperty, setNewProperty] = useState(''); const [propertyType, setPropertyType] = useState<'text' | 'number'>('text');

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const last = sheet.rolls[0];

  const outcome = (roll: SheetRoll) => `${c.outcomes[roll.outcome as keyof typeof c.outcomes] ?? roll.outcome}${roll.passed === undefined ? '' : ` · ${roll.passed ? c.outcomes.success : c.outcomes.failure} (${c.outcomes[roll.difficulty ?? 'regular']})`}`;

  const addRoll = (roll: SheetRoll) => { update(current => ({ ...current, rolls: [roll, ...current.rolls].slice(0, 200) })); status(c.rolled); report(''); };

  const check = (label: string, value: number) => {

    try { if(coc){const skill=sheet.skills.find(item=>item.label===label);update(current=>cocRoll(current,label,value,{difficulty,skillId:skill?.id,kind:skill?/^(Fighting|Firearms|Dodge)/.test(label)?'combat':'skill':'trait'}));status(c.rolled);report('');}else addRoll(duality ? dualityCheck(label, value, target) : d20Check(label, value, target, mode, attack, undefined, sheet.preset !== 'daggerheart-adversary')); } catch { report(c.integer); }

  };

  const panelProps = { sheet, locale, update, confirm };

  return <div className="space-y-5">

    {tab === 'stats' && <button type="button" className={button} aria-expanded={showRollControls} onClick={()=>setShowRollControls(value=>!value)}><Dice5 size={15}/>{locale === 'es' ? 'Opciones de tirada' : 'Roll options'} - {coc ? c.outcomes[difficulty] : `${target} / ${duality ? 'Duality' : c[mode]}`}</button>}
    {(tab === 'stats' && showRollControls || tab === 'rolls') && <div className="space-y-3 rounded-lg border border-border bg-surface p-4"><div className="grid gap-3 sm:grid-cols-3"><NumberField label={c.target} value={target} min={coc ? 0 : undefined} onChange={setTarget} />{!coc && !duality && <Field label={c.mode}><select className={input} aria-label={c.mode} value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="normal">{c.normal}</option><option value="advantage">{c.advantage}</option><option value="disadvantage">{c.disadvantage}</option></select></Field>}{coc && <Field label={locale === 'es' ? 'Éxito requerido' : 'Required success'}><select className={input} aria-label={locale === 'es' ? 'Éxito requerido' : 'Required success'} value={difficulty} onChange={event => setDifficulty(event.target.value as typeof difficulty)}>{(['regular','hard','extreme'] as const).map(value => <option key={value} value={value}>{c.outcomes[value]}</option>)}</select></Field>}{tab === 'rolls' && !coc && <NumberField label={c.bonus} value={bonus} onChange={setBonus} />}</div>{!coc && !duality && <label className="flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" checked={attack} onChange={event => setAttack(event.target.checked)} />{sheet.preset === 'daggerheart-adversary' ? (locale === 'es' ? 'Ataque (20 natural)' : 'Attack (natural 20)') : c.attack}</label>}{tab === 'stats' && coc && <p className="text-sm text-text-muted">{locale === 'es' ? 'Las tiradas de atributos y habilidades usan su propio valor. Las tres cifras muestran normal / mitad / quinta parte.' : 'Trait and skill rolls use their own rating. The three values show regular / half / fifth.'}</p>}</div>}

    {last && <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3 text-sm text-text-primary"><span>{last.label}</span><strong className="font-mono text-xl text-accent-gold">{last.total}</strong><span>{outcome(last)}</span><span className="text-text-muted">[{last.dice.join(', ')}]{last.target !== undefined ? ` · ${c.target}: ${last.target}` : ''}</span></div>}

    <div className="flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label={c.title}>{tabs.map((item, index) => <button key={item} ref={node => { tabRefs.current[index] = node; }} role="tab" id={`sheet-tab-${item}`} aria-controls={`sheet-panel-${item}`} aria-selected={tab === item} tabIndex={tab === item ? 0 : -1} className={`min-h-10 border-b-2 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent-gold ${tab === item ? 'border-accent-gold text-accent-gold' : 'border-transparent text-text-muted'}`} onClick={() => setTab(item)} onKeyDown={event => {

      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;

      if (next >= 0) { event.preventDefault(); setTab(tabs[next]); tabRefs.current[next]?.focus(); }

    }}>{item==='play'?(locale==='es'?'Partida':'Play'):item==='paper'?(locale==='es'?'Papel':'Paper'):c[item]}</button>)}</div>

    <div role="tabpanel" id={`sheet-panel-${tab}`} aria-labelledby={`sheet-tab-${tab}`} className="space-y-5">

      {tab === 'play' && coc && <CocPlayPanel {...panelProps} report={report}/>}
      {tab === 'play' && dh && <DaggerheartPlayPanel {...panelProps}/>}
      {tab === 'play' && fiveE && <FiveEPlayPanel {...panelProps} addRoll={addRoll} report={report}/>}
      {tab === 'paper' && <SheetPaper {...panelProps}/>}

      {tab === 'stats' && sheet.preset === 'daggerheart-adversary' && <button className={button} onClick={() => check('Attack',sheet.numbers.attack ?? 0)}><Dice5 size={16} />{locale === 'es' ? 'Ataque del adversario' : 'Adversary attack'} · {sheet.numbers.attack ?? 0}</button>}

      {tab === 'stats' && <StatsPanel {...panelProps} sheets={sheets} check={check} />}

      {tab === 'resources' && <ResourcePanel {...panelProps} />}

      {tab === 'rows' && <RowsPanel {...panelProps} addRoll={addRoll} report={report} />}

      {tab === 'details' && <><div className="grid gap-4 lg:grid-cols-2">{Object.entries(sheet.details).map(([key, value]) => <div key={key} className={key === 'notes' ? 'lg:col-span-2' : ''}><Field label={titleCase(key)}><textarea className={input} rows={key === 'notes' ? 6 : 2} aria-label={`Detail · ${key}`} value={value} onChange={event => update(current => ({ ...current, details: { ...current.details, [key]: event.target.value } }))} /></Field></div>)}</div><div className="flex flex-wrap items-end gap-3"><Field label={c.label}><input className={input} aria-label="New property" value={newProperty} onChange={event => setNewProperty(event.target.value)} maxLength={100} /></Field><Field label={locale === 'es' ? 'Tipo de propiedad' : 'Property type'}><select className={input} value={propertyType} onChange={event => setPropertyType(event.target.value as typeof propertyType)}><option value="text">{locale === 'es' ? 'Texto' : 'Text'}</option><option value="number">{locale === 'es' ? 'Número' : 'Number'}</option></select></Field><button className={button} disabled={!newProperty.trim()} onClick={() => {

        const key = newProperty.trim(); if (['__proto__', 'constructor', 'prototype'].includes(key) || Object.keys(sheet.details).concat(Object.keys(sheet.numbers)).some(existing => existing.toLowerCase() === key.toLowerCase())) { report(locale === 'es' ? 'Elige una etiqueta distinta.' : 'Choose a distinct label.'); return; }

        update(current => propertyType === 'text' ? { ...current, details: { ...current.details, [key]: '' } } : { ...current, numbers: { ...current.numbers, [key]: 0 } }); setNewProperty(''); report('');

      }}>{locale === 'es' ? 'Añadir propiedad' : 'Add property'}</button></div></>}

      {tab === 'rolls' && <>

        <button className={button} onClick={() => check(coc ? 'd100' : duality ? 'Duality' : 'd20', coc ? target : bonus)}><Dice5 size={16} />{c.roll} · {coc ? 'd100' : duality ? 'Hope d12 + Fear d12' : 'd20'}</button>

        <div className="flex flex-wrap items-end gap-2"><div className="min-w-48 flex-1"><Field label={c.expression}><input className={input} aria-label={c.expression} maxLength={100} value={expression} onChange={event => setExpression(event.target.value)} /></Field></div><button className={button} onClick={() => { try { addRoll(rollExpression(expression)); } catch { report(locale === 'es' ? 'Expresión no válida: usa NdS y +/−.' : 'Invalid expression: use NdS and +/−.'); } }}>{c.roll}</button></div>

        {duality && last && last.expression.startsWith('Hope') && <div className="space-y-2 rounded-lg border border-border p-3"><p className="text-sm text-text-muted">{c.hopeHelp}</p><button className={button} disabled={last.appliedResources || !(last.outcome === 'critical' || last.outcome.endsWith('hope')) || !sheet.resources.some(item => item.id === 'hope')} onClick={() => update(current => { if (current.rolls.find(roll => roll.id === last.id)?.appliedResources) return current; return { ...current, resources: current.resources.map(item => item.id === 'hope' ? { ...item, current: Math.min(item.max, item.current + 1) } : item.id === 'stress' && last.outcome === 'critical' ? { ...item, current: Math.max(0, item.current - 1) } : item), rolls: current.rolls.map(roll => roll.id === last.id ? { ...roll, appliedResources: true } : roll) }; })}>{c.hope}</button></div>}

        <div className="flex items-center justify-between gap-2"><h3 className="font-display text-xl text-text-primary">{c.history}</h3><button className={button} disabled={!sheet.rolls.length} onClick={() => confirm(c.clearHelp, () => update(current => ({ ...current, rolls: [] })))}>{c.clearHistory}</button></div>

        <ol className="space-y-2">{sheet.rolls.map(roll => <li key={roll.id} className="rounded-lg border border-border p-3 text-sm text-text-primary"><div className="flex flex-wrap justify-between gap-2"><strong>{roll.label}</strong><time className="text-xs text-text-muted" dateTime={new Date(roll.at).toISOString()}>{new Date(roll.at).toLocaleString(locale)}</time></div><div className="mt-2 flex flex-wrap items-center gap-3"><span className="font-mono text-text-muted">{roll.expression} [{roll.dice.join(', ')}]</span><strong className="font-mono text-xl text-accent-gold">{roll.total}</strong>{roll.target !== undefined && <span className="text-text-muted">{c.target}: {roll.target}</span>}<span>{outcome(roll)}</span></div>{roll.coc?.pushedFrom&&<p className="mt-2 text-xs text-text-muted">{locale==='es'?'Forzada tras':'Pushed after'} {sheet.rolls.find(item=>item.id===roll.coc?.pushedFrom)?.total??'…'} · {roll.coc.justification}</p>}{roll.coc?.pushedBy&&<p className="mt-2 text-xs text-text-muted">{locale==='es'?'Forzada una vez →':'Pushed once →'} {sheet.rolls.find(item=>item.id===roll.coc?.pushedBy)?.total??'…'}</p>}</li>)}</ol>

      </>}

    </div>

  </div>;

}

