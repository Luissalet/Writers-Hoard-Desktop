import {localToolFieldKey,type LocalToolStateCodec} from '../stateCodec';
import {localToolJsonText,type LocalToolJson} from '../stateTypes';
import type {LocalToolDefinition} from '../sdk';
import type {WorldEraScope} from '@/services/worldEras/types';
import type {SourceToolDocument} from '../documents/types';

export type LocalToolMapKind='maps'|'worldgen';
export type LocalToolMapTarget={kind:LocalToolMapKind;documentId:string};
export interface LocalToolMapPanelSpec {version:1;targetField:string;kinds:readonly LocalToolMapKind[]}
export interface LocalToolMapContext {
 target:LocalToolMapTarget;title:string;targetVersion:string;provenance:'base'|'variant';readOnly:boolean;
 presentation:{kind:'current'}|{kind:'map-version';versionId:string};
}
/** Selected executable identity and actual effective map, never a catalogue representative. */
export interface LocalMapResolvedBinding {
 scope:WorldEraScope;target:LocalToolMapTarget;namespace:string;definition:LocalToolDefinition;
 mapPanel:LocalToolMapPanelSpec;pinRevision:number|null;contentHash:string|null;context:LocalToolMapContext;
}
/** One normal host generation. Not serialized, persisted or granted to headless callers. */
export interface LocalMapAuthority extends Omit<LocalMapResolvedBinding,'context'> {
 context?:LocalToolMapContext;readOnly:boolean;isCurrent:()=>boolean;
}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export const localToolMapKind=(value:unknown):value is LocalToolMapKind=>value==='maps'||value==='worldgen';
export function localToolMapTarget(value:unknown):value is LocalToolMapTarget {
 if(!record(value)||Object.keys(value).sort().join(',')!=='documentId,kind'||!localToolMapKind(value.kind)||typeof value.documentId!=='string'||!value.documentId.trim())return false;
 return true;
}
export function sameLocalMapTarget(a:LocalToolMapTarget|null|undefined,b:LocalToolMapTarget|null|undefined){return a===b||!!a&&!!b&&a.kind===b.kind&&a.documentId===b.documentId;}
export function sameLocalMapScope(a:WorldEraScope,b:WorldEraScope){return a.projectId===b.projectId&&a.eraId===b.eraId;}
/** Exact portable declaration; no new document root, runtime member kind or writer. */
export function prepareLocalToolMapPanel(value:unknown,document:LocalToolDefinition['document'],codec:LocalToolStateCodec|undefined,initialState:LocalToolJson):LocalToolMapPanelSpec {
 const fail=():never=>{throw Error('local_tool_map_panel_invalid');};
 // Validate plain JSON before touching author properties; clone only the declaration.
 const candidate:unknown=JSON.parse(localToolJsonText(value));
 if(!record(candidate)||Object.keys(candidate).sort().join(',')!=='kinds,targetField,version'||candidate.version!==1||!document||!localToolFieldKey(candidate.targetField))return fail();
 const field=candidate.targetField;
 if(codec?.fields[field]?.kind!=='reference'||!record(initialState)||!Object.hasOwn(initialState,field)||initialState[field]!==null||!Array.isArray(candidate.kinds)||!candidate.kinds.length)return fail();
 const kinds=candidate.kinds.filter(localToolMapKind);
 if(kinds.length!==candidate.kinds.length||new Set(kinds).size!==kinds.length)return fail();
 return Object.freeze({version:1,targetField:field,kinds:Object.freeze([...kinds].sort())});
}
/** A stored codec is authoritative for portability; never infer binding from arbitrary refs. */
export function assertLocalMapDocumentBinding(document:Pick<SourceToolDocument,'codec'|'data'>,panel:LocalToolMapPanelSpec,target:LocalToolMapTarget):void {
 const value=record(document.data)?document.data[panel.targetField]:undefined;
 if(document.codec?.fields[panel.targetField]?.kind!=='reference'||!panel.kinds.includes(target.kind)||!localToolMapTarget(value)||!sameLocalMapTarget(value,target))throw Error('local_tool_map_binding_invalid');
}
