import {useState} from 'react';
import type {PanelProps} from './StatsPanel';
import {DAGGERHEART_CLASSES,DAGGERHEART_SOURCE,applyDaggerheartClass,daggerheartClassPreview,setDaggerheartResource,type DaggerheartClassField, DAGGERHEART_GOLD_CAPACITY, DAGGERHEART_GOLD_LABELS, DAGGERHEART_GOLD_UNITS, daggerheartGold, setDaggerheartGold, daggerheartExperienceRows, editDaggerheartExperience} from './daggerheart';
import {button,input,signed} from './uiStyles';
import {Field,NumberField} from './ui';
import { DaggerheartAdversaryRows, DaggerheartAdversaryStats } from './DaggerheartAdversaryPanel';

const slotButton = 'flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-elevated text-sm text-text-muted aria-pressed:border-accent-gold aria-pressed:bg-accent-gold/20 aria-pressed:text-accent-gold focus-visible:outline focus-visible:outline-accent-gold';

function DaggerheartGoldTrack({ sheet, locale, update }: Pick<PanelProps, 'sheet' | 'locale' | 'update'>) {
 const copy = DAGGERHEART_GOLD_LABELS[locale];
 const gold = daggerheartGold(sheet);
 return <section className="space-y-3 rounded-lg border border-border p-4" aria-label={copy.title}>
  <h3 className="font-semibold text-text-primary">{copy.title}</h3>
  <p className="text-sm text-text-muted">{locale === 'es'
   ? '10 puñados hacen una bolsa y 10 bolsas hacen un cofre. Si el destino está lleno, el oro se conserva.'
   : '10 handfuls make a bag and 10 bags make a chest. If the next counter is full, the gold stays where it is.'}</p>
  {DAGGERHEART_GOLD_UNITS.map(unit => <div key={unit} className="space-y-2" role="group" aria-label={copy[unit]}>
   <div className="flex items-center justify-between gap-2 text-sm text-text-muted">
    <span>{copy[unit]}</span><output className="tabular-nums">{gold[unit]} / {DAGGERHEART_GOLD_CAPACITY[unit]}</output>
   </div>
   <div className="flex flex-wrap gap-1.5">
    {Array.from({ length: DAGGERHEART_GOLD_CAPACITY[unit] }, (_, index) => {
     const amount = index + 1;
     return <button type="button" key={amount} aria-label={unit === 'chest' ? copy.chest : copy[unit] + ' ' + amount}
      aria-pressed={amount <= gold[unit]} className={slotButton} onClick={() => update(current => {
       const next = setDaggerheartGold(current, unit, amount);
       return next === current ? setDaggerheartGold(current, unit, index) : next;
      })}>{amount}</button>;
    })}
   </div>
  </div>)}
 </section>;
}

const experienceLabels = {
 es: {
  title: 'Experiencias', add: 'Añadir experiencia', edit: 'Editar', remove: 'Eliminar', name: 'Nombre de la experiencia',
  modifier: 'Modificador', unset: 'Sin modificador', save: 'Guardar experiencia', cancel: 'Cancelar', confirm: '¿Eliminar la experiencia «{name}»?',
  changed: 'La experiencia cambió en otra vista. Revisa la fila actual antes de volver a editarla.',
  full: 'La ficha alcanzó el límite de filas.',
 },
 en: {
  title: 'Experiences', add: 'Add experience', edit: 'Edit', remove: 'Remove', name: 'Experience name',
  modifier: 'Modifier', unset: 'No modifier', save: 'Save experience', cancel: 'Cancel', confirm: 'Remove the experience “{name}”?',
  changed: 'The experience changed in another view. Review the current row before editing it again.',
  full: 'This sheet has reached its row limit.',
 },
};

