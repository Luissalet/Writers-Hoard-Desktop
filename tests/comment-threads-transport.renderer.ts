import '@/engines';
import '@/services/aiBridge/dispatch';
import {db} from '@/db';
async function prepare(){
 await db.projects.put({id:'transport-world',title:'Synthetic comments transport',description:'',mode:'custom',type:'standalone',color:'#777777',status:'draft',enabledEngines:['codex','writings','annotations'],engineOrder:[],createdAt:1,updatedAt:1});
 await db.writings.put({id:'transport-chapter',projectId:'transport-world',title:'The crossing',content:'<p>Ágata reaches the harbor.</p><p>The boat waits.</p>',wordCount:9,tags:[],status:'draft',createdAt:1,updatedAt:1});
 await db.projects.put({id:'comments-foreign',title:'Foreign',description:'',mode:'custom',type:'standalone',color:'#777777',status:'draft',enabledEngines:[],engineOrder:[],createdAt:1,updatedAt:1});await db.codexEntries.put({id:'comments-foreign-card',projectId:'comments-foreign',title:'Foreign',type:'character',fields:{},tags:[],relations:[],content:'',createdAt:1,updatedAt:1});Object.assign(window,{__commentsReady:true});
}
void prepare().catch(error=>Object.assign(window,{__commentsFailure:error.stack??String(error)}));
