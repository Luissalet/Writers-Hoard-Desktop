// Production-Vite contract: real Source authors, shared lazy Three and an empty private profile.
// The existing esbuild IIFE CSS runner cannot prove this contract.
import '@/engines';
import '@/index.css';
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,Route,Routes,useParams} from 'react-router-dom';
import MainLayout from '@/components/layout/MainLayout';
import TopBar from '@/components/layout/TopBar';
import ProjectWorkspace from '@/components/project/workspace/ProjectWorkspace';
import {saveTabsState,tabsStorageKey} from '@/components/project/workspace/workspaceTabs';
import {workspaceRoute} from '@/components/project/workspace/routes';
import {getEngine} from '@/engines/_registry';
import {useLocaleStore} from '@/stores/localeStore';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {getPendingWritesSnapshot} from '@/services/pendingWrites';
import {triangleObj,triangleStl,trianglePly,triangleFbx,triangleGltf} from '../model-viewer-depth-fixtures';
import a from './author-a';import b from './author-b';import {probes} from './probe';
type Chunk={file:string;entry:boolean;facade:string|null;imports:string[];dynamicImports:string[];modules:string[];bytes:number};
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,20));
const same=(left:unknown,right:unknown,message:string)=>check(JSON.stringify(left)===JSON.stringify(right),message);
const resources=()=>performance.getEntriesByType('resource').map(row=>new URL(row.name).pathname.replace(/^\//,''));
let nativeSequence=0;
async function nativeClicks(buttons:HTMLButtonElement[]){
 const n=++nativeSequence,events=buttons.flatMap(button=>{const rect=button.getBoundingClientRect(),x=Math.round(rect.x+rect.width/2),y=Math.round(rect.y+rect.height/2),layout=JSON.stringify({n,author:button.closest<HTMLElement>('[data-three-author]')?.dataset.threeAuthor,rect:rect.toJSON(),center:{x,y},viewport:{width:innerWidth,height:innerHeight},rootRect:document.getElementById('root')?.getBoundingClientRect().toJSON(),scroll:{x:scrollX,y:scrollY}});check(rect.width>0&&rect.height>0,'Native author control has no layout '+layout);check(x>=0&&x<innerWidth&&y>=0&&y<innerHeight,'Native author control is outside viewport '+layout);return[{type:'mouseMove',x,y},{type:'mouseDown',button:'left',clickCount:1,x,y},{type:'mouseUp',button:'left',clickCount:1,x,y}];});
 Reflect.set(window,'__native',{n,events});
 for(let i=0;i<1500;i++){if(Reflect.get(window,'__nativeAck')===n)return;await pause();}throw Error('Native author click handshake did not complete');
}
export async function testSourceThreeCurrentImports(){
 const graph=Reflect.get(window,'__threeBuildGraph') as Chunk[];check(Array.isArray(graph),'Actual Vite output graph required');
 const vendor=graph.filter(row=>row.modules.some(id=>id.includes('/node_modules/three/')));check(vendor.length===1,'Expected actual one shared Three runtime chunk');
 const vendorFile=vendor[0].file,byFile=new Map(graph.map(row=>[row.file,row]));
 for(const fragment of ['/build/three.core.js','/loaders/OBJLoader.js','/loaders/GLTFLoader.js','/loaders/STLLoader.js','/loaders/PLYLoader.js','/loaders/FBXLoader.js'])check(vendor[0].modules.some(id=>id.endsWith(fragment)),'Missing real module '+fragment);
 const entry=graph.find(row=>row.entry&&row.facade?.replaceAll('\\','/').endsWith('/local-tool-three-runtime/index.html'));check(entry,'Own author entry absent');
 const eager=new Set<string>();function visit(file:string){if(eager.has(file))return;eager.add(file);for(const child of byFile.get(file)?.imports??[])visit(child);}visit(entry.file);
 check(!eager.has(vendorFile),'Author/SDK static import eagerly reaches Three');
 check([...eager].every(file=>!byFile.get(file)?.modules.some(id=>id.includes('/model-viewer/runtime.generated.txt'))),'Author entry eagerly contains the serialized offline Reader Three runtime');
 check(!resources().includes(vendorFile),'Cold fixture fetched Three before any invocation');
 check(await db.projects.count()===0,'Private fixture must start without projects');
 registerLocalToolModules({['./installed/'+a.namespace+'/module.tsx']:{default:a},['./installed/'+b.namespace+'/module.tsx']:{default:b}});
 const pid='three-author-'+crypto.randomUUID(),control=pid+'-control',project=(id:string)=>({id,title:'Own Three fixture',description:'Synthetic Source QA',mode:'custom' as const,type:'standalone' as const,status:'draft' as const,color:'#777',enabledEngines:['local-tool-'+a.namespace,'local-tool-'+b.namespace],engineOrder:['local-tool-'+a.namespace,'local-tool-'+b.namespace],createdAt:1,updatedAt:1});
 await db.projects.bulkPut([project(pid),project(control)]);const one=await createSourceToolDocument({projectId:pid},a.namespace,'Own A'),two=await createSourceToolDocument({projectId:pid},b.namespace,'Own B');
 const engine=getEngine('local-tool-'+a.namespace)!,otherEngine=getEngine('local-tool-'+b.namespace)!;check(engine&&otherEngine,'Registered author engines missing');
 const route='/project/'+pid+'/'+engine.id+'?document='+one.id,beside='companion:'+crypto.randomUUID();
 saveTabsState(pid,{tabs:[{id:beside,engineId:otherEngine.id,history:[workspaceRoute('/project/'+pid+'/'+otherEngine.id+'?document='+two.id)],index:0}],activeId:beside,closed:[]});
 function Workspace(){const {id}=useParams();return <><TopBar title="Own Three fixture"/><ProjectWorkspace projectId={id!} engines={[engine,otherEngine]}><engine.component projectId={id!}/></ProjectWorkspace></>;}
 // The production stylesheet gives the HTML scaffold #root a full viewport height.
 // Appending a second root after that scaffold places the fixture below the viewport.
 const container=document.getElementById('root');check(container instanceof HTMLElement&&container.childElementCount===0,'Own empty HTML root required');const root=createRoot(container);const canvases:HTMLCanvasElement[]=[],framebuffers:number[][]=[],disposers:(()=>void)[]=[];
 const snapshot=async()=>({projects:await db.projects.bulkGet([pid,control]),pending:getPendingWritesSnapshot()});
 try{
  useLocaleStore.setState({locale:'en',loaded:true});
  flushSync(()=>root.render(<MemoryRouter initialEntries={[route]}><Routes><Route element={<MainLayout/>}><Route path="/project/:id/:tab" element={<Workspace/>}/></Route></Routes></MemoryRouter>));
  for(let i=0;i<200&&probes.size!==2;i++)await pause();check(probes.size===2,'Two real Source author components did not mount');
  check([...probes.values()].every(value=>value.pending.length===0),'An author invoked Three on mount');check(!resources().includes(vendorFile),'Actual Source host fetched Three before invocation');
  const before=await snapshot(),buttons=[a.namespace,b.namespace].map(namespace=>container.querySelector<HTMLButtonElement>('[data-three-author="'+namespace+'"] [data-three-load]'));Reflect.set(window,'__threeSnapshots',{before});check(buttons.every((button):button is HTMLButtonElement=>button!==null),'Both own Source buttons required');check(container.querySelectorAll('[data-source-document-host]').length===2,'Native fixture did not mount two real Source hosts');Reflect.set(window,'__threePhase','cold-mounted');
  await nativeClicks(buttons);
  for(let i=0;i<200&&[...probes.values()].some(value=>value.pending.length!==2);i++)await pause();
  check([...probes.values()].every(value=>value.pending.length===2&&value.fulfilled===0),'Both creations must start before first import resolution');
  Reflect.set(window,'__threePhase','imports-in-flight');
  await Promise.all([...probes.values()].flatMap(value=>value.pending));
  const first=probes.get(a.namespace)!,second=probes.get(b.namespace)!;check(first.errors.length===0&&second.errors.length===0,'Real dynamic author import failed');
  const parts=first.results[0];check(parts&&first.results.length===2&&second.results.length===2,'Concurrent calls did not complete');
  for(const result of [...first.results,...second.results])for(let i=0;i<6;i++)check(result[i]===parts[i],'Module namespace duplicated across calls/creations at '+i);
  check(resources().filter(file=>file===vendorFile).length===1,'Cold parallel calls must request the one runtime chunk once');
  await nativeClicks([buttons[0]]);for(let i=0;i<200&&first.pending.length!==4;i++)await pause();check(first.pending.length===4,'Repeat native click did not reach author');await Promise.all(first.pending);for(let i=0;i<6;i++)check(first.results.at(-1)![i]===parts[i],'Repeat call changed module namespace');
  check(resources().filter(file=>file===vendorFile).length===1,'Repeat import fetched runtime again');
  const T=parts[0],manager=new T.LoadingManager();manager.setURLModifier(url=>{check(url.startsWith('data:'),'Fixture requested an external model resource');return url;});
  const obj=new parts[1].OBJLoader(manager).parse(triangleObj),stl=new parts[3].STLLoader(manager).parse(new TextEncoder().encode(triangleStl).buffer),ply=new parts[4].PLYLoader(manager).parse(new TextEncoder().encode(trianglePly).buffer),fbx=new parts[5].FBXLoader(manager).parse(new TextEncoder().encode(triangleFbx).buffer,'');
  const fixture=triangleGltf();fixture.json.images=undefined;fixture.json.textures=undefined;fixture.json.materials=undefined;delete ((fixture.json.meshes as {primitives:{material?:number}[]}[])[0].primitives[0]).material;
  (fixture.json.buffers as {uri:string}[])[0].uri='data:application/octet-stream;base64,'+btoa(String.fromCharCode(...new Uint8Array(fixture.bin)));
  const gltf=await new parts[2].GLTFLoader(manager).parseAsync(JSON.stringify(fixture.json),'');
  const roots=[obj,new T.Mesh(stl,new T.MeshBasicMaterial()),new T.Mesh(ply,new T.MeshBasicMaterial()),fbx,gltf.scene];
  disposers.push(()=>{for(const model of roots)model.traverse(object=>{if(object instanceof T.Mesh){object.geometry.dispose();for(const material of Array.isArray(object.material)?object.material:[object.material])material.dispose();}});});
  for(const model of roots){check(model instanceof second.results[0][0].Object3D,'Loader root does not share crosscreation Object3D');let triangles=0;model.traverse(object=>{if(object instanceof T.Mesh){check(object.geometry instanceof second.results[0][0].BufferGeometry,'Loader geometry runtime duplicated');triangles+=object.geometry.getAttribute('position').count/3;}});check(triangles>=1,'A real loader did not parse triangle geometry');}
  // Two real author views render their geometry with the shared constructor; no GPU fake.
  for(const [index,source]of [[0,roots[0]],[1,roots[3]]] as const){
   const canvas=document.createElement('canvas');canvases.push(canvas);buttons[index].parentElement!.append(canvas);const other=second.results[0][0];const renderer=new other.WebGLRenderer({canvas,antialias:false,preserveDrawingBuffer:true});renderer.setSize(64,64,false);renderer.setClearColor('#050507');
   const scene=new T.Scene(),camera=new T.PerspectiveCamera(45,1,.1,100);camera.position.set(0,1,5);camera.lookAt(0,1,0);const model=source.clone(true);model.traverse(object=>{if(object instanceof T.Mesh)object.material=new T.MeshBasicMaterial({color:'#ddaa44',side:T.DoubleSide});});disposers.push(()=>{model.traverse(object=>{if(object instanceof T.Mesh){for(const material of Array.isArray(object.material)?object.material:[object.material])material.dispose();}});renderer.dispose();renderer.forceContextLoss();});scene.add(model);renderer.render(scene,camera);
   const gl=renderer.getContext(),pixel=new Uint8Array(4);gl.readPixels(32,32,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);framebuffers.push([...pixel]);check(pixel[0]>80&&pixel[1]>40,'Actual crosscreation triangle produced no expected framebuffer pixel');
  }
  const after=await snapshot();Reflect.set(window,'__threeSnapshots',{before,after});same(after,before,'Imports/loaders/rendering changed saved Source or control project/pending ledger');
  Reflect.set(window,'__threeEvidence',{vendorFile,vendorBytes:vendor[0].bytes,actualHostCount:2,creationNamespaces:[a.namespace,b.namespace],coldBeforeInvocation:true,parallelNamespaceIdentity:true,repeatedNamespaceIdentity:true,loaders:['OBJ','GLTF','STL','PLY','FBX'],actualFramebuffers:canvases.length,framebuffers});
  return['Actual Vite Source authors: cold lazy shared runtime, concurrent/repeat namespace identity, five real local loaders and two real framebuffer triangles'];
 }finally{for(const dispose of disposers)dispose();flushSync(()=>root.unmount());await deleteProject(pid);await deleteProject(control);localStorage.removeItem(tabsStorageKey(pid));check(probes.size===0,'Source probe ownership leaked');check(await db.projects.count()===0,'Own project cleanup failed');Reflect.set(window,'__threeCleanup',{projects:0,hosts:document.querySelectorAll('[data-source-document-host]').length,probes:probes.size});}
}
testSourceThreeCurrentImports().then(tests=>Reflect.set(window,'__result',{ok:true,tests})).catch(error=>Reflect.set(window,'__result',{ok:false,error:error.stack||String(error)}));
