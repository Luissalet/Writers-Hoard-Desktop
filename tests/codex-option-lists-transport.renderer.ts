import '@/engines';
import '@/services/aiBridge/dispatch';
import {db} from '@/db';
async function prepare(){await db.projects.put({id:'transport-world',title:'Synthetic option-list transport',description:'',mode:'custom',type:'standalone',color:'#777777',status:'draft',enabledEngines:['codex'],engineOrder:['codex'],createdAt:1,updatedAt:1});(window as unknown as {__transportReady:boolean}).__transportReady=true;}
void prepare();
