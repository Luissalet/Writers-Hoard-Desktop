// The compendium: shelves of SRD 5.2 monsters, spells, magic items and
// conditions, a search across all of them, filters per shelf, entry pages
// (a monster as a stat block), and "Añadir al mundo" / "Añadir al combate".
import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Plus, Swords } from 'lucide-react';
import type { CodexEntry } from '@/types';
import { COMPENDIUM_KINDS, COMPENDIUM_KIND_LABELS, SRD_CREDIT, abilityMod, compendiumCounts, compendiumEntry, crLabel, searchCompendium, type CompendiumEntry, type CompendiumFilter, type CompendiumHit, type CompendiumKind, type SrdMonster } from './srd';
import { addCompendiumEntryToWorld } from './addToWorld';

const control = 'min-h-9 rounded-lg border border-border bg-deep px-2 text-sm text-text-primary';
const button = 'inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm text-text-primary hover:bg-elevated disabled:opacity-50';
const CRS = [0, 0.125, 0.25, 0.5, ...Array.from({ length: 30 }, (_, i) => i + 1)];
const ABILITIES = { es: ['FUE', 'DES', 'CON', 'INT', 'SAB', 'CAR'], en: ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] };


function MonsterBlock({ m, lang }: { m: SrdMonster; lang: 'es' | 'en' }) {
  const line = (label: string, value?: string) => value ? <p><strong>{label}</strong> {value}</p> : null;
  const part = (title: string, pairs: [string, string][]) => pairs.length ? <section className="space-y-1"><h4 className="border-b border-[#9a3a1c]/50 font-display text-base text-[#9a3a1c]">{title}</h4>{pairs.map(([name, text]) => <p key={name} className="whitespace-pre-line"><strong><em>{name}.</em></strong> {text}</p>)}</section> : null;
  const es = lang === 'es';
  return <div className="space-y-2 text-sm text-text-primary" data-testid="compendium-statblock">
    <p className="italic text-text-muted">{m.s} {m.t}, {m.al}</p>
    <div className="space-y-0.5 border-y border-[#9a3a1c]/50 py-2">{line(es ? 'CA' : 'AC', `${m.ac}${m.acn ? ` (${m.acn})` : ''}`)}{line(es ? 'PG' : 'HP', `${m.hp} (${m.hd})`)}{line(es ? 'Velocidad' : 'Speed', m.sp)}</div>
    <table className="w-full text-center text-xs"><thead><tr>{ABILITIES[lang].map(label => <th key={label} className="text-[#9a3a1c]">{label}</th>)}</tr></thead><tbody><tr>{m.ab.map((score, index) => <td key={index}>{score} ({abilityMod(score)})</td>)}</tr></tbody></table>
    <div className="space-y-0.5 border-y border-[#9a3a1c]/50 py-2">{line(es ? 'Salvaciones' : 'Saving Throws', m.sv)}{line(es ? 'Habilidades' : 'Skills', m.sk)}{line(es ? 'Vulnerabilidades' : 'Vulnerabilities', m.dv)}{line(es ? 'Resistencias' : 'Resistances', m.dr)}{line(es ? 'Inmunidades' : 'Immunities', [m.di, m.ci].filter(Boolean).join('; '))}{line(es ? 'Equipo' : 'Gear', m.gear)}{line(es ? 'Sentidos' : 'Senses', m.se)}{line(es ? 'Idiomas' : 'Languages', m.la ?? '—')}{line(es ? 'Desafío' : 'CR', `${crLabel(m.cr)} (${m.xp} XP${m.xpl ? `, ${m.xpl} ${es ? 'en su guarida' : 'in lair'}` : ''}; ${es ? 'BC' : 'PB'} +${m.pb})`)}</div>
    {part(es ? 'Rasgos' : 'Traits', m.tr)}{part(es ? 'Acciones' : 'Actions', m.act)}{part(es ? 'Acciones adicionales' : 'Bonus actions', m.bon)}{part(es ? 'Reacciones' : 'Reactions', m.rea)}{part(es ? 'Acciones legendarias' : 'Legendary actions', m.leg)}
  </div>;
}

