import {getSetting,setSetting} from '@/db/operations';
import type {LocalToolSaveMode} from './types';

/** One choice per Source instance, retained when its client/lease is rebound. */
export class DocumentSavePreference {
 mode:LocalToolSaveMode='manual';
 ready=false;
 error='';
 private revision=0;
 private listeners=new Set<()=>void>();
 constructor(){void getSetting('writer.rich.saveMode').then(value=>{if(!this.revision)this.mode=value==='automatic'?'automatic':'manual';this.ready=true;this.changed();},()=>{if(!this.revision)this.error='local_tool_autosave_preference_failed';this.ready=true;this.changed();});}
 subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 private changed(){for(const listener of this.listeners)listener();}
 async choose(mode:LocalToolSaveMode,validate:()=>Promise<void>){
  if(mode!=='manual'&&mode!=='automatic')throw Error('local_tool_save_mode_invalid');
  const revision=++this.revision;this.mode=mode;this.ready=true;this.error='';this.changed();
  try{await validate();await setSetting('writer.rich.saveMode',mode);if(revision===this.revision){this.error='';this.changed();}}
  catch(error){if(revision===this.revision){this.error='local_tool_autosave_preference_failed';this.changed();}throw error;}
 }
}
