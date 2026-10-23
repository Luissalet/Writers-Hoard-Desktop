import { useState } from 'react';
import { Bookmark, Circle, ArrowRight, Diamond, Filter, Tag, Trash2, X } from 'lucide-react';
import { useTranslation, registerLocaleStrings } from '@/i18n/useTranslation';
import en from '../locales/en';
import es from '../locales/es';
import type { TimelineEventType } from '@/types';
import { EMPTY_TIMELINE_FILTER, isFilterActive, TAG_COLORS, tagColorOf, type TimelineFilter, type TimelineSavedView } from '../timelineFilter';

registerLocaleStrings({ es, en });

const chip = (on: boolean) => `inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${on ? 'border-accent-gold bg-accent-gold/15 text-accent-gold' : 'border-border text-text-muted hover:text-text-primary'}`;

/**
 * Tags, shapes and words to narrow the timeline to, the views saved from them,
 * and the tag manager (rename, merge into another, take off every event).
 */
export default function TimelineFilterBar({ filter, onFilter, tags, shown, total, views, onSaveView, onRemoveView, onRetag, tagColors = {}, onTagColor }: {
  filter: TimelineFilter;
  onFilter: (filter: TimelineFilter) => void;
  tags: Array<{ tag: string; count: number }>;
  shown: number;
  total: number;
  views: TimelineSavedView[];
  onSaveView: (name: string) => Promise<void>;
  onRemoveView: (id: string) => Promise<void>;
  onRetag: (from: string, to: string | null) => Promise<void>;
  tagColors?: Record<string, string>;
  onTagColor?: (tag: string, color: string | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [naming, setNaming] = useState(false), [viewName, setViewName] = useState('');
  const [managing, setManaging] = useState(false), [editing, setEditing] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const toggle = <K extends 'tags' | 'types'>(key: K, value: TimelineFilter[K][number]) => {
    const list = filter[key] as string[];
    onFilter({ ...filter, [key]: list.includes(value) ? list.filter(item => item !== value) : [...list, value] });
  };
  const run = async (task: () => Promise<void>) => { if (busy) return; setBusy(true); try { await task(); } finally { setBusy(false); } };
  const activeView = views.find(view => JSON.stringify(view.filter) === JSON.stringify(filter));
  return <div className="space-y-2 rounded-xl border border-border bg-surface/60 p-3" data-testid="timeline-filter">
    <div className="flex flex-wrap items-center gap-2">
      <Filter size={14} className="text-text-muted" aria-hidden="true" />
      <input type="search" data-testid="timeline-filter-text" value={filter.text} onChange={event => onFilter({ ...filter, text: event.target.value })} placeholder={t('timeline.filter.search')} aria-label={t('timeline.filter.search')} className="min-w-40 flex-1 rounded-lg border border-border bg-elevated px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent-gold" />
      {([['point', Circle], ['range', ArrowRight], ['milestone', Diamond]] as const).map(([type, Icon]) => <button key={type} type="button" data-testid={`timeline-filter-type-${type}`} aria-pressed={filter.types.includes(type as TimelineEventType)} className={chip(filter.types.includes(type as TimelineEventType))} onClick={() => toggle('types', type as TimelineEventType)}><Icon size={11} aria-hidden="true" />{t(`timeline.type${type[0].toUpperCase()}${type.slice(1)}`)}</button>)}
      <label className="flex items-center gap-1.5 text-xs text-text-muted"><input type="checkbox" data-testid="timeline-filter-wiki" checked={!!filter.wikiOnly} onChange={event => onFilter({ ...filter, wikiOnly: event.target.checked || undefined })} />{t('timeline.filter.wikiOnly')}</label>
      <select data-testid="timeline-view-select" aria-label={t('timeline.views.label')} value={activeView?.id ?? ''} onChange={event => { const view = views.find(item => item.id === event.target.value); onFilter(view ? view.filter : EMPTY_TIMELINE_FILTER); }} className="rounded-lg border border-border bg-elevated px-2 py-1.5 text-xs text-text-primary">
        <option value="">{t('timeline.views.none')}</option>
        {views.map(view => <option key={view.id} value={view.id}>{view.name}</option>)}
      </select>
      {activeView && <button type="button" data-testid="timeline-view-remove" disabled={busy} title={t('timeline.views.remove')} aria-label={t('timeline.views.remove')} className="rounded p-1 text-text-muted hover:text-danger" onClick={() => void run(() => onRemoveView(activeView.id))}><Trash2 size={13} /></button>}
      {isFilterActive(filter) && !activeView && (naming
        ? <form className="flex items-center gap-1" onSubmit={event => { event.preventDefault(); if (viewName.trim()) void run(async () => { await onSaveView(viewName.trim()); setNaming(false); setViewName(''); }); }}><input autoFocus data-testid="timeline-view-name" maxLength={60} value={viewName} onChange={event => setViewName(event.target.value)} placeholder={t('timeline.views.name')} className="w-36 rounded-lg border border-border bg-elevated px-2 py-1 text-xs text-text-primary" /><button type="submit" data-testid="timeline-view-save" disabled={busy || !viewName.trim()} className={chip(true)}>{t('timeline.views.save')}</button></form>
        : <button type="button" data-testid="timeline-view-new" className={chip(false)} onClick={() => setNaming(true)}><Bookmark size={11} aria-hidden="true" />{t('timeline.views.saveAs')}</button>)}
      {isFilterActive(filter) && <button type="button" data-testid="timeline-filter-clear" className={chip(false)} onClick={() => onFilter(EMPTY_TIMELINE_FILTER)}><X size={11} aria-hidden="true" />{t('timeline.filter.clear')}</button>}
      <span className="text-[11px] text-text-dim" data-testid="timeline-filter-count">{t('timeline.filter.count').replace('{shown}', String(shown)).replace('{total}', String(total))}</span>
    </div>
    {tags.length > 0 && <div className="flex flex-wrap items-center gap-1.5">
      <Tag size={13} className="text-text-muted" aria-hidden="true" />
      {tags.map(({ tag, count }) => <button key={tag} type="button" data-testid={`timeline-filter-tag-${tag}`} aria-pressed={filter.tags.includes(tag)} className={chip(filter.tags.includes(tag))} style={tagColorOf(tagColors, tag) ? { borderColor: tagColorOf(tagColors, tag), color: tagColorOf(tagColors, tag) } : undefined} onClick={() => toggle('tags', tag)}>#{tag} <span className="opacity-60">{count}</span></button>)}
      <button type="button" data-testid="timeline-tags-manage" className="ml-1 text-xs text-text-muted underline-offset-2 hover:underline" onClick={() => setManaging(value => !value)}>{t('timeline.tags.manage')}</button>
    </div>}
    {managing && <div className="space-y-1.5 rounded-lg border border-border p-2" data-testid="timeline-tag-manager">
      <p className="text-xs text-text-dim">{t('timeline.tags.manageHelp')}</p>
      {tags.map(({ tag, count }) => <div key={tag} className="flex flex-wrap items-center gap-2 text-sm">
        <input data-testid={`timeline-tag-rename-${tag}`} value={editing[tag] ?? tag} maxLength={40} onChange={event => setEditing(previous => ({ ...previous, [tag]: event.target.value }))} className="w-40 rounded border border-border bg-elevated px-2 py-1 text-xs text-text-primary" aria-label={t('timeline.tags.rename').replace('{tag}', tag)} />
        <span className="text-[11px] text-text-dim">{t('timeline.tags.uses').replace('{count}', String(count))}</span>
        {onTagColor && <span className="flex items-center gap-0.5">{TAG_COLORS.map(color => <button key={color} type="button" data-testid={`timeline-tag-color-${tag}-${color.slice(1)}`} aria-label={color} aria-pressed={tagColorOf(tagColors, tag) === color} disabled={busy} className={`h-4 w-4 rounded-full border ${tagColorOf(tagColors, tag) === color ? 'border-text-primary' : 'border-transparent'}`} style={{ background: color }} onClick={() => void run(() => onTagColor(tag, tagColorOf(tagColors, tag) === color ? null : color))} />)}</span>}
        <button type="button" data-testid={`timeline-tag-apply-${tag}`} disabled={busy || !(editing[tag] ?? '').trim() || editing[tag] === tag} className={chip(false)} onClick={() => void run(async () => { await onRetag(tag, editing[tag].trim()); setEditing(previous => { const next = { ...previous }; delete next[tag]; return next; }); })}>{tags.some(other => other.tag !== tag && other.tag.toLocaleLowerCase() === (editing[tag] ?? '').trim().toLocaleLowerCase()) ? t('timeline.tags.merge') : t('timeline.tags.renameApply')}</button>
        <button type="button" data-testid={`timeline-tag-delete-${tag}`} disabled={busy} className="rounded p-1 text-text-muted hover:text-danger" title={t('timeline.tags.remove')} aria-label={t('timeline.tags.remove')} onClick={() => void run(() => onRetag(tag, null))}><Trash2 size={13} /></button>
      </div>)}
    </div>}
  </div>;
}
