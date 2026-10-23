import {Activity,Component,StrictMode,act,type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import type {Editor} from '@tiptap/react';
import TiptapEditor from '@/components/editor/TiptapEditor';
const assert=(value:unknown,message:string):asserts value=>{if(!value)throw Error(message);};
const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
class Boundary extends Component<{children:ReactNode;failed:(error:Error)=>void},{error:string}>{
 state={error:''};static getDerivedStateFromError(error:Error){return{error:error.message};}componentDidCatch(error:Error){this.props.failed(error);}render(){return this.state.error?<p role="alert">{this.state.error}</p>:this.props.children;}
}
export async function testTiptapReconnect(){
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),errors:Error[]=[],edits:string[]=[],created:Editor[]=[];let current:Editor|null=null;
 // Force the lifetime interleaving during the real StrictMode effect replay:
 // the previous real Editor is released at cleanup, before its captured
 // passive effects reconnect. No serializer, schema or useEditor is mocked.
 let expireOnCleanup=true;
 const ready=(editor:Editor|null)=>{if(!editor&&expireOnCleanup&&current&&!current.isDestroyed){expireOnCleanup=false;current.destroy();}current=editor;if(editor&&!created.includes(editor))created.push(editor);};
 const render=async(visible:boolean,content:string)=>{await act(async()=>{root.render(<StrictMode><MemoryRouter><Boundary failed={error=>errors.push(error)}><Activity mode={visible?'visible':'hidden'}><TiptapEditor content={content} onChange={html=>edits.push(html)} onEditorReady={ready}/></Activity></Boundary></MemoryRouter></StrictMode>);});await act(async()=>{await pause();});};
 const until=async(check:()=>boolean,label:string)=>{for(let i=0;i<100;i++){if(check())return;await act(async()=>{await pause();});}throw Error('Timed out '+label);};
 try{
  await render(true,'<p>Saved original prose.</p>');assert(!errors.length,'Initial editor failed: '+errors[0]?.stack);await until(()=>!!current&&!current.isDestroyed,'initial real editor');const first=current!;
  await render(false,'<p>Saved original prose.</p>');await until(()=>first.isDestroyed,'hidden editor destruction');
  await render(true,'<p>Latest external prose &amp; retained text.</p>');
  assert(!errors.length,'Real Tiptap passive-effect reconnect failed: '+errors[0]?.stack);
  await until(()=>!!current&&!current.isDestroyed,'reconnected real editor');assert(current!==first&&current!.getHTML()==='<p>Latest external prose &amp; retained text.</p>','Recreated editor lost the current external snapshot');
  assert(!edits.length,'Lifecycle or external sync emitted content to persistence');
  await act(async()=>{current!.commands.insertContent(' Authored after reconnect.');});assert(edits.length===1&&edits[0].includes('Latest external prose')&&edits[0].includes('Authored after reconnect.'),'Normal authoring stopped after reconnect');
  await render(true,'<p>Restored version after reconnect.</p>');assert(current!.getHTML()==='<p>Restored version after reconnect.</p>'&&edits.length===1,'External sync was disabled or emitted a phantom edit');
  return['Real StrictMode editor effect disconnect/destroy/reconnect retains latest external HTML without null-schema access or phantom writes','Author edits still emit exact content and subsequent version restore syncs silently after reconnect'];
 }finally{await act(async()=>root.unmount());host.remove();}
}
