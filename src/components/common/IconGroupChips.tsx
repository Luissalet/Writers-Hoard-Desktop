// Chips under the icon search: recent icons, categories and genres.
import { ICON_CATEGORIES, ICON_GENRES } from './iconCategories';

export type IconFilter = { kind: 'recent' } | { kind: 'category'; id: string } | { kind: 'genre'; id: string } | null;

export default function IconGroupChips({ value, onChange, locale, hasRecent }: { value: IconFilter; onChange: (next: IconFilter) => void; locale: string; hasRecent: boolean }) {
  const lang = locale === 'en' ? 'en' : 'es';
  const chip = (active: boolean) => `shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${active ? 'border-accent-gold bg-accent-gold/10 text-accent-gold' : 'border-border text-text-muted hover:bg-elevated'}`;
  return <div className="mb-2 space-y-1" data-testid="icon-groups">
    <div className="flex flex-wrap gap-1">
      {hasRecent && <button type="button" className={chip(value?.kind === 'recent')} data-testid="icon-group-recent" onClick={() => onChange(value?.kind === 'recent' ? null : { kind: 'recent' })}>{lang === 'es' ? 'Recientes' : 'Recent'}</button>}
      {ICON_CATEGORIES.map(group => <button key={group.id} type="button" className={chip(value?.kind === 'category' && value.id === group.id)} data-testid={`icon-category-${group.id}`} onClick={() => onChange(value?.kind === 'category' && value.id === group.id ? null : { kind: 'category', id: group.id })}>{group[lang]}</button>)}
    </div>
    <div className="flex flex-wrap gap-1">{ICON_GENRES.map(group => <button key={group.id} type="button" className={chip(value?.kind === 'genre' && value.id === group.id)} data-testid={`icon-genre-${group.id}`} onClick={() => onChange(value?.kind === 'genre' && value.id === group.id ? null : { kind: 'genre', id: group.id })}>{group[lang]}</button>)}</div>
  </div>;
}
