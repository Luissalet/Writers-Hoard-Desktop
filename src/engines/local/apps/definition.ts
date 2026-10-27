import {defineLocalTool,type LocalToolJson} from '../sdk';
import {cloneLocalToolJson,localToolNamespace} from '../stateTypes';
import type {LocalAppDefinition,LocalAppDescriptor} from './types';
import LocalAppDocument from './LocalAppDocument';

export function defineLocalApp<T extends LocalToolJson>(spec:LocalAppDefinition<T>){
  if(!localToolNamespace(spec.id)||!spec.version?.trim()||spec.publishPreset!==undefined&&!['instance-documents','world-wiki'].includes(spec.publishPreset)||!Array.isArray(spec.tools)||spec.tools.some(id=>!localToolNamespace(id))||new Set(spec.tools).size!==spec.tools.length||typeof spec.Host!=='function'||typeof spec.Surface!=='function')throw Error('local_app_definition_invalid');
  if(spec.state.codec.fields.children?.kind!=='list'||spec.state.codec.fields.children.idKey!=='id'||spec.state.codec.fields.children.referenceKey!=='document')throw Error('local_app_children_list_required');
  if(spec.state.preview?.fields.some(field=>field.key==='children'))throw Error('local_app_preview_membership_reserved');
  const validateState=(value:LocalToolJson):value is T=>{
    if(!spec.state.validateState(value)||!value||typeof value!=='object'||Array.isArray(value))return false;
    const record=value as Record<string,LocalToolJson>;if(!Array.isArray(record.children))return false;
    return record.children.every(member=>!!member&&typeof member==='object'&&!Array.isArray(member)&&Object.keys(member).length===3&&['id','document','variant'].every(key=>Object.hasOwn(member,key))&&typeof member.id==='string'&&!!member.id&&typeof member.variant==='string'&&['panel','plain'].includes(member.variant)&&!!member.document&&typeof member.document==='object'&&!Array.isArray(member.document)&&Object.keys(member.document).length===2&&member.document.kind==='local-tool'&&typeof member.document.documentId==='string'&&!!member.document.documentId);
  };
  if(!validateState(spec.state.initialState)||((spec.state.initialState as Record<string,LocalToolJson>).children as LocalToolJson[]).length!==0)throw Error('local_app_initial_members_must_be_empty');
  const preview=spec.state.preview??{version:1 as const,fields:Object.keys(spec.state.codec.fields).filter(key=>key!=='children').map(key=>({key}))};
  const descriptor=cloneLocalToolJson({format:'writers-hoard-local-app/1',id:spec.id,name:spec.name,description:spec.description,version:spec.version,subRoutes:spec.subRoutes??false,tools:[...spec.tools],state:{initialState:spec.state.initialState,codec:spec.state.codec,preview},...(spec.publishPreset?{publishPreset:spec.publishPreset}:{})} as unknown as LocalToolJson) as unknown as LocalAppDescriptor;
  return defineLocalTool<T>({namespace:spec.id,name:spec.name,description:spec.description,initialState:spec.state.initialState,validateState,codec:spec.state.codec,preview,document:{defaultTitle:spec.name,embed:'interactive'},app:{descriptor,Host:spec.Host,Surface:spec.Surface},component:LocalAppDocument});
}
