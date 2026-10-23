// The fight at the table: initiative order with the turn and round, hit
// points with damage, healing and temporary ones, conditions that wear off,
// death saves and concentration checks, characters from the sheets and
// monsters from the compendium.
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight, Dices, Heart, Plus, Shield, Skull, Swords, Trash2 } from 'lucide-react';
import { db } from '@/db';
import type { CharacterSheet } from '@/engines/character-sheets/types';
import { ENCOUNTER_CONDITIONS, conditionLabel, applyDamage, createCombatant, createEncounter, deathSave, heal, nextTurn, previousTurn, rollInitiative, setTempHp, sortByInitiative, toggleCondition, type Combatant, type DamageEffect, type Encounter } from './model';
import { EncounterConflict, deleteEncounter, saveEncounter } from './operations';
import { combatantFromSheet } from './fromSources';

const control = 'min-h-9 rounded-lg border border-border bg-deep px-2 text-sm text-text-primary';
const button = 'inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-text-primary hover:bg-elevated disabled:opacity-50';
const small = 'inline-flex min-h-8 items-center gap-1 rounded border border-border px-2 text-xs text-text-primary hover:bg-elevated disabled:opacity-50';
const d20 = () => { const value = new Uint32Array(1); crypto.getRandomValues(value); return (value[0] % 20) + 1; };

const COPY = {
  es: { title: 'Combate', fight: 'Combate', none: 'Aún no hay combates. Empieza uno y añade personajes y monstruos.', newFight: 'Nuevo combate', round: 'Ronda', turnOf: 'Turno de', rollAll: 'Tirar iniciativa', rollMissing: 'Tirar las que faltan', sort: 'Ordenar', prev: 'Anterior', next: 'Siguiente turno', end: 'Terminar combate', remove: 'Quitar', name: 'Nombre', init: 'Ini.', bonus: 'Bono ini.', hp: 'PG', ac: 'CA', player: 'Personaje (salvaciones de muerte)', add: 'Añadir', addSheet: 'Añadir desde una hoja…', damage: 'Daño', heal: 'Curar', temp: 'PG temporales', amount: 'Cantidad', conditions: 'Condiciones', addCondition: 'Añadir condición…', rounds: 'rondas', deathSave: 'Salvación de muerte', concentrating: 'Concentrándose', log: 'Registro', dead: 'muerto', down: 'cae', unconscious: 'inconsciente', massive: 'daño masivo', failed: 'falla una salvación de muerte', concentration: 'salvación de concentración CD', stable: 'estable', revived: 'vuelve con 1 PG', conflict: 'Otra ventana cambió este combate; se muestra el actual.', deleteFight: 'Borrar combate' },
  en: { title: 'Encounter', fight: 'Fight', none: 'No fights yet. Start one and add characters and monsters.', newFight: 'New fight', round: 'Round', turnOf: 'Turn of', rollAll: 'Roll initiative', rollMissing: 'Roll the missing ones', sort: 'Sort', prev: 'Previous', next: 'Next turn', end: 'End fight', remove: 'Remove', name: 'Name', init: 'Init.', bonus: 'Init. bonus', hp: 'HP', ac: 'AC', player: 'Character (death saves)', add: 'Add', addSheet: 'Add from a sheet…', damage: 'Damage', heal: 'Heal', temp: 'Temp HP', amount: 'Amount', conditions: 'Conditions', addCondition: 'Add condition…', rounds: 'rounds', deathSave: 'Death save', concentrating: 'Concentrating', log: 'Log', dead: 'dead', down: 'down', unconscious: 'unconscious', massive: 'massive damage', failed: 'fails a death save', concentration: 'concentration save DC', stable: 'stable', revived: 'back with 1 HP', conflict: 'Another window changed this fight; showing the current one.', deleteFight: 'Delete fight' },
};

