import assert from './local-tool-collaborative-rich.assert';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {Extension,type Editor} from '@tiptap/core';
import {AllSelection} from '@tiptap/pm/state';
import {defineLocalTool,createLocalToolReplica,type LocalToolJson,type RichBlockDocument} from '@/engines/local/sdk';
import {createFakeLocalToolHost} from '@/engines/local/testing';
import CollaborativeRichRenderer from '@/engines/local/collaborativeRich/Renderer';
import {blockPMLeaves} from '@/engines/local/collaborativeRich/blockProsemirror';
import {useLocaleStore} from '@/stores/localeStore';

export async function testBlockEditor(){
 const checks:string[]=[],locale=useLocaleStore.getState().locale,element=document.createElement('div');document.body.append(element);let root=createRoot(element),editor:Editor|undefined,peer:ReturnType<typeof createLocalToolReplica>|undefined;
 const equal=(name:string,a:unknown,b:unknown)=>{assert.deepStrictEqual(a,b,name);checks.push(name);};
 const tick=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));});
 const wait=async(check:()=>boolean,name:string)=>{for(let i=0;i<160;i++){if(check())return;await tick();}throw Error(name+' timed out: '+element.textContent);};
 const capture=Extension.create({name:'captureBlockEditor',onCreate(){editor=this.editor;}}),extensions=[capture];
 const data={opaque:'Élodie你🙂',body:{type:'block-doc',schema:'writers-blocks/1',blocks:[{id:'P',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:null,content:[{type:'text',text:'ab'}]},{id:'Q',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:'P',content:[{type:'text',text:'gh'}]}]}} as LocalToolJson;
 const definition=defineLocalTool({namespace:'tests.blocks1883.dom',name:{en:'Blocks',es:'Bloques'},description:{en:'Mounted blocks test',es:'Prueba montada de bloques'},initialState:data,codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/1',schema:'writers-blocks/1'}}},validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&v.opaque==='Élodie你🙂',component:()=>null});
 const host=createFakeLocalToolHost(definition,{projects:[{id:'blocks-dom',updatedAt:1,sourceToolDocuments:[{id:'doc',namespace:definition.namespace,title:'Blocks',generation:'g',revision:1,createdAt:1,updatedAt:1,data,codec:definition.codec}]}]}),client=host.createClient({projectId:'blocks-dom'},false,'doc');
 const mount=async(readOnly=false)=>{await act(async()=>root.render(<CollaborativeRichRenderer client={client} definition={definition} field="body" readOnly={readOnly} extensions={extensions}/>));};
 const button=(label:string)=>[...element.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===label)??(()=>{throw Error('Button missing '+label+': '+element.textContent);})();
 const click=async(label:string)=>{await act(async()=>button(label).click());await tick();equal(label+':no-recovery-alert',element.querySelector('[role="alert"]'),null);};
 const select=async(id:string,from:number,to=from)=>{const n=blockPMLeaves(editor!.state.doc).find(n=>n.id===id)!;assert.equal(!!n,true,'Leaf '+id);await act(async()=>{editor!.commands.setTextSelection({from:n.pos+1+from,to:n.pos+1+to});});};
 try{
  useLocaleStore.setState({locale:'en'});await mount();await wait(()=>!!element.querySelector('[data-sdk-rich-baseline]'),'passive baseline');equal('passive-root-paragraphs',element.querySelectorAll('[data-sdk-rich-baseline] p').length,2);equal('baseline-no-start',(await client.convergence!.export()).checkpoint,null);await click('Activate shared editing');await wait(()=>!!editor?.isEditable,'mounted editor');
  const G=(await client.convergence!.export()).checkpoint!;peer=createLocalToolReplica(G,{authorId:'B',contract:{namespace:definition.namespace,codec:definition.codec!,validationId:G.validationId,schemaEpoch:G.schemaEpoch,validateState:definition.validateState}});
  for(const level of [1,2,3]){await select('P',0,1);await click('H'+level);equal('H'+level+'-actual-DOM',element.querySelector(`h${level}[data-writer-block="P"]`)?.textContent,'ab');}
  await click('Paragraph');await select('P',0);const end=blockPMLeaves(editor!.state.doc).find(n=>n.id==='Q')!;await act(async()=>{editor!.commands.setTextSelection({from:1,to:end.pos+3});});await click('Bullet list');equal('real-list-items',element.querySelectorAll('.tiptap ul>li').length,2);
  const remote=peer.apply([{type:'rich-text-splice',field:'body',nodeId:'Q',range:peer.richRange('body','Q',1,1),text:'X',marks:['italic']}]);await act(async()=>{await client.convergence!.import(remote.update);});await wait(()=>editor!.getText().includes('gXh'),'remote B');await click('Undo');equal('structural-Undo-keeps-B',editor!.getText().includes('gXh'),true);equal('Undo-removes-only-list',element.querySelectorAll('.tiptap ul').length,0);await click('Redo');equal('Redo-list',element.querySelectorAll('.tiptap ul>li').length,2);
  await select('Q',0,1);await click('Numbered list');equal('real-numbered-list',element.querySelectorAll('.tiptap ol>li').length,2);await click('Numbered list');equal('list-toggle-off',element.querySelectorAll('.tiptap ol,.tiptap ul').length,0);
  await select('Q',3);await act(async()=>{editor!.commands.insertContent('你🙂');});await tick();equal('accepted-normal-typing',editor!.getText().includes('gXh你🙂'),true);equal('typing-no-recovery',element.querySelector('[role="alert"]'),null);
  await select('Q',1);await act(async()=>{editor!.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});await tick();equal('Enter-adds-real-leaf',blockPMLeaves(editor!.state.doc).length,3);const born=blockPMLeaves(editor!.state.doc).find(n=>n.id!=='P'&&n.id!=='Q')!;equal('Enter-caret-new-leaf',editor!.state.selection.from,born.pos+1);equal('Enter-prefix',blockPMLeaves(editor!.state.doc).find(n=>n.id==='Q')!.node.textContent,'g');
  await act(async()=>{editor!.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',bubbles:true,cancelable:true}));});await tick();equal('Backspace-joins-tree-leaf',blockPMLeaves(editor!.state.doc).length,2);equal('Backspace-keeps-bytes',blockPMLeaves(editor!.state.doc).find(n=>n.id==='Q')!.node.textContent,'gXh你🙂');equal('Backspace-no-recovery',element.querySelector('[role="alert"]'),null);
  await select('Q',0,1);await click('Blockquote');equal('quote-normal-DOM',element.querySelector('.tiptap blockquote')?.textContent,'gXh你🙂');await click('Blockquote');await click('Toggle');equal('toggle-normal-summary',element.querySelector('.tiptap details>summary')?.textContent,'gXh你🙂');
  await click('Save changes');await wait(()=>button('Save changes').disabled,'Save ACK');const saved=(await client.read()).data;equal('normal-save-keeps-opaque',(saved as Record<string,LocalToolJson>).opaque,'Élodie你🙂');const savedBody=(saved as Record<string,LocalToolJson>).body as unknown as RichBlockDocument;equal('normal-save-has-toggle',savedBody.blocks.some(b=>b.type==='toggle'),true);
  const beforeCollapse=await client.convergence!.export(),details=element.querySelector<HTMLDetailsElement>('.tiptap details')!;details.open=false;details.dispatchEvent(new Event('toggle'));await tick();equal('collapse-is-local',(await client.convergence!.export()).checkpoint,beforeCollapse.checkpoint);equal('collapse-no-unsaved-edit',button('Save changes').disabled,true);
  await act(async()=>root.unmount());editor=undefined;root=createRoot(element);await mount();await wait(()=>!!editor?.isEditable,'reopen');equal('reopen-exact-text',editor!.getText().includes('gXh你🙂'),true);equal('reopen-toggle',element.querySelector('.tiptap details>summary')?.textContent,'gXh你🙂');equal('reopen-saved-data',(await client.read()).data,saved);
  const clipboardData=new DataTransfer();
  clipboardData.setData('text/html','<p><strong>Nuevo A Ω</strong></p><p><em>Nuevo B 🙂</em></p>');
  clipboardData.setData('text/plain','Nuevo A Ω\nNuevo B 🙂');
  await act(async()=>{
   const view=editor!.view;
   view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
   view.dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData}));
  });
  await tick();
  equal('whole-paste-replaces-toggle',element.querySelector('.tiptap details'),null);
  equal('whole-paste-mixed-marks',Array.from(element.querySelectorAll('.tiptap p strong,.tiptap p em'),node=>[node.tagName,node.textContent]),[['STRONG','Nuevo A Ω'],['EM','Nuevo B 🙂']]);
  equal('whole-paste-caret-at-end',editor!.state.selection.from,editor!.state.doc.content.size-1);
  await click('Undo');equal('whole-paste-one-Undo-restores-toggle',element.querySelector('.tiptap details>summary')?.textContent,'gXh你🙂');
  await click('Redo');equal('whole-paste-one-Redo-restores-paragraphs',editor!.getText(),'Nuevo A Ω\n\nNuevo B 🙂');
  await click('Save changes');await wait(()=>button('Save changes').disabled,'replacement Save ACK');
  await act(async()=>root.unmount());editor=undefined;root=createRoot(element);await mount();await wait(()=>!!editor?.isEditable,'reopen replacement');
  equal('whole-paste-persists-marks',Array.from(element.querySelectorAll('.tiptap p strong,.tiptap p em'),node=>node.textContent),['Nuevo A Ω','Nuevo B 🙂']);
  {
   const leaves=()=>blockPMLeaves(editor!.state.doc),firstId=leaves()[0].id!,secondId=leaves()[1].id!;
   const caretData=new DataTransfer();
   caretData.setData('text/html','<p><strong>Medio A Ω</strong></p><p><em>Medio B 🙂</em></p>');
   caretData.setData('text/plain','Medio A Ω\nMedio B 🙂');
   await select(firstId,3);
   await act(async()=>{editor!.view.dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:caretData}));});
   await tick();
   equal('caret-paste-no-recovery',element.querySelector('[role="alert"]'),null);
   equal('caret-paste-splits-at-caret',leaves().map(n=>n.node.textContent),['NueMedio A Ω','Medio B 🙂vo A Ω','Nuevo B 🙂']);
   equal('caret-paste-keeps-prefix-identity',leaves()[0].id,firstId);
   equal('caret-paste-keeps-later-identity',leaves()[2].id,secondId);
   const runs=(index:number)=>{const out:[string,string[]][]=[];leaves()[index].node.forEach(child=>out.push([child.text??'',child.marks.map(mark=>mark.type.name).sort()]));return out;};
   equal('caret-paste-first-paragraph-runs',runs(0),[['NueMedio A Ω',['bold']]]);
   equal('caret-paste-last-paragraph-runs',runs(1),[['Medio B 🙂',['italic']],['vo A Ω',['bold']]]);
   await click('Undo');equal('caret-paste-one-Undo',leaves().map(n=>n.node.textContent),['Nuevo A Ω','Nuevo B 🙂']);
   await click('Redo');equal('caret-paste-one-Redo',leaves().map(n=>n.node.textContent),['NueMedio A Ω','Medio B 🙂vo A Ω','Nuevo B 🙂']);
   await click('Undo');
   for(const [name,at,expected,keeper] of [['end',9,['Nuevo A ΩMedio A Ω','Medio B 🙂','Nuevo B 🙂'],0],['start',0,['Medio A Ω','Medio B 🙂Nuevo A Ω','Nuevo B 🙂'],1]] as const){
    await select(leaves()[0].id!,at);
    const edge=new DataTransfer();edge.setData('text/html','<p>Medio A Ω</p><p>Medio B 🙂</p>');edge.setData('text/plain','Medio A Ω\nMedio B 🙂');
    const ownerId=leaves()[0].id;
    await act(async()=>{editor!.view.dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:edge}));});await tick();
    equal('caret-paste-'+name+'-text',leaves().map(n=>n.node.textContent),expected);
    equal('caret-paste-'+name+'-keeps-identity',leaves()[keeper].id,ownerId);
    if(editor!.state.selection.from!==leaves()[1].pos+1+'Medio B 🙂'.length)throw Error('caret-paste-'+name+'-caret-after-paste actual='+editor!.state.selection.from+' leaves='+JSON.stringify(leaves().map(n=>[n.pos,n.node.textContent.length])));
    checks.push('caret-paste-'+name+'-caret-after-paste');
    await click('Undo');equal('caret-paste-'+name+'-one-Undo',leaves().map(n=>n.node.textContent),['Nuevo A Ω','Nuevo B 🙂']);
   }
   await select(firstId,3);
   await act(async()=>{editor!.view.dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:caretData}));});await tick();
   await click('Save changes');await wait(()=>button('Save changes').disabled,'caret paste Save ACK');
   await act(async()=>root.unmount());editor=undefined;root=createRoot(element);await mount();await wait(()=>!!editor?.isEditable,'reopen caret paste');
   equal('caret-paste-persists',leaves().map(n=>n.node.textContent),['NueMedio A Ω','Medio B 🙂vo A Ω','Nuevo B 🙂']);
   equal('caret-paste-persists-marks',[runs(0),runs(1)],[[['NueMedio A Ω',['bold']]],[['Medio B 🙂',['italic']],['vo A Ω',['bold']]]]);
  }
  {
   // Plain target: marks of the pasted runs must stay on the pasted text only, not leak into the prefix or suffix.
   const leaves=()=>blockPMLeaves(editor!.state.doc);
   const plain=new DataTransfer();plain.setData('text/html','<p>Antes Ω🙂</p><p>Despues</p>');plain.setData('text/plain','Antes Ω🙂\nDespues');
   await act(async()=>{const view=editor!.view;view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));view.dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:plain}));});await tick();
   equal('plain-target-ready',leaves().map(n=>n.node.textContent),['Antes Ω🙂','Despues']);
   const runs=(index:number)=>{const out:[string,string[]][]=[];leaves()[index].node.forEach(child=>out.push([child.text??'',child.marks.map(mark=>mark.type.name).sort()]));return out;};
   const marked=new DataTransfer();marked.setData('text/html','<p><strong>Medio A Ω</strong></p><p><em>Medio B 🙂</em></p>');marked.setData('text/plain','Medio A Ω\nMedio B 🙂');
   await select(leaves()[0].id!,3);
   await act(async()=>{editor!.view.dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:marked}));});await tick();
   equal('plain-target-text',leaves().map(n=>n.node.textContent),['AntMedio A Ω','Medio B 🙂es Ω🙂','Despues']);
   equal('plain-target-prefix-stays-plain',runs(0),[['Ant',[]],['Medio A Ω',['bold']]]);
   equal('plain-target-suffix-stays-plain',runs(1),[['Medio B 🙂',['italic']],['es Ω🙂',[]]]);
   equal('plain-target-untouched-paragraph',runs(2),[['Despues',[]]]);
   await click('Undo');equal('plain-target-one-Undo',leaves().map(n=>n.node.textContent),['Antes Ω🙂','Despues']);
  }
  await mount(true);await wait(()=>editor?.isEditable===false,'readonly');const readonlyBefore=await client.convergence!.export();await act(async()=>{editor!.commands.insertContent('forbidden');});await tick();equal('readonly-no-doc-edit',(await client.convergence!.export()).checkpoint,readonlyBefore.checkpoint);equal('readonly-format-disabled',button('H1').disabled,true);
 }finally{peer?.destroy();await act(async()=>root.unmount());element.remove();useLocaleStore.setState({locale});}
 return checks;
}

