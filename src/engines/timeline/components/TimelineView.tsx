import { useState } from 'react';
import { Plus, Trash2, Clock, GripVertical, Calendar, Type, ArrowUpDown, Circle, Diamond, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TimelineEvent, DateMode, TimelineEventType } from '@/types';
import { generateId } from '@/utils/idGenerator';
import Modal from '@/components/common/Modal';
import EmptyState from '@/components/common/EmptyState';
import ColorPicker from '@/components/common/ColorPicker';

interface TimelineViewProps {
  projectId: string;
  timelineId: string;
  events: TimelineEvent[];
  onAddEvent: (event: TimelineEvent) => void;
  onEditEvent: (id: string, changes: Partial<TimelineEvent>) => void;
  onDeleteEvent: (id: string) => void;
}

/** Format an ISO date string into a human-readable form */
function formatRealDate(iso: string, endIso?: string): string {
  const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };
  try {
    const start = new Date(iso + 'T00:00:00').toLocaleDateString(undefined, opts);
    if (endIso) {
      const end = new Date(endIso + 'T00:00:00').toLocaleDateString(undefined, opts);
      return `${start} — ${end}`;
    }
    return start;
  } catch {
    return iso;
  }
}

/** Get the display date string for an event */
function getDisplayDate(evt: TimelineEvent): string {
  if (evt.dateMode === 'calendar' && evt.realDate) {
    return formatRealDate(evt.realDate, evt.realDateEnd);
  }
  return evt.date || '';
}

type SortMode = 'manual' | 'chronological';

