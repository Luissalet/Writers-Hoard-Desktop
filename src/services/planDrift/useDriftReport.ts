import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import { buildDriftReport, type ProjectDrift } from './report';

/** Typing settles before the comparison is rebuilt. */
const SETTLE_MS = 1500;

/** The project's plan drift, rebuilt when chapters, beats, cards, seeds or story events change. */
export function useDriftReport(projectId: string, disabled = false): { report: ProjectDrift | null; loading: boolean; error: string | null } {
  const signature = useLiveQuery(async () => {
    if (disabled) return '';
    const [writings, beats, codex, seeds, payoffs, worlds] = await Promise.all([
      db.writings.where('projectId').equals(projectId).toArray(),
      db.outlineBeats.where('projectId').equals(projectId).toArray(),
      db.codexEntries.where('projectId').equals(projectId).toArray(),
      db.seeds.where('projectId').equals(projectId).toArray(),
      db.payoffs.where('projectId').equals(projectId).toArray(),
      db.generatedWorlds.where('projectId').equals(projectId).toArray(),
    ]);
    return JSON.stringify([writings, beats, codex, seeds, payoffs, worlds].map((rows) => rows.map((r) => [r.id, (r as { updatedAt?: number }).updatedAt])));
  }, [projectId, disabled]);
  const [result, setResult] = useState<{ key: string; report: ProjectDrift | null; error: string | null }>({ key: '', report: null, error: null });
  const key = `${projectId}|${signature ?? ''}`;

  useEffect(() => {
    if (disabled || signature === undefined) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      buildDriftReport(projectId).then(
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
