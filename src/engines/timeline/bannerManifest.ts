import type {BridgeTool} from '@/services/aiBridge/schema';
const str={type:'string'} as const;
export const BANNER_PARAMS_SCHEMA={anyOf:[{type:'object',properties:{repeatSizePx:{type:'number',exclusiveMinimum:0},opacity:{type:'number',minimum:0,maximum:1}},additionalProperties:false},{type:'null'}]} as const;
export const BANNER_IMAGE_SCHEMA={anyOf:[{type:'object',properties:{dataUrl:str},required:['dataUrl'],additionalProperties:false},{type:'null'}]} as const;
export const BANNER_EVENT_SCHEMA={
 bannerPatternParams:BANNER_PARAMS_SCHEMA,bannerImage:BANNER_IMAGE_SCHEMA,
 banner:{type:'object',properties:{mode:{type:'string',enum:['live','copy','manual']},ownerTimelineId:str,presetId:str,colorMode:{type:'string',enum:['event','preset']}},required:['mode'],additionalProperties:false},
 expectedTargets:{type:'array',items:{type:'object',properties:{timelineId:str,version:str},required:['timelineId','version'],additionalProperties:false}},
} as const;
const scope={projectId:str,eraId:str,timelineId:str};
export const TIMELINE_BANNER_TOOLS:BridgeTool[]=[
 {name:'wh_timeline_banner_presets',description:"Read the timeline's effective banner presets and CAS version. Era explicit; no writes or defaults materialized.",writes:false,schema:{type:'object',properties:scope,required:['timelineId'],additionalProperties:false}},
 {name:'wh_timeline_banner_preset_set',description:'Upsert, archive or restore one live banner preset with expectedVersion from read. Archived definitions remain live. Local raster bytes only. Undo preserves later neighbouring work.',writes:true,schema:{type:'object',properties:{...scope,expectedVersion:str,action:{type:'string',enum:['upsert','archive','restore']},presetId:str,name:str,style:{type:'object',properties:{shape:{type:'string',enum:['plain','ribbon','bunting','scallop']},pattern:{type:'string',enum:['solid','stripes','dots','checks','crosshatch','grid','image']},color:str,patternParams:BANNER_PARAMS_SCHEMA,image:BANNER_IMAGE_SCHEMA},required:['shape','pattern','color'],additionalProperties:false}},required:['timelineId','expectedVersion','action','presetId'],additionalProperties:false}},
];
