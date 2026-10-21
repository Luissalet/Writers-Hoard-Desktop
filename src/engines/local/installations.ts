/** Optional project-wide release pins. Pure portable metadata; no code is loaded from backups. */
import {localToolNamespace} from './stateTypes';
export interface LocalToolInstallation {contentHash:string|null;revision:number;updatedAt:number}
export type LocalToolInstallations=Record<string,LocalToolInstallation>;
export const LOCAL_TOOL_INSTALLATIONS_KEY='localToolInstallations' as const;
export function validateLocalToolInstallations(value:unknown):asserts value is LocalToolInstallations|undefined{
 if(value===undefined)return;
 if(!value||typeof value!=='object'||Array.isArray(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null))throw Error('local_tool_installations_invalid');
 for(const namespace of Reflect.ownKeys(value)){if(!localToolNamespace(namespace))throw Error('local_tool_installations_invalid');const property=Object.getOwnPropertyDescriptor(value,namespace);if(!property||!('value'in property)||!property.enumerable)throw Error('local_tool_installations_invalid');const record=property.value;if(!record||typeof record!=='object'||Array.isArray(record)||(Object.getPrototypeOf(record)!==Object.prototype&&Object.getPrototypeOf(record)!==null)||Reflect.ownKeys(record).length!==3)throw Error('local_tool_installations_invalid');for(const key of ['contentHash','revision','updatedAt']){const field=Object.getOwnPropertyDescriptor(record,key);if(!field||!('value'in field)||!field.enumerable)throw Error('local_tool_installations_invalid');}if(record.contentHash!==null&&(typeof record.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(record.contentHash))||!Number.isSafeInteger(record.revision)||record.revision<0||!Number.isSafeInteger(record.updatedAt)||record.updatedAt<0)throw Error('local_tool_installations_invalid');}
}
/** Preserve exact immutable source identity while giving a cloned project fresh CAS revisions. */
export function cloneLocalToolInstallations(value:LocalToolInstallations|undefined):LocalToolInstallations|undefined{validateLocalToolInstallations(value);return value?Object.fromEntries(Object.entries(value).map(([namespace,record])=>[namespace,{...record,revision:0}])):undefined;}
