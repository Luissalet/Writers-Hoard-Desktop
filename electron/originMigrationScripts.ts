// Page-side halves of the origin migration (originMigration.ts), kept free of
// Electron imports so a test can run them in any Chromium page. Each is an
// expression executeJavaScript can evaluate; DUMP and RESTORE talk to main
// through `window.__whMigration` (migrationPreload.ts).

export interface OriginSummary {
  databases: { [db: string]: { [store: string]: number } };
  records: number;
  localStorageKeys: number;
}

/** Every counted store on the old side holds the same count on the new side. */
export function sameCounts(before: OriginSummary, after: OriginSummary): boolean {
  for (const [db, stores] of Object.entries(before.databases)) {
    for (const [store, count] of Object.entries(stores)) {
      if ((after.databases[db] ?? {})[store] !== count) return false;
    }
  }
  return after.localStorageKeys >= before.localStorageKeys;
}

/** Counts every record in every database, and the localStorage keys. */
export const SUMMARY_SCRIPT = `(async () => {
  const out = { databases: {}, records: 0, localStorageKeys: 0 };
  const list = indexedDB.databases ? await indexedDB.databases() : [];
  for (const info of list) {
    if (!info.name) continue;
    const db = await new Promise((resolve) => {
      const req = indexedDB.open(info.name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onupgradeneeded = () => { req.transaction.abort(); };
    });
    if (!db) continue;
    const counts = {};
    const names = Array.from(db.objectStoreNames);
    if (names.length) {
      const tx = db.transaction(names, 'readonly');
      await Promise.all(names.map((name) => new Promise((resolve) => {
        const req = tx.objectStore(name).count();
        req.onsuccess = () => { counts[name] = req.result; out.records += req.result; resolve(); };
        req.onerror = () => resolve();
      })));
    }
    db.close();
    out.databases[info.name] = counts;
  }
  try { out.localStorageKeys = localStorage.length; } catch (e) {}
  return out;
})()`;

/** Streams every database and localStorage to main, Blobs as bytes. */
export const DUMP_SCRIPT = `(async () => {
  const put = (chunk) => window.__whMigration.put(chunk);
  const pack = async (value, depth) => {
    if (depth > 64 || value === null || typeof value !== 'object') return value;
    if (value instanceof Blob) {
      const isFile = typeof File !== 'undefined' && value instanceof File;
      return { __whBlob: 1, type: value.type, name: isFile ? value.name : undefined,
        lastModified: isFile ? value.lastModified : undefined, bytes: await value.arrayBuffer() };
    }
    if (value instanceof Date || value instanceof RegExp || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;
    if (Array.isArray(value)) {
      const out = new Array(value.length);
      for (let i = 0; i < value.length; i += 1) out[i] = await pack(value[i], depth + 1);
      return out;
    }
    if (value instanceof Map) {
      const out = new Map();
      for (const [k, v] of value) out.set(k, await pack(v, depth + 1));
      return out;
    }
    if (value instanceof Set) {
      const out = new Set();
      for (const v of value) out.add(await pack(v, depth + 1));
      return out;
    }
    const out = {};
    for (const key of Object.keys(value)) out[key] = await pack(value[key], depth + 1);
    return out;
  };
  const list = indexedDB.databases ? await indexedDB.databases() : [];
  for (const info of list) {
    if (!info.name) continue;
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(info.name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const names = Array.from(db.objectStoreNames);
    const stores = [];
    if (names.length) {
      const tx = db.transaction(names, 'readonly');
      for (const name of names) {
        const s = tx.objectStore(name);
        stores.push({ name, keyPath: s.keyPath, autoIncrement: s.autoIncrement,
          indexes: Array.from(s.indexNames).map((n) => { const ix = s.index(n);
            return { name: n, keyPath: ix.keyPath, unique: ix.unique, multiEntry: ix.multiEntry }; }) });
      }
    }
    await put({ kind: 'db', name: info.name, version: db.version, stores });
    for (const store of stores) {
      let lower;
      let started = false;
      for (;;) {
        const batch = await new Promise((resolve, reject) => {
          const tx = db.transaction(store.name, 'readonly');
          const s = tx.objectStore(store.name);
          const range = started ? IDBKeyRange.lowerBound(lower, true) : null;
          const keysReq = s.getAllKeys(range, 200);
          const valsReq = s.getAll(range, 200);
          tx.oncomplete = () => resolve({ keys: keysReq.result, values: valsReq.result });
          tx.onerror = () => reject(tx.error);
        });
        if (!batch.keys.length) break;
        const rows = [];
        for (let i = 0; i < batch.keys.length; i += 1) rows.push([batch.keys[i], await pack(batch.values[i], 0)]);
        await put({ kind: 'rows', db: info.name, store: store.name, rows });
        lower = batch.keys[batch.keys.length - 1];
        started = true;
        if (batch.keys.length < 200) break;
      }
    }
    db.close();
  }
  const entries = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      entries.push([k, localStorage.getItem(k)]);
    }
  } catch (e) {}
  await put({ kind: 'ls', entries });
  await put({ kind: 'end' });
  return true;
})()`;