export async function testEmptyBlockEditor(){
 const locale=useLocaleStore.getState().locale,element=document.createElement('div'),checks:string[]=[];document.body.append(element);const root=createRoot(element);let editor:Editor|undefined;
 const equal=(name:string,a:unknown,b:unknown)=>{try{assert.deepStrictEqual(a,b,name);}catch{throw Error(name+' actual='+JSON.stringify(a)+' expected='+JSON.stringify(b));}checks.push(name);},tick=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));});
 const wait=async(check:()=>boolean)=>{for(let i=0;i<160;i++){if(check())return;await tick();}throw Error('Editor timed out: '+element.textContent);};
 const capture=Extension.create({name:'captureEmptyBlocks',onCreate(){editor=this.editor;}}),data={body:{type:'block-doc',schema:'writers-blocks/1',blocks:[]}} as LocalToolJson;
 const definition=defineLocalTool({namespace:'tests.blocks1883.empty-dom',name:{en:'Empty blocks',es:'Bloques vacíos'},description:{en:'Empty block editor',es:'Editor de bloques vacío'},initialState:data,codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/1',schema:'writers-blocks/1'}}},validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body,component:()=>null});
 const host=createFakeLocalToolHost(definition,{projects:[{id:'empty-dom',updatedAt:1,sourceToolDocuments:[{id:'doc',namespace:definition.namespace,title:'Empty',generation:'g',revision:1,createdAt:1,updatedAt:1,data,codec:definition.codec}]}]}),client=host.createClient({projectId:'empty-dom'},false,'doc');
 const button=(name:string)=>[...element.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===name)!;
 const click=async(name:string)=>{await act(async()=>button(name).click());await tick();equal(name+':no-error',element.querySelector('[role="alert"]'),null);};
 const select=async(id:string,from:number,to=from)=>{const leaf=blockPMLeaves(editor!.state.doc).find(n=>n.id===id)!;await act(async()=>{editor!.commands.setTextSelection({from:leaf.pos+1+from,to:leaf.pos+1+to});});};
 const key=async(name:string,shiftKey=false)=>{const event=new KeyboardEvent('keydown',{key:name,shiftKey,bubbles:true,cancelable:true});await act(async()=>{editor!.view.dom.dispatchEvent(event);});await tick();equal(name+':handled',event.defaultPrevented,true);equal(name+':no-error',element.querySelector('[role="alert"]'),null);};
 const save=async()=>{await click('Save changes');await wait(()=>button('Save changes').disabled);};
 const savedIds=async()=>{const body=(await client.read()).data as Record<string,LocalToolJson>,blocks=(body.body as unknown as RichBlockDocument).blocks,out:Record<string,string[]>={};for(const b of blocks.filter(b=>b.content)){out[b.id]=(await client.convergence!.richRange('body',b.id,0,b.content!.reduce((n,t)=>n+t.text.length,0))).range.deleteIds;}return out;};
 try{
  useLocaleStore.setState({locale:'en'});await act(async()=>root.render(<CollaborativeRichRenderer client={client} definition={definition} field="body" readOnly={false} extensions={[capture]}/>));await wait(()=>!!button('Activate shared editing'));equal('empty-passive-no-fake-ID',element.querySelectorAll('[data-writer-block]').length,0);await click('Activate shared editing');await wait(()=>!!editor?.isEditable);await act(async()=>{editor!.commands.insertContent('ab');});await tick();equal('first-input-real-leaf',blockPMLeaves(editor!.state.doc).filter(n=>n.id).length,1);await save();const id=blockPMLeaves(editor!.state.doc)[0].id!,original=await savedIds();
  await select(id,0,1);await act(async()=>{editor!.commands.insertContent('a');});await tick();equal('same-text-replacement-dirty',button('Save changes').disabled,false);await save();const replaced=await savedIds();equal('same-text-new-selected-unit',replaced[id][0]!==original[id][0],true);equal('same-text-keeps-other-unit',replaced[id][1],original[id][1]);await click('Undo');await save();equal('same-text-Undo-unit-identity',await savedIds(),original);
  const long='R8 '+('Ω你🙂 abcdef '.repeat(900)).slice(0,9997);
  const clipboardData=new DataTransfer();
  clipboardData.setData('text/html','<p><em>'+long+'</em></p>');
  clipboardData.setData('text/plain',long);
  await act(async()=>{
   const view=editor!.view;
   view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
   view.dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData}));
  });
  await tick();
  equal('select-all-paste-keeps-paragraph-id',blockPMLeaves(editor!.state.doc).map(leaf=>leaf.id),[id]);
  equal('select-all-paste-keeps-long-italic-text',element.querySelector('.tiptap p > em')?.textContent,long);
  equal('select-all-paste-keeps-editing-available',element.querySelector('[role="alert"]'),null);
  await click('Undo');equal('select-all-paste-undo-restores-original-text',editor!.getText(),'ab');
  await click('Redo');equal('select-all-paste-redo-restores-formatted-text',element.querySelector('.tiptap p > em')?.textContent,long);
  await save();
  const longSaved=((await client.read()).data as Record<string,LocalToolJson>).body as unknown as RichBlockDocument;
  equal('select-all-paste-persists-id-and-italic',longSaved.blocks.map(block=>[block.id,block.content]),[[id,[{type:'text',text:long,marks:[{type:'italic'}]}]]]);
  await click('Undo');await save();equal('select-all-paste-undo-restores-original-unit-ids',await savedIds(),original);
  await select(id,0,2);await click('Bullet list');await select(id,1);await key('Enter');equal('list-Enter-new-item',element.querySelectorAll('.tiptap ul>li').length,2);const second=blockPMLeaves(editor!.state.doc).find(n=>n.id!==id)!.id!;await key('Backspace');equal('list-Backspace-merges-items',element.querySelectorAll('.tiptap ul>li').length,1);equal('list-Backspace-text',editor!.state.doc.textContent,'ab');
  await select(id,1);await key('Enter');const right=blockPMLeaves(editor!.state.doc).find(n=>n.id!==id)!.id!;equal('fresh-item-ID-not-reused',right!==second,true);await save();const beforeIndent=await savedIds();await select(right,0);await key('Tab');equal('nested-list-real-DOM',element.querySelectorAll('.tiptap ul ul').length,1);await save();equal('indent-keeps-units',await savedIds(),beforeIndent);await select(right,0);await key('Tab',true);equal('outdent-removes-empty-nested-wrapper',element.querySelectorAll('.tiptap ul ul').length,0);equal('outdent-two-items',element.querySelectorAll('.tiptap ul>li').length,2);await save();equal('outdent-keeps-units',await savedIds(),beforeIndent);
  await click('Numbered list');await click('Numbered list');await select(id,0,1);await click('Toggle');await select(id,1);await key('Enter');equal('toggle-Enter-summary-kept',element.querySelector('.tiptap details>summary')?.textContent,'a');equal('toggle-Enter-body-real',element.querySelectorAll('.tiptap details>p').length,1);await key('Backspace');equal('toggle-Backspace-empty-body-removed',element.querySelectorAll('.tiptap details>p').length,0);equal('toggle-summary-retained',element.querySelector('.tiptap details>summary')?.textContent,'a');await save();
 }finally{await act(async()=>root.unmount());element.remove();useLocaleStore.setState({locale});}
 return checks;
}

