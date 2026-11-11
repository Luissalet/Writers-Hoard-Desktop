import {projectCodexTypeCatalogue,type CodexTypeCatalogueRow} from '../codex/typeCatalogue';
import type {CodexTemplate} from '../codex/templateTypes';

export interface LocalToolCodexTypes {
 list():Promise<readonly CodexTypeCatalogueRow[]>;
 read(id:string):Promise<CodexTypeCatalogueRow|undefined>;
 /** Delivers committed snapshots and then effective changes. The return value stops delivery. */
 watch(changed:(rows:readonly CodexTypeCatalogueRow[])=>void,failed?:(error:unknown)=>void):()=>void;
}

export function createLocalToolCodexTypes(
 readTemplates:()=>Promise<readonly CodexTemplate[]>,
 subscribe:(changed:()=>void)=>()=>void,
 current:()=>boolean=()=>true,
 readCommittedTemplates:()=>Promise<readonly CodexTemplate[]>=readTemplates,
):LocalToolCodexTypes{
 const snapshot=async(read:()=>Promise<readonly CodexTemplate[]>)=>{
  if(!current())throw Error('local_tool_context_expired');
  const rows=projectCodexTypeCatalogue(await read());
  if(!current())throw Error('local_tool_context_expired');
  return rows;
 };
 const list=()=>snapshot(readTemplates);
 return Object.freeze({
  list,
  async read(id:string){
   if(typeof id!=='string'||!id.trim())throw Error('local_tool_codex_type_invalid');
   return (await list()).find(row=>row.id===id);
  },
  watch(changed:(rows:readonly CodexTypeCatalogueRow[])=>void,failed?:(error:unknown)=>void){
   let active=true,sequence=0,last:string|undefined;
   const subscription:{stop?:()=>void}={};
   const dispose=()=>{if(active){active=false;subscription.stop?.();}};
   const report=(error:unknown)=>{try{failed?.(error);}catch{/* An observer cannot interrupt the host. */}};
   const refresh=()=>{
    if(!active)return;
    if(!current()){dispose();return;}
    const request=++sequence;
    const ready=()=>{
     if(!active||request!==sequence)return false;
     if(!current()){dispose();return false;}
     return true;
    };
    void snapshot(readCommittedTemplates).then(rows=>{
     if(!ready())return;
     const signature=JSON.stringify(rows);
     if(signature===last)return;
     last=signature;
     try{changed(rows);}catch(error){report(error);}
    },error=>{
     if(ready()){last=undefined;report(error);}
    });
   };
   const stop=subscribe(refresh);
   subscription.stop=stop;
   if(!active)stop();
   refresh();
   return dispose;
  },
 });
}
