import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useWorldEraScope } from '@/services/worldEras/hooks';
import { readVoiceInputs, summarizeVoice, type VoiceReport } from './report';

/** Typing settles before the profiles are rebuilt. */
const SETTLE_MS = 1500;

/** The project's voice report, rebuilt when the manuscript, cards or dialog blocks change. */
export function useVoiceReport(projectId: string, disabled = false): { report: VoiceReport | null; loading: boolean; error: string | null } {
  const { eraId } = useWorldEraScope(projectId);
  const key = JSON.stringify([projectId, eraId]);
  const snapshot = useLiveQuery(async () => {
    if (disabled) return null;
    try { return { key, inputs: await readVoiceInputs(projectId, eraId), error: null }; }
    catch (error) { return { key, inputs: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [key, projectId, eraId, disabled]);
  const [result, setResult] = useState<{ snapshot: typeof snapshot; report: VoiceReport | null; error: string | null }>();

  useEffect(() => {
    if (disabled || !snapshot || snapshot.key !== key) return;
    const timer = window.setTimeout(() => {
      try { setResult({ snapshot, report: snapshot.inputs ? summarizeVoice(snapshot.inputs) : null, error: snapshot.error }); }
      catch (error) { setResult({ snapshot, report: null, error: error instanceof Error ? error.message : String(error) }); }
    }, result?.snapshot?.key === key ? SETTLE_MS : 0);
    return () => window.clearTimeout(timer);
    // The previous report only sets the delay; a new report must not schedule another build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, disabled, snapshot]);

  return result?.snapshot?.key === key
    ? { report: result.report, loading: result.snapshot !== snapshot, error: result.error }
    : { report: null, loading: !disabled, error: null };
}
