import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import JSZip from 'jszip';
import {db} from '@/db';
import type {Project,CodexEntry} from '@/types';
import {getAllEngines,getEngine,registerEngine} from '@/engines/_registry';
import {registerLocalToolModules,localToolEngineId} from '@/engines/local/registry';
import {createLocalToolClient} from '@/engines/local/storage';
import {defineLocalTool} from '@/engines/local/sdk';
import {localToolJsonText,validateLocalToolStates,LocalToolStateError,MAX_LOCAL_TOOL_STATE_BYTES,type LocalToolJson} from '@/engines/local/stateTypes';
import fixture from './fixtures/local-tools/notebook';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import {exportProjectData,importProjectData,deleteProject} from '@/db/operations';
import {BRIDGE_ENGINE_IDS} from '@/services/aiBridge/manifest';
const P='test-local-tool-sdk',Q=P+'-other';
const pause=()=>new Promise(resolve=>setTimeout(resolve,65));
function assert(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
const project=(id:string):Project=>({id,title:id,description:'',mode:'custom',type:'standalone',status:'draft',color:'#000',enabledEngines:['codex'],engineOrder:['codex'],createdAt:1,updatedAt:1});
export async function testLocalToolSdk():Promise<string[]>{
  const passed:string[]=[],host=document.getElementById('root')!,root=createRoot(host);let cloneId='';
  const expectReject=async(action:()=>unknown|Promise<unknown>,code?:string)=>{let caught:unknown;try{await action();}catch(error){caught=error;}assert(caught,`Expected rejection ${code}`);if(code)assert(caught instanceof LocalToolStateError&&caught.code===code,`Wrong error ${String(caught)}`);};
  const render=async(node:React.ReactNode)=>{await act(async()=>{root.render(<MemoryRouter>{node}</MemoryRouter>);await pause();});await act(async()=>{await pause();});};
  try{
    const builtinCount=getAllEngines().length;assert(!getEngine(localToolEngineId(fixture.namespace)),'default installation is empty');const bridge=[...BRIDGE_ENGINE_IDS];
    const before=(await db.projects.toArray()).map(project=>[project.id,project.enabledEngines]);
    const [engine]=registerLocalToolModules({'./installed/tests.notebook/module.tsx':{default:fixture}});assert(getEngine(engine.id)===engine&&getAllEngines().length===builtinCount+1&&Object.keys(engine.tables).length===0,'real registry receives tableless extension');
    assert(JSON.stringify((await db.projects.toArray()).map(project=>[project.id,project.enabledEngines]))===JSON.stringify(before)&&JSON.stringify(BRIDGE_ENGINE_IDS)===JSON.stringify(bridge),'registration neither enables projects nor changes MCP');
    await expectReject(()=>registerLocalToolModules({'./installed/other.namespace/module.tsx':{default:fixture}}));
    const collision={...engine,id:'local-tool-tests.collision'};registerEngine(collision);await expectReject(()=>registerLocalToolModules({'./installed/tests.collision/module.tsx':{default:{...fixture,namespace:'tests.collision'}}}));
    passed.push('SDK registry: explicit synthetic module, builtin/collision checks, empty default and no automatic project/MCP activation');

    let called=false;const getter=Object.defineProperty({},'x',{enumerable:true,get(){called=true;return 1;}}),recordGetter=Object.defineProperty({data:null,updatedAt:1},'revision',{enumerable:true,get(){called=true;return 1;}});
    const cycle:Record<string,unknown>={};cycle.self=cycle;
    for(const value of [undefined,()=>1,NaN,Infinity,1n,new Date(),new Blob(['x']),getter,cycle,[,1],{x:undefined},JSON.parse('{"__proto__":{}}'),{constructor:'x'},Object.create({x:1})])await expectReject(()=>localToolJsonText(value));
    await expectReject(()=>validateLocalToolStates({'tests.bad':recordGetter}));assert(!called,'JSON validation never invokes getters');
    const text='<script>window.__sdkInjected=1</script>';assert(JSON.parse(localToolJsonText({text})).text===text,'script-looking strings stay inert JSON');
    await expectReject(()=>localToolJsonText('x'.repeat(MAX_LOCAL_TOOL_STATE_BYTES)),'state-too-large');
    passed.push('SDK JSON: rejects executable/omitted/prototype/cyclic/getter payloads, bounds UTF-8 size and retains inert authored text');

    await db.projects.bulkPut([project(P),project(Q)]);const client=createLocalToolClient(P,fixture),other=createLocalToolClient(Q,fixture);
    assert((await client.read()).revision===null&&!((await db.projects.get(P))?.localToolStates),'reading defaults never writes');
    const initial=await client.save({version:1,notes:'Own project'},null);assert(initial.revision===1&&(await other.read()).data.notes==='','project scope separates same namespaces');
    initial.data.notes='Mutated returned value';assert((await client.read()).data.notes==='Own project','read/save values are detached');
    const writes=await Promise.allSettled([client.save({version:1,notes:'Writer A'},1),client.save({version:1,notes:'Writer B'},1)]);assert(writes.filter(result=>result.status==='fulfilled').length===1&&(await client.read()).revision===2,'same namespace CAS permits one concurrent writer');
    const sibling=defineLocalTool({...fixture,namespace:'tests.sibling'}),siblingClient=createLocalToolClient(P,sibling);await Promise.all([siblingClient.save({version:1,notes:'Sibling'},null),db.projects.update(P,{description:'Unrelated metadata survives'})]);assert((await client.read()).revision===2&&(await siblingClient.read()).data.notes==='Sibling'&&(await db.projects.get(P))?.description==='Unrelated metadata survives','separate namespaces and latest Project metadata merge');
    await expectReject(()=>client.save({version:1,notes:'stale'},1),'conflict');await expectReject(()=>client.save({version:1,notes:'x'.repeat(MAX_LOCAL_TOOL_STATE_BYTES)},2),'state-too-large');
    const largeStates=Object.fromEntries(Array.from({length:10},(_,index)=>[`budget.t${index}`,{revision:1,updatedAt:1,data:'x'.repeat(2000000)}]));await db.projects.update(Q,{localToolStates:largeStates});
    const any=defineLocalTool({...fixture,namespace:'budget.extra',initialState:null as LocalToolJson,validateState:(_value:LocalToolJson):_value is LocalToolJson=>true}),budget=createLocalToolClient(Q,any);
    await expectReject(()=>budget.save('x'.repeat(1500000),null),'project-too-large');assert(!(await db.projects.get(Q))?.localToolStates?.['budget.extra'],'project budget rejection is atomic');await db.projects.update(Q,{localToolStates:undefined});
    passed.push('SDK storage: detached defaults, project/namespace isolation, actual concurrent CAS, metadata merge and atomic per-tool/project budget refusal');

    const entry=(id:string,projectId:string,title:string):CodexEntry=>({id,projectId,title,type:'location',fields:{population:'42',long:'z'.repeat(1000)},content:'Private prose not exposed',avatar:'Private image not exposed',tags:[],relations:[],createdAt:1,updatedAt:1});
    await db.codexEntries.bulkPut([entry(P+'-entry',P,'Own harbor'),entry(Q+'-entry',Q,'Foreign secret')]);
    const cards=await client.queryCodex({query:'harbor'});assert(cards.length===1&&cards[0].fields.population==='42'&&cards[0].truncated&&!JSON.stringify(cards).includes('Private prose')&&!JSON.stringify(cards).includes('Private image'),'bounded meaningful projection');assert((await client.queryCodex({ids:[Q+'-entry']})).length===0,'foreign IDs never escape project scope');
    await expectReject(()=>client.queryCodex({limit:51}),'invalid-query');await expectReject(()=>client.queryCodex({query:'x'.repeat(201)}),'invalid-query');
    passed.push('SDK Codex: bounded typed local projection, explicit truncation, private bodies/images omitted and foreign IDs refused');

    const Component=engine.component;await render(<Component projectId={P}/>);let field=host.querySelector<HTMLTextAreaElement>('textarea');assert(field,'actual registered component reads state');
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,'Draft survives conflict');field!.dispatchEvent(new Event('input',{bubbles:true}));await pause();});
    const current=await client.read();await client.save({version:1,notes:'External latest'},current.revision);
    await act(async()=>{host.querySelector<HTMLButtonElement>('button')!.click();await pause();});assert(host.textContent?.includes('Conflict: draft retained')&&field.value==='Draft survives conflict'&&(await client.read()).data.notes==='External latest','real component retains failed draft and canonical data');
    await render(<Component key="other" projectId={Q}/>);field=host.querySelector('textarea');assert(field?.value===''&&!host.textContent?.includes('External latest'),'changing project yields independent component/client');
    passed.push('SDK actual engine component: persisted reads, conflict-visible draft retention and independent project instances');

    await render(<div/>);const archive=await createProjectZipArchive(P),zip=await JSZip.loadAsync(await archive.blob.arrayBuffer()),projectPath=Object.keys(zip.files).find(path=>path.endsWith('/project.json'))!;
    const metadata=JSON.parse(await zip.file(projectPath)!.async('string'))as Project;assert(metadata.localToolStates?.[fixture.namespace]?.revision===3,'ZIP carries source-extension state');
    await db.projects.update(P,{localToolStates:undefined});await importProjectZip(new File([archive.blob],'sdk.zip'),{replaceProjectIds:[P]});assert((await client.read()).data.notes==='External latest','real ZIP restores state without installed code execution');
    const badZip=await JSZip.loadAsync(await archive.blob.arrayBuffer());badZip.file(projectPath,JSON.stringify({...metadata,localToolStates:{'tests.bad':{revision:-1,updatedAt:1,data:null}}}));
    // Construct a real malformed ZIP for the preflight boundary, not only a DTO.
    const badBytes=await badZip.generateAsync({type:'uint8array'});await expectReject(()=>importProjectZip(new File([badBytes],'bad-state.zip'),{replaceProjectIds:[P]}));assert((await client.read()).data.notes==='External latest','malformed state rejected before replacement');
    cloneId=await importProjectData(await exportProjectData(P));const cloned=createLocalToolClient(cloneId,fixture);assert((await cloned.read()).revision===0&&(await cloned.read()).data.notes==='External latest','clone preserves opaque data and resets revisions');await cloned.save({version:1,notes:'Clone independent'},0);assert((await client.read()).data.notes==='External latest','clone write does not touch source');
    await deleteProject(P);await expectReject(()=>client.read(),'missing-project');await expectReject(()=>client.save({version:1,notes:'no resurrection'},3),'missing-project');assert(!(await db.projects.get(P)),'project deletion removes tool state and stale clients cannot resurrect it');
    passed.push('SDK portability/lifecycle: real ZIP state restore, poisoned archive preflight, independent JSON clone and project deletion without resurrection');
    return passed;
  }finally{await act(async()=>{root.unmount();await pause();});for(const id of [P,Q,cloneId].filter(Boolean))await deleteProject(id);}
}
