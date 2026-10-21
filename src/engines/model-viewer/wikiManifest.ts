import { PROJECT_ID, type BridgeTool } from '@/services/aiBridge/schema';
import {WIKI_OPTIONS_SCHEMA} from '@/services/wikiProfiles/bridgeManifest';
export const MODEL_READER_WIKI_TOOLS: BridgeTool[]=[{
  name:'wh_wiki_export',writes:false,group:'writing',engineId:'codex',
  description:'Export the project wiki as one standalone offline HTML file, including admitted interactive local 3D models, media, maps and links. Returns filename, HTML and counts; respects explicit era and exclusions.',
  schema:{type:'object',additionalProperties:false,properties:{projectId:PROJECT_ID,...WIKI_OPTIONS_SCHEMA.properties}},
}];
