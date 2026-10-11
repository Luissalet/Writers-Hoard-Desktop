import { useEffect, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { WorldDateField } from '@/engines/timeline/components/WorldDateField';
import { useWorldCalendar, worldDateText } from '@/engines/timeline/useWorldCalendar';
import { parseWorldDate, validateWorldRange, type WorldDate } from '@/engines/timeline/worldCalendar';
import type { Writing } from '@/types';

interface ChapterWorldDateProps {
  projectId: string;
  writing: Pick<Writing, 'id' | 'worldDate' | 'worldDateEnd'>;
  onUpdate: (id: string, changes: Partial<Writing>) => Promise<void>;
}

/**
 * When a chapter happens in the project's world calendar. Shown only when the
 * project has a calendar; an empty start clears the date. Typing is committed
 * after a short pause, and only when the text is a real date of the calendar.
 */
export default function ChapterWorldDate({ projectId, writing, onUpdate }: ChapterWorldDateProps) {
  const { t } = useTranslation();
  const calendar = useWorldCalendar(projectId)?.calendar ?? null;
  const storedStart = worldDateText(calendar, writing.worldDate);
  const storedEnd = worldDateText(calendar, writing.worldDateEnd);
  const [start, setStart] = useState(storedStart);
  const [end, setEnd] = useState(storedEnd);
  // What the text boxes were last in step with (the stored dates, as text).
  // Typing makes the boxes differ from it: that is the only unsaved state.
  const [base, setBase] = useState({ id: writing.id, start: storedStart, end: storedEnd });

  // The stored dates can change under the editor (another chapter opened, the
  // calendar loaded or edited, a bridge tool wrote them). Boxes the person has
  // not touched follow along; boxes with pending typing are left alone.
  if (base.id !== writing.id) {
    setBase({ id: writing.id, start: storedStart, end: storedEnd });
    setStart(storedStart);
    setEnd(storedEnd);
  } else if (base.start !== storedStart || base.end !== storedEnd) {
    if (start === base.start) setStart(storedStart);
    if (end === base.end) setEnd(storedEnd);
    setBase({ id: writing.id, start: storedStart, end: storedEnd });
  }
  const dirty = start !== base.start || end !== base.end;

  useEffect(() => {
    if (!calendar || !dirty) return;
    const handle = window.setTimeout(() => {
      let worldDate: WorldDate | undefined;
      let worldDateEnd: WorldDate | undefined;
      if (start.trim()) {
        const parsed = parseWorldDate(calendar, start);
        if (!parsed) return;
        worldDate = parsed;
        if (end.trim()) {
          const parsedEnd = parseWorldDate(calendar, end);
          if (!parsedEnd || validateWorldRange(calendar, parsed, parsedEnd) !== null) return;
          worldDateEnd = parsedEnd;
        }
      }
      if (JSON.stringify(worldDate) === JSON.stringify(writing.worldDate)
        && JSON.stringify(worldDateEnd) === JSON.stringify(writing.worldDateEnd)) return;
      void onUpdate(writing.id, { worldDate, worldDateEnd });
    }, 500);
    return () => window.clearTimeout(handle);
  }, [start, end, dirty, calendar, writing.id, writing.worldDate, writing.worldDateEnd, onUpdate]);
  if (!calendar) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="chapter-world-date">
      <WorldDateField calendar={calendar} label={t('writings.worldDate')} value={start} onChange={setStart} testId="chapter-world-date-start" />
      <WorldDateField calendar={calendar} label={t('writings.worldDateEnd')} value={end} onChange={setEnd} optional testId="chapter-world-date-end" />
    </div>
  );
}

