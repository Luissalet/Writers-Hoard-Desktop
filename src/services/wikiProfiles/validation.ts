import type {WorldWikiOptions,WikiDocumentRef} from '@/types/worldWiki';
import type {WikiProfile,WikiProfilesProject} from './types';
import {validateWikiAppearance} from './appearance';
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==='string'&&!!value.trim();
const integer=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const strings=(value:unknown)=>Array.isArray(value)&&value.every(text)&&new Set(value).size===value.length;
const choices=['character','location','item','faction','concept','magic','custom'];
const raster=(value:unknown)=>typeof value==='string'&&/^data:image\/(?:png|jpe?g|webp|gif|avif|bmp);base64,[a-z\d+/=\s]+$/i.test(value);
export function validateWikiOptions(value:unknown):asserts value is WorldWikiOptions{
 if(!record(value))throw Error('wiki_options_invalid');
 validateWikiAppearance(value);
 for(const key of ['eraId']as const)if(value[key]!==undefined&&!text(value[key]))throw Error('wiki_options_invalid');
 for(const[key,values]of Object.entries({locale:['es','en'],theme:['parchment','paper','night','forest'],layout:['sidebar','journal','terminal','shell'],font:['serif','sans'],grouping:['type','manual']}))if(value[key]!==undefined&&!values.includes(String(value[key])))throw Error('wiki_options_invalid');
 for(const key of ['includeMaps','includeImages','includeCover','includeMedia'])if(value[key]!==undefined&&typeof value[key]!=='boolean')throw Error('wiki_options_invalid');
 for(const key of ['excludedEntryIds','excludedMapIds','excludedFields'])if(value[key]!==undefined&&!strings(value[key]))throw Error('wiki_options_invalid');
 if(value.types!==undefined&&(!strings(value.types)||(value.types as string[]).some(type=>!choices.includes(type))))throw Error('wiki_options_invalid');
 if(value.accent!==undefined&&(typeof value.accent!=='string'||!/^#[\da-f]{6}$/i.test(value.accent)))throw Error('wiki_options_invalid');
 const ref=(item:unknown)=>record(item)&&['entry','map'].includes(String(item.kind))&&text(item.id);
 const refs=(items:unknown)=>Array.isArray(items)&&items.every(ref)&&new Set(items.map(item=>JSON.stringify([item.kind,item.id]))).size===items.length;
 if(value.sections!==undefined){if(!Array.isArray(value.sections))throw Error('wiki_sections_invalid');const ids=new Set<string>();for(const section of value.sections){if(!record(section)||!text(section.id)||ids.has(section.id)||!text(section.name)||!refs(section.documents)||section.category!==undefined&&![...choices,'maps'].includes(String(section.category))||section.view!==undefined&&!['full','cards','list'].includes(String(section.view))||section.navigationHidden!==undefined&&typeof section.navigationHidden!=='boolean'||section.hideDocuments!==undefined&&typeof section.hideDocuments!=='boolean')throw Error('wiki_sections_invalid');ids.add(section.id);}}
 if(value.home!==undefined){const home=value.home;if(!record(home)||home.title!==undefined&&typeof home.title!=='string'||home.intro!==undefined&&typeof home.intro!=='string'||home.banner!==undefined&&!raster(home.banner)||home.featured!==undefined&&!refs(home.featured)||home.tiles!==undefined&&(!Array.isArray(home.tiles)||home.tiles.some(tile=>!record(tile)||!ref(tile.document)||!['small','medium','large'].includes(String(tile.size)))))throw Error('wiki_home_invalid');}
}
export function validateWikiProfilesProject(project:{wikiProfiles?:unknown}):void{
 if(project.wikiProfiles===undefined)return;if(!Array.isArray(project.wikiProfiles))throw Error('wiki_profiles_invalid');const ids=new Set<string>();
 for(const profile of project.wikiProfiles){if(!record(profile)||!text(profile.id)||ids.has(profile.id)||!text(profile.name)||!integer(profile.revision)||!integer(profile.createdAt)||!integer(profile.updatedAt))throw Error('wiki_profile_invalid');ids.add(profile.id);validateWikiOptions(profile.options);
  if(profile.editions!==undefined){if(!Array.isArray(profile.editions))throw Error('wiki_editions_invalid');const editions=new Set<string>();for(const edition of profile.editions){if(!record(edition)||!text(edition.id)||editions.has(edition.id)||!integer(edition.publishedAt)||!text(edition.profileName)||typeof edition.sourceFingerprint!=='string'||! /^[\da-f]{64}$/.test(edition.sourceFingerprint)||!record(edition.reader)||typeof edition.reader.html!=='string'||!/^<!doctype html>/i.test(edition.reader.html)||!text(edition.reader.filename)||typeof edition.reader.sha256!=='string'||! /^[\da-f]{64}$/.test(edition.reader.sha256)||!record(edition.reader.counts)||!integer(edition.reader.counts.entries)||!integer(edition.reader.counts.maps))throw Error('wiki_edition_invalid');validateWikiOptions(edition.options);editions.add(edition.id);}}
 }
}
export function remapWikiProfiles(project:WikiProfilesProject,remap:(id:string,prefix:string)=>string):Pick<WikiProfilesProject,'wikiProfiles'>{
 validateWikiProfilesProject(project);
 const ref=(item:WikiDocumentRef):WikiDocumentRef=>({...item,id:remap(item.id,item.kind==='entry'?'codex':'map')});
 const options=(source:WorldWikiOptions):WorldWikiOptions=>({...structuredClone(source),eraId:source.eraId?remap(source.eraId,'era'):undefined,excludedEntryIds:source.excludedEntryIds?.map(id=>remap(id,'codex')),excludedMapIds:source.excludedMapIds?.map(id=>remap(id,'map')),sections:source.sections?.map(section=>({...structuredClone(section),id:remap(section.id,'wiki-section'),documents:section.documents.map(ref)})),home:source.home?{...structuredClone(source.home),featured:source.home.featured?.map(ref),tiles:source.home.tiles?.map(tile=>({...tile,document:ref(tile.document)}))}:undefined});
 return{wikiProfiles:project.wikiProfiles?.map((profile):WikiProfile=>({...structuredClone(profile),id:remap(profile.id,'wiki-profile'),revision:0,options:options(profile.options),editions:profile.editions?.map(edition=>({...structuredClone(edition),id:remap(edition.id,'wiki-edition'),options:options(edition.options)}))}))};
}
