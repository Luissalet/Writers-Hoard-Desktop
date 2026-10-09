import { useEffect, useRef, useState } from 'react';
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
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const seeded = useRef(false);

  // Seed the text once the calendar is known (it loads asynchronously).
  useEffect(() => {
    if (!calendar || seeded.current) return;
    seeded.current = true;
    setStart(worldDateText(calendar, writing.worldDate));
    setEnd(worldDateText(calendar, writing.worldDateEnd));
  }, [calendar, writing.worldDate, writing.worldDateEnd]);

  useEffect(() => {
    if (!calendar || !seeded.current) return;
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
  }, [start, end, calendar, writing.id, writing.worldDate, writing.worldDateEnd, onUpdate]);

  if (!calendar) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="chapter-world-date">
      <WorldDateField calendar={calendar} label={t('writings.worldDate')} value={start} onChange={setStart} testId="chapter-world-date-start" />
      <WorldDateField calendar={calendar} label={t('writings.worldDateEnd')} value={end} onChange={setEnd} optional testId="chapter-world-date-end" />
    </div>
  );
}
