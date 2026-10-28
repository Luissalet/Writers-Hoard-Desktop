import assert from 'node:assert/strict';
export {assert};
export function deferred<T>() {let resolve!: (value: T) => void;const promise = new Promise<T>(done => {resolve = done;});return {promise, resolve};}
export async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
 let timer: ReturnType<typeof setTimeout> | undefined;
 try {return await Promise.race([promise, new Promise<never>((_resolve, reject) => {timer = setTimeout(() => reject(Error('SDK34_TIMEOUT: ' + label)), 3000);})]);}
 finally {if (timer !== undefined) clearTimeout(timer);}
}
export type RecordEvent = (event: Record<string, unknown>) => void;
export async function group<T>(groups: string[], record: RecordEvent, name: string, run: () => Promise<T>) {
 record({kind: 'begin', name});const result = await run();groups.push(name);record({kind: 'pass', name, result});return result;
}
