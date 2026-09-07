import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import type { Project } from '@/types';
import * as ops from '@/db/operations';

// Same concurrency contract as `makeEntityHook` (src/engines/_shared):
//  - `loading` is true ONLY during the initial load, never on post-mutation
//    refreshes — so views gating on `loading` don't flash spinners (or
//    unmount modals) every time a project is renamed or recolored.
//  - A monotonic sequence token discards stale fetch results.
//  - A mounted ref prevents setState after unmount.
//
// And one thing that is NOT that contract: both hooks also re-read whenever any
// project row is written, from anywhere. Several components hold their own copy
// of the same project (the sidebar and the project page, for two), and without
// this a save in one of them left the others showing the row as it was until
// they happened to remount. See `notifyProjectsChanged` in db/operations.

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadedOnceRef = useRef(false);
  const seqRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      seqRef.current += 1;
    };
  }, []);

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    if (!loadedOnceRef.current) setLoading(true);
    setError(null);
    try {
      const data = await ops.getAllProjects();
      if (seq !== seqRef.current || !mountedRef.current) return;
      setProjects(data);
      loadedOnceRef.current = true;
    } catch (err) {
      console.error('[useProjects] fetch failed', err);
      if (seq === seqRef.current && mountedRef.current) setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (seq === seqRef.current && mountedRef.current) setLoading(false);
    }
  }, []);

  const version = useSyncExternalStore(ops.subscribeProjects, ops.getProjectsVersion);
  useEffect(() => {
    refresh();
  }, [refresh, version]);

  const addProject = useCallback(async (project: Project) => {
    await ops.createProject(project);
    await refresh();
  }, [refresh]);

  const editProject = useCallback(async (id: string, changes: Partial<Project>) => {
    await ops.updateProject(id, changes);
    await refresh();
  }, [refresh]);

  const removeProject = useCallback(async (id: string) => {
    await ops.deleteProject(id);
    await refresh();
  }, [refresh]);

  return { projects, loading, error, refresh, addProject, editProject, removeProject };
}

export function useProject(id: string | undefined) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadedIdRef = useRef<string | null>(null);
  const requestedIdRef = useRef<string | undefined>(undefined);
  const errorIdRef = useRef<string | undefined>(undefined);
  const currentIdRef = useRef(id);
  currentIdRef.current = id;
  const seqRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      seqRef.current += 1;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!mountedRef.current || currentIdRef.current !== id) return;
    const seq = ++seqRef.current;
    requestedIdRef.current = id;
    setError(null);
    if (!id) {
      setProject(null);
      setLoading(false);
      loadedIdRef.current = null;
      return;
    }
    if (loadedIdRef.current !== id) setLoading(true);
    try {
      const data = await ops.getProject(id);
      if (seq !== seqRef.current || !mountedRef.current) return;
      setProject(data || null);
      loadedIdRef.current = id;
    } catch (err) {
      console.error('[useProject] fetch failed', err);
      if (seq === seqRef.current && mountedRef.current) {
        errorIdRef.current = id;
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (seq === seqRef.current && mountedRef.current) setLoading(false);
    }
  }, [id]);

  const version = useSyncExternalStore(ops.subscribeProjects, ops.getProjectsVersion);
  useEffect(() => {
    refresh();
  }, [refresh, version]);

  const ownsPublishedProject = Boolean(id) && loadedIdRef.current === id;
  return {
    project: ownsPublishedProject ? project : null,
    loading: Boolean(id) && requestedIdRef.current !== id ? true : loading,
    error: id && errorIdRef.current === id ? error : null,
    refresh,
  };
}
