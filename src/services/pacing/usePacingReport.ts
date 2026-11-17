import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import { buildPacingReport, type ProjectPacing } from './report';

/** Typing settles before the curve is rebuilt. */
const SETTLE_MS = 1500;

/** The project's pacing report, rebuilt when the manuscript or the outline beats change. */
export function usePacingReport(projectId: string, disabled = false): { report: ProjectPacing | null; loading: boolean; error: string | null } {
  const signature = useLiveQuery(async () => {
    if (disabled) return '';
    const [writings, beats] = await Promise.all([
      db.writings.where('projectId').equals(projectId).toArray(),
      db.outlineBeats.where('projectId').equals(projectId).toArray(),
    ]);
    return JSON.stringify([writings.map((w) => [w.id, w.updatedAt, w.chapter, w.title]), beats.map((b) => [b.id, b.updatedAt])]);
  }, [projectId, disabled]);
  const [result, setResult] = useState<{ key: string; report: ProjectPacing | null; error: string | null }>({ key: '', report: null, error: null });
  const key = `${projectId}|${signature ?? ''}`;

  useEffect(() => {
    if (disabled || signature === undefined) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      buildPacingReport(projectId).then(
        (report) => { if (alive) setResult({ key, report, error: null }); },
        (error: unknown) => { if (alive) setResult((prior) => ({ key, report: prior.report, error: error instanceof Error ? error.message : String(error) })); },
      );
    }, result.report ? SETTLE_MS : 0);
    return () => { alive = false; window.clearTimeout(timer); };
    // result.report only decides the first delay; a new report must not schedule another build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, disabled, signature, projectId]);

  return { report: result.report, loading: result.key !== key, error: result.error };
}
