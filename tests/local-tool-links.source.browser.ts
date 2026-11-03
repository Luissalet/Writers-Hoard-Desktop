import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import definition from '@/engines/local/installed/examples.shared-links/module';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument,readSourceToolDocument} from '@/engines/local/documents/store';
import {remapSourceToolDocument} from '@/engines/local/documents/portability';
import {createLocalToolReplica} from '@/engines/local/convergence/replica';
import {convergenceCanonical} from '@/engines/local/convergence/format';
import {runBridgeTool} from '@/services/aiBridge/dispatch';

/** Real Source RW, normal dispatcher, original installed example, and portable bytes. */
export async function testSourceLinks(){
 const checks:string[]=[],P='own-links-source-'+crypto.randomUUID(),NS=definition.namespace,scope={projectId:P};
 const eq=(name:string,a:unknown,b:unknown)=>{if(convergenceCanonical(a)!==convergenceCanonical(b))throw Error(name);checks.push(name);(globalThis as typeof globalThis&{__linksProgress?:string[]}).__linksProgress=checks;},refused=async(name:string,run:()=>Promise<unknown>)=>{let error='';try{await run();}catch(e){error=String(e);}eq(name,error.length>0,true);};
 try{
  eq('health private89zero',db.tables.length===89&&(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);registerLocalToolModules({'./installed/examples.shared-links/module.tsx':{default:definition}});await db.projects.add({id:P,title:P,description:P,mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+NS],createdAt:1,updatedAt:1});const D=(await createSourceToolDocument(scope,NS,'Links')).id,client=createLocalToolClient(P,definition,{documentId:D}),started=await client.convergence!.start(await client.read()),G=started.checkpoint;
  eq('original example is native4',G.engine.version,'4');
  for(const[field,nodeId]of[['body','P'],['outline','Q']] as const){
   const {range}=await client.convergence!.richRange(field,nodeId,0,2),before=await client.read(),response=await runBridgeTool('wh_local_tool_state_apply',{projectId:P,namespace:NS,documentId:D,baseline:before,actions:[{type:'rich-link',field,nodeId,range,href:'https://example.org/'+field+'?q=1#unicode'}]});eq(field+' normal dispatcher apply',response.ok,true);eq(field+' Source contains href',JSON.stringify((await client.read()).data).includes('https://example.org/'+field+'?q=1#unicode'),true);
  }
  const exact=await client.read(),original=await client.convergence!.export(),project=await db.projects.get(P),readonly=createLocalToolClient(P,definition,{documentId:D,readOnly:true}),capture=await readonly.convergence!.richRange('body','P',0,2);
  await readonly.convergence!.export();await readonly.read();eq('readonly reads/captures leave all own Source exact',await db.projects.get(P),project);await refused('readonly apply rejects',()=>readonly.state!.apply(exact,[{type:'rich-link',field:'body',nodeId:'P',range:capture.range,href:null}]));eq('readonly reject atomic',await client.read(),exact);
  const aside=await client.convergence!.richRange('aside','S',0,2),bad=await runBridgeTool('wh_local_tool_state_apply',{projectId:P,namespace:NS,documentId:D,baseline:exact,actions:[{type:'rich-link',field:'body',nodeId:'P',range:capture.range,href:null},{type:'rich-link',field:'aside',nodeId:'S',range:aside.range,href:'https://example.org/invalid'}]});eq('mixed field1 dispatcher rejection',bad.ok,false);eq('mixed failed batch Source exact',await client.read(),exact);eq('mixed failed batch checkpoint exact',(await client.convergence!.export()).checkpoint,original.checkpoint);
  let alive=true;const leased=createLocalToolClient(P,definition,{documentId:D,isCurrent:()=>alive}),pending=leased.convergence!.richRange('body','P',0,2);alive=false;await refused('retired original client read refuses',()=>pending);eq('retired capture did not write',await client.read(),exact);
  const zip=await createProjectZipArchive(P),beforeZip=(await readSourceToolDocument(scope,D,NS))!.document;await client.state!.apply(await client.read(),[{type:'rich-link',field:'body',nodeId:'P',range:capture.range,href:'https://example.org/discarded'}]);await importProjectZip(new File([zip.blob],'own-links.zip',{type:'application/zip'}),{replaceProjectIds:[P]});eq('same-ID ZIP keeps complete Source', (await readSourceToolDocument(scope,D,NS))!.document,beforeZip);eq('same-ID ZIP checkpoint exact',(await client.convergence!.export()).checkpoint,original.checkpoint);
  const fork=remapSourceToolDocument(beforeZip,(id,prefix)=>prefix+'-copy-'+id);eq('semantic copy preserves href/data',fork.data,beforeZip.data);eq('semantic copy forks causal identity',fork.convergence!.checkpoint.genesisId!==beforeZip.convergence!.checkpoint.genesisId,true);const verifier=createLocalToolReplica(fork.convergence!.checkpoint,{authorId:'copy-reader',contract:{namespace:NS,codec:definition.codec!,validationId:G.validationId,schemaEpoch:G.schemaEpoch,validateState:definition.validateState}});try{eq('copy current reader data',verifier.read(),fork.data);let failed=false;try{verifier.apply([{type:'rich-link',field:'body',nodeId:'P',range:capture.range,href:null}]);}catch{failed=true;}eq('copy old capture rejected',failed,true);}finally{verifier.destroy();}
  db.close();await db.open();eq('cold real Source data', (await client.read()).data,exact.data);eq('cold real Source origin/checkpoint',(await client.convergence!.export()).checkpoint,original.checkpoint);
 }finally{if(await db.projects.get(P))await deleteProject(P);eq('cleanup89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);}
 return checks;
}
