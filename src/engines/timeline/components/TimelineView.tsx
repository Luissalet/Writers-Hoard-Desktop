import { useWorldEraScope } from '@/services/worldEras/hooks';
import { readEraRow } from '@/services/worldEras/store';
import type { Timeline } from '@/types';
import { useState } from 'react';
import { Plus, Trash2, Clock, GripVertical, Calendar, Type, ArrowUpDown, Circle, Diamond, ArrowRight, Globe } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TimelineEvent, DateMode, TimelineEventType } from '@/types';
import { generateId } from '@/utils/idGenerator';
import { useTranslation } from '@/i18n/useTranslation';
import Modal from '@/components/common/Modal';
import EmptyState from '@/components/common/EmptyState';
import ColorPicker from '@/components/common/ColorPicker';
import { validateTimelineDates } from '../dateValidation';
import { WorldDateField } from './WorldDateField';
import { useWorldCalendar, worldDateText } from '../useWorldCalendar';
import { chronologicalCompare, readWorldForm } from '../worldEventForm';
import type { WorldCalendar } from '../worldCalendar';
import { useCodexEntries } from '@/engines/codex/hooks';
import { emptyEventDetails, editEventDetails, eventDetailFields } from '../eventDetails';
import { timelineEventLabel, validateEventClock } from '../eventClock';
import EventDetailsFields, { EventDetailsPreview, EventIcon } from './EventDetailsFields';
import { useDeepLinkParam } from '@/engines/_shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { compactTimelineLabel, eventWithinYearRange, saveTimelineSettings } from '../timelineSettings';

interface TimelineViewProps {
  projectId: string;
  timelineId: string;
  events: TimelineEvent[];
  onAddEvent: (event: TimelineEvent) => void | Promise<void>;
  onEditEvent: (id: string, changes: Partial<TimelineEvent>, baseline?:TimelineEvent) => void | Promise<void>;
  onDeleteEvent: (id: string) => void;
}

function getDisplayDate(evt: TimelineEvent, calendar?: WorldCalendar | null, locale?: string): string { return timelineEventLabel(evt, calendar, locale); }

type SortMode = 'manual' | 'chronological';