function EntryPage({ hit, lang }: { hit: CompendiumEntry; lang: 'es' | 'en' }) {
  const es = lang === 'es';
  if (hit.kind === 'monster') return <MonsterBlock m={hit.entry} lang={lang} />;
  if (hit.kind === 'spell') {
    const s = hit.entry;
    return <div className="space-y-2 text-sm text-text-primary" data-testid="compendium-spell">
      <p className="italic text-text-muted">{s.lv === 0 ? `${es ? 'Truco de' : 'Cantrip,'} ${s.sc}` : `${es ? 'Nivel' : 'Level'} ${s.lv} · ${s.sc}`}{s.cl ? ` (${s.cl})` : ''}</p>
      <div className="flex flex-wrap gap-1 text-xs">{s.cn && <span className="rounded bg-accent-gold/15 px-2 py-0.5 text-accent-gold">{es ? 'Concentración' : 'Concentration'}</span>}{s.ri && <span className="rounded bg-accent-gold/15 px-2 py-0.5 text-accent-gold">{es ? 'Ritual' : 'Ritual'}</span>}{s.co.split(', ').map(part => <span key={part} className="rounded border border-border px-2 py-0.5">{part}</span>)}</div>
      <p><strong>{es ? 'Tiempo de lanzamiento' : 'Casting time'}</strong> {s.ct} · <strong>{es ? 'Alcance' : 'Range'}</strong> {s.ra} · <strong>{es ? 'Duración' : 'Duration'}</strong> {s.du}</p>
      {s.ma && <p className="text-xs text-text-muted">{es ? 'Material' : 'Material'}: {s.ma}</p>}
      <p className="whitespace-pre-line">{s.d}</p>
      {s.hl && <p className="whitespace-pre-line"><strong>{es ? 'A niveles superiores.' : 'Using a higher-level spell slot.'}</strong> {s.hl}</p>}
    </div>;
  }
  if (hit.kind === 'item') return <div className="space-y-2 text-sm text-text-primary" data-testid="compendium-item"><p className="italic text-text-muted">{hit.entry.ca} · {hit.entry.ra}{hit.entry.at ? ` · ${es ? 'requiere sintonización' : 'requires attunement'}` : ''}</p><p className="whitespace-pre-line">{hit.entry.d}</p></div>;
  return <p className="whitespace-pre-line text-sm text-text-primary" data-testid="compendium-condition">{hit.entry.d}</p>;
}

