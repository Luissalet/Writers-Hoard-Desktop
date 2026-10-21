import {prepareEditionFixture,testPublishedEditions} from './published-editions.browser';
import {db} from '@/db';
Object.assign(window,{__failEditionUndo:(entityId:string)=>{
 const fail=(_changes:unknown,_key:unknown,row:{entityId:string})=>{if(row.entityId===entityId)throw Error('synthetic_second_draft_hide_failure');};
 db.worldEraVariants.hook('updating',fail);
 Object.assign(window,{__clearEditionUndoFailure:()=>db.worldEraVariants.hook('updating').unsubscribe(fail)});
}});
void(async()=>{const results=await testPublishedEditions();await prepareEditionFixture('editions-native');Object.assign(window,{__editionNativeReady:true,__editionResults:results});})().catch(error=>Object.assign(window,{__editionNativeFailure:error.stack??String(error)}));
