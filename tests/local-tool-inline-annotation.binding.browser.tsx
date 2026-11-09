import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {Extension,type Editor} from '@tiptap/core';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import original from '@/engines/local/installed/examples.inline-clues/module';
import {defineLocalTool,LocalToolCollaborativeRichEditor,type LocalToolJson,type LocalToolProps} from '@/engines/local/sdk';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createLocalToolClient} from '@/engines/local/storage';
import {annotationCanonical,annotationSpec} from '@/engines/local/convergence/annotationFormat';
import {INLINE_ANNOTATION_ATTRIBUTE,annotationLabel,readInlineAnnotation} from '@/engines/local/collaborativeRich/inlineAnnotation';
import {useLocaleStore} from '@/stores/localeStore';

function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
/** The actual Source host, document creator, public component and native PM clipboard. */
export async function testInlineAnnotationBinding(){
 const element=document.getElementById('root');check(element,'Test root absent');
 const root=createRoot(element),projectId='own-inline-binding-'+crypto.randomUUID(),checks:string[]=[],previousLocale=useLocaleStore.getState().locale;
 let editor:Editor|undefined,mounted=false;
 const current=()=>{check(editor&&!editor.isDestroyed,'Normal editor absent');return editor;};
 const equal=(label:string,actual:unknown,expected:unknown)=>{check(annotationCanonical(actual)===annotationCanonical(expected),label+': '+JSON.stringify([actual,expected]));checks.push(label);Reflect.set(window,'__testStage',label);};
 const wait=async(predicate:()=>boolean,label:string)=>{for(let i=0;i<150;i++){if(predicate())return;await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});}throw Error(label+'; current='+JSON.stringify({text:element.textContent,editor:!!editor,editable:editor?.isEditable}));};
 const button=(name:string)=>Array.from(element.querySelectorAll('button')).find(value=>value.textContent===name);
 const click=async(name:string)=>{const target=button(name);check(target&&!target.disabled,'Button unavailable '+name);await act(async()=>target.click());};
 const select=async(from:number,to=from)=>{await act(async()=>{current().commands.setTextSelection({from,to});});};
 const input=async(name:string,value:string)=>{const control=element.querySelector('[aria-label="'+name+'"]');check(control instanceof HTMLInputElement||control instanceof HTMLSelectElement,'Control absent '+name);await act(async()=>{const setter=Object.getOwnPropertyDescriptor(control instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLSelectElement.prototype,'value')?.set;check(setter,'Native setter absent');setter.call(control,value);control.dispatchEvent(new Event(control instanceof HTMLInputElement?'input':'change',{bubbles:true}));});};
 const submit=async()=>{const form=element.querySelector('form[aria-label="Pista narrativa"]');check(form instanceof HTMLFormElement,'Annotation form absent');await act(async()=>form.requestSubmit());};
 const spans=()=>Array.from(current().view.dom.querySelectorAll('['+INLINE_ANNOTATION_ATTRIBUTE+']'));
 const attrs=()=>spans().map(span=>[span.textContent,readInlineAnnotation(span.getAttribute(INLINE_ANNOTATION_ATTRIBUTE),annotationSpec(original.codec?.fields.body))]);
 const text='Nadie miró la puerta del norte. Allí esperaba Ωriel.',selected='la puerta del norte',from=text.indexOf(selected)+1,to=from+selected.length;
 const presentation={label:'Pista narrativa',attributes:{clueKey:'Clave',state:'Estado'},values:{state:{hint:'Insinuada',revealed:'Revelada'}}};
 const extensions=[Extension.create({name:'observeInlineAnnotation2336',onCreate(){editor=this.editor;}})];
 function Fixture({client,context}:LocalToolProps<Record<string,LocalToolJson>>){return <LocalToolCollaborativeRichEditor client={client} context={context} field="body" label="Escena" annotationPresentation={presentation} extensions={extensions}/>;}
 const definition=defineLocalTool({...original,namespace:'qa.inline-binding',component:Fixture});
 const mount=async(documentId:string,namespace:string)=>{editor=undefined;await act(async()=>root.render(<MemoryRouter><LocalToolDocumentHost key={documentId} projectId={projectId} documentId={documentId} namespace={namespace}/></MemoryRouter>));mounted=true;await wait(()=>!!editor?.isEditable,'Normal Source editor not ready');};
 try{
  const freeStringSpec=annotationSpec({kind:'rich',profile:'paragraphs-inline/3',annotation:{id:'story.free-clue',version:1,attributes:{state:{type:'string'}}}});check(freeStringSpec,'Free string descriptor absent');
  for(const state of ['toString','hasOwnProperty'])equal('An empty own value-label map preserves the free string '+state,annotationLabel({state},freeStringSpec,{label:'Pista',attributes:{state:'Estado'},values:{state:{}}}),'Pista · Estado: '+state);
  const prototypeKeySpec=annotationSpec({kind:'rich',profile:'paragraphs-inline/3',annotation:{id:'story.prototype-key',version:1,attributes:{toString:{type:'string'}}}});check(prototypeKeySpec,'Prototype-named attribute descriptor absent');equal('An empty own attribute-label map preserves a prototype-named key',annotationLabel({toString:'own text'},prototypeKeySpec,{label:'Pista',attributes:{},values:{}}),'Pista · toString: own text');
  equal('An inherited class label cannot replace the descriptor label',annotationLabel({state:'hint'},freeStringSpec,Object.create({label:'Inherited class'})),'story.free-clue · state: hint');
  useLocaleStore.setState({locale:'es'});
  registerLocalToolModules({'./installed/qa.inline-binding/module.tsx':{default:definition}});
  await db.projects.add({id:projectId,title:'Own annotation binding',description:'Synthetic isolated Source UI',mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+definition.namespace],createdAt:1,updatedAt:1});
  const documentId=(await createSourceToolDocument({projectId},definition.namespace,'Own clue')).id,client=createLocalToolClient(projectId,definition,{documentId});
  check(client.convergence,'Normal convergence absent');await client.convergence.start(await client.read());await mount(documentId,definition.namespace);
  equal('The installed author example opens with unannotated own prose',current().getText(),text);
  await select(from,to);await click('Pista narrativa');await input('Clave','north-door');
  // Changing the view selection after focus left it must not retarget the captured units.
  await select(text.length+1);await submit();
  equal('The normal form applies the captured selection and full semantic attributes',attrs(),[[selected,{clueKey:'north-door',state:'hint'}]]);
  equal('The accessible annotation expresses its label, key and translated state',spans()[0]?.getAttribute('aria-label'),'Pista narrativa · Clave: north-door · Estado: Insinuada');
  await select(from+2);await click('Pista narrativa');await input('Estado','revealed');await submit();
  equal('A collapsed caret edits the entire existing annotation',attrs(),[[selected,{clueKey:'north-door',state:'revealed'}]]);
  const noOp=current().getJSON();await click('Pista narrativa');await submit();equal('Applying unchanged complete attrs leaves the prose exact',current().getJSON(),noOp);
  await click('Deshacer');equal('One normal Undo restores the complete previous attribute value',attrs(),[[selected,{clueKey:'north-door',state:'hint'}]]);
  await click('Rehacer');equal('Normal Redo restores the edited attributes',attrs(),[[selected,{clueKey:'north-door',state:'revealed'}]]);
  const beforeCancel=current().getJSON();await click('Pista narrativa');await input('Clave','discarded');await click('Cancelar');equal('Cancelling the form does not mutate the document',current().getJSON(),beforeCancel);
  await select(from,to);await act(async()=>{current().chain().setMark('bold').setLink({href:'https://example.com/clue'}).run();});
  equal('Annotation coexists with stock bold and a normal link',!!current().view.dom.querySelector('strong a['+INLINE_ANNOTATION_ATTRIBUTE+'],strong a ['+INLINE_ANNOTATION_ATTRIBUTE+'],a strong ['+INLINE_ANNOTATION_ATTRIBUTE+'],a ['+INLINE_ANNOTATION_ATTRIBUTE+'] strong, ['+INLINE_ANNOTATION_ATTRIBUTE+'] a strong, ['+INLINE_ANNOTATION_ATTRIBUTE+'] strong a'),true);
  await select(from+3);await act(async()=>{current().commands.insertContent('vieja Ω🙂 ');});
  equal('Typing Unicode inside a mark carries its complete semantic value',attrs().map(value=>value[0]).join(''),selected.slice(0,3)+'vieja Ω🙂 '+selected.slice(3));
  const annotatedBeforeSplit=attrs().map(value=>value[0]).join('');await act(async()=>{current().commands.splitBlock();});
  equal('Splitting an annotated paragraph keeps the same words and attrs',attrs().map(value=>value[0]).join(''),annotatedBeforeSplit);
  const splitPoint=current().state.selection.from,beforeMulti=current().getJSON();await select(from,from+annotatedBeforeSplit.length+2);await click('Pista narrativa');await input('Clave','two-paragraphs');await submit();equal('One captured form gesture annotates both paragraph ranges',spans().every(span=>readInlineAnnotation(span.getAttribute(INLINE_ANNOTATION_ATTRIBUTE),annotationSpec(definition.codec?.fields.body))?.clueKey==='two-paragraphs'),true);await click('Deshacer');equal('One Undo restores both paragraph attribute ranges exactly',current().getJSON(),beforeMulti);await select(splitPoint);
  await act(async()=>{current().commands.joinBackward();});equal('Joining preserves annotated Unicode prose',attrs().map(value=>value[0]).join(''),annotatedBeforeSplit);
  const end=from+annotatedBeforeSplit.length;await select(end);await act(async()=>{current().commands.insertContent(' OUTSIDE ');});equal('Typing at the noninclusive right edge does not acquire annotation',attrs().map(value=>value[0]).join(''),annotatedBeforeSplit);
  await select(from,end);const clipboard=new DataTransfer();await act(async()=>{current().view.dom.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:clipboard}));});
  const html=clipboard.getData('text/html'),plain=clipboard.getData('text/plain');check(html.includes(INLINE_ANNOTATION_ATTRIBUTE),'Native copy omitted semantic marker');equal('Native copy includes the readable Unicode text',plain,annotatedBeforeSplit);
  const copied=new DOMParser().parseFromString(html,'text/html').querySelector('['+INLINE_ANNOTATION_ATTRIBUTE+']');check(copied,'Copied marker absent');equal('Native HTML copy includes contract-bound complete attrs',readInlineAnnotation(copied.getAttribute(INLINE_ANNOTATION_ATTRIBUTE),annotationSpec(definition.codec?.fields.body)),{clueKey:'north-door',state:'revealed'});
  await select(current().state.doc.content.size-1);await act(async()=>{current().view.dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:clipboard}));});
  equal('Native paste into a compatible field preserves annotation attrs',spans().every(span=>annotationCanonical(readInlineAnnotation(span.getAttribute(INLINE_ANNOTATION_ATTRIBUTE),annotationSpec(definition.codec?.fields.body)))===annotationCanonical({clueKey:'north-door',state:'revealed'})),true);
  const beforeRemoval=current().getJSON();await select(from+2);await click('Pista narrativa');await click('Quitar anotación');equal('Normal removal clears the captured annotation without changing text',current().state.doc.resolve(from+2).marks().some(mark=>mark.type.name==='annotation'),false);await click('Deshacer');equal('Undo removal restores complete attributes and all other marks',current().getJSON(),beforeRemoval);
  await select(from,from+2);await act(async()=>{current().commands.setMark('annotation',{value:{clueKey:'pm-route',state:'hint'}});});equal('Normal PM admission carries an attribute replacement to the writer',readInlineAnnotation(spans()[0]?.getAttribute(INLINE_ANNOTATION_ATTRIBUTE)??null,annotationSpec(definition.codec?.fields.body)),{clueKey:'pm-route',state:'hint'});await click('Deshacer');equal('Undo PM attribute replacement restores the original mark graph',current().getJSON(),beforeRemoval);
  await click('Guardar cambios');await wait(()=>button('Guardar cambios')?.disabled===true,'Annotation draft not saved');
  const saved=(await client.convergence.export()).checkpoint;check(saved,'Normal save omitted checkpoint');
  await act(async()=>{root.render(null);});mounted=false;db.close();await db.open();await mount(documentId,definition.namespace);equal('Fresh normal Source mount after database reopen restores saved semantic values',spans().length>1,true);
  // Same native clipboard into a field with another annotation identity cannot reinterpret it.
  const incompatible=defineLocalTool({...definition,namespace:'qa.inline-binding-other',codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/3',annotation:{id:'story.other',version:1,attributes:{clueKey:{type:'string'},state:{type:'string',enum:['hint','revealed']}}}}}}});
  const legacy=defineLocalTool({...definition,namespace:'qa.inline-binding-legacy',codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/2'}}}});
  await act(async()=>{root.render(null);});mounted=false;
  registerLocalToolModules({'./installed/qa.inline-binding/module.tsx':{default:definition},'./installed/qa.inline-binding-other/module.tsx':{default:incompatible},'./installed/qa.inline-binding-legacy/module.tsx':{default:legacy}});
  await db.projects.update(projectId,{enabledEngines:[definition,incompatible,legacy].map(item=>'local-tool-'+item.namespace)});
  for(const destination of [incompatible,legacy]){await act(async()=>root.render(null));mounted=false;const id=(await createSourceToolDocument({projectId},destination.namespace,'Own incompatible paste')).id,target=createLocalToolClient(projectId,destination,{documentId:id});check(target.convergence,'Destination convergence absent');await target.convergence.start(await target.read());await mount(id,destination.namespace);await select(1);const before=current().getJSON(),persisted=await target.convergence.export();await act(async()=>{current().view.dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:clipboard}));});equal('Incompatible native paste leaves '+destination.namespace+' view exact',current().getJSON(),before);equal('Incompatible native paste leaves '+destination.namespace+' storage exact',(await target.convergence.export()).checkpoint,persisted.checkpoint);equal('Incompatible native paste leaves clipboard exact '+destination.namespace,[clipboard.getData('text/html'),clipboard.getData('text/plain')],[html,plain]);equal('Incompatible paste has a visible recoverable error '+destination.namespace,element.textContent?.includes('Esta anotación pertenece a un campo incompatible.'),true);}
  return checks;
 }catch(error){throw Error('Completed checks='+JSON.stringify(checks)+'; original='+String(error instanceof Error?error.stack:error));}finally{if(mounted)await act(async()=>root.unmount());else root.unmount();if(await db.projects.get(projectId))await deleteProject(projectId);useLocaleStore.setState({locale:previousLocale});}
}
