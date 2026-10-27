import {act,type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {runtimeBase64} from '@/engines/local/runtimeFormat.mjs';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import EngineErrorBoundary from '@/components/common/EngineErrorBoundary';
import {useLocaleStore} from '@/stores/localeStore';
import {proseFixture,assertProse,untilProse} from './local-tool-rich-prose.browser';
export {db,act,assertProse,untilProse,LocalToolDocumentHost,EngineErrorBoundary};
export class Error61Fixture{
 f!:Awaited<ReturnType<typeof proseFixture>>;root!:ReturnType<typeof createRoot>;replies:unknown[]=[];projects:{id:string;title:string}[]=[];titles:string[]=[];packages:{hash:string;namespace:string;fileSha256:string}[]=[];
 async seed(label:string){assertProse(db.tables.length===89&&(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),'HEALTH own empty89 required');this.f=await proseFixture('error61-'+label);this.root=createRoot(document.getElementById('root')!);useLocaleStore.setState({locale:'en',loaded:true});return true;}
 async reply(name:string,args:Record<string,unknown>){const reply=await runBridgeTool(name,args as never);this.replies.push({name,args:name==='wh_local_package_install'?{ownFile:true}:args,reply});return reply;}
 async call<T=any>(name:string,args:Record<string,unknown>):Promise<T>{const r=await this.reply(name,args);assertProse(r.ok,'PUBLIC_'+name+': '+JSON.stringify(r));return r.result as T;}
 async install(file:{name:string;mime:string;base64:string}){const inspected=await this.call('wh_local_package_inspect',{file}),old=await db.localToolPackages.get(inspected.manifest.contentHash);if(!old)this.packages.push({hash:inspected.manifest.contentHash,namespace:inspected.manifest.namespace,fileSha256:inspected.fileSha256});await this.call('wh_local_package_install',{file});return inspected.manifest;}
 async good(){const {default:text}=await import('./fixtures/local-tools/runtime-rollback-v2.whpackage.json?raw');return this.install({name:'own-v2-error61.whpackage.json',mime:'application/json',base64:runtimeBase64(new TextEncoder().encode(text))});}
 async create(namespace:string,hash:string,tools:{namespace:string;contentHash:string}[]=[]){const title='Own error61 '+crypto.randomUUID();this.titles.push(title);const trial=await this.call<{projectId:string;documentId:string;path:string}>('wh_local_package_trial_create',{namespace,contentHash:hash,title,tools});this.projects.push({id:trial.projectId,title});return trial;}
 read(projectId:string,namespace:string,documentId?:string){return this.call('wh_local_tool_read',{projectId,namespace,...documentId?{documentId}:{}});}
 async apply(projectId:string,namespace:string,documentId:string,actions:unknown[]){return this.call('wh_local_tool_state_apply',{projectId,namespace,documentId,baseline:await this.read(projectId,namespace,documentId),actions});}
 async render(children:ReactNode){await act(async()=>this.root.render(<MemoryRouter>{children}</MemoryRouter>));}
 async snapshot(){return db.transaction('r',db.tables,async()=>JSON.stringify(await Promise.all(db.tables.map(async t=>[t.name,await t.toArray()]))));}
 async cleanup(){const errors:string[]=[];try{if(this.root)await act(async()=>this.root.unmount());}catch(e){errors.push(String(e));}for(const title of this.titles)for(const row of await db.projects.filter(p=>p.title===title).toArray())if(!this.projects.some(p=>p.id===row.id))this.projects.push({id:row.id,title});for(const own of this.projects){try{const row=await db.projects.get(own.id);assertProse(!row||row.title===own.title,'Refuse foreign project cleanup');if(row)await deleteProject(own.id);}catch(e){errors.push(String(e));}}try{if(this.f)await deleteProject(this.f.projectId);}catch(e){errors.push(String(e));}for(const own of this.packages){try{const row=await db.localToolPackages.get(own.hash);assertProse(!row||row.namespace===own.namespace&&row.fileSha256===own.fileSha256,'Refuse foreign package cleanup');if(row)await db.localToolPackages.delete(own.hash);}catch(e){errors.push(String(e));}}const counts=await Promise.all(db.tables.map(async t=>({table:t.name,count:await t.count()})));return{errors,counts,all89Empty:errors.length===0&&counts.length===89&&counts.every(r=>r.count===0)};}
}
export function editor61(scope:ParentNode=document){return(scope.querySelector('[data-sdk-prose-editor] .tiptap')as HTMLElement&{editor:import('@tiptap/core').Editor})?.editor;}
export const button61=(text:string,scope:ParentNode=document)=>[...scope.querySelectorAll<HTMLButtonElement>('button')].find(n=>n.textContent?.trim()===text);
export async function click61(node:HTMLButtonElement|undefined){assertProse(node&&!node.disabled,'Normal control absent/busy');await act(async()=>node.dispatchEvent(new MouseEvent('click',{bubbles:true})));}
