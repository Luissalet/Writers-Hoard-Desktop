import { useState, useEffect, useCallback, useRef } from 'react';
import type { Project } from '@/types';
import * as ops from '@/db/operations';

// Same concurrency contract as `makeEntityHook` (src/engines/_shared):
//  - `loading` is true ONLY during the initial load, never on post-mutation
//    refreshes — so views gating on `loading` don't flash spinners (or
//    unmount modals) every time a project is renamed or recolored.
//  - A monotonic sequence token discards stale fetch results.
//  - A mounted ref prevents setState after unmount.

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const loadedOnceRef = useRef(false);
  const seqRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    if (!loadedOnceRef.current) setLoading(true);
    try {
      const data = await ops.getAllProjects();
      if (seq !== seqRef.current || !mountedRef.current) return;
      setProjects(data);
      loadedOnceRef.current = true;
    } catch (err) {
      console.error('[useProjects] fetch failed', err);
    } finally {
      if (seq === seqRef.current && mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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

  return { projects, loading, refresh, addProject, editProject, removeProject };
}

export function useProject(id: string | undefined) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const loadedIdRef = useRef<string | null>(null);
  const seqRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!id) {
      setProject(null);
      setLoading(false);
      loadedIdRef.current = null;
      return;
    }
    const seq = ++seqRef.current;
    if (loadedIdRef.current !== id) setLoading(true);
    try {
      const data = await ops.getProject(id);
      if (seq !== seqRef.current || !mountedRef.current) return;
      setProject(data || null);
      loadedIdRef.current = id;
    } catch (err) {
      console.error('[useProject] fetch failed', err);
    } finally {
      if (seq === seqRef.current && mountedRef.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { project, loading, refresh };
}
