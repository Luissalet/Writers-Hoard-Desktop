// ============================================
// World Generator — generation lifecycle hook
// ============================================
// Owns the worker, progress state and the in-memory world cache. Worlds are
// regenerated from (seed, params) whenever they aren't cached — deterministic
// pipeline, so the result is identical every time.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorldData, WorldParams } from './core/types';
import { unpackWorld } from './core/types';
import type { WorkerReply } from './worldgen.worker';

/** Session-lifetime cache: worldId → { key, data }. */
const cache = new Map<string, { key: string; data: WorldData }>();

export function paramsKey(params: WorldParams): string {
  return JSON.stringify(params);
}

export function getCachedWorld(worldId: string, params: WorldParams): WorldData | null {
  const hit = cache.get(worldId);
  if (hit && hit.key === paramsKey(params)) return hit.data;
  return null;
}

export interface GenerationState {
  running: boolean;
  stage: string;
  progress: number; // 0..1
  error: string | null;
}

const IDLE: GenerationState = { running: false, stage: '', progress: 0, error: null };

export function useWorldGeneration(
  worldId: string,
  onDone?: (world: WorldData) => void,
): {
  world: WorldData | null;
  gen: GenerationState;
  generate: (params: WorldParams) => void;
  cancel: () => void;
} {
  const [world, setWorld] = useState<WorldData | null>(() => cache.get(worldId)?.data ?? null);
  const [gen, setGen] = useState<GenerationState>(IDLE);
  const workerRef = useRef<Worker | null>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  // World switch → reset synchronously during render (React's documented
  // "adjust state when props change" pattern; no effect, no extra paint).
  const [lastWorldId, setLastWorldId] = useState(worldId);
  if (worldId !== lastWorldId) {
    setLastWorldId(worldId);
    const hit = cache.get(worldId);
    setWorld(hit ? hit.data : null);
    setGen(IDLE);
  }

  // Kill any in-flight worker when the world changes or on unmount.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [worldId]);

  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setGen(IDLE);
  }, []);

  const generate = useCallback((params: WorldParams) => {
    // Cache hit → instant.
    const hit = getCachedWorld(worldId, params);
    if (hit) {
      setWorld(hit);
      setGen(IDLE);
      return;
    }
    workerRef.current?.terminate();
    const worker = new Worker(new URL('./worldgen.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    setGen({ running: true, stage: 'plates', progress: 0, error: null });

    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        setGen({ running: true, stage: msg.stage, progress: msg.overall, error: null });
      } else if (msg.type === 'done') {
        const data = unpackWorld(msg.world);
        cache.set(worldId, { key: paramsKey(params), data });
        setWorld(data);
        setGen(IDLE);
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        onDoneRef.current?.(data);
      } else {
        setGen({ running: false, stage: '', progress: 0, error: msg.message });
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      }
    };
    worker.onerror = (err) => {
      setGen({ running: false, stage: '', progress: 0, error: err.message || 'Worker error' });
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };

    worker.postMessage({ type: 'generate', params });
  }, [worldId]);

  return { world, gen, generate, cancel };
}