/** Synthetic event-order control; this is not physical IME acceptance. */
export async function testBlockCompositionOrder(){
 const locale=useLocaleStore.getState().locale,element=document.createElement('div'),checks:string[]=[];document.body.append(element);const root=createRoot(element);let editor:Editor|undefined;
 const eq=(name:string,a:unknown,b:unknown)=>{assert.deepStrictEqual(a,b,name);checks.push(name);},tick=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));});
 const wait=async(check:()=>boolean)=>{for(let i=0;i<160;i++){if(check())return;await tick();}throw Error('Composition editor timed out: '+element.textContent);};
 const data={body:{type:'block-doc',schema:'writers-blocks/1',blocks:[{id:'P',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:null,content:[{type:'text',text:'ab'}]}]}} as LocalToolJson;
 const definition=defineLocalTool({namespace:'tests.blocks1883.composition-order',name:{en:'Composition order',es:'Orden de composición'},description:{en:'Synthetic event ordering',es:'Orden sintético de eventos'},initialState:data,codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/1',schema:'writers-blocks/1'}}},validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body,component:()=>null});
 const host=createFakeLocalToolHost(definition,{projects:[{id:'composition-order',updatedAt:1,sourceToolDocuments:[{id:'doc',namespace:definition.namespace,title:'Composition',generation:'g',revision:1,createdAt:1,updatedAt:1,data,codec:definition.codec}]}]}),client=host.createClient({projectId:'composition-order'},false,'doc');
 const capture=Extension.create({name:'captureCompositionBlocks',onCreate(){editor=this.editor;}}),button=(name:string)=>[...element.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===name)!;
 const click=async(name:string)=>{await act(async()=>button(name).click());await tick();};
 try{
  useLocaleStore.setState({locale:'en'});await client.convergence!.start(await client.read());const original=(await client.convergence!.richRange('body','P',0,2)).range.deleteIds;
  await act(async()=>root.render(<CollaborativeRichRenderer client={client} definition={definition} field="body" readOnly={false} extensions={[capture]}/>));await wait(()=>!!editor?.isEditable);
  await act(async()=>{editor!.commands.setTextSelection(3);editor!.view.dom.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));editor!.commands.insertContent('你');editor!.view.dom.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));editor!.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});await tick();
  eq('composition-end-then-Enter-no-recovery',element.querySelector('[role="alert"]'),null);eq('composition-final-text-once',editor!.state.doc.textContent,'ab你');eq('Enter-after-final-slice-two-leaves',blockPMLeaves(editor!.state.doc).length,2);eq('Enter-after-final-slice-left-bytes',blockPMLeaves(editor!.state.doc)[0].node.textContent,'ab你');eq('Enter-after-final-slice-caret-right',editor!.state.selection.from,blockPMLeaves(editor!.state.doc)[1].pos+1);
  await click('Undo');eq('Undo-split-keeps-composition',editor!.state.doc.textContent,'ab你');eq('Undo-split-one-leaf',blockPMLeaves(editor!.state.doc).length,1);await click('Undo');eq('Undo-composition-exactly-once',editor!.state.doc.textContent,'ab');await click('Save changes');await wait(()=>button('Save changes').disabled);eq('saved-original-identities',(await client.convergence!.richRange('body','P',0,2)).range.deleteIds,original);
 }finally{await act(async()=>root.unmount());element.remove();useLocaleStore.setState({locale});}
 return checks;
}
