import { act, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { PaintSession } from '@/engines/worldgen/core/paintSession';
import { applyEdits, serializeEdits } from '@/engines/worldgen/core/edits';
import { captureEnvironment, recalculateEnvironment, restoreEnvironment, worldRecalculationCheckpoints } from '@/engines/worldgen/core/recalculate';
import type { RecalculationRequest } from '@/engines/worldgen/recalculation.worker';
import { useWorldEnvironment } from '@/engines/worldgen/useWorldEnvironment';
import { createWorldEditWriter } from '@/engines/worldgen/editWriter';
import { relevantEditsForSheets } from '@/engines/worldgen/canonSnapshots';
import { tileGeometry } from '@/engines/worldgen/region/tiles';
import type { GeneratedWorld } from '@/engines/worldgen/types';

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
export async function testWorldEnvironment(): Promise<string[]> {
  const id = `environment-${Date.now()}`;
  const data = generateWorld({ ...DEFAULT_PARAMS, width: 64, seed: id, erosion: 0 });
  const original = { environment: captureEnvironment(data), elevation: data.elevation.slice() };
  let record: GeneratedWorld = { id, projectId: id, title: 'Environmental edits', params: data.params, edits: serializeEdits([]), createdAt: 1, updatedAt: 1 };
  const element = document.createElement('div'); document.body.append(element);
  let root = createRoot(element);
  let api!: ReturnType<typeof useWorldEnvironment>;
  let paint!: PaintSession;
  let saveRef!: { current: string | undefined };
  let writerRef!: ReturnType<typeof createWorldEditWriter>;
  let saveGate: (edits: string) => Promise<void> = async () => {};
  const restore = () => { data.elevation.set(original.elevation); restoreEnvironment(data, original.environment); };
  function Harness() {
    const session = useRef<PaintSession | null>(null), sessionWorld = useRef<typeof data | null>(null), savedEdits = useRef(record.edits);
    const writer = useMemo(() => createWorldEditWriter(id, async edits => { await saveGate(edits); await db.generatedWorlds.update(id, { edits }); }), []);
    writerRef = writer;
    api = useWorldEnvironment({ data, record, session, sessionWorld, savedEdits, writer, restorePristine: restore, onReady: () => { paint = session.current!; } });
    saveRef = savedEdits;
    return <span>{api.ready ? 'ready' : 'opening'}</span>;
  }
  const jobs: (() => void)[] = [];
  const NativeWorker = globalThis.Worker;
  let workerFailure = false;
  class WorkerMock {
    onmessage: ((event: MessageEvent) => void) | null = null; onerror = null; dead = false;
    terminate() { this.dead = true; }
    postMessage(message: RecalculationRequest) {
      const request = structuredClone(message);
      jobs.push(() => {
        if (this.dead) return;
        if (workerFailure) { this.onmessage?.({ data: { type: 'error', message: 'Injected worker failure' } } as MessageEvent); return; }
        if (request.type === 'derive') this.onmessage?.({ data: { type: 'done', environment: recalculateEnvironment(request.world) } } as MessageEvent);
        else { applyEdits(request.world, request.edits); this.onmessage?.({ data: { type: 'done', checkpoints: worldRecalculationCheckpoints(request.world) } } as MessageEvent); }
      });
    }
  }
  globalThis.Worker = WorkerMock as unknown as typeof Worker;
  const settle = async () => { await new Promise(resolve => setTimeout(resolve, 30)); };
  const render = async () => { await act(async () => { root.render(<Harness />); await settle(); }); };
  const runWorker = async () => { await act(async () => { jobs.splice(0).forEach(job => job()); await settle(); }); };
  const signature = () => JSON.stringify(captureEnvironment(data));
  const fail = () => { throw new Error('disk full'); };
  try {
    await db.generatedWorlds.put(record); await render();
    const remoteStroke = { kind: 'terrain' as const, op: 'raise' as const, stroke: { pts: [{ x: 32, y: 16 }], radius: 1, strength: 1 } };
    const sheet = tileGeometry(data, { tx: 0, ty: 0 });
    const localOnly = relevantEditsForSheets(data, [sheet], serializeEdits([remoteStroke]));
    const globalClimate = relevantEditsForSheets(data, [sheet], serializeEdits([remoteStroke, { kind: 'recalculate', version: 1 }]));
    assert(localOnly.length === 0 && globalClimate.length === 2, 'Regional cache ignored distant terrain affecting recalculated climate');
    assert(api.ready && paint, 'Opening did not create a usable edit session');
    const before = signature();
    let pending!: Promise<boolean>;
    await act(async () => { pending = api.recalculate(); await settle(); });
    assert(api.busy && jobs.length === 1, 'Recalculation did not leave rendering thread');
    await act(async () => { api.cancel(); await pending; }); await runWorker();
    assert(signature() === before && paint.edits.length === 0 && (await db.generatedWorlds.get(id))?.edits === record.edits, 'Cancelled result mutated world or history');

    db.generatedWorlds.hook('updating', fail);
    await act(async () => { pending = api.recalculate(); await settle(); }); await runWorker();
    await act(async () => { await pending; });
    assert(api.error === 'save' && signature() === before && paint.edits.length === 0, 'Failed commit published the environment');
    db.generatedWorlds.hook('updating').unsubscribe(fail);
    await act(async () => { pending = api.recalculate(); await settle(); }); await runWorker();
    await act(async () => { assert(await pending, 'Successful retry did not adopt result'); });
    const adopted = signature();
    assert(paint.edits.at(-1)?.kind === 'recalculate' && (await db.generatedWorlds.get(id))?.edits === saveRef.current, 'Checkpoint was not persisted before adopting');
    record = (await db.generatedWorlds.get(id))!; await render();
    assert(signature() === adopted && paint.edits.length === 1, 'Parent refresh reapplied or erased the checkpoint');
    await act(async () => { assert(await api.history('undo'), 'Undo failed'); });
    assert(signature() === before, 'Undo did not restore full original environment');
    await act(async () => { assert(await api.history('redo'), 'Redo failed'); });
    assert(signature() === adopted, 'Redo changed cached environment');

    await act(async () => { pending = api.recalculate(); await settle(); });
    await db.generatedWorlds.update(id, { edits: serializeEdits([{ kind: 'label', x: 2, y: 2, text: 'External intent' }]) });
    await runWorker(); await act(async () => { await pending; });
    assert(api.error === 'conflict' && signature() === adopted && paint.edits.length === 1, 'Concurrent authored changes were overwritten');

    record = { ...record, edits: saveRef.current }; await db.generatedWorlds.put(record);
    await act(async () => root.unmount()); root = createRoot(element);
    await render(); await runWorker();
    assert(api.ready && signature() === adopted, 'Reopening did not restore the checkpoint exactly');

    // The older local write can echo while the next stroke is still waiting for disk.
    record = { ...record, edits: serializeEdits([]) }; await db.generatedWorlds.put(record); await render();
    let releaseA!: () => void, releaseB!: () => void;
    const gateA = new Promise<void>(resolve => { releaseA = resolve; }), gateB = new Promise<void>(resolve => { releaseB = resolve; });
    paint.push({ kind: 'label', x: 2, y: 2, text: 'Local A' });
    const localA = paint.serialize();
    saveRef.current = localA;
    saveGate = edits => edits === localA ? gateA : gateB;
    writerRef.schedule(localA);
    const writes = writerRef.flush(); await settle();
    paint.push({ kind: 'label', x: 3, y: 3, text: 'Local B' });
    const localB = paint.serialize(); saveRef.current = localB; writerRef.schedule(localB);
    releaseA(); await settle();
    record = { ...record, edits: localA }; await render();
    assert(paint.serialize() === localB && saveRef.current === localB, 'Older write echo replaced a newer pending stroke');
    releaseB(); assert(await writes, 'Writer did not drain the newest stroke'); saveGate = async () => {};
    record = { ...record, edits: localB }; await render();
    record = { ...record, edits: localA }; await db.generatedWorlds.put(record); await render();
    assert(paint.serialize() === localA, 'Echo suppression incorrectly ignored a later intentional external undo');

    record = { ...record, edits: undefined }; await db.generatedWorlds.put(record); await render();
    assert(paint.edits.length === 0 && saveRef.current === undefined, 'External empty history was confused with no pending update');
    const incoming = serializeEdits([remoteStroke, { kind: 'recalculate', version: 1 }]);
    record = { ...record, edits: incoming }; await db.generatedWorlds.put(record); await render();
    assert(jobs.length === 1, 'Incoming checkpoint did not prepare in worker');
    workerFailure = true; await runWorker();
    assert(api.error === 'work' && !api.ready && jobs.length === 0 && paint.edits.length === 0, 'Failed external replay was discarded, looped, or allowed painting stale history');
    await render(); assert(jobs.length === 0, 'Rendering automatically retried a failed external replay');
    workerFailure = false;
    await act(async () => { api.retry(); await settle(); }); await runWorker();
    assert(api.ready && paint.serialize() === incoming && saveRef.current === incoming, 'Retry restored old local history instead of the desired external checkpoint');

    const nextIncoming = serializeEdits([remoteStroke, { kind: 'label', x: 4, y: 4, text: 'Keep after cancellation' }, { kind: 'recalculate', version: 1 }]);
    record = { ...record, edits: nextIncoming }; await db.generatedWorlds.put(record); await render();
    await act(async () => { api.cancel(); await settle(); }); await runWorker();
    assert(!api.ready && !api.busy && jobs.length === 0 && paint.serialize() === incoming, 'Cancelling incoming replay restarted work or mutated displayed history');
    await render(); assert(jobs.length === 0, 'Cancelled external replay restarted itself on render');
    await act(async () => { api.retry(); await settle(); }); await runWorker();
    assert(api.ready && paint.serialize() === nextIncoming, 'Explicit retry lost cancelled external intent');
    return ['Environment UI: cancellation and failed storage preserve displayed world and edit history', 'Environment UI: retry commits before adoption; refresh and undo/redo retain exact fields', 'Environment UI: concurrent edits reject stale results and reopening prepares saved checkpoints', 'Environment UI: old write echoes preserve newer local strokes; later external undo still applies', 'Environment UI: empty external history clears edits; failed incoming replay preserves desired retry and blocks stale painting', 'Environment UI: cancelled incoming replay stays cancelled until explicit retry'];
  } finally {
    db.generatedWorlds.hook('updating').unsubscribe(fail);
    await act(async () => root.unmount()); element.remove(); globalThis.Worker = NativeWorker; await db.generatedWorlds.delete(id);
  }
}
