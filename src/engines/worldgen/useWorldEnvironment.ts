import { useWorldEraScope } from '@/services/worldEras/hooks';
import { useCallback, useEffect, useEffectEvent, useRef, useState, type RefObject } from 'react';
import type { WorldData } from './core/types';
import type { GeneratedWorld } from './types';
import { PaintSession } from './core/paintSession';
import { deserializeEdits, serializeEdits } from './core/edits';
import { preparePaintReplay, requestWorldRecalculation } from './recalculationClient';
import { commitWorldRecalculation, prepareWorldRecalculation, WorldRecipeConflict } from './recipe';
import type { createWorldEditWriter } from './editWriter';
import { packWorld, unpackWorld } from './core/types';
import { appendDomainEdits, domainBounds, readDomainDocument, serializeDomainDocument } from './core/domainDocument';
import { prepareWorldDomain } from './domainPreparationClient';
import { captureWorldDomainHistory, commitWorldDomainHistory, WorldDomainError, type WorldDomainHistoryExpectation } from './worldDomain';
import { applyWorldScaleMetadata } from './core/geoScale';

async function prepareSerializedReplay(data: WorldData, json: string, revision: number, options: { signal: AbortSignal; onProgress: (stage: string, progress: number) => void }, source?: () => WorldData) {
  const document = json ? readDomainDocument(json) : null;
  if (!document) { await preparePaintReplay(data, deserializeEdits(json), options, source); return undefined; }
  const pristine = source?.() ?? data;
  const prepared = await prepareWorldDomain({ type: 'replay', params: pristine.params, pristine: packWorld(pristine).transfer, legacy: json, revision }, options.signal, options.onProgress);
  return unpackWorld(prepared.world);
}

export interface EnvironmentJob { kind: 'open' | 'recalculate' | 'history'; stage: string; progress: number; committing?: boolean }