export default function TimelineView({ projectId, timelineId, events, onAddEvent, onEditEvent, onDeleteEvent }: TimelineViewProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TimelineEvent | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('manual');
  const [form, setForm] = useState({
    title: '',
    description: '',
    date: '',
    dateMode: 'text' as DateMode,
    eventType: 'point' as TimelineEventType,
    realDate: '',
    realDateEnd: '',
    lane: 'Main',
    color: '#c4973b',
  });

  const lanes = [...new Set(events.map(e => e.lane))];
  if (lanes.length === 0) lanes.push('Main');

  // Check if there are any calendar-mode events (enables chronological sort)
  const hasCalendarEvents = events.some(e => e.dateMode === 'calendar' && e.realDate);

  const handleSave = () => {
    if (!form.title.trim()) return;

    const dateValue = form.dateMode === 'calendar' && form.realDate
      ? formatRealDate(form.realDate, form.realDateEnd)
      : form.date;

    // Auto-detect eventType: if there's an end date, it's a range
    const effectiveType: TimelineEventType =
      form.dateMode === 'calendar' && form.realDateEnd ? 'range' : form.eventType;

    if (editingEvent) {
      onEditEvent(editingEvent.id, {
        title: form.title,
        description: form.description,
        date: dateValue,
        dateMode: form.dateMode,
        eventType: effectiveType,
        realDate: form.dateMode === 'calendar' ? form.realDate : undefined,
        realDateEnd: form.dateMode === 'calendar' ? form.realDateEnd || undefined : undefined,
        lane: form.lane,
        color: form.color,
      });
    } else {
      onAddEvent({
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
        order: events.length,
        lane: form.lane,
        color: form.color,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    setShowForm(false);
    setEditingEvent(null);
    resetForm();
  };

  const resetForm = () => {
    setForm({ title: '', description: '', date: '', dateMode: 'text', eventType: 'point', realDate: '', realDateEnd: '', lane: 'Main', color: '#c4973b' });
  };

  const openEdit = (evt: TimelineEvent) => {
    setForm({
      title: evt.title,
      description: evt.description,
      date: evt.date,
      dateMode: evt.dateMode || 'text',
      eventType: evt.eventType || 'point',
      realDate: evt.realDate || '',
      realDateEnd: evt.realDateEnd || '',
      lane: evt.lane,
      color: evt.color,
    });
    setEditingEvent(evt);
    setShowForm(true);
  };

  // Sort events
  const sortedEvents = [...events].sort((a, b) => {
    if (sortMode === 'chronological') {
      // Calendar dates first (sorted), then text dates at the end by order
      const aDate = a.dateMode === 'calendar' && a.realDate ? a.realDate : '';
      const bDate = b.dateMode === 'calendar' && b.realDate ? b.realDate : '';
      if (aDate && bDate) return aDate.localeCompare(bDate);
      if (aDate && !bDate) return -1;
      if (!aDate && bDate) return 1;
      return a.order - b.order;
    }
    return a.order - b.order;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-serif font-bold text-accent-gold">Timeline</h3>
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
              title={sortMode === 'chronological' ? 'Sorted by date' : 'Sorted manually'}
            >
              <ArrowUpDown size={13} />
              {sortMode === 'chronological' ? 'By date' : 'Manual order'}
            </button>
          )}
          <button
            onClick={() => { resetForm(); setEditingEvent(null); setShowForm(true); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent-gold text-deep font-semibold text-sm rounded-lg hover:bg-accent-amber transition"
          >
            <Plus size={16} /> Add Event
          </button>
        </div>
      </div>

      {sortedEvents.length === 0 ? (
        <EmptyState
          icon={<Clock size={40} />}
          title="Empty timeline"
          message="Add events to visualize your story's chronology."
          action={{ label: 'Add First Event', onClick: () => setShowForm(true) }}
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
                  {/* Node shape — varies by eventType */}
                  {(evt.eventType || 'point') === 'milestone' ? (
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
                          {getDisplayDate(evt) && (
                            <span
                              className="text-xs px-2 py-0.5 rounded inline-flex items-center gap-1"
                              style={{ backgroundColor: `${evt.color}20`, color: evt.color }}
                            >
                              {evt.dateMode === 'calendar' && <Calendar size={10} />}
                              {getDisplayDate(evt)}
                            </span>
                          )}
                          <span className="text-[10px] text-text-dim uppercase tracking-wider">{evt.lane}</span>
                        </div>
                        <h4 className="font-serif font-bold text-text-primary group-hover:text-accent-gold transition">
                          {evt.title}
                        </h4>
                        {evt.description && (
                          <p className="text-sm text-text-muted mt-1 line-clamp-2">{evt.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                        <button className="p-1 hover:bg-elevated rounded"><GripVertical size={14} className="text-text-dim" /></button>
                        <button
                          onClick={(e) => { e.stopPropagation(); onDeleteEvent(evt.id); }}
                          className="p-1 hover:bg-danger/20 rounded"
                        >
                          <Trash2 size={14} className="text-danger" />
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
      <Modal open={showForm} onClose={() => { setShowForm(false); setEditingEvent(null); }} title={editingEvent ? 'Edit Event' : 'New Event'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-text-muted mb-1.5">Title</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Event name..."
              className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
              autoFocus
            />
          </div>

          {/* Date Mode Toggle */}
          <div>
            <label className="block text-sm text-text-muted mb-1.5">Date</label>
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
                Free text
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
                Calendar
              </button>
            </div>

            {form.dateMode === 'text' ? (
              <input
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                placeholder="e.g. Year 342, Third Age..."
                className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
              />
            ) : (
              <div className="space-y-2">
                <div>
                  <label className="block text-[11px] text-text-dim mb-1">Start date</label>
                  <input
                    type="date"
                    value={form.realDate}
                    onChange={(e) => setForm({ ...form, realDate: e.target.value })}
                    className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition [color-scheme:dark]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-text-dim mb-1">End date <span className="text-text-dim">(optional, for ranges)</span></label>
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
            <label className="block text-sm text-text-muted mb-1.5">Event type</label>
            <div className="flex items-center gap-1 p-0.5 bg-elevated rounded-lg border border-border w-fit">
              {([
                { type: 'point' as const, icon: Circle, label: 'Point' },
                { type: 'range' as const, icon: ArrowRight, label: 'Range' },
                { type: 'milestone' as const, icon: Diamond, label: 'Milestone' },
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
            <label className="block text-sm text-text-muted mb-1.5">Lane</label>
            <input
              value={form.lane}
              onChange={(e) => setForm({ ...form, lane: e.target.value })}
              placeholder="e.g. Main, Kingdom A, Character Arc..."
              className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
            />
          </div>
          <div>
            <label className="block text-sm text-text-muted mb-1.5">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What happened..."
              rows={3}
              className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition resize-none"
            />
          </div>
          <div>
            <label className="block text-sm text-text-muted mb-1.5">Color</label>
            <ColorPicker
              value={form.color}
              onChange={(color) => setForm({ ...form, color })}
              size="sm"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={handleSave} className="flex-1 py-2.5 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-amber transition">
              {editingEvent ? 'Save' : 'Create'}
            </button>
            <button onClick={() => { setShowForm(false); setEditingEvent(null); }} className="px-6 py-2.5 border border-border text-text-muted rounded-lg hover:bg-elevated transition">
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