function DaggerheartExperiences({ sheet, locale, update, confirm }: PanelProps) {
 const copy = experienceLabels[locale];
 const rows = daggerheartExperienceRows(sheet);
 const [draft, setDraft] = useState<{
  rowId?: string; name: string; modifier: string; before?: { name: string; modifier?: number };
 }>();
 const target = draft?.before && rows.find(row => row.id === draft.rowId);
 const changed = draft?.before && (!target || target.name !== draft.before.name || target.daggerheartExperience !== draft.before.modifier);
 const problem = changed ? copy.changed : draft && draft.rowId === undefined && sheet.rows.length >= 500 ? copy.full : '';
 const value = draft?.modifier.trim() ?? '';
 const modifier = Number(value);
 const valid = !!draft?.name.trim() && /^[+-]?\d+$/.test(value) && Number.isSafeInteger(modifier);
 return <section className="space-y-3 rounded-lg border border-border p-4" aria-label={copy.title}>
  <div className="flex flex-wrap items-center justify-between gap-2">
   <h3 className="font-semibold text-text-primary">{copy.title}</h3>
   <button type="button" className={button} disabled={sheet.rows.length >= 500}
    onClick={() => setDraft({ name: '', modifier: '' })}>{copy.add}</button>
  </div>
  {rows.length > 0 && <ul className="divide-y divide-border">
   {rows.map(row => <li key={row.id} className="flex flex-wrap items-center gap-2 py-2">
    <strong className="mr-auto min-w-0 break-words text-sm font-medium text-text-primary">{row.name}</strong>
    <span className="text-sm tabular-nums text-text-muted">{row.daggerheartExperience === undefined ? copy.unset : signed(row.daggerheartExperience)}</span>
    <button type="button" className={button} aria-label={copy.edit + ' · ' + row.name}
     onClick={() => setDraft({
      rowId: row.id, name: row.name, modifier: row.daggerheartExperience === undefined ? '' : signed(row.daggerheartExperience),
      before: { name: row.name, modifier: row.daggerheartExperience },
     })}>{copy.edit}</button>
    <button type="button" className={button} aria-label={copy.remove + ' · ' + row.name}
     onClick={() => confirm(copy.confirm.replace('{name}', () => row.name), () => {
      update(current => editDaggerheartExperience(current, { action: 'delete-experience', rowId: row.id }));
      if (draft?.rowId === row.id) setDraft(undefined);
     })}>{copy.remove}</button>
   </li>)}
  </ul>}
  {draft && <form key={draft.rowId ?? 'new'} className="flex flex-wrap items-end gap-2" onSubmit={event => {
   event.preventDefault();
   if (!valid || problem) return;
   update(current => editDaggerheartExperience(current, { action: 'save-experience', rowId: draft.rowId, name: draft.name, modifier }));
   setDraft(undefined);
  }}>
   <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-text-muted">{copy.name}
    <input autoFocus required className={input} maxLength={100000} value={draft.name}
     onChange={event => setDraft({ ...draft, name: event.target.value })} />
   </label>
   <label className="flex flex-col gap-1 text-sm text-text-muted">{copy.modifier}
    <input required className={input + ' w-28'} inputMode="text" value={draft.modifier}
     onChange={event => setDraft({ ...draft, modifier: event.target.value })} />
   </label>
   {problem && <p role="alert" className="basis-full text-sm text-danger">{problem}</p>}
   <button type="submit" className={button} disabled={!valid || !!problem}>{copy.save}</button>
   <button type="button" className={button} onClick={() => setDraft(undefined)}>{copy.cancel}</button>
  </form>}
 </section>;
}

