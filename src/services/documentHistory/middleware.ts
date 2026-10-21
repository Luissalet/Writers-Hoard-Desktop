import Dexie, { type DBCore, type DBCoreMutateRequest, type DBCoreMutateResponse, type DBCoreTransaction } from 'dexie';
export interface HistoryMutationBoundary {
  /** Physical stores needed by aggregate capture, never added to readonly transactions. */
  stores: readonly string[];
  trackedTables: ReadonlySet<string>;
  skip?: (transaction: DBCoreTransaction) => boolean;
  capture: (table: string, request: DBCoreMutateRequest, core: DBCore) => Promise<(result: DBCoreMutateResponse) => Promise<void>>;
}
/** Capture is part of the same native transaction, below ordinary domain hooks. */
export function installHistoryMutationBoundary(database: Dexie, boundary: HistoryMutationBoundary): void {
  const eligible = new WeakSet<DBCoreTransaction>();
  database.use({ stack: 'dbcore', name: 'document-history', level: -0.5, create: down => ({
    ...down,
    transaction(stores, mode, options) {
      const available = new Set(down.schema.tables.map(table => table.name));
      const capture = mode === 'readwrite' && stores.some(name => boundary.trackedTables.has(name)) && boundary.stores.every(name => available.has(name));
      const transaction = down.transaction(capture ? [...new Set([...stores, ...boundary.stores])] : stores, mode, options);
      if (capture) eligible.add(transaction);
      return transaction;
    },
    table(name) {
      const table = down.table(name);
      if (!boundary.trackedTables.has(name)) return table;
      return { ...table, mutate: request => {
        if (!eligible.has(request.trans) || boundary.skip?.(request.trans)) return table.mutate(request);
        // Native keepalive is independent of Dexie.waitFor: aggregate hashing may
        // itself use waitFor, whose nested waiting chain must not wait on itself.
        let waiting = true;
        const jobs: { run: () => void; reject: (error: unknown) => void }[] = [];
        const native = request.trans as unknown as IDBTransaction;
        const active = <T,>(operation: () => Promise<T>): Promise<T> => new Dexie.Promise<T>((resolve,reject)=>jobs.push({run:()=>{try{resolve(operation());}catch(error){reject(error);}},reject}));
        const spin = () => {
          if (!waiting) return;
          const keepalive = native.objectStore(boundary.stores[0]).get(-Infinity);
          keepalive.onsuccess = () => { for(const job of jobs.splice(0))job.run(); if(waiting)spin(); };
          keepalive.onerror = () => { waiting=false; for(const job of jobs.splice(0))job.reject(keepalive.error); };
        };
        // A live IDB transaction is active only in a request callback/microtask.
        // Hash completion can occur between callbacks: queue each raw request
        // into the next keepalive callback instead of relying on a lost PSD zone.
        const core: DBCore = { ...down, table(tableName) { const raw=down.table(tableName);return{...raw,get:args=>active(()=>raw.get(args)),getMany:args=>active(()=>raw.getMany(args)),query:args=>active(()=>raw.query(args)),mutate:args=>active(()=>raw.mutate(args))}; } };
        spin();
        return Dexie.Promise.resolve((async () => {
          try {
            const publish = await boundary.capture(name, request, core);
            const result = await active(() => table.mutate(request));
            await publish(result);
            return result;
          } catch (error) { try { request.trans.abort(); } catch { /* Preserve the original failure if IndexedDB already closed. */ } throw error; }
        })()).finally(() => { waiting = false; });
      } };
    },
  }) });
}
