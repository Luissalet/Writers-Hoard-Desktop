// Own autosave UI controls over the unchanged normal two-field Source fixture.
import './local-tool-live-content.fixture';
import {act} from 'react';
import {db} from '@/db';
import {testAutosaveSourceControls} from './local-tool-autosave.browser';
const base=Reflect.get(window,'__own1913');
const preferenceKey='writer.rich.saveMode';
Reflect.set(window,'__autosave1952',{
 ...base,
 sourceControls:testAutosaveSourceControls,
 async chooseMode(mode:'manual'|'automatic'){
  const select=document.querySelector<HTMLSelectElement>('[aria-label="Save mode"]');
  if(!select)return{offered:false,status:base.status()};
  await act(async()=>{select.value=mode;select.dispatchEvent(new Event('change',{bubbles:true}));});
  return{offered:true,status:base.status()};
 },
 async mark(text:string){const section=document.querySelector('[data-sdk-collaborative-rich="body"]'),button=[...section!.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text);if(!button)throw Error('HEALTH_AUTOSAVE_MARK_BUTTON');await act(async()=>button.click());},
 armReadFailure(){Reflect.set(globalThis,'__auto1952FailRead',true);return base.status();},
 async retryBody(){const section=document.querySelector('[data-sdk-collaborative-rich="body"]'),button=[...section!.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Retry save');if(!button)return{clicked:false,status:base.status()};await act(async()=>button.click());return{clicked:true,status:base.status()};},
 async preference(){return(await db.settings.where('key').equals(preferenceKey).first())?.value??null;},
 async cleanup(){await db.settings.where('key').equals(preferenceKey).delete();return base.cleanup();},
});
Reflect.set(window,'__autosave1952Ready',true);
