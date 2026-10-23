// The stat block's spellcasting: ability, at-will spells and N/day spells,
// with the sentence the stat block will print shown as it is written.
import type { CharacterSheet } from './types';
import { SPELL_ABILITIES, spellcastingText } from './spellcasting';
import { input } from './uiStyles';

export default function SpellcastingEditor({ sheet, locale, update }: { sheet: CharacterSheet; locale: 'es' | 'en'; update: (change: (sheet: CharacterSheet) => CharacterSheet) => void }) {
  const es = locale === 'es', text = spellcastingText(sheet, locale);
  const set = (key: string, value: string) => update(current => { const details = { ...current.details }; if (value) details[key] = value; else delete details[key]; return { ...current, details }; });
  return <section className="space-y-3 rounded-xl border border-border p-3" aria-label={es ? 'Lanzamiento de conjuros' : 'Spellcasting'} data-testid="statblock-spellcasting">
    <h3 className="font-display text-lg text-text-primary">{es ? 'Lanzamiento de conjuros' : 'Spellcasting'}</h3>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="space-y-1 text-sm text-text-primary">{es ? 'Aptitud' : 'Ability'}<select className={input} data-testid="statblock-spell-ability" value={sheet.details.spellAbility ?? ''} onChange={event => set('spellAbility', event.target.value)}><option value="">{es ? 'Sin conjuros' : 'No spells'}</option>{(Object.keys(SPELL_ABILITIES) as (keyof typeof SPELL_ABILITIES)[]).map(key => <option key={key} value={key}>{es ? { int: 'Inteligencia', wis: 'Sabiduría', cha: 'Carisma' }[key] : { int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' }[key]}</option>)}</select></label>
      <label className="space-y-1 text-sm text-text-primary sm:col-span-2">{es ? 'A voluntad (separados por comas)' : 'At will (comma separated)'}<input className={input} data-testid="statblock-spells-at-will" value={sheet.details.spellsAtWill ?? ''} onChange={event => set('spellsAtWill', event.target.value)} /></label>
      <label className="space-y-1 text-sm text-text-primary sm:col-span-3">{es ? 'Por día (p. ej. «1: Bola de fuego, Volar; 3: Escudo»)' : 'Per day (e.g. "1: Fireball, Fly; 3: Shield")'}<input className={input} data-testid="statblock-spells-per-day" value={sheet.details.spellsPerDay ?? ''} onChange={event => set('spellsPerDay', event.target.value)} /></label>
    </div>
    {text && <div className="rounded-lg bg-surface p-3 text-sm text-text-primary" data-testid="statblock-spell-text"><p><strong>{es ? 'Lanzamiento de conjuros.' : 'Spellcasting.'}</strong> {text.intro}</p>{text.lines.map(line => <p key={line} className="mt-1 pl-3">{line}</p>)}</div>}
  </section>;
}
