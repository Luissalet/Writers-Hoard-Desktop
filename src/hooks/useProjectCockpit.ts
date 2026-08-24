import { useCallback, useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import {
  loadProjectCockpit,
  type ProjectCockpitData,
} from '@/services/projectIntelligence';

export function useProjectCockpit(projectId: string) {
  const [state, setState] = useState<{
    projectId: string | null;
    data: ProjectCockpitData | null;
    error: Error | null;
  }>({ projectId: null, data: null, error: null });
  const [revision, setRevision] = useState(0);

  const retry = useCallback(() => {
    setState(current => current.projectId === projectId
      ? { ...current, error: null }
      : current);
    setRevision(value => value + 1);
  }, [projectId]);

  useEffect(() => {
    const subscription = liveQuery(() => loadProjectCockpit(projectId)).subscribe({
      next: value => {
        setState({ projectId, data: value, error: null });
      },
      error: reason => {
        setState({
          projectId,
          data: null,
          error: reason instanceof Error ? reason : new Error(String(reason)),
        });
      },
    });
    return () => subscription.unsubscribe();
  }, [projectId, revision]);

  const ownsCurrentProject = state.projectId === projectId;
  const data = ownsCurrentProject ? state.data : null;
  const error = ownsCurrentProject ? state.error : null;
  return { data, error, loading: !data && !error, retry };
}
