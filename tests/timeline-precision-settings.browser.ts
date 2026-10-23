// Month precision for a timeline's dates, and a timeline's own settings
// (title, colour, precision, span of years) through wh_timeline_settings.
import { db } from '@/db';
import { compactTimelineLabel } from '@/engines/timeline/timelineSettings';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import type { Project, Timeline, TimelineEvent } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

export async function testTimelinePrecisionSettings(): Promise<string[]> {
  const passed: string[] = [];
  const event = { id: 'e', projectId: 'p', timelineId: 't', title: 'La tormenta', description: '', date: '', dateMode: 'calendar', realDate: '2026-10-21', realDateEnd: '2026-11-02', eventType: 'range', order: 0, lane: '', color: '#888888', createdAt: 1, updatedAt: 1 } as TimelineEvent;
  const month = compactTimelineLabel(event, null, 'month', 'es');
  assert(month === 'octubre 2026 – noviembre 2026', `Month: ${month}`);
  assert(compactTimelineLabel(event, null, 'year', 'es') === '2026 – 2026', 'Year');
  passed.push(`Precision "Mes": the storm reads "${month}"`);

  const P = 'tps-project';
  try {
    await db.projects.put({ id: P, title: 'Sal', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['timeline'], createdAt: 1, updatedAt: 1 } as Project);
    const created = await runBridgeTool('wh_create_timeline', { projectId: P, title: 'Otoño' });
    const timelineId = (created.result as { id: string }).id;
    const set = await runBridgeTool('wh_timeline_settings', { projectId: P, timelineId, title: 'Otoño del puerto', color: '#c0504d', displayPrecision: 'month', yearRange: { start: 2020, end: 2030 } });
    assert(set.ok, JSON.stringify(set));
    const stored = await db.timelines.get(timelineId) as Timeline;
    assert(stored.title === 'Otoño del puerto' && stored.color === '#c0504d' && stored.displayPrecision === 'month' && stored.yearRange?.start === 2020, `Stored: ${JSON.stringify(stored)}`);
    const bad = await runBridgeTool('wh_timeline_settings', { projectId: P, timelineId, displayPrecision: 'week' });
    assert(!bad.ok, 'Unknown precision refused');
    await undoAuditEntry({ entry: { ...(set.result as { __audit: Record<string, unknown> }).__audit, tool: 'wh_timeline_settings', kind: 'update' } });
    const back = await db.timelines.get(timelineId) as Timeline;
    assert(back.title === 'Otoño' && back.displayPrecision === undefined && back.yearRange === undefined, `Undo: ${JSON.stringify(back)}`);
    passed.push('Bridge: wh_timeline_settings renames "Otoño" to "Otoño del puerto", colours it, shows its dates by month and limits it to 2020–2030; an unknown precision is refused; undo puts it back');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
