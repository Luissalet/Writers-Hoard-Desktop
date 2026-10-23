// The name generator: choose what to name (inn, shop, person, village, noble
// house) and a style, optionally say something about it ("llevada por una
// viuda"), and get a name with the parts that make it usable — owner, charm,
// what it is known for, a secret, a trouble, a motto. Each part can be picked
// again or skipped; the result can become a Codex card or go into the text.
import { useMemo, useState } from 'react';
import { Dices, FilePlus2, RefreshCw, TextCursorInput, X } from 'lucide-react';
import { KIND_STEPS, NAME_KINDS, NAME_STYLES, type NameKind, type NameStyle } from './types';
import { STYLE_TABLES } from './tables';
import { KIND_LABELS, STEP_LABELS, generateIdea, generateNames, rerollPart, skipPart, type NameIdea, type NameLocale } from './generate';
import { makeIdeaCard } from './makeCard';

const control = 'min-h-9 rounded-lg border border-border bg-deep px-2 text-sm text-text-primary';
const button = 'inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-text-primary hover:bg-elevated disabled:opacity-50';
const newSeed = () => { const value = new Uint32Array(2); crypto.getRandomValues(value); return `${value[0].toString(36)}${value[1].toString(36)}`; };

const COPY = {
  es: { kind: 'Qué nombrar', style: 'Estilo', brief: 'Algo sobre ello (opcional)', briefHint: 'p. ej. llevada por una viuda, junto al puerto', generate: 'Otra idea', again: 'Elegir otra vez', skip: 'Quitar', more: 'Más nombres', card: 'Crear ficha', insert: 'Insertar en el texto', made: 'Ficha creada:', open: 'Abrir', failed: 'No se pudo crear la ficha.', offline: 'Se genera en este equipo con tablas de palabras; la misma idea sale igual con la misma semilla.' },
  en: { kind: 'What to name', style: 'Style', brief: 'Something about it (optional)', briefHint: 'e.g. run by a widow, by the harbour', generate: 'Another idea', again: 'Pick again', skip: 'Skip', more: 'More names', card: 'Make a card', insert: 'Insert into the text', made: 'Card made:', open: 'Open', failed: 'Could not make the card.', offline: 'Made on this device from word tables; the same seed gives the same idea.' },
};

