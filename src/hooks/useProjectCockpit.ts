import { useCallback, useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import {
  loadProjectCockpit,
  type ProjectCockpitData,
} from '@/services/projectIntelligence';

export function useProjectCockpit(projectId: string) {
  const [data, setData] = useState<ProjectCockpitData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [revision, setRevision] = useState(0);

  const retry = useCallback(() => {
    setError(null);
    setRevision(value => value + 1);
  }, []);

  useEffect(() => {
    const subscription = liveQuery(() => loadProjectCockpit(projectId)).subscribe({
      next: value => {
        setData(value);
        setError(null);
      },
      error: reason => {
        setError(reason instanceof Error ? reason : new Error(String(reason)));
      },
    });
    return () => subscription.unsubscribe();
  }, [projectId, revision]);

  return { data, error, loading: !data && !error, retry };
}
