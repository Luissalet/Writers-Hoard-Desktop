import {admittedWikiDocuments} from '@/services/wikiProfiles/policy';
import {privateTemplateIds} from '@/engines/codex/templateHierarchy';
import {captureWikiSnapshot,wikiSource} from '@/services/wikiProfiles/snapshot';
import {buildWorldWiki,loadWorldWikiData,type WorldWikiData,type WorldWikiOptions} from '@/services/worldWikiExport';
import type {ReaderSource} from '@/engines/writings/readerSource';
import type {SourceToolDocument} from '../documents/types';
import {captureLocalToolDefinitions} from '../definitions';
import {localToolSemanticPreview} from '../previewTypes';
import type {LocalToolJson} from '../sdk';
import type {LocalAppMember,LocalAppPreset} from './types';

export interface LocalAppPublicationInput {projectId:string;eraId?:string;appId:string;instanceId:string;preset:LocalAppPreset;locale?:'en'|'es';options?:Pick<WorldWikiOptions,'includeImages'|'includeMedia'|'excludedDocuments'|'excludedEntryIds'|'excludedFields'>}
export interface OwnedLocalAppPublication {format:'writers-hoard-local-app-publication/1';data:WorldWikiData;options:WorldWikiOptions;nonce:string;fingerprint:string}
const aborted=(signal?:AbortSignal)=>{if(signal?.aborted)throw new DOMException('Publication cancelled','AbortError');};
/** One normal Wiki snapshot transaction, then asynchronous byte materialisation.
 * No loader, definition, registry, DB handle or DOM node crosses ready. */