export default function NameGenerator({ projectId, locale, onInsert, onOpenCard, initialKind = 'inn' }: { projectId?: string; locale: NameLocale; onInsert?: (text: string) => void; onOpenCard?: (entryId: string) => void; initialKind?: NameKind }) {
  const c = COPY[locale], labels = STEP_LABELS[locale];
  const [kind, setKind] = useState<NameKind>(initialKind), [style, setStyle] = useState<NameStyle>('classic'), [brief, setBrief] = useState('');
  const [idea, setIdea] = useState<NameIdea>(() => generateIdea(initialKind, 'classic', newSeed(), locale));
  const [extra, setExtra] = useState<string[]>([]), [made, setMade] = useState<{ id: string; title: string } | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const regenerate = (next: { kind?: NameKind; style?: NameStyle; brief?: string } = {}) => {
    const k = next.kind ?? kind, s = next.style ?? style, b = next.brief ?? brief;
    setIdea(generateIdea(k, s, newSeed(), locale, b)); setExtra([]); setMade(null); setError('');
  };
  const steps = useMemo(() => KIND_STEPS[idea.kind], [idea.kind]);
  return <section className="space-y-4" data-testid="name-generator" aria-label={locale === 'es' ? 'Generador de nombres' : 'Name generator'}>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm text-text-primary">{c.kind}<select className={`${control} w-full`} data-testid="namegen-kind" value={kind} onChange={event => { const value = event.target.value as NameKind; setKind(value); regenerate({ kind: value }); }}>{NAME_KINDS.map(item => <option key={item} value={item}>{KIND_LABELS[locale][item]}</option>)}</select></label>
      <label className="space-y-1 text-sm text-text-primary">{c.style}<select className={`${control} w-full`} data-testid="namegen-style" value={style} onChange={event => { const value = event.target.value as NameStyle; setStyle(value); regenerate({ style: value }); }}>{NAME_STYLES.map(item => <option key={item} value={item}>{STYLE_TABLES[item].label[locale]}</option>)}</select></label>
      <label className="space-y-1 text-sm text-text-primary sm:col-span-2">{c.brief}<input className={`${control} w-full`} data-testid="namegen-brief" placeholder={c.briefHint} value={brief} onChange={event => setBrief(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); regenerate(); } }} /></label>
    </div>
    <div className="rounded-xl border border-border bg-surface p-4" aria-live="polite">
      <div className="flex items-start gap-2"><h3 className="flex-1 font-display text-2xl text-accent-gold" data-testid="namegen-name">{idea.parts.name}</h3><button type="button" className={button} aria-label={`${c.again}: ${labels.name}`} data-testid="namegen-again-name" onClick={() => setIdea(current => rerollPart(current, 'name', locale))}><RefreshCw className="h-4 w-4" /></button></div>
      <dl className="mt-3 space-y-2">{steps.filter(step => step !== 'name').map(step => <div key={step} className="flex items-start gap-2" data-testid={`namegen-part-${step}`}>
        <dt className="w-32 shrink-0 text-xs uppercase tracking-wide text-text-muted">{labels[step]}</dt>
        <dd className={`flex-1 text-sm ${idea.parts[step] ? 'text-text-primary' : 'italic text-text-muted'}`} data-testid={`namegen-${step}`}>{idea.parts[step] ?? '—'}</dd>
        <button type="button" className="rounded p-1 text-text-muted hover:bg-elevated hover:text-text-primary" aria-label={`${c.again}: ${labels[step]}`} data-testid={`namegen-again-${step}`} onClick={() => setIdea(current => rerollPart(current, step, locale))}><RefreshCw className="h-3.5 w-3.5" /></button>
        <button type="button" className="rounded p-1 text-text-muted hover:bg-elevated hover:text-text-primary disabled:opacity-30" aria-label={`${c.skip}: ${labels[step]}`} data-testid={`namegen-skip-${step}`} disabled={!idea.parts[step]} onClick={() => setIdea(current => skipPart(current, step))}><X className="h-3.5 w-3.5" /></button>
      </div>)}</dl>
    </div>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} data-testid="namegen-generate" onClick={() => regenerate()}><Dices className="h-4 w-4" />{c.generate}</button>
      <button type="button" className={button} data-testid="namegen-more" onClick={() => setExtra(generateNames(idea.kind, idea.style, newSeed(), locale, 8, idea.brief))}>{c.more}</button>
      {onInsert && <button type="button" className={button} data-testid="namegen-insert" onClick={() => onInsert(idea.parts.name ?? '')}><TextCursorInput className="h-4 w-4" />{c.insert}</button>}
      {projectId && <button type="button" className={`${button} bg-accent-gold text-deep hover:bg-accent-amber`} data-testid="namegen-card" disabled={busy} onClick={() => { setBusy(true); setError(''); void makeIdeaCard(projectId, idea, locale).then(entry => setMade({ id: entry.id, title: entry.title })).catch(() => setError(c.failed)).finally(() => setBusy(false)); }}><FilePlus2 className="h-4 w-4" />{c.card}</button>}
    </div>
    {extra.length > 0 && <ul className="flex flex-wrap gap-2" data-testid="namegen-list">{extra.map(name => <li key={name}><button type="button" className="rounded-full border border-border px-3 py-1 text-sm text-text-primary hover:bg-elevated" onClick={() => setIdea(current => ({ ...current, parts: { ...current.parts, name } }))}>{name}</button></li>)}</ul>}
    {made && <p role="status" data-testid="namegen-made" className="text-sm text-success">{c.made} {made.title}{onOpenCard && <> · <button type="button" className="underline" onClick={() => onOpenCard(made.id)}>{c.open}</button></>}</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <p className="text-xs text-text-muted">{c.offline}</p>
  </section>;
}
