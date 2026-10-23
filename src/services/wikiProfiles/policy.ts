import type {CodexEntry,WorldMap} from '@/types';
import type {WikiDocumentRef,WikiSection,WorldWikiOptions} from '@/types/worldWiki';
import {isRevealed} from '@/engines/codex/revealModel';
export const wikiRefKey=(ref:WikiDocumentRef)=>JSON.stringify(ref.kind==='local-tool'?[ref.kind,ref.id,ref.namespace]:[ref.kind,ref.id]);
/** Engine references and wiki selection refs name the same sources differently. */
export const wikiDocumentKind=(kind:string):string=>kind==='codex'||kind==='codex-entry'?'entry':kind==='maps'?'map':kind==='genealogy'?'relation-tree':kind;
export function wikiDocumentExcluded(refs:readonly {kind:string;id:string;namespace?:string}[]|undefined,kind:string,id:string,namespace?:string):boolean{
 const canonical=wikiDocumentKind(kind);
 return !!refs?.some(ref=>wikiDocumentKind(ref.kind)===canonical&&ref.id===id&&(canonical!=='local-tool'||namespace===undefined||ref.namespace===namespace));
}
export function wikiSectionHidden(section:WikiSection,options:WorldWikiOptions,field:'hideDocuments'|'navigationHidden'):boolean{
 const seen=new Set<string>();let current:WikiSection|undefined=section;
 while(current&&!seen.has(current.id)){seen.add(current.id);if(current[field])return true;current=options.sections?.find(parent=>parent.id===current!.parentId);}return false;
}
export function wikiDocumentHidden(ref:WikiDocumentRef,category:string,options:WorldWikiOptions):boolean{
 return wikiDocumentExcluded(options.excludedDocuments,ref.kind,ref.id,ref.namespace)||!!options.sections?.some(section=>wikiSectionHidden(section,options,'hideDocuments')&&(section.category===category||section.documents.some(item=>wikiRefKey(item)===wikiRefKey(ref))));
}
export function admittedWikiDocuments(entries:CodexEntry[],maps:WorldMap[],options:WorldWikiOptions){
 const hidden=(kind:'entry'|'map',id:string,category:string)=>wikiDocumentHidden({kind,id},category,options);
 return{entries:entries.filter(entry=>(!options.onlyRevealed||isRevealed(entry))&&(!options.types||options.types.includes(entry.type))&&!options.excludedEntryIds?.includes(entry.id)&&!hidden('entry',entry.id,entry.type)),maps:maps.filter(map=>options.includeMaps!==false&&!options.onlyRevealed&&!options.excludedMapIds?.includes(map.id)&&!hidden('map',map.id,'maps'))};
}
export function wikiDocumentSections(entries:CodexEntry[],maps:WorldMap[],options:WorldWikiOptions,labels:Record<string,string>,other:string,additional:WikiDocumentRef[]=[]):WikiSection[]{
 const all:WikiDocumentRef[]=[...entries.map(entry=>({kind:'entry' as const,id:entry.id})),...maps.map(map=>({kind:'map' as const,id:map.id})),...additional],available=new Set(all.map(wikiRefKey));
 if(options.grouping==='manual'){
  const used=new Set<string>(),sections=(options.sections??[]).filter(section=>!section.category&&!wikiSectionHidden(section,options,'hideDocuments')).map(section=>({...section,documents:section.documents.filter(ref=>{const key=wikiRefKey(ref);if(!available.has(key)||used.has(key))return false;used.add(key);return true;})}));const rest=all.filter(ref=>!used.has(wikiRefKey(ref)));return[...sections,...(rest.length?[{id:'wiki-unassigned',name:other,documents:rest,view:'full' as const}]:[])];
 }
 const categories=[...new Set([...options.sections?.flatMap(section=>section.category?[section.category]:[])??[],...entries.map(entry=>entry.type),...(maps.length?['maps' as const]:[]),...additional.map(ref=>ref.kind)])];
 return categories.flatMap(category=>{const custom=options.sections?.find(section=>section.category===category),documents=all.filter(ref=>ref.kind==='map'?category==='maps':ref.kind==='entry'?entries.find(entry=>entry.id===ref.id)?.type===category:ref.kind===category);if(!documents.length)return[];return[{...custom,id:custom?.id??'wiki-type-'+category,name:custom?.name??labels[category]??category,documents}];});
}