export async function prepareLocalAppPublication(input:LocalAppPublicationInput,{signal}:{signal?:AbortSignal}={}):Promise<OwnedLocalAppPublication>{
 aborted(signal);
 const handles=captureLocalToolDefinitions(),snapshot=await captureWikiSnapshot({projectId:input.projectId,eraId:input.eraId});aborted(signal);
 const base=wikiSource(snapshot),hash=base.project.localToolInstallations?.[input.appId]?.contentHash,catalog=handles.get(input.appId),definition=hash?catalog?.releases.get(hash)?.definition:catalog?.development,descriptor=definition?.app?.descriptor;
 if(!definition||!descriptor)throw Error('local_app_source_unavailable');
 if(!descriptor.publishPreset||descriptor.publishPreset!==input.preset)throw Error('local_app_preset_not_declared');
 const instance=base.project.sourceToolDocuments?.find(row=>row.id===input.instanceId&&row.namespace===input.appId);if(!instance)throw Error('local_app_instance_unavailable');
 const state=instance.data as Record<string,LocalToolJson>,members=state.children as unknown as LocalAppMember[],selected:SourceToolDocument[]=[],seen=new Set<string>();
 for(const member of members??[]){const id=member.document?.documentId;if(!id||seen.has(id))continue;seen.add(id);const child=base.project.sourceToolDocuments?.find(row=>row.id===id);if(child&&descriptor.tools.includes(child.namespace))selected.push(child);}
 const allowedDocuments=selected.filter(row=>!input.options?.excludedDocuments?.some(ref=>ref.kind==='local-tool'&&ref.id===row.id&&(!ref.namespace||ref.namespace===row.namespace)));
 for(const child of allowedDocuments){const pin=base.project.localToolInstallations?.[child.namespace]?.contentHash,available=handles.get(child.namespace);if(!(pin?available?.releases.get(pin):available?.development))throw Error('local_app_child_release_unavailable');}
 const admitted=new Set(allowedDocuments.map(row=>row.id)),locale=input.locale??'en';
 const projectDocument=(document:SourceToolDocument)=>{
  const row=structuredClone(document),data=row.data as Record<string,LocalToolJson>,codec=row.codec;
  // Only declared references participate in selection policy. Opaque prose is
  // deliberately untouched, including strings resembling document IDs.
  for(const [key,field]of Object.entries(codec?.fields??{})){
   const allowed=(value:LocalToolJson)=>{if(value===null)return true;if(!value||typeof value!=='object'||Array.isArray(value))return false;return value.kind==='local-tool'&&typeof value.documentId==='string'&&admitted.has(value.documentId);};
   if(field.kind==='reference'&&!allowed(data[key]))data[key]=null;
   if(field.kind==='map'&&field.referenceValues&&data[key]&&typeof data[key]==='object'&&!Array.isArray(data[key]))data[key]=Object.fromEntries(Object.entries(data[key]).filter(([,value])=>allowed(value)));
   if(field.kind==='list'&&field.referenceKey&&Array.isArray(data[key])){const refKey=field.referenceKey;data[key]=(data[key] as Record<string,LocalToolJson>[]).map(item=>({...item,...(!allowed(item[refKey])?{[refKey]:null}:{})}));}
  }
  return row;
 };
 const documents=allowedDocuments.map(projectDocument);
 const refs=documents.map(row=>({kind:'local-tool' as const,id:row.id,namespace:row.namespace}));
 const appPreview=input.preset==='instance-documents'?projectDocument(instance):instance;
 const semantic=localToolSemanticPreview(instance.title,appPreview.data,definition.preview,locale,definition.codec),intro=semantic.fields.map(field=>field.label+': '+field.value).join('\n');
 const options:WorldWikiOptions={...input.options,locale,...input.eraId?{eraId:input.eraId}:{},...(input.preset==='instance-documents'?{types:[],includeMaps:false,additionalDocuments:refs,grouping:'manual',sections:[{id:'app-documents',name:instance.title,documents:refs}]}:{}),home:{title:instance.title,intro}};
 const project={...base.project,sourceToolDocuments:input.preset==='instance-documents'?documents:base.project.sourceToolDocuments};
 const source:ReaderSource&{images:typeof base.images}={...base,project,capturedLocalSources:handles,documents:kind=>kind==='local-tool'&&input.preset==='instance-documents'?documents.map(root=>({root:root as unknown as import('@/services/worldEras/types').EraRow,children:{}})):base.documents?.(kind)??[]};
 const data=await loadWorldWikiData(input.projectId,options,source);aborted(signal);
 // WorldWikiData's project is used for presentation only. Strip raw authored
 // stores from owned data so excluded metadata cannot leak into later formats.
 const publicProject={id:project.id,title:project.title,description:project.description,createdAt:project.createdAt,updatedAt:project.updatedAt,...(project.codexTemplates?{codexTemplates:project.codexTemplates}:{}),...(project.timelineViews?{timelineViews:project.timelineViews}:{})} as typeof project;
 // The owned boundary admits the same canon as Wiki, rather than retaining
 // excluded rows for a later HTML-only filter. Source assets are already
 // materialised in their admitted standalone previews, not the gallery.
 const admittedCanon=admittedWikiDocuments(data.entries,data.maps,options),privateTypes=privateTemplateIds(project.codexTemplates??[]);
 const entries=admittedCanon.entries.filter(row=>!row.templateId||!privateTypes.has(row.templateId)),entryIds=new Set(entries.map(row=>row.id)),maps=admittedCanon.maps,mapIds=new Set(maps.map(row=>row.id));
 const images=data.images.filter(image=>(image.linkedEntryIds??[image.linkedEntryId]).some(id=>!!id&&entryIds.has(id)));
 const detached=JSON.parse(JSON.stringify({...data,project:publicProject,entries,maps,pins:data.pins.filter(pin=>mapIds.has(pin.mapId)),images})) as WorldWikiData;
 const nonce=[...crypto.getRandomValues(new Uint8Array(18))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 const fingerprint=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({data:detached,options}))))].map(byte=>byte.toString(16).padStart(2,'0')).join('');aborted(signal);
 return {format:'writers-hoard-local-app-publication/1',data:detached,options:structuredClone(options),nonce,fingerprint};
}
/** The same Wiki compositor, now using only the owned materialised payload. */
export function renderLocalAppPublication(owned:OwnedLocalAppPublication){
 if(owned.format!=='writers-hoard-local-app-publication/1')throw Error('local_app_publication_invalid');
 const artifact=buildWorldWiki(owned.data,owned.options,owned.nonce);return {html:artifact.html,filename:artifact.filename,mime:'text/html',fingerprint:owned.fingerprint};
}
