// Regression from the independent expired-era causal; explicit registry producers, real DB/adapter.
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {mountedSourceDocuments,createBrowserLocalToolOpenDocuments} from '@/engines/local/queryOpenDocuments';
export async function testLocalToolPublishedExpiredScope(){
 const P='own1890-scope-'+crypto.randomUUID(),NS='tests.peer1890.scope',scope={projectId:P,eraId:'E'},checks:string[]=[],pubs:ReturnType<typeof mountedSourceDocuments.createPublisher>[]=[],table=db.worldEraVariants,original=table.where;let release=()=>{};
 const check=(v:unknown,name:string)=>{if(!v)throw Error(name);checks.push(name);};
 try{
  check(db.tables.length===89&&(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),'health89zero');
  const documents=['D1','D2'].map(id=>({id,generation:id,namespace:NS,title:id,revision:1,createdAt:1,updatedAt:1,data:{score:7}}));
  await db.projects.add({id:P,title:P,description:P,mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:[],createdAt:1,updatedAt:1,sourceToolDocuments:documents,worldEras:[{id:'E',name:'E',description:'',revision:0,createdAt:1,updatedAt:1}]});
  for(const [i,document]of documents.entries()){const p=mountedSourceDocuments.createPublisher(scope,document.id,NS,'H'+i);pubs.push(p);p.publish({score:9+i});}
  const port=createBrowserLocalToolOpenDocuments(scope),query={namespace:NS,fields:{score:{path:'$.score',type:'number' as const}}};check((await port.queryPublished!(query)).length===2,'healthy exact-era adapter has two explicit publications');
  let enter!:()=>void;const entered=new Promise<void>(r=>enter=r),gate=new Promise<void>(r=>release=r);let held=false;
  // Only delay a real completed IDB variant read; all data and scope writes are real.
  Reflect.set(table,'where',function(...args:unknown[]){const clause=Reflect.apply(original,table,args),equals=clause.equals;clause.equals=function(key:unknown){const collection=Reflect.apply(equals,clause,[key]),first=collection.first;collection.first=async function(...firstArgs:unknown[]){const value=await Reflect.apply(first,collection,firstArgs);if(!held&&Array.isArray(key)&&key[0]===P&&key[3]==='D2'){held=true;enter();await gate;}return value;};return collection;};return clause;});
  const pending=port.queryPublished!(query);await entered;await db.projects.update(P,{worldEras:[]});check(!(await db.projects.get(P))!.worldEras?.length,'era actually removed before final reader settles');release();let rows:unknown[]|undefined,error='';try{rows=[...await pending];}catch(reason){error=String(reason);}
  console.error('PEER1890_SCOPE '+JSON.stringify({rows,error}));
  check(!!error||rows?.length===0,'expired era must not return captured published fields');
 }finally{release();table.where=original;for(const p of pubs)p.dispose();if(await db.projects.get(P))await deleteProject(P);check((await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),'finally89zero');}
 return checks;
}
