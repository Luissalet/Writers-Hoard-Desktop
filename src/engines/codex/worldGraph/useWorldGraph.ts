import { useEffect, useState } from 'react';
import { buildWorldGraph } from './model';
import type { WorldGraph, WorldGraphInput } from './types';

interface Result { input: WorldGraphInput; graph?: WorldGraph; error?: string }

/** Each analysis owns its worker and cancellation; the editor never mutates card content. */
export function useWorldGraph(input: WorldGraphInput) {
  const [result, setResult] = useState<Result | null>(null);
  const [revision, setRevision] = useState(0);
  const { projectId, entries, relationships, referenceLabels, contentReferenceLabels } = input;
  useEffect(() => {
    let alive = true, worker: Worker | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Avatars can be megabytes each; they do not belong on the analysis transport.
    const payload = { projectId, relationships, referenceLabels, contentReferenceLabels, entries: entries.map(entry => { const copy = { ...entry }; delete copy.avatar; delete copy.avatarOriginal; return copy; }) };
    const owner: WorldGraphInput = { projectId, entries, relationships, referenceLabels, contentReferenceLabels };
    const publish = (graph?: WorldGraph, error?: string) => { if (alive) setResult({ input: owner, graph, error }); };
    const fallback = () => {
      worker?.terminate(); worker = null;
      if (timer !== null) return;
      timer = setTimeout(() => { if (!alive) return; try { publish(buildWorldGraph(payload)); } catch (error) { publish(undefined, String(error)); } }, 0);
    };
    if (typeof Worker === 'undefined') fallback();
    else {
      try {
        worker = new Worker(new URL('./worldGraph.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<{ graph?: WorldGraph; error?: string }>) => { publish(event.data.graph, event.data.error); worker?.terminate(); worker = null; };
        worker.onerror = event => { event.preventDefault(); fallback(); };
        worker.postMessage(payload);
      } catch { fallback(); }
    }
    return () => { alive = false; worker?.terminate(); if (timer !== null) clearTimeout(timer); };
  }, [projectId, entries, relationships, referenceLabels, contentReferenceLabels, revision]);
  const graph = result?.input.projectId === projectId ? result.graph : undefined;
  const indexing = !result || result.input.projectId !== projectId || result.input.entries !== entries || result.input.relationships !== relationships || result.input.referenceLabels !== referenceLabels || result.input.contentReferenceLabels !== contentReferenceLabels;
  return { graph, indexing, error: result?.input.projectId === projectId ? result.error : undefined, retry: () => { setResult(null); setRevision(value => value + 1); } };
}
