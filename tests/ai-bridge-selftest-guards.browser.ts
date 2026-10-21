import '@/engines';
import { db } from '@/db';
import { createProject, deleteProject, updateProject } from '@/db/operations';
import { TOOL_HANDLERS } from '@/services/aiBridge/tools';
import { BRIDGE_TOOLS } from '@/services/aiBridge/manifest';
import { BridgeError, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { validateToolArgs } from '@/services/aiRuntime/toolPolicy';
import { selfTestGuardPlan, runSelfTest } from '@/services/aiBridge/selftest';
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
async function call(name:string,args:ToolArgs):Promise<any>{const tool=BRIDGE_TOOLS.find(x=>x.name===name)!;assert(validateToolArgs(tool.schema,args).ok,'invalid fixture '+name);return TOOL_HANDLERS[name](args);}
export async function testSelfTestGuardContract(){
 const failures:string[]=[],passed:string[]=[],proof:unknown[]=[];
 const plan=selfTestGuardPlan();console.log('GUARD_CLASSIFICATION '+JSON.stringify(plan));assert(plan.parentFixtures.includes('wh_update_writing')&&!plan.projectFirst.includes('wh_update_writing')&&plan.projectFirst.includes('wh_create_writing'),'optional project scope cannot reclassify known parent validation');
 const uncovered=selfTestGuardPlan([...BRIDGE_TOOLS,{name:'wh_new_unprobed_engine_write',description:'Fixture',writes:true,engineId:'writings',schema:{type:'object',properties:{id:{type:'string'}},required:['id']}}]).uncovered;
 assert(uncovered.includes('wh_new_unprobed_engine_write'),'a new engine write without any probe must remain a coverage failure');passed.push('Parent/project-first classification and new unprobed write completeness remain strict');
 const names=['wh_timeline_batch_apply','wh_wiki_profile_save','wh_wiki_profile_delete','wh_wiki_profile_publish','wh_wiki_profile_restore_config','wh_timeline_batch_undo'];
 for(const name of names){
  const projectId='guard-oracle-'+crypto.randomUUID(),now=Date.now();await createProject({id:projectId,title:'Guard oracle',mode:'custom',type:'standalone',enabledEngines:['timeline','codex'],engineOrder:['timeline','codex'],createdAt:now,updatedAt:now});
  try{
   let args:ToolArgs={projectId},eventId='';
   if(name.startsWith('wh_timeline')){
    const timeline=await call('wh_create_timeline',{projectId,title:'Host'}),event=await call('wh_create_event',{timelineId:timeline.id,title:'Kept'});eventId=event.id;
    const preview=await call('wh_timeline_batch_preview',{projectId});args={projectId,eventIds:[event.id],kind:'remove',expectedTargets:preview.targets};
    if(name.endsWith('_undo')){const result=await call('wh_timeline_batch_apply',args);args={projectId,receiptId:result.receiptId};assert(!await db.timelineEvents.get(eventId),'normal apply removes fixture');}
   }else if(name==='wh_wiki_profile_save')args={projectId,name:'Disabled new profile',options:{},expectedRevision:null};
   else{
    let profile=await call('wh_wiki_profile_save',{projectId,name:'Existing',options:{},expectedRevision:null});
    if(name==='wh_wiki_profile_restore_config'){
     profile=await call('wh_wiki_profile_publish',{projectId,profileId:profile.id,expectedRevision:profile.revision});const editionId=profile.editions[0].id;
     profile=await call('wh_wiki_profile_save',{projectId,profileId:profile.id,name:profile.name,options:{home:{title:'Changed'}},expectedRevision:profile.revision});
     args={projectId,profileId:profile.id,editionId,expectedRevision:profile.revision};
    }else args={projectId,profileId:profile.id,expectedRevision:profile.revision};
   }
   await updateProject(projectId,{enabledEngines:[]});
   const state=async()=>JSON.stringify({project:await db.projects.get(projectId),events:await db.timelineEvents.where('projectId').equals(projectId).toArray()});
   const before=await state();let code='returned';try{await call(name,args);}catch(error){code=error instanceof BridgeError?error.code:String(error);}
   const after=await state(),changed=before!==after;proof.push({name,args,code,changed,before:JSON.parse(before),after:JSON.parse(after)});
   if(name==='wh_timeline_batch_undo'){
    if(code!=='returned'||!await db.timelineEvents.get(eventId))failures.push(name+' must restore a valid session receipt while disabled, got '+code);
    else passed.push('Valid timeline receipt recovery remains available while engine disabled');
   }else if(code!=='engine-disabled'||changed)failures.push(`${name}: ${code}, mutated=${changed}`);
   else passed.push(name+' refuses engine-disabled before any mutation');
  }finally{await deleteProject(projectId);}
 }
 assert(!failures.length,'Valid disabled-engine guard contract: '+failures.join('; ')+'; proof='+JSON.stringify(proof));return passed.concat('GUARD_CLASSIFICATION '+JSON.stringify(plan),'GUARD_MUTATION_PROOF '+JSON.stringify(proof));
}

export async function testSelfTestUnprobedWrite(){
 const name='wh_selftest_unprobed_write_fixture';
 const injected={name,description:'Synthetic unprobed write; never executed.',writes:true,engineId:'notes',schema:{type:'object' as const,properties:{id:{type:'string'}},required:['id']}};
 let invoked=false;BRIDGE_TOOLS.push(injected);TOOL_HANDLERS[name]=async()=>{invoked=true;return{};};
 try{
  const report=await runSelfTest();const coverage=report.checks.find(check=>check.name==='every write tool that names an engine is actually covered');
  assert(report.failed===1&&coverage?.ok===false&&coverage.detail?.includes(name)&&report.cleanedUp&&!invoked,'Actual self-test must fail exactly coverage for a new unprobed engine write and clean up');
  return ['Actual self-test rejects a newly registered engine write without a probe, with exact completeness failure and scratch cleanup'];
 }finally{BRIDGE_TOOLS.splice(BRIDGE_TOOLS.indexOf(injected),1);delete TOOL_HANDLERS[name];}
}
