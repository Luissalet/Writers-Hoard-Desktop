import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import { buildPacingReport, type ProjectPacing } from './report';

/** Typing settles before the curve is rebuilt. */
const SETTLE_MS = 1500;

/** The project's pacing report, rebuilt when the manuscript or the outline beats change. */
export function usePacingReport(projectId: string, eraId: string | undefined, disabled = false): { report: ProjectPacing | null; loading: boolean; error: string | null } {
  const signature = useLiveQuery(async () => {
    if (disabled) return '';
    const [writings, outlines, beats, variants] = await Promise.all([
      db.writings.where('projectId').equals(projectId).toArray(),
      db.outlines.where('projectId').equals(projectId).toArray(),
      db.outlineBeats.where('projectId').equals(projectId).toArray(),
      eraId ? db.worldEraVariants.where('[projectId+eraId+kind]').equals([projectId, eraId, 'writings']).toArray() : [],
    ]);
    return JSON.stringify([
      writings.map((w) => [w.id, w.updatedAt, w.chapter, w.title, w.sceneTension]),
      outlines.map((o) => [o.id, o.kind]), beats.map((b) => [b.id, b.updatedAt]),
      variants.map((v) => [v.id, v.revision]),
    ]);
  }, [projectId, eraId, disabled]);
  const [result, setResult] = useState<{ scope: string; key: string; report: ProjectPacing | null; error: string | null }>({ scope: '', key: '', report: null, error: null });
  const scope = JSON.stringify([projectId, eraId]);
  const key = JSON.stringify([scope, signature]);
  const report = result.scope === scope ? result.report : null;

  useEffect(() => {
    if (disabled || signature === undefined) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      buildPacingReport(projectId, undefined, eraId).then(
        (report) => { if (alive) setResult({ scope, key, report, error: null }); },
        (error: unknown) => {
          if (alive) setResult((prior) => ({ scope, key, report: prior.scope === scope ? prior.report : null, error: error instanceof Error ? error.message : String(error) }));
        },
      );
    }, report ? SETTLE_MS : 0);
    return () => { alive = false; window.clearTimeout(timer); };
    // report only decides the first delay; a new report must not schedule another build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, scope, disabled, signature, projectId, eraId]);

  return { report, loading: result.key !== key, error: result.scope === scope ? result.error : null };
}