export default function TimelineView({ projectId, timelineId, events: storedEvents, onAddEvent, onEditEvent, onDeleteEvent }: TimelineViewProps) {
  const { t, locale } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TimelineEvent | null>(null);
  const linkedEntity = useDeepLinkParam('entity');
  const [appliedEntity, setAppliedEntity] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('manual');
  const [form, setForm] = useState({
    title: '',
    description: '',
    date: '',
    dateMode: 'text' as DateMode,
    eventType: 'point' as TimelineEventType,
    realDate: '',
    realDateEnd: '',
    worldText: '',
    worldTextEnd: '',
    lane: 'Main',
    color: '#c4973b',
    ...emptyEventDetails(),
  });
  const calendarSource = useWorldCalendar(projectId, timelineId);
  const worldCalendar = calendarSource?.calendar ?? null;
  const scope = useWorldEraScope(projectId);
  const timeline = useLiveQuery(() => readEraRow<Timeline>(scope, 'timelines', timelineId), [scope, timelineId]);
  const events = storedEvents.filter(event => eventWithinYearRange(event, timeline?.yearRange));
  const { items: codexEntries } = useCodexEntries(projectId);
  // What the form held when it opened: Escape and the backdrop only close it
  // while nothing typed since then would be lost.
  const [formOpenedWith, setFormOpenedWith] = useState(form);
  const loadForm = (next: typeof form) => {
    setForm(next);
    setFormOpenedWith(next);
  };
  const formDirty = (Object.keys(form) as (keyof typeof form)[]).some((key) => form[key] !== formOpenedWith[key]);

  const lanes = [...new Set(events.map(e => e.lane))];
  if (lanes.length === 0) lanes.push('Main');

  // Check if there are any calendar-mode events (enables chronological sort)
  const hasCalendarEvents = events.some(e => (e.dateMode === 'calendar' && e.realDate) || (e.dateMode === 'world' && e.worldDate));
  const world = form.dateMode === 'world' ? readWorldForm(worldCalendar, form.worldText, form.worldTextEnd) : null;
  const dateError = (form.dateMode === 'calendar' ? validateTimelineDates(form.realDate, form.realDateEnd) : world?.error ?? null)
    ?? validateEventClock({ ...form, ...world?.fields }, worldCalendar);

  const editableFields=(value:typeof form):Partial<TimelineEvent>=>{
    const world=value.dateMode==='world'?readWorldForm(worldCalendar,value.worldText,value.worldTextEnd):null;
    return{title:value.title,description:value.description,date:timelineEventLabel({...value,...world?.fields},worldCalendar,locale),dateMode:value.dateMode,eventType:(value.dateMode!=='text'&&value.endTime)||(value.dateMode==='calendar'&&value.realDateEnd)||world?.fields.worldDateEnd?'range':value.eventType,realDate:value.dateMode==='calendar'?value.realDate:undefined,realDateEnd:value.dateMode==='calendar'?value.realDateEnd||undefined:undefined,...(world?world.fields:{worldDate:undefined,worldDateEnd:undefined}),...eventDetailFields(value,value.dateMode),lane:value.lane,color:value.color};
  };
  const handleSave = async () => {
    if (!form.title.trim() || saving || dateError) return;
    setSaving(true);
    setSaveFailed(false);
    try {

    const dateValue = timelineEventLabel({ ...form, ...world?.fields }, worldCalendar, locale);

    // Auto-detect eventType: if there's an end date, it's a range
    const effectiveType: TimelineEventType =
      (form.dateMode !== 'text' && form.endTime) || (form.dateMode === 'calendar' && form.realDateEnd) || world?.fields.worldDateEnd ? 'range' : form.eventType;
    const worldFields = world ? world.fields : { worldDate: undefined, worldDateEnd: undefined };

    if (editingEvent) {
      const current=editableFields(form),initial=editableFields(formOpenedWith),changes=Object.fromEntries(Object.entries(current).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(initial[key as keyof TimelineEvent])));
      await onEditEvent(editingEvent.id,changes,editingEvent);
    } else {
      const now = Date.now();
      await onAddEvent({
        id: generateId('evt'),
        projectId,
        timelineId,
        title: form.title,
        description: form.description,
        date: dateValue,
        dateMode: form.dateMode,
        eventType: effectiveType,
        realDate: form.dateMode === 'calendar' ? form.realDate : undefined,
        realDateEnd: form.dateMode === 'calendar' ? form.realDateEnd || undefined : undefined,
        ...worldFields,
        ...eventDetailFields(form, form.dateMode),
        // Not `events.length`: once anything has been deleted the count is
        // lower than the highest `order`, and the new event lands tied with a
        // row that is already there — a tie no reorder can break.
        order: events.reduce((max, e) => Math.max(max, e.order), -1) + 1,
        lane: form.lane,
        color: form.color,
        createdAt: now,
        updatedAt: now,
      });
    }

    setShowForm(false);
    setEditingEvent(null);
    resetForm();
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setSaveFailed(false);
    loadForm({ title: '', description: '', date: '', dateMode: 'text', eventType: 'point', realDate: '', realDateEnd: '', worldText: '', worldTextEnd: '', lane: 'Main', color: '#c4973b', ...emptyEventDetails() });
  };

  const openEdit = (evt: TimelineEvent) => {
    setSaveFailed(false);
    loadForm({
      title: evt.title,
      description: evt.description,
      date: evt.date,
      dateMode: evt.dateMode || 'text',
      eventType: evt.eventType || 'point',
      realDate: evt.realDate || '',
      realDateEnd: evt.realDateEnd || '',
      worldText: worldDateText(worldCalendar, evt.worldDate),
      worldTextEnd: worldDateText(worldCalendar, evt.worldDateEnd),
      lane: evt.lane,
      color: evt.color,
      ...editEventDetails(evt),
    });
    setEditingEvent(evt);
    setShowForm(true);
  };

  // Sort events
  const linkedEvent = storedEvents.find(event => event.id === linkedEntity);
  if (linkedEvent && calendarSource !== undefined && appliedEntity !== linkedEntity) { setAppliedEntity(linkedEntity); openEdit(linkedEvent); }
  const sortedEvents = [...events].sort(sortMode === 'chronological' ? chronologicalCompare(worldCalendar) : (a, b) => a.order - b.order);


  return (
    <div className="space-y-6">
      {timeline?.yearRange && <div className="text-xs text-text-muted flex flex-wrap items-center gap-3" data-testid="timeline-range-note"><span>{t('timeline.settings.rangeNote').replace('{start}', String(timeline.yearRange.start)).replace('{end}', String(timeline.yearRange.end)).replace('{count}', String(storedEvents.length - events.length))}</span><button type="button" className="text-accent-gold hover:underline" onClick={() => void saveTimelineSettings(projectId, timelineId, { yearRange: undefined })}>{t('timeline.settings.allYears')}</button></div>}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-serif font-bold text-accent-gold">{t('timeline.timelineHeading')}</h3>
        <div className="flex items-center gap-2">
          {/* Sort toggle — only show when there are calendar events */}
          {hasCalendarEvents && (
            <button
              onClick={() => setSortMode(s => s === 'manual' ? 'chronological' : 'manual')}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border transition ${
                sortMode === 'chronological'
                  ? 'border-accent-gold/40 bg-accent-gold/10 text-accent-gold'
                  : 'border-border text-text-muted hover:text-text-primary hover:bg-elevated'
              }`}
              title={sortMode === 'chronological' ? t('timeline.sortedByDate') : t('timeline.sortedManually')}
            >
              <ArrowUpDown size={13} />
              {sortMode === 'chronological' ? t('timeline.byDate') : t('timeline.manualOrder')}
            </button>
          )}
          <button
            onClick={() => { resetForm(); setEditingEvent(null); setShowForm(true); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent-gold text-deep font-semibold text-sm rounded-lg hover:bg-accent-amber transition"
          >
            <Plus size={16} /> {t('timeline.addEvent')}
          </button>
        </div>
      </div>

      {sortedEvents.length === 0 ? (
        <EmptyState
          icon={<Clock size={40} />}
          title={t('timeline.emptyTitle')}
          message={t('timeline.emptyMessage')}
          // Same reset as the header's Add button: a cancelled edit leaves its
          // event's fields in `form`, and the new event would open pre-filled.
          action={{ label: t('timeline.addFirstEvent'), onClick: () => { resetForm(); setEditingEvent(null); setShowForm(true); } }}
        />
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-border" />

          <div className="space-y-4">
            <AnimatePresence>
              {sortedEvents.map((evt, i) => (
                <motion.div
                  key={evt.id}
                  className="relative flex items-start gap-4 pl-4"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  {evt.icon && <span className="relative z-10 w-8 h-8 flex items-center justify-center" style={{ color: evt.color }}><EventIcon icon={evt.icon} /></span>}
                  {/* Node shape — varies by eventType */}
                  {evt.icon ? null : (evt.eventType || 'point') === 'milestone' ? (
                    <div
                      className="relative z-10 w-8 h-8 flex items-center justify-center flex-shrink-0"
                      style={{ color: evt.color }}
                    >
                      <div
                        className="w-6 h-6 border-2 rotate-45"
                        style={{ borderColor: evt.color, backgroundColor: `${evt.color}30` }}
                      />
                    </div>
                  ) : (evt.eventType || 'point') === 'range' ? (
                    <div
                      className="relative z-10 w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 border-2"
                      style={{ borderColor: evt.color, backgroundColor: `${evt.color}30` }}
                    >
                      <ArrowRight size={12} style={{ color: evt.color }} />
                    </div>
                  ) : (
                    <div
                      className="relative z-10 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border-2"
                      style={{ borderColor: evt.color, backgroundColor: `${evt.color}20` }}
                    >
                      {evt.dateMode === 'calendar' ? (
                        <Calendar size={12} style={{ color: evt.color }} />
                      ) : (
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: evt.color }} />
                      )}
                    </div>
                  )}

                  {/* Event card */}
                  <div
                    className="flex-1 p-4 bg-surface border border-border rounded-xl hover:border-accent-gold/30 transition group cursor-pointer"
                    onClick={() => openEdit(evt)}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {getDisplayDate(evt, worldCalendar, locale) && (
                            <span
                              className="text-xs px-2 py-0.5 rounded inline-flex items-center gap-1"
                              style={{ backgroundColor: `${evt.color}20`, color: evt.color }}
                            >
                              {evt.dateMode === 'calendar' && <Calendar size={10} />}
                              {compactTimelineLabel(evt, worldCalendar, timeline?.displayPrecision, locale)}
                            </span>
                          )}
                          <span className="text-[10px] text-text-dim uppercase tracking-wider">{evt.lane}</span>
                        </div>
                        <h4 className="font-serif font-bold text-text-primary group-hover:text-accent-gold transition">
                          <button type="button" className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold rounded" onClick={event => { event.stopPropagation(); openEdit(evt); }}>{evt.title}</button>
                        </h4>
                        {evt.description && (
                          <p className="text-sm text-text-muted mt-1 line-clamp-2">{evt.description}</p>
                        )}
                        <EventDetailsPreview event={evt} entries={codexEntries} />
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                        <button className="p-1 hover:bg-elevated rounded" title={t('common.dragToReorder')} aria-label={t('common.dragToReorder')}><GripVertical size={14} className="text-text-dim" aria-hidden="true" /></button>
                        <button
                          onClick={(e) => { e.stopPropagation(); onDeleteEvent(evt.id); }}
                          className="p-1 hover:bg-danger/20 rounded"
                          title={t('timeline.deleteEvent')}
                          aria-label={t('timeline.deleteEvent')}
                        >
                          <Trash2 size={14} className="text-danger" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Form Modal */}
      <Modal open={showForm} onClose={() => { if (!saving) { setShowForm(false); setEditingEvent(null); } }} dismissible={!formDirty} title={editingEvent ? t('timeline.editEvent') : t('timeline.newEvent')}>
        <fieldset disabled={saving} className="space-y-4">
          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('timeline.labelTitle')}</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={t('timeline.placeholderEventName')}
              className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
              autoFocus
            />
          </div>

          {/* Date Mode Toggle */}
          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('timeline.labelDate')}</label>
            <div className="flex items-center gap-1 mb-2 p-0.5 bg-elevated rounded-lg border border-border w-fit">
              <button
                onClick={() => setForm({ ...form, dateMode: 'text' })}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition ${
                  form.dateMode === 'text'
                    ? 'bg-accent-gold/20 text-accent-gold font-semibold'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                <Type size={12} />
                {t('timeline.freeText')}
              </button>
              <button
                onClick={() => setForm({ ...form, dateMode: 'calendar' })}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition ${
                  form.dateMode === 'calendar'
                    ? 'bg-accent-gold/20 text-accent-gold font-semibold'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                <Calendar size={12} />
                {t('timeline.calendar')}
              </button>
              <button
                onClick={() => setForm({ ...form, dateMode: 'world' })}
                data-testid="date-mode-world"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition ${
                  form.dateMode === 'world'
                    ? 'bg-accent-gold/20 text-accent-gold font-semibold'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                <Globe size={12} />
                {t('timeline.world.mode')}
              </button>
            </div>

            {form.dateMode === 'world' ? (
              worldCalendar ? (
                <div className="space-y-2">
                  <WorldDateField calendar={worldCalendar} label={t('timeline.startDate')} value={form.worldText} testId="world-date-start"
                    onChange={(worldText) => setForm({ ...form, worldText })} />
                  <WorldDateField calendar={worldCalendar} label={t('timeline.endDate')} value={form.worldTextEnd} optional testId="world-date-end"
                    onChange={(worldTextEnd) => setForm({ ...form, worldTextEnd })} />
                </div>
              ) : (
                <p className="text-xs text-text-muted">{t('timeline.world.noCalendarHint')}</p>
              )
            ) : form.dateMode === 'text' ? (
              <input
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                placeholder={t('timeline.placeholderFreeDate')}
                className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
              />
            ) : (
              <div className="space-y-2">
                <div>
                  <label className="block text-[11px] text-text-dim mb-1">{t('timeline.startDate')}</label>
                  <input
                    type="date"
                    value={form.realDate}
                    onChange={(e) => setForm({ ...form, realDate: e.target.value })}
                    className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition [color-scheme:dark]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-text-dim mb-1">{t('timeline.endDate')} <span className="text-text-dim">{t('timeline.endDateOptional')}</span></label>
                  <input
                    type="date"
                    value={form.realDateEnd}
                    onChange={(e) => setForm({ ...form, realDateEnd: e.target.value })}
                    min={form.realDate || undefined}
                    className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition [color-scheme:dark]"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Event Type selector */}
          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('timeline.labelEventType')}</label>
            <div className="flex items-center gap-1 p-0.5 bg-elevated rounded-lg border border-border w-fit">
              {([
                { type: 'point' as const, icon: Circle, label: t('timeline.typePoint') },
                { type: 'range' as const, icon: ArrowRight, label: t('timeline.typeRange') },
                { type: 'milestone' as const, icon: Diamond, label: t('timeline.typeMilestone') },
              ]).map(({ type, icon: Icon, label }) => (
                <button
                  key={type}
                  onClick={() => setForm({ ...form, eventType: type })}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition ${
                    form.eventType === type
                      ? 'bg-accent-gold/20 text-accent-gold font-semibold'
                      : 'text-text-muted hover:text-text-primary'
                  }`}
                >
                  <Icon size={12} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('timeline.labelLane')}</label>
            <input
              value={form.lane}
              onChange={(e) => setForm({ ...form, lane: e.target.value })}
              placeholder={t('timeline.placeholderLane')}
              className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
            />
          </div>
          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('timeline.labelDescription')}</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={t('timeline.placeholderDescription')}
              rows={3}
              className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition resize-none"
            />
          </div>
          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('timeline.labelColor')}</label>
            <ColorPicker
              value={form.color}
              onChange={(color) => setForm({ ...form, color })}
              size="sm"
            />
          </div>
          <EventDetailsFields value={form} onChange={details => setForm(current => ({ ...current, ...details }))} entries={codexEntries} mode={form.dateMode} hours={form.dateMode === 'world' ? worldCalendar?.hoursPerDay ?? 24 : 24} />
          {dateError && <p role="alert" className="text-sm text-danger">{t(dateError)}</p>}
          {saveFailed && <p role="alert" className="text-sm text-danger">{t('common.saveFailed')}</p>}
          <div className="flex gap-3 pt-2">
            <button onClick={handleSave} disabled={saving || Boolean(dateError)} className="flex-1 py-2.5 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-amber transition disabled:opacity-50">
              {saving ? t('common.saving') : editingEvent ? t('timeline.save') : t('timeline.create')}
            </button>
            <button onClick={() => { setShowForm(false); setEditingEvent(null); }} className="px-6 py-2.5 border border-border text-text-muted rounded-lg hover:bg-elevated transition">
              {t('timeline.cancel')}
            </button>
          </div>
        </fieldset>
      </Modal>
    </div>
  );
}
