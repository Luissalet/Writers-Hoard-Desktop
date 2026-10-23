import { useCallback, useEffect, useState } from 'react';
import type { EraDocumentKind, LocalToolClient, LocalToolJson, LocalToolWorldRead } from './sdk';

export type LocalToolWorldClient = Pick<LocalToolClient<LocalToolJson>, 'projectId' | 'eraId' | 'world' | 'subscribe'>;
/** Reads through the public scoped client; a new binding never exposes the old binding's rows. */
function useWorldQuery(client: LocalToolWorldClient, kind: EraDocumentKind, id?: string) {
  const key = JSON.stringify([client.projectId, client.eraId ?? null, kind, id ?? null]);
  const [retryVersion, setRetryVersion] = useState(0);
  const retry = useCallback(() => setRetryVersion(value => value + 1), []);
  const [result, setResult] = useState<{ client: LocalToolWorldClient; key: string; rows: LocalToolWorldRead[]; loading: boolean; error: string }>();
  useEffect(() => {
    let active = true, sequence = 0;
    const refresh = () => {
      if (!active) return;
      const request = ++sequence;
      setResult(previous => ({ client, key, rows: previous?.client === client && previous.key === key ? previous.rows : [], loading: true, error: '' }));
      void Promise.resolve().then(() => id === undefined ? client.world.list(kind) : client.world.read(kind, id).then(document => document ? [document] : [])).then(rows => {
        if (active && request === sequence) setResult({ client, key, rows, loading: false, error: '' });
      }).catch(reason => {
        if (active && request === sequence) setResult({ client, key, rows: [], loading: false, error: String(reason) });
      });
    };
    const stop = client.subscribe?.(refresh);
    refresh();
    return () => { active = false; stop?.(); };
  }, [client, key, kind, id, retryVersion]);
  return result?.client === client && result.key === key ? { rows: result.rows, loading: result.loading, error: result.error, retry } : { rows: [], loading: true, error: '', retry };
}
export function useLocalToolWorldList(client: LocalToolWorldClient, kind: EraDocumentKind) { return useWorldQuery(client, kind); }
export function useLocalToolWorldRead(client: LocalToolWorldClient, kind: EraDocumentKind, id: string) {
  const result = useWorldQuery(client, kind, id);
  return { document: result.rows[0], loading: result.loading, error: result.error, retry: result.retry };
}
