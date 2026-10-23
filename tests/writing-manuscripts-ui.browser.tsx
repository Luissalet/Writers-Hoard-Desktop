import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import WritingsEngine from '@/engines/writings/WritingsEngine';
import {db} from '@/db';
import {t} from '@/i18n/useTranslation';
import {useLocaleStore} from '@/stores/localeStore';
import {manuscriptFixture} from './writing-manuscripts.browser';
const pause=(ms=60)=>new Promise(resolve=>setTimeout(resolve,ms));
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
async function until(test:()=>boolean|Promise<boolean>,label:string){const deadline=Date.now()+12000;while(Date.now()<deadline){if(await test())return;await act(async()=>{await pause();});}throw Error(label);}
function button(label:string,scope:ParentNode=document){const found=[...scope.querySelectorAll('button')].find(item=>item.textContent?.trim()===label||item.getAttribute('aria-label')===label);assert(found,`Button ${label}`);return found;}
async function click(element:HTMLElement){await act(async()=>{element.click();await pause();});}
function input(element:HTMLInputElement,value:string){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));}
export async function testManuscriptEngineFlow(){
 useLocaleStore.setState({locale:'en'});const {project,main}=await manuscriptFixture('manuscript-ui-engine'),host=document.getElementById('root')!;const root=createRoot(host);
 try{
  await act(async()=>{root.render(<MemoryRouter initialEntries={[`/project/${project.id}/writings?manuscript=manuscript-a`]}><WritingsEngine projectId={project.id}/></MemoryRouter>);await pause();});
  await until(()=>!!document.querySelector('h1')?.textContent?.includes('Story A'),'Story A heading');
  assert(host.textContent?.includes('Chapter A')&&!host.textContent?.includes('Chapter B')&&!host.textContent?.includes('Legacy chapter'),'native list isolates A');
  await click(button('Manuscripts'));await until(()=>[...document.querySelectorAll('li h2')].some(node=>node.textContent==='Story B'),'library B');
  const row=[...document.querySelectorAll('li')].find(node=>node.querySelector('h2')?.textContent==='Story B')!;await click(button('Open',row));
  await until(()=>document.querySelector('h1')?.textContent==='Story B','open B from library');
  assert(host.textContent?.includes('Chapter B')&&!host.textContent?.includes('Chapter A'),'B list does not include A');
  await click(button(t('writings.newWriting')));const dialog=document.querySelector('[role="dialog"]')!;await act(async()=>{input(dialog.querySelector('input')!,'Created inside B');});await click(button(t('common.create'),dialog));
  await until(async()=>!!await db.writings.where('projectId').equals(project.id).filter(row=>row.title==='Created inside B').first(),'normal creation persisted');
  const created=(await db.writings.where('projectId').equals(project.id).filter(row=>row.title==='Created inside B').first())!;assert(created.manuscriptId==='manuscript-b','native create persists B owner');
  await until(()=>!!document.querySelector('.ProseMirror[contenteditable="true"]'),'real prose editor');
  await act(async()=>{const editor=document.querySelector<HTMLElement>('.ProseMirror[contenteditable="true"]')!;editor.focus();document.execCommand('insertText',false,'ONLY_UI_STORY_B_PROSE');await pause();});
  await click(button(t('writings.save')));await until(async()=>!!(await db.writings.get(created.id))?.content.includes('ONLY_UI_STORY_B_PROSE'),'native prose save B');
  assert((await db.writings.get(main.id))?.content===main.content,'main prose remains byte-identical');
  return['Normal Writings Engine/library/create/editor/save persists separate B owner and prose while A/main stay separate'];
 }finally{await act(async()=>{root.unmount();await pause();});}
}
