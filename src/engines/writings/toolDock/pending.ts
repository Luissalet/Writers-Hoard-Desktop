interface Guard {projectId:string;eraId?:string;paneId?:string;run:()=>boolean}
const guards=new Map<string,Guard>();
export const toolDockContextKey=(projectId:string,eraId?:string)=>JSON.stringify([projectId,eraId??null]);
export function registerToolDockGuard(projectId:string,eraId:string|undefined,id:string,guard:()=>boolean,paneId?:string){const key=JSON.stringify([projectId,eraId??null,paneId??null,id]),value={projectId,eraId,paneId,run:guard};guards.set(key,value);return()=>{if(guards.get(key)===value)guards.delete(key);};}
/** Explicit navigation asks only this pane; prose autosave stays independent. */
export function canLeaveToolDocks(projectId:string,eraId?:string,paneId?:string){let safe=true;for(const guard of guards.values())if(guard.projectId===projectId&&guard.eraId===eraId&&guard.paneId===paneId)safe=guard.run()&&safe;return safe;}
