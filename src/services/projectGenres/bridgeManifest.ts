import {PROJECT_ID,type BridgeTool} from '@/services/aiBridge/schema';
const genres={type:'array',items:{type:'string'},description:'Genre labels, including custom labels. [] clears the list.'};
export const PROJECT_GENRE_TOOLS:BridgeTool[]=[
 {name:'wh_project_genres_get',writes:false,group:'core',description:'Read the main project’s genre labels, independent of its engine preset or fiction sessions.',schema:{type:'object',properties:{projectId:PROJECT_ID},additionalProperties:false}},
 {name:'wh_project_genres_set',writes:true,group:'core',description:'Set the main project’s genre labels while preserving unrelated metadata and subsequent edits.',schema:{type:'object',properties:{projectId:PROJECT_ID,genres,expectedGenres:{...genres,description:'Exact genre list last read. [] for a project without genres.'}},required:['genres','expectedGenres'],additionalProperties:false}},
];
