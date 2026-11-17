import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import { buildVoiceReport, type VoiceReport } from './report';

/** Typing settles before the profiles are rebuilt. */
const SETTLE_MS = 1500;

/** The project's voice report, rebuilt when the manuscript, cards or dialog blocks change. */
export function useVoiceReport(projectId: string, disabled = false): { report: VoiceReport | null; loading: boolean; error: string | null } {
  const signature = useLiveQuery(async () => {
    if (disabled) return '';
    const [writings, codex, blocks] = await Promise.all([
      db.writings.where('projectId').equals(projectId).toArray(),
      db.codexEntries.where('projectId').equals(projectId).toArray(),
      db.dialogBlocks.where('projectId').equals(projectId).toArray(),
    ]);
    return JSON.stringify([
      writings.map((w) => [w.id, w.updatedAt, w.chapter, w.title]),
      codex.filter((c) => c.type === 'character').map((c) => [c.id, c.title, c.updatedAt]),
      blocks.map((b) => [b.id, b.updatedAt]),
    ]);
  }, [projectId, disabled]);
  const [result, setResult] = useState<{ key: string; report: VoiceReport | null; error: string | null }>({ key: '', report: null, error: null });
  const key = `${projectId}|${signature ?? ''}`;

  useEffect(() => {
    if (disabled || signature === undefined) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      buildVoiceReport(projectId).then(
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