/** Environment work never publishes a partial world or blocks a pointer stroke. */
export function useWorldEnvironment({ data, record, session, sessionWorld, savedEdits, writer, restorePristine, onReady }: {
  data: WorldData | null; record: GeneratedWorld;
  session: RefObject<PaintSession | null>; sessionWorld: RefObject<WorldData | null>;
  savedEdits: RefObject<string | undefined>; writer: ReturnType<typeof createWorldEditWriter>;
  restorePristine: (world: WorldData) => void; onReady: () => void;
}) {
  const scope = useWorldEraScope(record.projectId);
  const [job, setJob] = useState<EnvironmentJob | null>(null);
  const [error, setError] = useState<'work' | 'save' | 'conflict' | null>(null);
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const active = useRef<{ controller: AbortController; committing: boolean; kind: EnvironmentJob['kind'] } | null>(null);
  const seenIncoming = useRef(record.edits);
  const pendingIncoming = useRef<{ value: string | undefined; blocked: boolean } | null>(null);
  const historyBaseline = useRef<WorldDomainHistoryExpectation | null>(null);
  const readyEvent = useEffectEvent(onReady);
  const recordEvent = useEffectEvent(() => record);
  const eraEvent = useEffectEvent(() => scope.eraId);
  const start = (kind: EnvironmentJob['kind']) => {
    const controller = new AbortController();
    const task = { controller, committing: false, kind };
    active.current = task; setError(null); setJob({ kind, stage: '', progress: 0 });
    return { task, signal: controller.signal, onProgress: (stage: string, progress: number) => {
      if (!controller.signal.aborted) setJob({ kind, stage, progress });
    } };
  };
  const finish = (signal: AbortSignal) => {
    if (active.current?.controller.signal !== signal) return;
    active.current = null; setJob(null);
  };

  useEffect(() => {
    session.current = null; sessionWorld.current = null; setReady(false);
    if (!data) return;
    restorePristine(data);
    const options = start('open');
    void (async () => {
      try {
        const snapshot = recordEvent(), eraId = eraEvent();
        const desired = pendingIncoming.current;
        const source = desired ? desired.value : savedEdits.current;
        const edits = source ? deserializeEdits(source) : [];
        const baseline = readDomainDocument(source ?? '') ? await captureWorldDomainHistory({ projectId: snapshot.projectId, eraId }, snapshot) : null;
        const prepared = await prepareSerializedReplay(data, source ?? '', snapshot.domainRevision ?? 0, options);
        if (options.signal.aborted) return;
        session.current = new PaintSession(data);
        if (prepared) session.current.load(source ?? '', snapshot.domainRevision ?? 0, prepared); else session.current.load(serializeEdits(edits));
        sessionWorld.current = data;
        applyWorldScaleMetadata(data, snapshot); historyBaseline.current = baseline;
        if (desired) {
          savedEdits.current = source;
          if (pendingIncoming.current === desired) pendingIncoming.current = null;
        }
        setReady(true); readyEvent();
      } catch {
        if (!options.signal.aborted) setError('work');
      } finally { finish(options.signal); }
    })();
    return () => { active.current?.controller.abort(); active.current = null; };
  }, [data, record.id, scope.eraId, restorePristine, retry, session, sessionWorld, savedEdits]);

  // Incoming edits can contain checkpoints created in another view. Prepare those
  // in a worker before loading them; an error leaves the last valid world visible.
  useEffect(() => {
    if (seenIncoming.current !== record.edits) {
      seenIncoming.current = record.edits;
      if (!writer.isSupersededEcho(record.edits)) pendingIncoming.current = { value: record.edits, blocked: false };
    }
    const current = session.current;
    if (!ready || !data || !current || active.current || !pendingIncoming.current || pendingIncoming.current.blocked) return;
    const desired = pendingIncoming.current;
    const incoming = desired.value;
    if (incoming === savedEdits.current || writer.isSupersededEcho(incoming)) { pendingIncoming.current = null; return; }
    const options = start('history');
    void (async () => {
      try {
        const snapshot = recordEvent(), eraId = eraEvent();
        const baseline = readDomainDocument(incoming ?? '') ? await captureWorldDomainHistory({ projectId: snapshot.projectId, eraId }, snapshot) : null;
        const prepared = await prepareSerializedReplay(data, incoming ?? '', snapshot.domainRevision ?? 0, options, () => current.pristineWorld);
        if (options.signal.aborted || session.current !== current) return;
        current.load(incoming ?? '', snapshot.domainRevision ?? 0, prepared); savedEdits.current = incoming;
        applyWorldScaleMetadata(data, snapshot); historyBaseline.current = baseline;
        if (pendingIncoming.current === desired) pendingIncoming.current = null;
        readyEvent();
      } catch { if (!options.signal.aborted) { desired.blocked = true; setReady(false); setError('work'); } }
      finally { finish(options.signal); }
    })();
  }, [record.edits, scope.eraId, ready, data, session, savedEdits, writer, job]);

  const recalculate = async () => {
    const current = session.current;
    if (!data || !current || !ready || active.current) return false;
    const revision = data.revision ?? 0;
    const options = start('recalculate');
    try {
      if (!await writer.flush()) { setError('save'); return false; }
      const base = await prepareWorldRecalculation(record.id, record.projectId, scope.eraId);
      const document = base.edits ? readDomainDocument(base.edits) : null;
      const saved = document ? serializeDomainDocument(document) : serializeEdits(base.edits ? deserializeEdits(base.edits) : []);
      if (saved !== current.serialize() || JSON.stringify(base.params) !== JSON.stringify(record.params)) throw new WorldRecipeConflict();
      const fields = await requestWorldRecalculation(data, options);
      if (options.signal.aborted || session.current !== current || (data.revision ?? 0) !== revision) return false;
      const json = document ? serializeDomainDocument(appendDomainEdits(document, [{ kind: 'recalculate', version: 1 }])) : serializeEdits([...current.edits, { kind: 'recalculate', version: 1 }]);
      options.task.committing = true; setJob({ kind: 'recalculate', stage: 'saving', progress: 1, committing: true });
      await commitWorldRecalculation(base, json, scope.eraId);
      savedEdits.current = json;
      if (options.signal.aborted || session.current !== current) return false;
      if (!current.pushRecalculation(fields, revision, true)) throw new WorldRecipeConflict();
      return true;
    } catch (cause) {
      if (!options.signal.aborted) setError(cause instanceof WorldRecipeConflict ? 'conflict' : options.task.committing ? 'save' : 'work');
      return false;
    } finally { finish(options.signal); }
  };

  const history = async (action: 'undo' | 'redo' | 'clear') => {
    const current = session.current;
    if (!data || !current || !ready || active.current) return false;
    const json = current.historySerialized(action), previous = current.serialize();
    const expected = historyBaseline.current;
    const options = start('history');
    try {
      const priorDoc = readDomainDocument(previous), nextDoc = readDomainDocument(json);
      const geometric = priorDoc && nextDoc && JSON.stringify(domainBounds(priorDoc)) !== JSON.stringify(domainBounds(nextDoc));
      const prepared = await prepareSerializedReplay(data, json, (expected?.domainRevision ?? record.domainRevision ?? 0) + (geometric ? 1 : 0), options, () => current.pristineWorld);
      if (options.signal.aborted || session.current !== current) return false;
      if (geometric) {
        if (!expected) throw new WorldRecipeConflict();
        if (!await writer.flush()) { setError('save'); return false; }
        options.task.committing = true; setJob({ kind: 'history', stage: 'saving', progress: 1, committing: true });
        const context = { projectId: record.projectId, eraId: scope.eraId };
        const row = await commitWorldDomainHistory(context, record.id, previous, json, expected);
        current[action](prepared); applyWorldScaleMetadata(data, row); if (data.domain) data.domain.revision = row.domainRevision ?? 0;
        historyBaseline.current = await captureWorldDomainHistory(context, row);
        savedEdits.current = json; writer.acknowledge(json);
      } else current[action](prepared);
      return true;
    } catch (cause) { if (!options.signal.aborted) setError(cause instanceof WorldDomainError && cause.code === 'conflict' ? 'conflict' : 'work'); return false; }
    finally { finish(options.signal); }
  };
  const cancel = useCallback(() => {
    if (!active.current || active.current.committing) return;
    if (active.current.kind === 'history' && pendingIncoming.current) { pendingIncoming.current.blocked = true; setReady(false); }
    active.current.controller.abort(); active.current = null; setJob(null);
  }, []);
  return { job, error, ready, recalculate, history, cancel, retry: () => { if (pendingIncoming.current) pendingIncoming.current.blocked = false; setRetry(value => value + 1); }, busy: !!job, busyRef: active };
}