export default function EncounterPanel({ projectId, locale, sheets }: { projectId: string; locale: 'es' | 'en'; sheets: CharacterSheet[] }) {
  const c = COPY[locale];
  const encounters = useLiveQuery(async () => (await db.projects.get(projectId))?.encounters ?? [], [projectId]);
  const [selected, setSelected] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ name: '', hp: '10', bonus: '0', ac: '', player: false });
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const sorted = useMemo(() => [...(encounters ?? [])].sort((a, b) => b.updatedAt - a.updatedAt), [encounters]);
  const encounter = sorted.find(item => item.id === selected) ?? sorted[0];
  useEffect(() => { if (!selected && sorted[0]) setSelected(sorted[0].id); }, [selected, sorted]);
  const save = async (change: (current: Encounter) => Encounter, base: Encounter | null = encounter ?? null) => {
    if (busy) return; setBusy(true); setError('');
    try { const next = change(base ?? createEncounter(c.fight)); const saved = await saveEncounter(projectId, next, base ? base.revision : null); setSelected(saved.id); }
    catch (failure) { setError(failure instanceof EncounterConflict ? c.conflict : String(failure instanceof Error ? failure.message : failure)); }
    finally { setBusy(false); }
  };
  const update = (id: string, change: (combatant: Combatant) => Combatant, log?: string) => void save(current => ({ ...current, combatants: current.combatants.map(combatant => combatant.id === id ? change(combatant) : combatant), log: log ? [...current.log, log] : current.log }));
  const effectText = (effects: DamageEffect[]) => effects.map(effect => ({ dead: c.dead, down: c.down, unconscious: c.unconscious, massive: c.massive, 'failed-save': c.failed })[effect]).join(', ');
  const amount = (id: string) => Math.max(0, Math.round(Number(amounts[id] ?? '0')) || 0);
  const fiveESheets = sheets.filter(sheet => sheet.preset.startsWith('5e'));
  const active = encounter?.combatants[encounter.turn];

  return <section className="space-y-3" data-testid="encounter" aria-label={c.title}>
    <header className="flex flex-wrap items-center gap-2">
      <Swords size={18} className="text-accent-gold" aria-hidden="true" />
      {sorted.length > 0 && <select data-testid="enc-select" aria-label={c.fight} className={control} value={encounter?.id ?? ''} onChange={event => setSelected(event.target.value)}>{sorted.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>}
      {encounter && <input data-testid="enc-title" aria-label={c.name} className={`${control} w-48`} defaultValue={encounter.title} key={`${encounter.id}:${encounter.revision}`} onBlur={event => { const title = event.target.value.trim(); if (title && title !== encounter.title) void save(current => ({ ...current, title })); }} />}
      <button type="button" data-testid="enc-new" className={button} disabled={busy} onClick={() => void save(() => createEncounter(`${c.fight} ${sorted.length + 1}`), null)}><Plus size={15} />{c.newFight}</button>
      {encounter && <button type="button" data-testid="enc-delete" className={`${small} ml-auto text-danger`} disabled={busy} onClick={() => { setBusy(true); void deleteEncounter(projectId, encounter.id, encounter.revision).then(() => setSelected('')).catch(() => setError(c.conflict)).finally(() => setBusy(false)); }}><Trash2 size={13} />{c.deleteFight}</button>}
    </header>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!encounter ? <p className="text-sm text-text-muted">{c.none}</p> : <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        <span data-testid="enc-round" className="font-display text-lg text-text-primary">{c.round} {encounter.round}</span>
        {active && <span className="text-sm text-text-muted">· {c.turnOf} <strong className="text-accent-gold">{active.name}</strong></span>}
        <div className="ml-auto flex flex-wrap gap-1">
          <button type="button" data-testid="enc-roll-all" className={small} disabled={busy || !encounter.combatants.length} onClick={() => void save(current => rollInitiative(current, 'all', d20))}><Dices size={13} />{c.rollAll}</button>
          <button type="button" data-testid="enc-roll-missing" className={small} disabled={busy} onClick={() => void save(current => rollInitiative(current, 'missing', d20))}>{c.rollMissing}</button>
          <button type="button" data-testid="enc-sort" className={small} disabled={busy} onClick={() => void save(current => sortByInitiative(current))}>{c.sort}</button>
          <button type="button" data-testid="enc-prev" className={small} disabled={busy} onClick={() => void save(current => previousTurn(current))}><ChevronLeft size={13} />{c.prev}</button>
          <button type="button" data-testid="enc-next" className={`${small} border-accent-gold text-accent-gold`} disabled={busy || !encounter.combatants.length} onClick={() => void save(current => nextTurn(current))}>{c.next}<ChevronRight size={13} /></button>
          <button type="button" data-testid="enc-end" className={small} disabled={busy} onClick={() => void save(current => ({ ...current, round: 1, turn: 0, combatants: current.combatants.filter(combatant => combatant.player).map(combatant => ({ ...combatant, initiative: null, conditions: [], concentrating: false })), log: [...current.log, `— ${c.end} —`] }))}>{c.end}</button>
        </div>
      </div>
      <ol className="space-y-2" aria-label={c.fight}>
        {encounter.combatants.map((combatant, index) => {
          const isTurn = index === encounter.turn;
          return <li key={combatant.id} data-testid={`enc-row-${index}`} aria-current={isTurn ? 'step' : undefined} className={`rounded-lg border p-2 text-sm ${isTurn ? 'border-accent-gold bg-accent-gold/10' : 'border-border'} ${combatant.dead ? 'opacity-50' : ''}`}>
            <div className="flex flex-wrap items-center gap-2">
              <input type="number" aria-label={`${c.init} ${combatant.name}`} data-testid={`enc-init-${index}`} className={`${control} w-16`} defaultValue={combatant.initiative ?? ''} key={`${combatant.id}:${combatant.initiative}`} onBlur={event => { const value = event.target.value === '' ? null : Number(event.target.value); if (value !== combatant.initiative && (value === null || Number.isFinite(value))) update(combatant.id, current => ({ ...current, initiative: value })); }} />
              <strong className="min-w-0 flex-1 truncate text-text-primary">{combatant.dead && <Skull size={13} className="mr-1 inline" />}{combatant.name}</strong>
              {combatant.ac !== undefined && <span className="inline-flex items-center gap-1 text-text-muted"><Shield size={13} />{combatant.ac}</span>}
              <span data-testid={`enc-hp-${index}`} className="inline-flex items-center gap-1 text-text-primary"><Heart size={13} className="text-danger" />{combatant.hp}/{combatant.maxHp}{combatant.tempHp ? ` +${combatant.tempHp}` : ''}</span>
              <input type="number" min={0} aria-label={`${c.amount} ${combatant.name}`} data-testid={`enc-amount-${index}`} className={`${control} w-16`} value={amounts[combatant.id] ?? ''} onChange={event => setAmounts(current => ({ ...current, [combatant.id]: event.target.value }))} />
              <button type="button" data-testid={`enc-damage-${index}`} className={small} disabled={busy || combatant.dead} onClick={() => { const result = applyDamage(combatant, amount(combatant.id)); update(combatant.id, () => result.combatant, `${combatant.name} −${result.taken}${result.effects.length ? ` (${effectText(result.effects)})` : ''}${result.concentrationDc ? ` · ${c.concentration} ${result.concentrationDc}` : ''}`); }}>{c.damage}</button>
              <button type="button" data-testid={`enc-heal-${index}`} className={small} disabled={busy || combatant.dead} onClick={() => update(combatant.id, current => heal(current, amount(combatant.id)), `${combatant.name} +${amount(combatant.id)}`)}>{c.heal}</button>
              <button type="button" data-testid={`enc-temp-${index}`} className={small} disabled={busy || combatant.dead} onClick={() => update(combatant.id, current => setTempHp(current, amount(combatant.id)))}>{c.temp}</button>
              <label className="inline-flex items-center gap-1 text-xs text-text-muted"><input type="checkbox" data-testid={`enc-concentrating-${index}`} checked={combatant.concentrating} onChange={event => update(combatant.id, current => ({ ...current, concentrating: event.target.checked }))} />{c.concentrating}</label>
              <button type="button" data-testid={`enc-remove-${index}`} aria-label={`${c.remove} ${combatant.name}`} className={`${small} text-danger`} disabled={busy} onClick={() => void save(current => { const at = current.combatants.findIndex(item => item.id === combatant.id), combatants = current.combatants.filter(item => item.id !== combatant.id); return { ...current, combatants, turn: Math.min(Math.max(0, at < current.turn ? current.turn - 1 : current.turn), Math.max(0, combatants.length - 1)) }; })}><Trash2 size={12} /></button>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {combatant.conditions.map(condition => <button key={condition.name} type="button" data-testid={`enc-chip-${index}-${condition.name}`} className="rounded-full bg-accent-plum/20 px-2 py-0.5 text-xs text-text-primary hover:line-through" title={c.remove} onClick={() => update(combatant.id, current => toggleCondition(current, condition.name))}>{conditionLabel(condition.name, locale)}{condition.rounds ? ` · ${condition.rounds} ${c.rounds}` : ''}</button>)}
              <select data-testid={`enc-condition-${index}`} aria-label={`${c.addCondition} ${combatant.name}`} className={`${control} text-xs`} value="" onChange={event => { const name = event.target.value; if (!name) return; const rounds = Number((document.querySelector(`[data-testid="enc-condition-rounds-${index}"]`) as HTMLInputElement | null)?.value || 0); update(combatant.id, current => toggleCondition(current, name, rounds || undefined)); }}>
                <option value="">{c.addCondition}</option>{ENCOUNTER_CONDITIONS.filter(name => !combatant.conditions.some(condition => condition.name === name)).map(name => <option key={name} value={name}>{conditionLabel(name, locale)}</option>)}
              </select>
              <input type="number" min={0} data-testid={`enc-condition-rounds-${index}`} aria-label={`${c.rounds} ${combatant.name}`} placeholder={c.rounds} className={`${control} w-20 text-xs`} />
              {combatant.player && combatant.hp === 0 && !combatant.dead && <span className="ml-2 inline-flex items-center gap-1 text-xs text-text-muted" data-testid={`enc-saves-${index}`}>✓ {combatant.deathSaves.successes}/3 · ✗ {combatant.deathSaves.failures}/3
                <button type="button" data-testid={`enc-deathsave-${index}`} className={small} disabled={busy} onClick={() => { const roll = d20(), result = deathSave(combatant, roll); update(combatant.id, () => result.combatant, `${combatant.name}: ${c.deathSave} ${roll} → ${({ success: '✓', failure: '✗', stable: c.stable, dead: c.dead, revived: c.revived })[result.outcome]}`); }}><Dices size={12} />{c.deathSave}</button></span>}
            </div>
          </li>;
        })}
      </ol>
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-2">
        <label className="text-xs text-text-muted">{c.name}<input data-testid="enc-add-name" className={`${control} block w-40`} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <label className="text-xs text-text-muted">{c.hp}<input type="number" data-testid="enc-add-hp" className={`${control} block w-20`} value={draft.hp} onChange={event => setDraft({ ...draft, hp: event.target.value })} /></label>
        <label className="text-xs text-text-muted">{c.bonus}<input type="number" data-testid="enc-add-init" className={`${control} block w-20`} value={draft.bonus} onChange={event => setDraft({ ...draft, bonus: event.target.value })} /></label>
        <label className="text-xs text-text-muted">{c.ac}<input type="number" data-testid="enc-add-ac" className={`${control} block w-16`} value={draft.ac} onChange={event => setDraft({ ...draft, ac: event.target.value })} /></label>
        <label className="flex items-center gap-1 text-xs text-text-muted"><input type="checkbox" data-testid="enc-add-player" checked={draft.player} onChange={event => setDraft({ ...draft, player: event.target.checked })} />{c.player}</label>
        <button type="button" data-testid="enc-add" className={button} disabled={busy || !draft.name.trim()} onClick={() => { void save(current => ({ ...current, combatants: [...current.combatants, createCombatant({ name: draft.name, hp: Number(draft.hp) || 0, maxHp: Number(draft.hp) || 0, initiativeBonus: Number(draft.bonus) || 0, ...(draft.ac ? { ac: Number(draft.ac) } : {}), player: draft.player })] })); setDraft({ name: '', hp: '10', bonus: '0', ac: '', player: false }); }}><Plus size={15} />{c.add}</button>
        {fiveESheets.length > 0 && <select data-testid="enc-add-sheet" aria-label={c.addSheet} className={control} value="" onChange={event => { const sheet = fiveESheets.find(item => item.id === event.target.value); if (sheet) void save(current => ({ ...current, combatants: [...current.combatants, combatantFromSheet(sheet, current)] })); }}><option value="">{c.addSheet}</option>{fiveESheets.map(sheet => <option key={sheet.id} value={sheet.id}>{sheet.title}</option>)}</select>}
      </div>
      {encounter.log.length > 0 && <details data-testid="enc-log" className="text-xs text-text-muted"><summary>{c.log} ({encounter.log.length})</summary><ul className="mt-1 space-y-0.5">{encounter.log.slice(-15).reverse().map((line, index) => <li key={index}>{line}</li>)}</ul></details>}
    </>}
  </section>;
}