export default function CompendiumPanel({ projectId, eraId, locale, onAddToFight, onAdded }: { projectId: string; eraId?: string; locale: 'es' | 'en'; onAddToFight?: (monster: SrdMonster) => void; onAdded?: (result: { entry: CodexEntry; sheetId?: string }) => void }) {
  const es = locale === 'es';
  const [kind, setKind] = useState<CompendiumKind | ''>(''), [query, setQuery] = useState(''), [filter, setFilter] = useState<CompendiumFilter>({});
  const [result, setResult] = useState<{ hits: CompendiumHit[]; total: number } | null>(null), [open, setOpen] = useState<CompendiumEntry | null>(null);
  const [counts, setCounts] = useState<Record<CompendiumKind, number> | null>(null), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { void compendiumCounts().then(setCounts); }, []);
  const effective = useMemo(() => ({ ...filter, ...(kind ? { kind } : {}) }), [filter, kind]);
  useEffect(() => { let live = true; const timer = setTimeout(() => { void searchCompendium(query, effective, 80).then(found => { if (live) setResult(found); }); }, 120); return () => { live = false; clearTimeout(timer); }; }, [query, effective]);
  const total = counts ? Object.values(counts).reduce((sum, value) => sum + value, 0) : 0;
  const choose = (next: CompendiumKind | '') => { setKind(next); setFilter({}); setOpen(null); };
  return <section className="flex min-h-0 flex-col gap-3" data-testid="compendium" aria-label={es ? 'Compendio' : 'Compendium'}>
    <header className="flex flex-wrap items-center gap-2"><BookOpen size={18} className="text-accent-gold" aria-hidden="true" /><h3 className="font-display text-lg text-text-primary">{es ? 'Compendio · SRD 5.2 (reglas de 2024)' : 'Compendium · SRD 5.2 (2024 rules)'}</h3></header>
    <div className="flex flex-wrap gap-1" role="tablist" aria-label={es ? 'Estantes' : 'Shelves'}>
      <button type="button" role="tab" aria-selected={kind === ''} data-testid="compendium-shelf-all" className={`${button} ${kind === '' ? 'border-accent-gold text-accent-gold' : ''}`} onClick={() => choose('')}>{es ? 'Todo' : 'All'}{counts ? ` (${total})` : ''}</button>
      {COMPENDIUM_KINDS.map(value => <button key={value} type="button" role="tab" aria-selected={kind === value} data-testid={`compendium-shelf-${value}`} className={`${button} ${kind === value ? 'border-accent-gold text-accent-gold' : ''}`} onClick={() => choose(value)}>{COMPENDIUM_KIND_LABELS[value][locale]}{counts ? ` (${counts[value]})` : ''}</button>)}
    </div>
    <input type="search" data-testid="compendium-search" className={`${control} w-full`} aria-label={es ? 'Buscar en el compendio' : 'Search the compendium'} placeholder={es ? `Buscar en ${total || '…'} entradas: un monstruo, un conjuro, un objeto, una condición…` : `Search ${total || '…'} entries: a monster, a spell, an item, a condition…`} value={query} onChange={event => { setQuery(event.target.value); setOpen(null); }} />
    {kind === 'monster' && <div className="flex flex-wrap gap-2 text-xs text-text-muted">
      <label className="flex items-center gap-1">{es ? 'Desafío de' : 'CR from'}<select data-testid="compendium-cr-min" className={control} value={filter.crMin ?? ''} onChange={event => setFilter(current => ({ ...current, crMin: event.target.value === '' ? undefined : Number(event.target.value) }))}><option value="">—</option>{CRS.map(cr => <option key={cr} value={cr}>{crLabel(cr)}</option>)}</select></label>
      <label className="flex items-center gap-1">{es ? 'a' : 'to'}<select data-testid="compendium-cr-max" className={control} value={filter.crMax ?? ''} onChange={event => setFilter(current => ({ ...current, crMax: event.target.value === '' ? undefined : Number(event.target.value) }))}><option value="">—</option>{CRS.map(cr => <option key={cr} value={cr}>{crLabel(cr)}</option>)}</select></label>
      <label className="flex items-center gap-1">{es ? 'Tipo' : 'Type'}<select data-testid="compendium-type" className={control} value={filter.type ?? ''} onChange={event => setFilter(current => ({ ...current, type: event.target.value || undefined }))}><option value="">—</option>{['aberration', 'beast', 'celestial', 'construct', 'dragon', 'elemental', 'fey', 'fiend', 'giant', 'humanoid', 'monstrosity', 'ooze', 'plant', 'undead'].map(type => <option key={type} value={type}>{type}</option>)}</select></label>
    </div>}
    {kind === 'spell' && <div className="flex flex-wrap gap-2 text-xs text-text-muted">
      <label className="flex items-center gap-1">{es ? 'Nivel' : 'Level'}<select data-testid="compendium-level" className={control} value={filter.level ?? ''} onChange={event => setFilter(current => ({ ...current, level: event.target.value === '' ? undefined : Number(event.target.value) }))}><option value="">—</option>{Array.from({ length: 10 }, (_, level) => <option key={level} value={level}>{level === 0 ? (es ? 'Truco' : 'Cantrip') : level}</option>)}</select></label>
      <label className="flex items-center gap-1">{es ? 'Escuela' : 'School'}<select data-testid="compendium-school" className={control} value={filter.school ?? ''} onChange={event => setFilter(current => ({ ...current, school: event.target.value || undefined }))}><option value="">—</option>{['Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Evocation', 'Illusion', 'Necromancy', 'Transmutation'].map(school => <option key={school} value={school}>{school}</option>)}</select></label>
      <label className="flex items-center gap-1">{es ? 'Clase' : 'Class'}<select data-testid="compendium-class" className={control} value={filter.className ?? ''} onChange={event => setFilter(current => ({ ...current, className: event.target.value || undefined }))}><option value="">—</option>{['Bard', 'Cleric', 'Druid', 'Paladin', 'Ranger', 'Sorcerer', 'Warlock', 'Wizard'].map(name => <option key={name} value={name}>{name}</option>)}</select></label>
    </div>}
    {kind === 'item' && <div className="flex flex-wrap gap-2 text-xs text-text-muted"><label className="flex items-center gap-1">{es ? 'Rareza' : 'Rarity'}<select data-testid="compendium-rarity" className={control} value={filter.rarity ?? ''} onChange={event => setFilter(current => ({ ...current, rarity: event.target.value || undefined }))}><option value="">—</option>{['Common', 'Uncommon', 'Rare', 'Very Rare', 'Legendary', 'Artifact', 'Varies'].map(rarity => <option key={rarity} value={rarity}>{rarity}</option>)}</select></label></div>}
    <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="min-h-0 space-y-1 overflow-y-auto" style={{ maxHeight: '60vh' }}>
        {result && <p className="text-xs text-text-muted" data-testid="compendium-count">{es ? `${result.total} resultados` : `${result.total} results`}</p>}
        {result?.hits.map(hit => <button key={`${hit.kind}:${hit.id}`} type="button" data-testid={`compendium-hit-${hit.kind}-${hit.id}`} className={`block w-full rounded-lg border px-3 py-2 text-left text-sm ${open && open.entry.id === hit.id && open.kind === hit.kind ? 'border-accent-gold bg-elevated' : 'border-border/60 hover:bg-elevated'}`} onClick={() => { setStatus(''); void compendiumEntry(hit.kind, hit.id).then(setOpen); }}>
          <span className="block text-text-primary">{hit.name}</span><span className="block text-xs text-text-muted">{COMPENDIUM_KIND_LABELS[hit.kind][locale]} · {hit.summary}</span>
        </button>)}
      </div>
      <article className="min-h-0 overflow-y-auto rounded-lg border border-border p-3" style={{ maxHeight: '60vh' }} data-testid="compendium-entry">
        {!open ? <p className="text-sm text-text-muted">{es ? 'Elige una entrada para leerla.' : 'Pick an entry to read it.'}</p> : <>
          <h4 className="font-display text-xl text-text-primary">{open.entry.n}</h4>
          <div className="my-2 flex flex-wrap gap-2">
            <button type="button" data-testid="compendium-add" className={button} disabled={busy || !!eraId} title={eraId ? (es ? 'Añadir funciona en la base compartida, no dentro de una era.' : 'Adding works in the shared base, not inside an era.') : undefined} onClick={() => { setBusy(true); void addCompendiumEntryToWorld(projectId, open, locale).then(added => { setStatus(es ? `«${added.entry.title}» está ahora en el Códice${added.sheetId ? ', con su bloque de estadísticas en Hojas' : ''}; es tu copia: cámbiala a tu gusto.` : `“${added.entry.title}” is now in the Codex${added.sheetId ? ', with its stat block in Sheets' : ''}; it is your copy to change.`); onAdded?.(added); }).catch(() => setStatus(es ? 'No se pudo añadir.' : 'Could not add it.')).finally(() => setBusy(false)); }}><Plus size={15} />{es ? 'Añadir al mundo' : 'Add to world'}</button>
            {open.kind === 'monster' && onAddToFight && <button type="button" data-testid="compendium-fight" className={button} onClick={() => { onAddToFight(open.entry); setStatus(es ? `${open.entry.n} se une al combate.` : `${open.entry.n} joins the fight.`); }}><Swords size={15} />{es ? 'Añadir al combate' : 'Add to fight'}</button>}
          </div>
          {status && <p role="status" data-testid="compendium-status" className="mb-2 text-xs text-text-muted">{status}</p>}
          <EntryPage hit={open} lang={locale} />
        </>}
      </article>
    </div>
    <footer className="text-[11px] leading-relaxed text-text-dim" data-testid="compendium-credit">{SRD_CREDIT}</footer>
  </section>;
}
