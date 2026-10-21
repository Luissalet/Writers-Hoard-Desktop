import {db} from '@/db';
import {notifyProjectsChanged} from '@/db/operations';
import {assertWorldEra} from '@/services/worldEras/store';
import type {WorldEraScope} from '@/services/worldEras/types';
import type {CodexEntry} from '@/types';
import {effectiveCodexTemplate,templateIsWithin} from './templateHierarchy';
import {propertyDefinitions} from './properties';
import {saveCodexTemplate} from './templates';
import type {CodexPropertyDefinition,CodexTemplate} from './templateTypes';
import {validateCodexOptionLists,type CodexOptionList} from './optionListTypes';
export const OPTION_LIST_LIBRARY_SCOPE='shared-project' as const;
export class CodexOptionListConflict extends Error{constructor(){super('codex_option_list_conflict');this.name='CodexOptionListConflict';}}
export interface CodexOptionListDraft {id?:string;name:string;options:string[];optionColors?:Record<string,string>}
export async function listCodexOptionLists(scope:WorldEraScope):Promise<CodexOptionList[]>{const project=await assertWorldEra(scope);return structuredClone(project.codexOptionLists??[]);}
export async function saveCodexOptionList(scope:WorldEraScope,draft:CodexOptionListDraft,expectedRevision:number|null):Promise<CodexOptionList>{
 const saved=await db.transaction('rw',db.projects,async()=>{const project=await assertWorldEra(scope),lists=project.codexOptionLists??[],current=lists.find(item=>item.id===draft.id);if(expectedRevision===null?!!current:!Number.isSafeInteger(expectedRevision)||current?.revision!==expectedRevision)throw new CodexOptionListConflict();const now=Math.max(Date.now(),(current?.updatedAt??0)+1),next:CodexOptionList={id:current?.id??draft.id??crypto.randomUUID(),name:draft.name.trim(),options:structuredClone(draft.options),optionColors:draft.optionColors?structuredClone(draft.optionColors):undefined,revision:(current?.revision??0)+1,createdAt:current?.createdAt??now,updatedAt:now};const all=current?lists.map(item=>item.id===next.id?next:item):[...lists,next];validateCodexOptionLists(all);await db.projects.update(scope.projectId,{codexOptionLists:all,updatedAt:Math.max(now,project.updatedAt+1)});return next;});notifyProjectsChanged();return saved;
}
export async function deleteCodexOptionList(scope:WorldEraScope,id:string,expectedRevision:number):Promise<void>{await db.transaction('rw',db.projects,async()=>{const project=await assertWorldEra(scope),lists=project.codexOptionLists??[],current=lists.find(item=>item.id===id);if(!current||current.revision!==expectedRevision)throw new CodexOptionListConflict();await db.projects.update(scope.projectId,{codexOptionLists:lists.filter(item=>item.id!==id),updatedAt:Math.max(Date.now(),project.updatedAt+1)});});notifyProjectsChanged();}
/** Copy only suggestion/color fields. There is intentionally no ongoing list linkage. */
export function copyOptionListToProperty(definition:CodexPropertyDefinition,list:Pick<CodexOptionList,'options'|'optionColors'>):CodexPropertyDefinition{if(definition.kind!=='multiselect')throw Error('codex_option_list_requires_multiselect');return{...definition,presets:[...list.options],optionColors:list.optionColors?{...list.optionColors}:undefined};}
export interface RetainedOptionValues {entryId:string;title:string;eraId?:string;values:string[]}
/** Include authored Base and own-era versions, not duplicated fallback reads or retained histories. */
export async function inspectRetainedOptionValues(scope:WorldEraScope,templateId:string,propertyId:string,options:readonly string[]):Promise<RetainedOptionValues[]>{
 const project=await assertWorldEra(scope),templates=project.codexTemplates??[],target=templates.find(item=>item.id===templateId);if(!target) return[];const targetDefinition=propertyDefinitions(effectiveCodexTemplate(target,templates)).find(item=>item.id===propertyId);if(!targetDefinition)return[];
 const base=await db.codexEntries.where('projectId').equals(scope.projectId).toArray(),variants=(await db.worldEraVariants.where('projectId').equals(scope.projectId).toArray()).filter(item=>item.kind==='codex'&&!item.hidden&&!item.archived&&item.document);
 const rows=[...base.map(entry=>({entry,eraId:undefined as string|undefined})),...variants.map(item=>({entry:item.document!.root as unknown as CodexEntry,eraId:item.eraId}))],retained:RetainedOptionValues[]=[];
 for(const {entry,eraId}of rows){const template=templates.find(item=>item.id===entry.templateId);if(!template||!templateIsWithin(entry.templateId,templateId,templates)||!propertyDefinitions(effectiveCodexTemplate(template,templates)).some(item=>item.id===propertyId))continue;const raw=entry.fields[targetDefinition.key];if(!raw?.trim())continue;let values:string[];try{const parsed:unknown=JSON.parse(raw);values=Array.isArray(parsed)&&parsed.every(item=>typeof item==='string')?parsed:[raw];}catch{values=[raw];}const outside=[...new Set(values.filter(value=>!options.includes(value)))];if(outside.length)retained.push({entryId:entry.id,title:entry.title,eraId,values:outside});}
 return retained;
}
export async function applyCodexOptionList(scope:WorldEraScope,input:{listId:string;templateId:string;propertyId:string;expectedListRevision:number;expectedTemplateRevision:number}):Promise<{template:CodexTemplate;retainedValues:RetainedOptionValues[]}>{
 return db.transaction('rw',[db.projects,db.codexEntries,db.worldEraVariants],async()=>{const project=await assertWorldEra(scope),list=project.codexOptionLists?.find(item=>item.id===input.listId);if(!list||list.revision!==input.expectedListRevision)throw new CodexOptionListConflict();const template=project.codexTemplates?.find(item=>item.id===input.templateId);if(!template||template.revision!==input.expectedTemplateRevision)throw Error('template_conflict');const definition=propertyDefinitions(effectiveCodexTemplate(template,project.codexTemplates??[])).find(item=>item.id===input.propertyId);if(!definition)throw Error('property_missing');const next=copyOptionListToProperty(definition,list),retainedValues=await inspectRetainedOptionValues(scope,template.id,definition.id,list.options);const saved=await saveCodexTemplate(scope.projectId,{...template,propertyDefinitions:[...template.propertyDefinitions?.filter(item=>item.key!==definition.key)??[],next]},input.expectedTemplateRevision);return{template:saved,retainedValues};});
}
