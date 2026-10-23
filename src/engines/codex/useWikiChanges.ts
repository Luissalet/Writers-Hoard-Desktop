import { useEffect, useState } from 'react';
import type { WikiProfile } from '@/services/wikiProfiles/types';
import { wikiProfileChanges, type WikiProfileChanges } from '@/services/wikiProfiles/changes';

/**
 * "Changes since the last edition" for the saved profile. It runs when the export section is
 * opened, when the saved profile or its editions change (save, publish) and when asked again; it
 * never follows the draft being typed or the card being edited, because the comparison renders the
 * wiki. Without an edition there is nothing to compare, so it stays idle.
 */
export function useWikiChanges(projectId: string, profile: WikiProfile | undefined, enabled: boolean) {
  const profileId = profile?.id, editions = profile?.editions?.length ?? 0, revision = profile?.revision ?? 0;
  const [tick, setTick] = useState(0), [state, setState] = useState<{ key: string; result?: WikiProfileChanges; error?: string }>({ key: '' });
  const wanted = enabled && profileId && editions > 0 ? `${projectId}:${profileId}:${revision}:${editions}:${tick}` : '';
  useEffect(() => {
    if (!wanted || !profileId) return;
    let live = true;
    wikiProfileChanges(projectId, profileId).then(result => { if (live) setState({ key: wanted, result }); }, error => { if (live) setState({ key: wanted, error: error instanceof Error ? error.message : String(error) }); });
    return () => { live = false; };
  }, [wanted, projectId, profileId]);
  const fresh = !!wanted && state.key === wanted;
  return { result: fresh ? state.result : undefined, error: fresh ? state.error : undefined, loading: !!wanted && !fresh, refresh: () => setTick(value => value + 1) };
}
