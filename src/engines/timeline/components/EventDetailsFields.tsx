import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Flag, Star, Swords, Crown, Heart, BookOpen, Sun, Moon, Ship, Mountain, X } from 'lucide-react';
import { useTranslation, registerLocaleStrings } from '@/i18n/useTranslation';
import type { CodexEntry, TimelineEvent } from '@/types';
import { EVENT_ICONS, eventEntryIds, safeEventImage, type EventDetailDraft } from '../eventDetails';
import TagInput from '@/components/common/TagInput';
import { normalizeEventTags } from '../timelineFilter';
import en from '../locales/en';
import es from '../locales/es';
registerLocaleStrings({ es, en });

const icons = { calendar: Calendar, flag: Flag, star: Star, swords: Swords, crown: Crown, heart: Heart, book: BookOpen, sun: Sun, moon: Moon, ship: Ship, mountain: Mountain };
export function EventIcon({ icon, size = 16, x, y }: { icon?: TimelineEvent['icon']; size?: number; x?: number; y?: number }) {
  const Icon = icon && icons[icon];
  return Icon ? <Icon size={size} x={x} y={y} aria-hidden="true" /> : null;
}
const field = 'w-full px-3 py-2 bg-elevated border border-border rounded-lg text-text-primary text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold';

export default function EventDetailsFields({ value, onChange, entries, mode, hours = 24, tagSuggestions = [] }: { value: EventDetailDraft; onChange: (value: Partial<EventDetailDraft>) => void; entries: CodexEntry[]; mode: TimelineEvent['dateMode']; hours?: number; /** Tags already used in the project. */ tagSuggestions?: string[] }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [imageError, setImageError] = useState(false);
  const visible = entries.filter(entry => entry.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024 || !/^image\/(png|jpeg|webp|gif|avif|bmp)$/.test(file.type)) { setImageError(true); return; }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
      if (!safeEventImage(dataUrl)) throw new Error();
      onChange({ image: dataUrl }); setImageError(false);
    } catch { setImageError(true); }
  }
  return <div className="space-y-4 border-t border-border pt-4">
    <div className="space-y-1.5" data-testid="event-tags">
      <span className="block text-sm text-text-muted">{t('timeline.tags.label')}</span>
      <TagInput tags={value.tags} suggestions={tagSuggestions} placeholder={t('timeline.tags.placeholder')} onChange={tags => onChange({ ...value, tags: normalizeEventTags(tags) })} />
    </div>
    <label className="flex items-center gap-2 text-sm text-text-muted"><input type="checkbox" data-testid="event-hide-wiki" checked={value.hideFromWiki} onChange={event => onChange({ ...value, hideFromWiki: event.target.checked })} />{t('timeline.tags.hideFromWiki')}</label>
    {mode !== 'text' && <div className="grid grid-cols-2 gap-3">
      <label className="text-sm text-text-muted space-y-1.5">{t('timeline.repeat.label')}<select data-testid="event-repeat" className={field} value={value.repeat} onChange={event => onChange({ ...value, repeat: event.target.value as EventDetailDraft['repeat'] })}>
        <option value="">{t('timeline.repeat.never')}</option><option value="year">{t('timeline.repeat.year')}</option><option value="month">{t('timeline.repeat.month')}</option><option value="week">{t('timeline.repeat.week')}</option>
      </select></label>
      <label className="text-sm text-text-muted space-y-1.5">{t('timeline.banner.label')}<select data-testid="event-banner-pattern" className={field} value={value.bannerPattern} onChange={event => onChange({ ...value, bannerPattern: event.target.value as EventDetailDraft['bannerPattern'] })}>
        <option value="">{t('timeline.banner.solid')}</option><option value="stripes">{t('timeline.banner.stripes')}</option><option value="dots">{t('timeline.banner.dots')}</option><option value="checks">{t('timeline.banner.checks')}</option>
      </select></label>
      {value.repeat && <label className="text-sm text-text-muted space-y-1.5">{t('timeline.repeat.until')}<input data-testid="event-repeat-until" className={field} inputMode="numeric" placeholder={t('timeline.repeat.forever')} value={value.untilYear} onChange={event => onChange({ ...value, untilYear: event.target.value.replace(/[^\d-]/g, '') })} /></label>}
    </div>}
    {mode !== 'text' && <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-text-muted space-y-1.5">{t('timeline.details.time')}<input className={field} aria-label={t('timeline.details.time')} inputMode="numeric" placeholder="HH:mm" value={value.time} onChange={event => onChange({ ...value, time: event.target.value })} maxLength={7} data-testid="event-time" /></label>
        <label className="text-sm text-text-muted space-y-1.5">{t('timeline.details.endTime')}<input className={field} aria-label={t('timeline.details.endTime')} inputMode="numeric" placeholder="HH:mm" value={value.endTime} onChange={event => onChange({ ...value, endTime: event.target.value })} maxLength={7} data-testid="event-end-time" /></label>
      </div>
      <p className="text-xs text-text-muted">{t('timeline.details.clockHelp').replace('{hours}', String(hours))}</p>
    </div>}
    <label className="block text-sm text-text-muted space-y-1.5">{t('timeline.details.icon')}
      <select className={field} value={value.icon} onChange={event => onChange({ ...value, icon: event.target.value as EventDetailDraft['icon'] })} data-testid="event-icon"><option value="">{t('timeline.details.noIcon')}</option>{EVENT_ICONS.map(icon => <option key={icon} value={icon}>{t(`timeline.details.icon.${icon}`)}</option>)}</select>
    </label>
    <div className="space-y-2">
      <label className="block text-sm text-text-muted space-y-1.5">{t('timeline.details.image')}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp" className={`${field} file:mr-3 file:cursor-pointer`} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} data-testid="event-image" /></label>
      {safeEventImage(value.image) && <div className="flex items-center gap-3"><img src={value.image} alt="" className="max-h-28 max-w-48 rounded-lg object-contain" /><button type="button" className="text-xs text-text-muted hover:text-danger" onClick={() => onChange({ ...value, image: '' })}>{t('timeline.details.removeImage')}</button></div>}
      {imageError && <p role="alert" className="text-xs text-danger">{t('timeline.details.imageError')}</p>}
    </div>
    <fieldset className="space-y-2">
      <legend className="text-sm text-text-muted mb-1.5">{t('timeline.details.links')}</legend>
      {value.linkedEntryIds.length > 0 && <div className="flex flex-wrap gap-2">{value.linkedEntryIds.map(id => <button type="button" key={id} className="inline-flex items-center gap-1.5 px-2 py-1 bg-accent-gold/10 text-accent-gold rounded-md text-xs" onClick={() => onChange({ ...value, linkedEntryIds: value.linkedEntryIds.filter(value => value !== id) })}>{entries.find(entry => entry.id === id)?.title ?? id}<X size={12} aria-hidden="true" /></button>)}</div>}
      <input type="search" className={field} value={search} onChange={event => setSearch(event.target.value)} aria-label={t('timeline.details.searchCards')} placeholder={t('timeline.details.searchCards')} />
      <div className="max-h-36 overflow-y-auto space-y-1 border border-border rounded-lg p-2">
        {visible.length ? visible.map(entry => <label key={entry.id} className="flex items-center gap-2 text-sm text-text-primary py-1 cursor-pointer"><input type="checkbox" checked={value.linkedEntryIds.includes(entry.id)} onChange={event => onChange({ ...value, linkedEntryIds: event.target.checked ? [...value.linkedEntryIds, entry.id] : value.linkedEntryIds.filter(id => id !== entry.id) })} className="accent-accent-gold" />{entry.title}</label>) : <p className="text-xs text-text-muted">{t('timeline.details.noCards')}</p>}
      </div>
    </fieldset>
  </div>;
}

export function EventDetailsPreview({ event, entries, interactive = true }: { event: TimelineEvent; entries: CodexEntry[]; interactive?: boolean }) {
  const navigate = useNavigate();
  const ids = eventEntryIds(event);
  const linked = entries.filter(entry => ids.includes(entry.id));
  return <div className="space-y-2 mt-2">
    {safeEventImage(event.image) && <img src={event.image} alt="" className="max-h-36 max-w-full rounded-lg object-contain" />}
    {linked.length > 0 && <div className="flex flex-wrap gap-1.5">{linked.map(entry => interactive ? <button key={entry.id} type="button" className="text-xs px-2 py-1 rounded-md text-accent-gold bg-accent-gold/10 hover:bg-accent-gold/20" onClick={e => { e.stopPropagation(); navigate(`/project/${encodeURIComponent(event.projectId)}/codex?entry=${encodeURIComponent(entry.id)}`); }}>{entry.title}</button> : <span key={entry.id} className="text-xs text-accent-gold">{entry.title}</span>)}</div>}
  </div>;
}