export default function DaggerheartPlayPanel({sheet,locale,update,confirm}:PanelProps){
 const es=locale==='es',pc=sheet.preset==='daggerheart-character';
 const [candidate,setCandidate]=useState(''),[choices,setChoices]=useState<{field:DaggerheartClassField;before:unknown;after:unknown;automatic:boolean}[]>([]),[notice,setNotice]=useState('');
 const preview=candidate&&pc?daggerheartClassPreview(sheet,candidate):null;
 // Consent is for the displayed old/new value, not a field name forever.
 const selectedFields=(changes:ReturnType<typeof daggerheartClassPreview>['changes'])=>changes.filter(change=>choices.some(choice=>choice.field===change.field&&choice.before===change.before&&choice.after===change.after&&(!choice.automatic||change.safe))).map(change=>change.field);
 const fields=preview?selectedFields(preview.changes):[];
 const names:Record<DaggerheartClassField,string>={class:es?'Clase':'Class',domains:es?'Dominios':'Domains',evasion:es?'Evasión':'Evasion',startingHp:es?'PV iniciales (capacidad)':'Starting HP capacity',features:es?'Referencias de rasgos':'Feature references'};
 return <section className="space-y-5" data-testid="daggerheart-play">
  {pc ? <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{['level','evasion','proficiency'].map(key=><NumberField key={key} label={key} value={sheet.numbers[key]??0} onChange={value=>update(current=>({...current,numbers:{...current.numbers,[key]:value}}))}/>)}</div>
    : <DaggerheartAdversaryStats sheet={sheet} locale={locale} update={update} confirm={confirm} />}
  <section className="space-y-3 rounded-lg border border-border p-4" aria-label={es?'Recursos de partida':'Play resources'}>
   {sheet.resources.map(resource=><div key={resource.id} className="space-y-2" data-testid={`daggerheart-track-${resource.id}`}>
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-primary"><strong>{resource.label}</strong><output>{resource.current} / {resource.max} · {resource.marked?(es?'marcados':'marked'):(es?'disponibles':'available')}</output></div>
    {Number.isSafeInteger(resource.max)&&Number.isSafeInteger(resource.current)&&resource.max>0&&resource.max<=24?<div className="flex flex-wrap gap-1.5" role="group" aria-label={resource.label}>
     {Array.from({length:resource.max},(_,i)=><button type="button" key={i} aria-label={`${resource.label}: ${i+1}`} aria-pressed={i<resource.current} className={slotButton} onClick={()=>{const value=resource.current===i+1?i:i+1;update(current=>setDaggerheartResource(current,resource.id,value));}}>{i+1}</button>)}
     <button type="button" className={button} disabled={resource.current===0} aria-label={`${es?'Vaciar':'Clear'} · ${resource.label}`} onClick={()=>update(current=>setDaggerheartResource(current,resource.id,0))}>0</button>
    </div>:<NumberField label={resource.label} value={resource.current} min={0} max={resource.max} onChange={value=>{if(Number.isFinite(value)&&value>=0&&value<=resource.max&&value!==resource.current)update(current=>setDaggerheartResource(current,resource.id,value));}}/>}
   </div>)}
   <p className="text-xs text-text-muted">{es?'Las capacidades y etiquetas siguen disponibles en Recursos. Los cambios de clase o nivel no reinician estos contadores.':'Capacities and labels remain editable in Resources. Class or level changes do not reset these counters.'}</p>
  </section>
  {pc && <DaggerheartExperiences sheet={sheet} locale={locale} update={update} confirm={confirm} />}
  {pc && <DaggerheartGoldTrack sheet={sheet} locale={locale} update={update} />}
  {pc&&<section className="space-y-3 rounded-lg border border-border p-4" aria-label={es?'Datos de clase':'Class data'}>
   <p className="text-sm text-text-primary">{es?'Clase registrada':'Recorded class'}: {sheet.details.class||'—'} · {sheet.details.domains||'—'}</p>
   <Field label={es?'Previsualizar clase del juego base':'Preview core class'}><select className={input} aria-label={es?'Previsualizar clase del juego base':'Preview core class'} value={candidate} onChange={event=>{const id=event.target.value;setNotice('');setCandidate(id);setChoices(id?daggerheartClassPreview(sheet,id).changes.filter(change=>change.safe).map(change=>({field:change.field,before:change.before,after:change.after,automatic:true})):[]);}}><option value="">{es?'Elegir clase…':'Choose class…'}</option>{DAGGERHEART_CLASSES.map(source=><option key={source.id} value={source.id}>{source.name}</option>)}</select></Field>
   {preview&&<div className="space-y-3" data-testid="daggerheart-class-preview">
    <p className="text-xs text-text-muted">{es?'Marca los valores que quieras aplicar. Los valores propios se conservan si no los marcas. Los PV iniciales son opcionales; no representan una subida de nivel.':'Choose which values to apply. Authored values stay unless checked. Starting HP is optional and does not represent a level-up.'}</p>
    {notice&&<p role="alert" className="text-sm text-danger">{notice}</p>}<div className="space-y-2">{preview.changes.map(change=><label key={change.field} className="flex items-start gap-2 text-sm text-text-primary"><input type="checkbox" className="mt-1 accent-accent-gold" aria-label={names[change.field]} checked={fields.includes(change.field)} onChange={event=>setChoices(current=>event.target.checked?[...current.filter(choice=>choice.field!==change.field),{field:change.field,before:change.before,after:change.after,automatic:false}]:current.filter(choice=>choice.field!==change.field))}/><span className="min-w-0 break-words"><strong>{names[change.field]}</strong>: {String(change.before??'—')||'—'} → {String(change.after)}{!change.safe&&<span className="block text-xs text-text-muted">{es?'Requiere elección explícita':'Requires explicit selection'}</span>}</span></label>)}</div>
    {preview.protectedRows.length>0&&<p role="status" className="text-xs text-accent-gold">{es?'Se conservarán las filas de clase que has editado.':'Edited class rows will be preserved.'}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!fields.length} onClick={()=>{try{const next=applyDaggerheartClass(sheet,candidate,fields);if(next!==sheet)update(current=>{const applicable=selectedFields(daggerheartClassPreview(current,candidate).changes);return applicable.length?applyDaggerheartClass(current,candidate,applicable):current;});setCandidate('');setChoices([]);setNotice('');}catch(error){setNotice(error instanceof Error&&error.message==='daggerheart_hp_missing'?(es?'No hay un recurso PV. Añádelo en Recursos o desmarca los PV iniciales.':'This sheet has no HP resource. Add it in Resources or uncheck starting HP.'):error instanceof Error&&error.message==='daggerheart_rows_limit'?(es?'No caben estas referencias dentro del límite de 500 filas. Conserva las filas actuales y desmarca las referencias, o deja espacio antes de aplicarlas.':'These references exceed the 500-row capacity. Keep the current rows and uncheck feature references, or make room before applying them.'):(es?'No se pudieron aplicar los campos. La ficha y la previsualización se conservan.':'Could not apply these fields. The sheet and preview are retained.'));}}}>{es?'Aplicar campos elegidos':'Apply selected fields'}</button><button type="button" className={button} onClick={()=>{setCandidate('');setChoices([]);}}>{es?'Cancelar previsualización':'Cancel preview'}</button><a href={preview.reference} target="_blank" rel="noreferrer noopener" className="self-center text-sm text-accent-gold underline">SRD2.0 · p.{preview.source.page}</a></div>
   </div>}
   <p className="text-xs text-text-muted">{es?'Nueve clases del juego base, verificadas en SRD2.0. Las filas son referencias editables; los efectos de los rasgos se resuelven en la mesa.':'Nine core classes, checked against SRD2.0. Rows are editable references; feature effects are resolved at the table.'} <a className="text-accent-gold underline" href={DAGGERHEART_SOURCE.license} target="_blank" rel="noreferrer noopener">{es?'Fuente y licencia':'Source and license'}</a></p>
  </section>}
  {!pc && <DaggerheartAdversaryRows sheet={sheet} locale={locale} update={update} confirm={confirm} />}
  {sheet.rows.filter(row=>!row.daggerheartAdversary&&/feature|trait|rasgo|hope/i.test(row.section)).map(row=><article key={row.id} className="space-y-1 rounded-lg border border-border p-3"><h3 className="font-semibold text-text-primary">{row.name}</h3><p className="whitespace-pre-wrap break-words text-sm text-text-muted">{row.detail}</p></article>)}
 </section>;
}