/** Replays the chunks main hands out into this page's origin. */
export const RESTORE_SCRIPT = `(async () => {
  const get = (i) => window.__whMigration.get(i);
  const unpack = (value, depth) => {
    if (depth > 64 || value === null || typeof value !== 'object') return value;
    if (value.__whBlob === 1) {
      const type = value.type || '';
      return value.name !== undefined
        ? new File([value.bytes], value.name, { type, lastModified: value.lastModified })
        : new Blob([value.bytes], { type });
    }
    if (value instanceof Date || value instanceof RegExp || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;
    if (Array.isArray(value)) return value.map((v) => unpack(v, depth + 1));
    if (value instanceof Map) { const out = new Map(); for (const [k, v] of value) out.set(k, unpack(v, depth + 1)); return out; }
    if (value instanceof Set) { const out = new Set(); for (const v of value) out.add(unpack(v, depth + 1)); return out; }
    const out = {};
    for (const key of Object.keys(value)) out[key] = unpack(value[key], depth + 1);
    return out;
  };
  const open = {};
  const schemas = {};
  for (let i = 0; ; i += 1) {
    const chunk = await get(i);
    if (!chunk || chunk.kind === 'end') break;
    if (chunk.kind === 'db') {
      await new Promise((resolve) => {
        const r = indexedDB.deleteDatabase(chunk.name);
        r.onsuccess = r.onerror = r.onblocked = () => resolve();
      });
      schemas[chunk.name] = {};
      open[chunk.name] = await new Promise((resolve, reject) => {
        const req = indexedDB.open(chunk.name, chunk.version);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const s of chunk.stores) {
            const store = db.createObjectStore(s.name, { keyPath: s.keyPath, autoIncrement: s.autoIncrement });
            for (const ix of s.indexes) store.createIndex(ix.name, ix.keyPath, { unique: ix.unique, multiEntry: ix.multiEntry });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      for (const s of chunk.stores) schemas[chunk.name][s.name] = s;
    } else if (chunk.kind === 'rows') {
      const db = open[chunk.db];
      const schema = schemas[chunk.db][chunk.store];
      await new Promise((resolve, reject) => {
        const tx = db.transaction(chunk.store, 'readwrite');
        const s = tx.objectStore(chunk.store);
        for (const [key, value] of chunk.rows) {
          const restored = unpack(value, 0);
          if (schema.keyPath === null || schema.keyPath === undefined) s.put(restored, key);
          else s.put(restored);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('aborted'));
      });
    } else if (chunk.kind === 'ls') {
      for (const [k, v] of chunk.entries) {
        if (k !== null && v !== null) localStorage.setItem(k, v);
      }
    }
  }
  for (const db of Object.values(open)) db.close();
  return true;
})()`;

/** Deletes the named databases on this page's origin (rollback). */
export function DROP_SCRIPT(names: string[]): string {
  return `(async () => {
  for (const name of ${JSON.stringify(names)}) {
    await new Promise((resolve) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    });
  }
  return true;
})()`;
}
