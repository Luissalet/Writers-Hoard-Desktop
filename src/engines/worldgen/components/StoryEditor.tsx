import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { STORY_COLORS, STORY_NOTE_MAX, STORY_STATUSES, STORY_TITLE_MAX, STORY_TYPES, STORY_WHO_MAX, type StoryEvent, type StoryStatus, type StoryType } from '../core/storyEvents';

export interface StoryDraft {
  storyType: StoryType;
  storyTitle: string;
  storyChapter: number | null;
  storyStatus: StoryStatus;
}

const parseChapter = (raw: string): number | null => {
  const text = raw.trim();
  if (!text) return null;
  const n = Math.floor(Number(text));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Story events: the draft for the next one (placed with a click on the map),
 * the selected one's fields, and the story so far, chapter by chapter.
 */
export default function StoryEditor({ draft, onDraft, events, selectedId, onSelect, onUpdate, onRemove, onFocus, people = [], onReorder, onPlace, writings = [], onOpenWriting }: {
  draft: StoryDraft;
  onDraft: (patch: Partial<StoryDraft>) => void;
  events: StoryEvent[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, patch: Partial<Omit<StoryEvent, 'id'>>) => void;
  onRemove: (id: string) => void;
  onFocus: (event: StoryEvent) => void;
  /** Codex characters and factions that can be marked as there. */
  people?: { id: string; title: string }[];
  /** Move an event up or down within its chapter. */
  onReorder?: (id: string, by: -1 | 1) => void;
  /** Put an event at a place within its chapter (dragged there in the list). */
  onPlace?: (id: string, index: number) => void;
  /** The manuscript's chapters and scenes an event can be linked to. */
  writings?: { id: string; title: string; chapter?: number }[];
  /** Open a linked chapter or scene in the manuscript. */
  onOpenWriting?: (id: string) => void;
}) {
  // Dragging within a chapter: which event is held and where it would drop.
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<string | null>(null);
  const { t } = useTranslation();
  const selected = selectedId ? events.find((event) => event.id === selectedId) ?? null : null;
  // Text is committed when the field is left (or Enter), not per keystroke: one undo step per change.
  const [title, setTitle] = useState(selected?.title ?? '');
  const [note, setNote] = useState(selected?.note ?? '');
  const [seen, setSeen] = useState<string | null>(null);
  const key = selected ? `${selected.id}|${selected.title}|${selected.note ?? ''}` : null;
  if (key !== seen) { setSeen(key); setTitle(selected?.title ?? ''); setNote(selected?.note ?? ''); }
  // Words typed for an event belong to that event: if another is picked (on the
  // map, before the field blurs) or the editor closes, they are saved to the
  // one they were typed for, not compared against the newly picked one.
  const typed = useRef<{ id: string; title: string; note: string } | null>(null);
  const latest = useRef({ events, onUpdate });
  useEffect(() => { latest.current = { events, onUpdate }; });
  useEffect(() => {
    const id = selectedId;
    return () => {
      const pending = typed.current;
      if (!id || !pending || pending.id !== id) return;
      typed.current = null;
      const stored = latest.current.events.find((event) => event.id === id);
      if (!stored) return;
      const patch: Partial<StoryEvent> = {};
      if (pending.title.trim() && pending.title.trim() !== stored.title) patch.title = pending.title.trim().slice(0, STORY_TITLE_MAX);
      if (pending.note.trim() !== (stored.note ?? '')) patch.note = pending.note.trim().slice(0, STORY_NOTE_MAX);
      if (Object.keys(patch).length) latest.current.onUpdate(id, patch);
    };
  }, [selectedId]);
  const commitText = () => {
    typed.current = null;
    if (!selected) return;
    const patch: Partial<StoryEvent> = {};
    if (title.trim() && title.trim() !== selected.title) patch.title = title.trim().slice(0, STORY_TITLE_MAX);
    if (note.trim() !== (selected.note ?? '')) patch.note = note.trim().slice(0, STORY_NOTE_MAX);
    if (Object.keys(patch).length) onUpdate(selected.id, patch);
  };
  const chapters = [...new Set(events.map((event) => event.chapter ?? null))];
  const typeChips = (value: StoryType, pick: (type: StoryType) => void, prefix: string) => (
    <div className="grid grid-cols-3 gap-1">
      {STORY_TYPES.map((type) => (
        <button key={type} type="button" data-testid={`${prefix}-${type}`} onClick={() => pick(type)}
          className={`flex items-center gap-1 rounded px-1.5 py-1 text-[10px] transition ${value === type ? 'bg-amber-400/85 text-black font-medium' : 'bg-white/10 hover:bg-white/20'}`}>
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: STORY_COLORS[type] }} />
          {t(`worldgen.story.type.${type}`)}
        </button>
      ))}
    </div>
  );
  const statusChips = (value: StoryStatus, pick: (status: StoryStatus) => void, prefix: string) => (
    <div className="grid grid-cols-2 gap-1">
      {STORY_STATUSES.map((status) => (
        <button key={status} type="button" data-testid={`${prefix}-${status}`} onClick={() => pick(status)}
          className={`rounded px-1.5 py-1 text-[10px] ${value === status ? 'bg-amber-400/85 text-black font-medium' : 'bg-white/10 hover:bg-white/20'}`}>
          {t(`worldgen.story.status.${status}`)}
        </button>
      ))}
    </div>
  );
  return (
    <div className="flex flex-col gap-2" data-testid="story-editor">
      {!selected && (
        <div className="flex flex-col gap-1.5" data-testid="story-draft">
          <span className="text-[10px] uppercase tracking-wider text-white/45">{t('worldgen.story.next')}</span>
          {typeChips(draft.storyType, (type) => onDraft({ storyType: type }), 'story-type')}
          <input data-testid="story-title" value={draft.storyTitle} maxLength={STORY_TITLE_MAX} placeholder={t('worldgen.story.titlePlaceholder')}
            onChange={(e) => onDraft({ storyTitle: e.target.value })}
            className="rounded bg-white/10 px-2 py-1 text-[11px] text-white placeholder:text-white/35" />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[10px] text-white/55">
              {t('worldgen.story.chapter')}
              <input data-testid="story-chapter" type="number" min={0} step={1} value={draft.storyChapter ?? ''} placeholder="—"
                onChange={(e) => onDraft({ storyChapter: parseChapter(e.target.value) })}
                className="w-14 rounded bg-white/10 px-1 py-0.5 text-right text-[11px] text-white tabular-nums" />
            </label>
            <div className="flex-1">{statusChips(draft.storyStatus, (status) => onDraft({ storyStatus: status }), 'story-status')}</div>
          </div>
          <p className="text-[10px] leading-snug text-white/45">{t('worldgen.story.placeHint')}</p>
        </div>
      )}
      {selected && (
        <div className="flex flex-col gap-1.5 rounded bg-white/[0.06] p-2" data-testid="story-selected">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-white/45">{t('worldgen.story.selected')}</span>
            <button type="button" onClick={() => onSelect(null)} className="text-[10px] text-white/55 underline">{t('worldgen.story.newOne')}</button>
          </div>
          {typeChips(selected.type, (type) => onUpdate(selected.id, { type }), 'story-edit-type')}
          <input data-testid="story-edit-title" value={title} maxLength={STORY_TITLE_MAX}
            onChange={(e) => { setTitle(e.target.value); typed.current = { id: selected.id, title: e.target.value, note }; }} onBlur={commitText}
            onKeyDown={(e) => { if (e.key === 'Enter') commitText(); }}
            className="rounded bg-white/10 px-2 py-1 text-[11px] text-white" />
          <textarea data-testid="story-edit-note" value={note} maxLength={STORY_NOTE_MAX} rows={3} placeholder={t('worldgen.story.notePlaceholder')}
            onChange={(e) => { setNote(e.target.value); typed.current = { id: selected.id, title, note: e.target.value }; }} onBlur={commitText}
            className="rounded bg-white/10 px-2 py-1 text-[11px] text-white placeholder:text-white/35" />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[10px] text-white/55">
              {t('worldgen.story.chapter')}
              <input data-testid="story-edit-chapter" type="number" min={0} step={1} defaultValue={selected.chapter ?? ''} key={`${selected.id}:${selected.chapter ?? ''}`} placeholder="—"
                onBlur={(e) => { const n = parseChapter(e.target.value); if (n !== (selected.chapter ?? null)) onUpdate(selected.id, { chapter: n ?? undefined }); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                className="w-14 rounded bg-white/10 px-1 py-0.5 text-right text-[11px] text-white tabular-nums" />
            </label>
            <div className="flex-1">{statusChips(selected.status, (status) => onUpdate(selected.id, { status }), 'story-edit-status')}</div>
          </div>
          {/* Who was there: Codex characters and factions, by name. */}
          <div className="flex flex-col gap-1" data-testid="story-who">
            <span className="text-[10px] text-white/55">{t('worldgen.story.who')}</span>
            <div className="flex flex-wrap gap-1">
              {(selected.who ?? []).map((id) => <span key={id} className="flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px]" data-testid={`story-who-${id}`}>
                {people.find((person) => person.id === id)?.title ?? t('worldgen.story.whoMissing')}
                <button type="button" aria-label={t('worldgen.story.whoRemove')} onClick={() => onUpdate(selected.id, { who: (selected.who ?? []).filter((other) => other !== id) })} className="text-white/55 hover:text-white" data-testid={`story-who-remove-${id}`}>×</button>
              </span>)}
              {!(selected.who ?? []).length && <span className="text-[10px] text-white/35">{t('worldgen.story.whoNobody')}</span>}
            </div>
            {(selected.who ?? []).length < STORY_WHO_MAX && people.some((person) => !(selected.who ?? []).includes(person.id)) && <select value="" onChange={(e) => { if (e.target.value) onUpdate(selected.id, { who: [...(selected.who ?? []), e.target.value] }); }} aria-label={t('worldgen.story.whoAdd')}
              className="rounded bg-white/10 px-1.5 py-1 text-[11px] text-white" data-testid="story-who-add">
              <option value="">{t('worldgen.story.whoAdd')}</option>
              {people.filter((person) => !(selected.who ?? []).includes(person.id)).map((person) => <option key={person.id} value={person.id}>{person.title}</option>)}
            </select>}
          </div>
          {/* Where it is told: a chapter or scene of the manuscript. */}
          <div className="flex flex-col gap-1" data-testid="story-writing">
            <span className="text-[10px] text-white/55">{t('worldgen.story.writing')}</span>
            <div className="flex items-center gap-1">
              <select value={selected.writingId ?? ''} aria-label={t('worldgen.story.writing')} data-testid="story-writing-pick"
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) { onUpdate(selected.id, { writingId: undefined }); return; }
                  const chosen = writings.find((w) => w.id === id);
                  // An event with no chapter takes the chapter of the scene it is told in.
                  onUpdate(selected.id, { writingId: id, ...(selected.chapter === undefined && typeof chosen?.chapter === 'number' ? { chapter: chosen.chapter } : {}) });
                }}
                className="min-w-0 flex-1 rounded bg-white/10 px-1.5 py-1 text-[11px] text-white">
                <option value="">{t('worldgen.story.writingNone')}</option>
                {selected.writingId && !writings.some((w) => w.id === selected.writingId) && <option value={selected.writingId}>{t('worldgen.story.writingMissing')}</option>}
                {writings.map((w) => <option key={w.id} value={w.id}>{typeof w.chapter === 'number' ? `${w.chapter} · ` : ''}{w.title}</option>)}
              </select>
              {selected.writingId && onOpenWriting && writings.some((w) => w.id === selected.writingId) && (
                <button type="button" data-testid="story-writing-open" onClick={() => onOpenWriting(selected.writingId!)}
                  className="shrink-0 rounded bg-white/10 px-1.5 py-1 text-[10px] hover:bg-white/20">{t('worldgen.story.writingOpen')}</button>
              )}
            </div>
            {!writings.length && <p className="text-[10px] text-white/35">{t('worldgen.story.writingEmpty')}</p>}
          </div>
          <p className="text-[10px] leading-snug text-white/45">{t('worldgen.story.moveHint')}</p>
          <button type="button" data-testid="story-remove" onClick={() => { onRemove(selected.id); onSelect(null); }}
            className="self-start rounded bg-red-500/20 px-2 py-0.5 text-[10px] text-red-200 hover:bg-red-500/30">{t('worldgen.story.remove')}</button>
        </div>
      )}
      <div className="flex flex-col gap-1" data-testid="story-list">
        <span className="text-[10px] uppercase tracking-wider text-white/45">{t('worldgen.story.soFar').replace('{n}', String(events.length))}</span>
        {!events.length && <p className="text-[10px] text-white/40">{t('worldgen.story.empty')}</p>}
        {chapters.map((chapter) => (
          <div key={chapter ?? 'none'} className="flex flex-col gap-0.5">
            <span className="text-[10px] text-white/50">{chapter === null ? t('worldgen.story.noChapter') : t('worldgen.story.chapterN').replace('{n}', String(chapter))}</span>
            {events.filter((event) => (event.chapter ?? null) === chapter).map((event, index, group) => (
              <div key={event.id} data-testid={`story-row-${event.id}`}
                draggable={!!onPlace && group.length > 1}
                onDragStart={(e) => { setDragging(event.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', event.id); }}
                onDragEnd={() => { setDragging(null); setDropAt(null); }}
                onDragOver={(e) => {
                  // Only within the same chapter: a drag never changes the chapter.
                  const held = dragging ? events.find((other) => other.id === dragging) : null;
                  if (!held || held.id === event.id || (held.chapter ?? null) !== chapter) return;
                  e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropAt(event.id);
                }}
                onDragLeave={() => setDropAt((at) => (at === event.id ? null : at))}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = dragging ?? e.dataTransfer.getData('text/plain');
                  setDragging(null); setDropAt(null);
                  if (id && id !== event.id && onPlace) onPlace(id, index);
                }}
                className={`flex items-center gap-0.5 rounded ${dropAt === event.id ? 'ring-1 ring-amber-300/80' : ''} ${dragging === event.id ? 'opacity-50' : ''} ${onPlace && group.length > 1 ? 'cursor-grab' : ''}`}>
                <button type="button" data-testid={`story-item-${event.id}`}
                  onClick={() => { onSelect(event.id); onFocus(event); }}
                  title={(event.who ?? []).map((id) => people.find((person) => person.id === id)?.title).filter(Boolean).join(', ') || undefined}
                  className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] ${event.id === selectedId ? 'bg-amber-400/20 text-amber-100' : 'hover:bg-white/10'}`}>
                  <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${event.status === 'planned' ? 'border-2 bg-transparent' : ''}`}
                    style={event.status === 'planned' ? { borderColor: STORY_COLORS[event.type] } : { background: STORY_COLORS[event.type] }} />
                  <span className="truncate">{event.title}</span>
                  {!!event.who?.length && <span className="shrink-0 text-[9px] text-white/50">· {event.who.length}</span>}
                  {event.writingId && <span className="shrink-0 text-[9px] text-white/50" title={writings.find((w) => w.id === event.writingId)?.title ?? t('worldgen.story.writingMissing')} data-testid={`story-item-writing-${event.id}`}>¶</span>}
                  <span className="ml-auto shrink-0 text-[9px] text-white/40">{t(`worldgen.story.type.${event.type}`)}</span>
                </button>
                {onReorder && group.length > 1 && <>
                  <button type="button" disabled={index === 0} onClick={() => onReorder(event.id, -1)} aria-label={t('worldgen.story.earlier')} title={t('worldgen.story.earlier')} className="rounded px-1 text-[10px] text-white/55 hover:bg-white/10 disabled:opacity-25" data-testid={`story-up-${event.id}`}>↑</button>
                  <button type="button" disabled={index === group.length - 1} onClick={() => onReorder(event.id, 1)} aria-label={t('worldgen.story.later')} title={t('worldgen.story.later')} className="rounded px-1 text-[10px] text-white/55 hover:bg-white/10 disabled:opacity-25" data-testid={`story-down-${event.id}`}>↓</button>
                </>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
