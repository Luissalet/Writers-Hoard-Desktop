import '@/engines';
import '@/services/aiBridge/dispatch';
import {db} from '@/db';
import {registerLocalToolModules} from '@/engines/local/registry';
import {saveWorldEra,saveEraDocument,readWorldDocument} from '@/services/worldEras/store';
import fixture from './fixtures/local-tools/author-kit';
import {authorCard,AUTHOR_PROJECT as P} from './fixtures/local-tools/author-data';
async function prepare(){registerLocalToolModules({'./installed/tests.author-kit/module.tsx':{default:fixture}});await db.projects.put({id:P,title:'Author kit integration',description:'',mode:'custom',type:'standalone',color:'#777777',status:'draft',enabledEngines:['codex'],engineOrder:[],createdAt:1,updatedAt:1});await db.codexEntries.put(authorCard());await saveWorldEra(P,{id:'future',name:'Future',description:'',revision:0,createdAt:1,updatedAt:1},null);const read=(await readWorldDocument({projectId:P,eraId:'future'},'codex','author-card'))!;await saveEraDocument({projectId:P,eraId:'future'},'codex',{...read.document,root:authorCard(P,'Future guide','5') as unknown as typeof read.document.root},read.version);Reflect.set(window,'__transportReady',true);}
void prepare();
