import {testEditorialQuotePreparation} from './editorial-quote.browser';
import '@/engines';
import '@/services/aiBridge/dispatch';
import {db} from '@/db';
import {testEditorialStyle} from './editorial-style.browser';
import {testEditorialCore} from './editorial-core.browser';
import {runManuscriptRoundTripTests} from './manuscript-roundtrip.browser';
async function prepare(){
 const results=await testEditorialStyle();results.push(...await testEditorialQuotePreparation());Object.assign(window,{__editorialStage:'Editorial core regressions'});results.push(...await testEditorialCore());Object.assign(window,{__editorialStage:'Manuscript roundtrip regressions'});results.push(...await runManuscriptRoundTripTests());
 await db.projects.put({id:'editorial-native',title:'Synthetic editorial QA',description:'',mode:'custom',type:'standalone',color:'#d5b575',status:'draft',enabledEngines:['writings'],engineOrder:['writings'],worldEras:[{id:'past',name:'Past',description:'',revision:1,createdAt:1,updatedAt:1}],createdAt:1,updatedAt:1});
 await db.writings.put({id:'editorial-native-text',projectId:'editorial-native',title:'The crossing',content:'<p>Ágata crosses the square.</p><p>The lamps burn.</p>',wordCount:9,tags:[],status:'draft',createdAt:1,updatedAt:1});
 Object.assign(window,{__editorialReady:true,__editorialResults:results});
}void prepare().catch(error=>Object.assign(window,{__editorialFailure:error.stack??String(error)}));
