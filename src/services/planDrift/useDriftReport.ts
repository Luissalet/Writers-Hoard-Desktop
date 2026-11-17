import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import { buildDriftReport, type ProjectDrift } from './report';

/** Typing settles before the comparison is rebuilt. */
const SETTLE_MS = 1500;

/** The project's plan drift, rebuilt when chapters, beats, cards, seeds or story events change. */
export function useDriftReport(projectId: string, disabled = false, eraId?: string): { report: ProjectDrift | null; loading: boolean; error: string | null } {
  const signature = useLiveQuery(async () => {
    if (disabled) return '';
    const [writings, outlines, beats, codex, seeds, payoffs, worlds, variants] = await Promise.all([
      db.writings.where('projectId').equals(projectId).toArray(),
      db.outlines.where('projectId').equals(projectId).toArray(),
      db.outlineBeats.where('projectId').equals(projectId).toArray(),
      db.codexEntries.where('projectId').equals(projectId).toArray(),
      db.seeds.where('projectId').equals(projectId).toArray(),
      db.payoffs.where('projectId').equals(projectId).toArray(),
      db.generatedWorlds.where('projectId').equals(projectId).toArray(),
      eraId ? db.worldEraVariants.where('[projectId+eraId+kind]').anyOf(
        ['writings', 'codex', 'worldgen'].map((kind) => [projectId, eraId, kind]),
      ).toArray() : [],
    ]);
    return JSON.stringify([writings, outlines, beats, codex, seeds, payoffs, worlds, variants].map((rows) => rows.map((r) => [r.id, (r as { updatedAt?: number }).updatedAt])));
  }, [projectId, disabled, eraId]);
  const [result, setResult] = useState<{ scopeKey: string; key: string; report: ProjectDrift | null; error: string | null }>({ scopeKey: '', key: '', report: null, error: null });
  const scopeKey = JSON.stringify([projectId, eraId]);
  const key = `${scopeKey}|${signature ?? ''}`;
  const report = result.scopeKey === scopeKey ? result.report : null;

  useEffect(() => {
    if (disabled || signature === undefined) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      buildDriftReport(projectId, undefined, eraId).then(
        (report) => { if (alive) setResult({ scopeKey, key, report, error: null }); },
        (error: unknown) => { if (alive) setResult((prior) => ({ scopeKey, key, report: prior.scopeKey === scopeKey ? prior.report : null, error: error instanceof Error ? error.message : String(error) })); },
      );
    }, report ? SETTLE_MS : 0);
    return () => { alive = false; window.clearTimeout(timer); };
    // report only decides the first delay; a new report must not schedule another build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, scopeKey, disabled, signature, projectId, eraId]);

  return { report, loading: result.key !== key, error: result.scopeKey === scopeKey ? result.error : null };
}
