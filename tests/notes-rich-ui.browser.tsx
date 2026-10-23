import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { Editor } from '@tiptap/core';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import NotesEngine from '@/engines/notes/components/NotesEngine';
import { useLocaleStore } from '@/stores/localeStore';
import { t } from '@/i18n/useTranslation';
import { notifyNotesChanged } from '@/engines/notes/hooks';
const P='notes-rich-ui';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const pause=()=>new Promise(resolve=>setTimeout(resolve,45));
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
export async function testNotesRichUi():Promise<string[]>{
 const host=document.getElementById('root')!,root=createRoot(host),passed:string[]=[];
 const until=async(check:()=>boolean,message:string)=>{for(let i=0;i<100;i++){if(check())return;await act(async()=>{await pause();});}throw Error(message);};
 const input=(node:HTMLTextAreaElement|HTMLInputElement,value:string)=>{Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));};
 const native=(within:ParentNode)=>(within.querySelector('.ProseMirror') as HTMLElement&{editor:Editor})?.editor;
 try{
  await db.projects.put({id:P,title:'Rich notes UI',description:'',mode:'custom',type:'standalone',status:'draft',color:'#888888',enabledEngines:['notes'],createdAt:1,updatedAt:1});useLocaleStore.setState({locale:'en',loaded:true});
  await act(async()=>{root.render(<StrictMode><MemoryRouter><NotesEngine projectId={P}/></MemoryRouter></StrictMode>);await pause();});
  await until(()=>Boolean(host.querySelector('fieldset textarea')),'plain composer');
  await act(async()=>{const text=host.querySelector<HTMLTextAreaElement>('fieldset textarea')!;input(text,'Pistas del puerto\nRevisar el faro\nHablar con la capitana');text.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await pause();});
  await until(()=>Boolean(host.querySelector('[data-note-id]')),'quick plain capture');
  let row=(await db.notes.where('projectId').equals(P).toArray())[0];assert(row&&row.richHtml===undefined,'Quick plain capture invented rich formatting');const before=JSON.stringify(row),id=row.id,card=()=>host.querySelector<HTMLElement>(`[data-note-id="${id}"]`)!;
  await act(async()=>{card().querySelector<HTMLButtonElement>(`button[title="${t('common.edit')}"]`)!.click();await pause();});
  await act(async()=>{card().querySelector<HTMLInputElement>('[data-testid="note-rich-toggle"]')!.click();await pause();});
  await until(()=>Boolean(native(card())),'native rich editor');
  await act(async()=>{const editor=native(card());editor.commands.setContent(`<p>Pistas del puerto</p><ul><li><p>Revisar el faro</p></li><li><p>Hablar con la capitana</p></li></ul><p><img src="${PNG}" alt="Local lighthouse"></p>`);editor.commands.setTextSelection(2);card().querySelector('svg.lucide-heading2')?.closest<HTMLButtonElement>('button')?.click();await pause();});
  assert(card().querySelector('.ProseMirror h2')&&card().querySelectorAll('.ProseMirror li').length===2,'Native heading toolbar/list content failed');
  await act(async()=>{const title=card().querySelector<HTMLInputElement>('[data-testid="note-title"]')!;input(title,'Harbor note');[...card().querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()===t('common.save'))!.click();await pause();});
  await until(()=>Boolean(card()?.querySelector('[data-note-rich-read] h2')),'saved rich read');
  row=(await db.notes.get(id))!;assert(row.richHtml?.includes('<h2>')&&row.text==='Pistas del puerto\nRevisar el faro\nHablar con la capitana'&&row.title==='Harbor note','Native rich save lost formatting/title/plain projection');
  assert(card().querySelectorAll('[data-note-rich-read] li').length===2&&card().querySelector('[data-note-rich-read] img')?.getAttribute('src')===PNG,'Readonly rich card lost list/local image');
  await act(async()=>{card().querySelector<HTMLButtonElement>(`button[title="${t('common.edit')}"]`)!.click();await pause();});await until(()=>Boolean(native(card())),'rich reopen');assert(native(card()).getHTML().includes('<h2>')&&native(card()).getHTML().includes(PNG),'Reopening rich note lost native document');
  await act(async()=>{card().querySelector<HTMLButtonElement>(`button[title="${t('common.cancel')}"]`)!.click();await pause();});
  assert(JSON.stringify(await db.notes.get(id))===JSON.stringify(row)&&before!==JSON.stringify(row),'Reopen/cancel wrote saved rich data');
  passed.push('Actual NotesEngine plain Enter capture stays plain; native rich toggle, heading toolbar, bullet list and local image save/reopen with title, coherent text and readonly rendering; cancel does not write');
  const imported={...row,richHtml:row.richHtml+'<script>globalThis.IMPORTED_EXECUTED=true</script><p onclick="BAD_HANDLER">Imported safe prose</p>'};
  await act(async()=>{await db.notes.put(imported);notifyNotesChanged();await pause();});await until(()=>card()?.querySelector('[data-note-rich-read]')?.textContent?.includes('Imported safe prose')===true,'Imported rich note did not render');
  assert(!card().querySelector('[data-note-rich-read] script, [data-note-rich-read] [onclick]')&&JSON.stringify(await db.notes.get(id))===JSON.stringify(imported),'Reading imported rich data trusted active HTML or migrated persisted data');
  passed.push('Actual note read sanitizes imported rich HTML independently of write validation without migrating its stored row');
  await act(async()=>{host.querySelector<HTMLInputElement>('fieldset [data-testid="note-rich-toggle"]')!.click();await pause();});await until(()=>Boolean(native(host.querySelector('fieldset')!)),'rich composer editor');
  await act(async()=>{native(host.querySelector('fieldset')!).commands.setContent('<h2>New rich capture</h2><p>Native composer content</p>');await pause();});
  await act(async()=>{const composer=host.querySelector('fieldset')!;[...composer.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()===t('notes.save'))!.click();await pause();});
  await until(()=>[...host.querySelectorAll('[data-note-rich-read] h2')].some(heading=>heading.textContent==='New rich capture'),'Rich composer did not save');
  const fresh=(await db.notes.where('projectId').equals(P).toArray()).find(note=>note.text==='New rich capture\nNative composer content');assert(fresh?.richHtml?.includes('<h2>')&&host.querySelector('fieldset textarea'),'Rich composer failed to persist or return to quick plain capture');
  passed.push('Actual rich composer creates native formatted note and returns to the unchanged plain quick-capture mode after save');
  await act(async()=>{const search=host.querySelector<HTMLInputElement>(`input[placeholder="${t('notes.search')}"]`)!;input(search,'capitana');await pause();});assert(card(),'Rich plain projection is not searchable');
  return passed;
 }finally{await act(async()=>{root.unmount();await pause();});if(await db.projects.get(P))await deleteProject(P);}
}
