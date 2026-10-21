import type {BoardNode,BoardEdge} from '../types';
export interface BoardBaseline {nodes:BoardNode[];edges:BoardEdge[]}
export class BoardBatchConflict extends Error{readonly rowId:string;readonly field?:string;constructor(rowId:string,field?:string){super(`Canvas changed: ${rowId}${field?` · ${field}`:''}. Pending changes remain in local recovery.`);this.rowId=rowId;this.field=field;this.name='BoardBatchConflict';}}
const equal=(a:unknown,b:unknown)=>JSON.stringify(a,(key,value)=>key==='updatedAt'?undefined:value)===JSON.stringify(b,(key,value)=>key==='updatedAt'?undefined:value);
/** Field-level three-way merge; input arrays and authored values remain untouched. */
export function mergeBoardRows<T extends BoardNode|BoardEdge>(current:readonly T[],puts:readonly T[],deletes:readonly string[],baseline:readonly T[]):T[]{const rows=new Map(current.map(row=>[row.id,row])),before=new Map(baseline.map(row=>[row.id,row]));
 for(const id of deletes){const row=rows.get(id);if(row&&!equal(row,before.get(id)))throw new BoardBatchConflict(id);rows.delete(id);}
 for(const next of puts){const old=before.get(next.id),row=rows.get(next.id);if(!old){if(row&&!equal(row,next))throw new BoardBatchConflict(next.id);rows.set(next.id,structuredClone(next));continue;}if(!row)throw new BoardBatchConflict(next.id);const merged={...row} as T;for(const key of new Set([...Object.keys(old),...Object.keys(next)])){if(key==='updatedAt'||equal(old[key as keyof T],next[key as keyof T]))continue;if(!equal(row[key as keyof T],old[key as keyof T])&&!equal(row[key as keyof T],next[key as keyof T]))throw new BoardBatchConflict(next.id,key);Object.assign(merged,{[key]:next[key as keyof T]});}merged.updatedAt=Math.max(Date.now(),row.updatedAt+1);rows.set(next.id,merged);}
 return [...rows.values()];}

/** Deliberate recovery applies only locally changed fields to the reviewed saved row. */
export function rebaseBoardRow<T extends BoardNode|BoardEdge>(next:T,old:T|undefined,saved:T|undefined):T{if(!old||!saved)return structuredClone(next);const result={...saved};for(const key of new Set([...Object.keys(old),...Object.keys(next)])){if(key==='updatedAt'||equal(old[key as keyof T],next[key as keyof T]))continue;Object.assign(result,{[key]:next[key as keyof T]});}result.updatedAt=Date.now();return result;}
