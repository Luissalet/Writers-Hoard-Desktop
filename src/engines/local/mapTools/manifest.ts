import {PROJECT_ID,s,type BridgeTool} from '@/services/aiBridge/schema';

const scope={projectId:PROJECT_ID,eraId:s('Named era ID; omit for Shared base.')};
const target={
 type:'object',
 properties:{kind:{type:'string',enum:['maps','worldgen']},documentId:s('Logical map or generated-world document ID.')},
 required:['kind','documentId'],additionalProperties:false,
};

export const LOCAL_MAP_TOOL_TOOLS:BridgeTool[]=[
 {
  name:'wh_local_tool_map_list',group:'research',writes:false,
  description:'List effective map targets, selected compiled map-panel tools and their bound Source documents in a project/era, plus actual mounted map hosts. Optional target narrows the document catalogue. Does not create documents, mount hosts, generate terrain or flush drafts.',
  schema:{type:'object',properties:{...scope,target},additionalProperties:false},
 },
 {
  name:'wh_local_tool_map_open',group:'research',writes:true,
  description:'Select a bound Source document in one actual mounted map host, with exact project/era, target and selected release hash. Uses normal pending-write navigation; unavailable hosts return available:false without starting an app or queuing work. applied reports selection admission, not a rendered-frame acknowledgement. Does not create or retarget Source documents.',
  schema:{type:'object',properties:{
   ...scope,target,hostId:s('Exact live hostId returned by map_list.'),
   namespace:s('Selected compiled map-panel tool namespace.'),documentId:s('Bound Source document ID.'),
   expectedContentHash:{type:['string','null'],description:'Exact selected contentHash returned by map_list; null for its development definition.'},
  },required:['hostId','target','namespace','documentId','expectedContentHash'],additionalProperties:false},
 },
];
