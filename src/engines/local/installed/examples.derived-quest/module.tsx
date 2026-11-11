import {defineLocalTool,type LocalToolJson} from '../../sdk';
import QuestLog from './QuestLog';

type Objective={id:string;text:string;done:boolean};
export type Quest={title:string;score:number;ready:boolean;objectives:Objective[];rewards:Record<string,number>;briefing:string};
const initialState:Quest={title:'',score:0,ready:false,objectives:[],rewards:{},briefing:''};
const object=(v:LocalToolJson):v is Record<string,LocalToolJson>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fieldDescription=(en:string,es:string)=>({en,es});
const definition=defineLocalTool<Quest>({
 namespace:'examples.derived-quest',
 name:fieldDescription('Quest log','Cuaderno de encargos'),
 description:fieldDescription('Track a quest and its objectives.','Organiza un encargo y sus objetivos.'),
 document:{defaultTitle:fieldDescription('New quest','Nuevo encargo')},
 initialState,
 stateFields:{version:1,fields:{
  title:{codec:{kind:'scalar'},agent:{description:fieldDescription('Name of the quest','Nombre del encargo'),schema:{type:'string',maxLength:100},index:true}},
  score:{codec:{kind:'scalar'},agent:{description:fieldDescription('Quest score','Puntuación del encargo'),schema:{type:'integer',minimum:0},index:true}},
  ready:{codec:{kind:'scalar'},agent:{description:fieldDescription('Ready to start','Preparado para empezar'),schema:{type:'boolean'},index:true}},
  objectives:{codec:{kind:'list',idKey:'id'},agent:{description:fieldDescription('Stable quest objectives','Objetivos del encargo'),schema:{type:'object',properties:{id:{type:'string',minLength:1},text:{type:'string',minLength:1,maxLength:200},done:{type:'boolean'}},required:['id','text','done'],additionalProperties:false}}},
  rewards:{codec:{kind:'map'},agent:{description:fieldDescription('Rewards by name','Recompensas por nombre'),schema:{type:'number',minimum:0}}},
  briefing:{codec:{kind:'prose'}},
 }},
 validateState:(value:LocalToolJson):value is Quest=>object(value)&&typeof value.title==='string'&&value.title.length<=100&&
  typeof value.score==='number'&&Number.isSafeInteger(value.score)&&value.score>=0&&typeof value.ready==='boolean'&&
  typeof value.briefing==='string'&&Array.isArray(value.objectives)&&
  value.objectives.every(item=>object(item)&&typeof item.id==='string'&&!!item.id&&typeof item.text==='string'&&!!item.text.trim()&&item.text.length<=200&&typeof item.done==='boolean')&&
  object(value.rewards)&&Object.values(value.rewards).every(amount=>typeof amount==='number'&&Number.isFinite(amount)&&amount>=0),
 component:QuestLog,
});
export default definition;
