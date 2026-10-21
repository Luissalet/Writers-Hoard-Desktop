import '@/engines';
import '@/services/aiBridge/dispatch';
import {db} from '@/db';
async function prepare(){await db.projects.put({id:'transport-world',title:'Synthetic canvas transport',description:'',mode:'custom',type:'standalone',color:'#777777',status:'draft',enabledEngines:['board'],engineOrder:['board'],createdAt:1,updatedAt:1});await db.boards.put({id:'transport-pile-board',projectId:'transport-world',title:'Native pile board',surface:'slate',createdAt:1,updatedAt:1});(window as unknown as {__transportReady:boolean}).__transportReady=true;}
void prepare();
