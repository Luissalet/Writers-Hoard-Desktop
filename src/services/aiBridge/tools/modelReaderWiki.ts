import {validateWikiOptions} from '@/services/wikiProfiles/validation';
import { buildWorldWiki, loadWorldWikiData, WIKI_TYPES } from '@/services/worldWikiExport';
import type { WorldWikiOptions } from '@/types/worldWiki';
import { BridgeError, optBoolean, optEnum, optString, optStringArray, resolveProjectId, type ToolArgs } from './shared';

export const MODEL_READER_WIKI_HANDLERS = {
  async wh_wiki_export(args: ToolArgs) {
    const projectId=resolveProjectId(args), types=optStringArray(args,'types');
    if(types?.some(type=>!WIKI_TYPES.includes(type as typeof WIKI_TYPES[number])))throw new BridgeError('bad-args','Invalid wiki category.');
    const options: WorldWikiOptions={eraId:optString(args,'eraId'),locale:optEnum(args,'locale',['es','en']),types:types as WorldWikiOptions['types'],theme:optEnum(args,'theme',['parchment','paper','night','forest']),layout:optEnum(args,'layout',['sidebar','journal','terminal','shell']),font:optEnum(args,'font',['serif','sans']),accent:optString(args,'accent')};
    for(const key of ['includeMaps','includeImages','includeMedia','includeCover'] as const)options[key]=optBoolean(args,key);
    for(const key of ['excludedEntryIds','excludedMapIds','excludedFields'] as const)options[key]=optStringArray(args,key);
    for(const key of ['headingFont','bodyFont','colors','branding','grouping','sections','home'] as const)if(args[key]!==undefined)Object.assign(options,{[key]:args[key]});
    try{validateWikiOptions(options);}catch(error){throw new BridgeError('bad-args',error instanceof Error?error.message:String(error));}
    return {projectId,eraId:options.eraId??null,...buildWorldWiki(await loadWorldWikiData(projectId,options),options)};
  },
};
