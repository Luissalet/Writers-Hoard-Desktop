import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import { onDataChanged } from '@/engines/_shared/dataChanged';
import { buildContinuityReport, type ContinuityReport, type ReportOptions } from './report';

// The calendar lives on the project or a timeline; the other rows are watched live below.
const WATCHED = new Set(['timelines', 'projects']);
const PENDING_RETRY_MS = 6000;

/**
 * The continuity report for a project, rebuilt when the manuscript, the Codex,
 * a world or the calendar change, and again while a world is still being generated.
 */
export function useContinuityReport(projectId: string, options: ReportOptions & { disabled?: boolean } = {}): { report: ContinuityReport | null; loading: boolean; error: string | null; refresh: () => void } {
  const { disabled, eraId, characterId, skipTravel } = options;
  const [tick, setTick] = useState(0);
  // Any change to the rows the report reads (from any writer) changes this.
  const signature = useLiveQuery(async () => {
    if (disabled) return '';
    const [writings, codex, worlds] = await Promise.all([
      db.writings.where('projectId').equals(projectId).toArray(),
      db.codexEntries.where('projectId').equals(projectId).toArray(),
      db.generatedWorlds.where('projectId').equals(projectId).toArray(),
    ]);
    // Only what the report reads: typing in a chapter does not rebuild it.
    return JSON.stringify([
      writings.map((w) => [w.id, w.title, w.chapter, w.worldDate, w.worldDateEnd]),
      codex.map((c) => [c.id, c.title, c.type, c.continuity]),
      worlds.map((g) => [g.id, g.updatedAt]),
    ]);
  }, [projectId, disabled]);
  const request = `${projectId}|${eraId ?? ''}|${characterId ?? ''}|${skipTravel ? 1 : 0}|${tick}|${signature ?? ''}`;
  const [result, setResult] = useState<{ request: string; report: ContinuityReport | null; error: string | null }>({ request: '', report: null, error: null });

  useEffect(() => {
    if (disabled) return;
    let alive = true;
    let retry: number | undefined;
    buildContinuityReport(projectId, { eraId, characterId, skipTravel }).then((report) => {
      if (!alive) return;
      setResult({ request, report, error: null });
      if (report.pendingWorlds.length) retry = window.setTimeout(() => setTick((n) => n + 1), PENDING_RETRY_MS);
    }, (error: unknown) => {
      if (alive) setResult((prior) => ({ request, report: prior.report, error: error instanceof Error ? error.message : String(error) }));
    });
    return () => { alive = false; window.clearTimeout(retry); };
  }, [request, projectId, disabled, eraId, characterId, skipTravel]);

  useEffect(() => {
    if (disabled) return;
    let handle: number | undefined;
    const off = onDataChanged((detail) => {
      if (detail.projectId && detail.projectId !== projectId) return;
      if (detail.table && !WATCHED.has(detail.table)) return;
      window.clearTimeout(handle);
      handle = window.setTimeout(() => setTick((n) => n + 1), 400);
    });
    return () => { off(); window.clearTimeout(handle); };
  }, [projectId, disabled]);

  if (disabled) return { report: null, loading: false, error: null, refresh: () => undefined };
  // The last report stays on screen while the next one is built.
  return { report: result.report, loading: result.request !== request, error: result.error, refresh: () => setTick((n) => n + 1) };
}
