import type {CodexEntry,WorldMap} from '@/types';
import type {WikiDocumentRef,WikiSection,WorldWikiOptions} from '@/types/worldWiki';
export const wikiRefKey=(ref:WikiDocumentRef)=>JSON.stringify([ref.kind,ref.id]);
export function admittedWikiDocuments(entries:CodexEntry[],maps:WorldMap[],options:WorldWikiOptions){
 const hidden=(kind:'entry'|'map',id:string,category:string)=>options.sections?.some(section=>section.hideDocuments&&(section.category===category||section.documents.some(ref=>ref.kind===kind&&ref.id===id)));
 return{entries:entries.filter(entry=>(!options.types||options.types.includes(entry.type))&&!options.excludedEntryIds?.includes(entry.id)&&!hidden('entry',entry.id,entry.type)),maps:maps.filter(map=>options.includeMaps!==false&&!options.excludedMapIds?.includes(map.id)&&!hidden('map',map.id,'maps'))};
}
export function wikiDocumentSections(entries:CodexEntry[],maps:WorldMap[],options:WorldWikiOptions,labels:Record<string,string>,other:string):WikiSection[]{
 const all:WikiDocumentRef[]=[...entries.map(entry=>({kind:'entry' as const,id:entry.id})),...maps.map(map=>({kind:'map' as const,id:map.id}))],available=new Set(all.map(wikiRefKey));
 if(options.grouping==='manual'){
  const used=new Set<string>(),sections=(options.sections??[]).filter(section=>!section.category&&!section.hideDocuments).map(section=>({...section,documents:section.documents.filter(ref=>{const key=wikiRefKey(ref);if(!available.has(key)||used.has(key))return false;used.add(key);return true;})}));const rest=all.filter(ref=>!used.has(wikiRefKey(ref)));return[...sections,...(rest.length?[{id:'wiki-unassigned',name:other,documents:rest,view:'full' as const}]:[])];
 }
 const categories=[...new Set([...options.sections?.flatMap(section=>section.category?[section.category]:[])??[],...entries.map(entry=>entry.type),...(maps.length?['maps' as const]:[])])];
 return categories.flatMap(category=>{const custom=options.sections?.find(section=>section.category===category),documents=all.filter(ref=>ref.kind==='map'?category==='maps':entries.find(entry=>entry.id===ref.id)?.type===category);if(!documents.length)return[];return[{...custom,id:custom?.id??'wiki-type-'+category,name:custom?.name??labels[category]??category,documents}];});
}
