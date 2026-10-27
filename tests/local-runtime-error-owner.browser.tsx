import {Error61Fixture,act,assertProse,untilProse,LocalToolDocumentHost,EngineErrorBoundary,editor61,button61,click61} from './local-runtime-errors.fixture';
import {NAMESPACE,packet,compiled} from './fixtures/local-tools/runtime-error-owner';
import {registerLocalToolModules} from '@/engines/local/registry';
import {getPendingWritesSnapshot} from '@/services/pendingWrites';

async function retainedErrorIdentity61(transitionCase:'runtime'|'compiled'){
 const cases:unknown[]=[],checks:string[]=[];let allOk=true;
 for(const transition of[transitionCase] as const){
  const h=new Error61Fixture(),observations:unknown[]=[];let phase='health',failure:unknown,cleanup:unknown;
  try{
   await h.seed('held-'+transition);const old=await packet('1.0.0'),next=await packet('2.0.0');await h.install(old.file);await h.install(next.file);
   registerLocalToolModules({'./installed/qa.error61-held-tool/module.tsx':{default:compiled}});
   const trial=await h.create(NAMESPACE,old.manifest.contentHash),targetId=trial.documentId;
   await h.call('wh_local_package_errors_clear',{namespace:NAMESPACE});
   await h.render(<><div data-held61-control><LocalToolDocumentHost projectId={h.f.projectId} documentId={h.f.document.id}/></div><EngineErrorBoundary resetKey={'owner61-'+transition} title="Own outer boundary" message="Own presenter failed" retryLabel="Outer recovery" detailsLabel="Details"><div data-held61-target><LocalToolDocumentHost projectId={trial.projectId} documentId={targetId} retainPresentation/></div></EngineErrorBoundary></>);
   const target=()=>document.querySelector('[data-held61-target]'),controlScope=()=>document.querySelector('[data-held61-control]');
   await untilProse(()=>!!target()&&!!editor61(target()!)&&!!controlScope()&&!!editor61(controlScope()!)&&target()!.querySelector('[data-held61-version]')?.getAttribute('data-held61-version')==='1.0.0','OWNER61_HEALTH_REAL_RUNTIME_AND_SOURCE_ABSENT');
   const rich=editor61(target()!),node=rich.view.dom,control=editor61(controlScope()!),controlNode=control.view.dom,targetSaved=await h.read(trial.projectId,NAMESPACE,targetId),controlSaved=await h.f.client.read(),pendingBefore=getPendingWritesSnapshot().dirty;
   await act(async()=>{rich.commands.setContent('<p>Own held draft61</p>');control.commands.setContent('<p>Own protected sibling61</p>');});
   await untilProse(()=>getPendingWritesSnapshot().dirty>pendingBefore&&rich.getText()==='Own held draft61'&&control.getText()==='Own protected sibling61','OWNER61_HEALTH_REAL_DRAFT_PENDING_ABSENT');
   assertProse(JSON.stringify(await h.read(trial.projectId,NAMESPACE,targetId))===JSON.stringify(targetSaved),'OWNER61_DRAFT_SAVED_BEFORE_PIN');checks.push('OWNER61_'+transition+'_REAL_RUNTIME_RICH_DRAFT_AND_SOURCE_HEALTH');
   phase='selected-authority-retained-presenter';const selectedHash=transition==='runtime'?next.manifest.contentHash:null;
   observations.push({beforePin:{oldHash:old.manifest.contentHash,selectedHash,nodeConnected:node.isConnected,text:rich.getText(),pending:getPendingWritesSnapshot()}});
   await h.call('wh_local_tool_pin',{projectId:trial.projectId,namespace:NAMESPACE,contentHash:selectedHash,expectedRevision:1});
   await untilProse(()=>!!target()?.querySelector('[data-held61-version][data-held61-canedit="false"]'),'OWNER61_OLD_PRESENTER_NOT_RETAINED_AFTER_PIN');
   observations.push({afterPin:{nodeConnected:node.isConnected,text:rich.getText(),version:target()?.querySelector('[data-held61-version]')?.getAttribute('data-held61-version'),dom:target()?.innerHTML,pending:getPendingWritesSnapshot()}});
   assertProse(node.isConnected&&editor61(target()!)===rich&&rich.getText()==='Own held draft61'&&!rich.isEditable,'OWNER61_SELECTED_PIN_DESTROYED_REAL_RETAINED_DRAFT');
   assertProse(target()?.querySelector('[data-held61-version]')?.getAttribute('data-held61-version')==='1.0.0','OWNER61_THROW_WOULD_USE_NEW_COMPONENT');
   assertProse(controlNode.isConnected&&editor61(controlScope()!)===control&&control.getText()==='Own protected sibling61'&&JSON.stringify(await h.f.client.read())===JSON.stringify(controlSaved),'OWNER61_PIN_CHANGED_OTHER_SOURCE_DRAFT');
   phase='old-presenter-error-identity';await click61(button61('Throw retained runtime61',target()!));
   await untilProse(async()=>{const observed=await h.call('wh_local_package_errors',{namespace:NAMESPACE,phase:'render'});const fallback=!!button61('Retry engine')||!!button61('Outer recovery');observations.push({oldThrowPoll:{feed:observed,fallback,targetDom:target()?.innerHTML,rootDom:document.getElementById('root')?.innerHTML}});return fallback||observed.errors.length>0;},'OWNER61_ACTUAL_OLD_THROW_NOT_OBSERVED');
   const oldFeed=await h.call('wh_local_package_errors',{contentHash:old.manifest.contentHash,phase:'render'}),newFeed=await h.call('wh_local_package_errors',{contentHash:next.manifest.contentHash,phase:'render'}),namespaceFeed=await h.call('wh_local_package_errors',{namespace:NAMESPACE,phase:'render'});
   observations.push({afterThrow:{oldFeed,newFeed,namespaceFeed,dom:document.getElementById('root')?.innerHTML,controlConnected:controlNode.isConnected,controlText:control.getText()}});
   assertProse(oldFeed.errors.length===1&&oldFeed.errors[0].namespace===NAMESPACE&&oldFeed.errors[0].count===1&&oldFeed.errors[0].errorType==='RangeError','OWNER61_OLD_RENDER_ATTRIBUTED_TO_SELECTED_AUTHORITY');
   assertProse(newFeed.errors.length===0&&namespaceFeed.errors.length===1&&namespaceFeed.errors[0].contentHash===old.manifest.contentHash,'OWNER61_NEW_OR_COMPILED_SOURCE_ABSORBED_OLD_RENDER');
   assertProse(controlNode.isConnected&&editor61(controlScope()!)===control&&control.getText()==='Own protected sibling61'&&JSON.stringify(await h.f.client.read())===JSON.stringify(controlSaved),'OWNER61_THROW_CHANGED_OTHER_SOURCE_DRAFT');
   assertProse(JSON.stringify(await h.read(trial.projectId,NAMESPACE,targetId))===JSON.stringify(targetSaved),'OWNER61_THROW_CHANGED_SAVED_DOCUMENT');checks.push('OWNER61_'+transition+'_OLD_RENDER_IDENTITY_AND_OTHER_DRAFT_EXACT');
   if(transition==='compiled'){
    phase='actual-compiled-source-excluded';
    await h.render(<><div data-held61-control><LocalToolDocumentHost projectId={h.f.projectId} documentId={h.f.document.id}/></div><EngineErrorBoundary resetKey="actual-compiled61" title="Own outer boundary" message="Own presenter failed" retryLabel="Outer recovery" detailsLabel="Details"><div data-held61-target><LocalToolDocumentHost key="adopt-compiled61" projectId={trial.projectId} documentId={targetId} retainPresentation/></div></EngineErrorBoundary></>);
    await untilProse(()=>!!button61('Throw compiled Source61',target()??document),'OWNER61_ACTUAL_COMPILED_COMPONENT_ABSENT');
    const beforeCompiled=await h.call('wh_local_package_errors',{namespace:NAMESPACE,phase:'render'});await click61(button61('Throw compiled Source61',target()!));await untilProse(()=>!!button61('Outer recovery'),'OWNER61_ACTUAL_SOURCE_THROW_NOT_OBSERVED');
    const afterCompiled=await h.call('wh_local_package_errors',{namespace:NAMESPACE,phase:'render'});observations.push({actualCompiledThrow:{beforeCompiled,afterCompiled,dom:document.getElementById('root')?.innerHTML}});
    assertProse(JSON.stringify(afterCompiled)===JSON.stringify(beforeCompiled),'OWNER61_COMPILED_SOURCE_ERROR_ABSORBED_BY_RUNTIME_FEED');
    assertProse(controlNode.isConnected&&editor61(controlScope()!)===control&&control.getText()==='Own protected sibling61'&&JSON.stringify(await h.f.client.read())===JSON.stringify(controlSaved),'OWNER61_SOURCE_THROW_CHANGED_OTHER_DRAFT');checks.push('OWNER61_ACTUAL_COMPILED_SOURCE_RENDER_EXCLUDED');
   }
  }catch(error){failure=error instanceof Error?error.stack:String(error);observations.push({failureDom:document.getElementById('root')?.innerHTML});}
  finally{cleanup=await h.cleanup();}
  const ok=!failure&&(cleanup as any)?.all89Empty===true;allOk=allOk&&ok;cases.push({transition,ok,phase,failure,observations,replies:h.replies,cleanup});
 }
 return{ok:allOk,checks,cases};
}

export async function testLocalRuntimeErrorOwnerRuntime(){const result=await retainedErrorIdentity61('runtime');assertProse(result.ok,JSON.stringify(result));return result.checks;}
export async function testLocalRuntimeErrorOwnerCompiled(){const result=await retainedErrorIdentity61('compiled');assertProse(result.ok,JSON.stringify(result));return result.checks;}
