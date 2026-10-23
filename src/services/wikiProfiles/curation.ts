import type { WikiDocumentRef, WikiSection, WorldWikiOptions } from '@/types/worldWiki';
import { wikiRefKey } from './policy';

export function wikiDescendants(sections:readonly WikiSection[],id:string):Set<string>{
  const result=new Set([id]);let changed=true;
  while(changed){changed=false;for(const section of sections)if(section.parentId&&result.has(section.parentId)&&!result.has(section.id)){result.add(section.id);changed=true;}}
  return result;
}
export function moveWikiDocuments(sections:readonly WikiSection[],refs:readonly WikiDocumentRef[],sectionId:string,position?:number):WikiSection[]{
  if(!sections.some(section=>section.id===sectionId&&!section.category))return [...sections];
  const unique=[...new Map(refs.map(ref=>[wikiRefKey(ref),ref])).values()],keys=new Set(unique.map(wikiRefKey));
  return sections.map(section=>{
    const documents=section.documents.filter(ref=>!keys.has(wikiRefKey(ref)));
    if(section.id===sectionId)documents.splice(Math.max(0,Math.min(position??documents.length,documents.length)),0,...unique);
    return{...section,documents};
  });
}
export function setWikiDocumentsIncluded(options:WorldWikiOptions,refs:readonly WikiDocumentRef[],included:boolean):Partial<WorldWikiOptions>{
  const additional=new Map((options.additionalDocuments??[]).map(ref=>[wikiRefKey(ref),ref]));
  const entries=new Set(options.excludedEntryIds??[]),maps=new Set(options.excludedMapIds??[]);
  const excluded=new Map((options.excludedDocuments??[]).map(ref=>[wikiRefKey(ref),ref]));
  for(const ref of refs){
    if(included)excluded.delete(wikiRefKey(ref));else excluded.set(wikiRefKey(ref),ref);
    if(ref.kind==='entry'){if(included)entries.delete(ref.id);else entries.add(ref.id);}
    else if(ref.kind==='map'){if(included)maps.delete(ref.id);else maps.add(ref.id);}
    else if(included)additional.set(wikiRefKey(ref),ref);
  }
  return{additionalDocuments:[...additional.values()],excludedDocuments:[...excluded.values()],excludedEntryIds:[...entries],excludedMapIds:[...maps]};
}
