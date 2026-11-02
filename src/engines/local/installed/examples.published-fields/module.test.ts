import definition from './module';
import {createFakeLocalToolHost} from '@/engines/local/testing';
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
export async function testLocalToolScaffold(){
 const scope={projectId:'published-author'},namespace=definition.namespace,host=createFakeLocalToolHost(definition,{projects:[{id:scope.projectId,updatedAt:1,sourceToolDocuments:[{id:'A',namespace,title:'A',revision:1,createdAt:1,updatedAt:1,data:{score:7,note:'saved'}}]}]}),reader=host.createClient(scope,true,'A'),query={namespace,fields:{score:{path:'$.score',type:'number' as const}}};
 const before=JSON.stringify(host.inspect());check((await reader.openDocuments!.queryPublished!(query)).length===0,'A client query created a producer');const one=host.mountDocumentPublisher(scope,'A'),two=host.mountDocumentPublisher(scope,'A');
 try{one.documentFields.publish({score:9,note:'draft one'});two.documentFields.publish({score:11,note:'draft two'});const rows=await reader.openDocuments!.queryPublished!(query);check(rows.length===2&&new Set(rows.map(row=>row.instanceId)).size===2,'Two drafts were collapsed');check(JSON.stringify(host.inspect())===before,'Publishing changed saved data');check((await reader.read()).data.score===7,'A draft was saved implicitly');const baseline=await one.client.read();await one.client.save({score:9,note:'draft one'},baseline.revision,baseline.document?.version);const after=await reader.openDocuments!.queryPublished!(query);check(after.length===1&&after[0].instanceId===two.instanceId&&after[0].fields.score===11,'Save retired another instance publication');}
 finally{one.dispose();two.dispose();}check((await reader.openDocuments!.queryPublished!(query)).length===0,'A disposed producer survived');
 return['Normal author module kit: explicit9/11 publications leave saved7 exact and distinct; Save retires only its instance and dispose leaves no producer'];
}
