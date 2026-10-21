import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { promises as fs, constants as fileConstants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { isSafeNativeSegment, resolveExistingContainedNativePath, resolveWritableContainedNativePath } from '../security';
import type { DuplicateBinding, DuplicateExternalSnapshot, ProjectDuplicateNative } from '../../src/services/projectDuplicate/types';

export interface ProjectDuplicateOptions { mediaRoot:()=>string; recoveryDir:string; publishingLinksPath:()=>string }
interface Stage { version:1; operationId:string; sourceProjectId:string; targetProjectId:string; externalVersion:string; pathMap:Record<string,string>; bindings:DuplicateBinding[]; files:DuplicateExternalSnapshot['files']; complete:boolean; discarded?:boolean; discarding?:boolean }
const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,stable(value)])):value;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const fileHash=async(file:string)=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
function segment(value:string){if(!isSafeNativeSegment(value))throw Error('project_duplicate_invalid_identity');return value;}

/** Own product file/SQLite operations; never starts a publishing module or touches unrelated native objects. */
export class ProjectDuplicateResources implements ProjectDuplicateNative {
  private queue:Promise<unknown>=Promise.resolve();
  constructor(private options:ProjectDuplicateOptions){}
  private serial<T>(run:()=>Promise<T>):Promise<T>{const result=this.queue.then(run);this.queue=result.catch(()=>undefined);return result;}
  private journalPath(id:string){return path.join(this.options.recoveryDir,`${segment(id)}.json`);}
  private async read(id:string):Promise<Stage|undefined>{try{return JSON.parse(await fs.readFile(this.journalPath(id),'utf8')) as Stage;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}}
  private async write(stage:Stage){await fs.mkdir(this.options.recoveryDir,{recursive:true});const target=this.journalPath(stage.operationId),temporary=target+'.tmp';await fs.writeFile(temporary,JSON.stringify(stage),'utf8');await fs.rename(temporary,target);}
  private bindings(projectId:string):DuplicateBinding[]{
    const filename=this.options.publishingLinksPath();let database:DatabaseSync;
    try{database=new DatabaseSync(filename,{readOnly:true});}catch(error){if((error as Error).message.includes('unable to open database file'))return[];throw error;}
    try{
      if(!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_results'").get())return[];
      return database.prepare('SELECT module,kind,object_id,title,artifact FROM project_results WHERE project_id=? ORDER BY module,kind,object_id').all(projectId).map(row=>({module:String(row.module),kind:String(row.kind),object_id:String(row.object_id),title:String(row.title),artifact:JSON.parse(String(row.artifact)) as Record<string,unknown>}));
    }finally{database.close();}
  }
  async inspect({projectId,paths}:Parameters<ProjectDuplicateNative['inspect']>[0]):Promise<DuplicateExternalSnapshot>{
    segment(projectId);const files:DuplicateExternalSnapshot['files']=[],missing:string[]=[];
    for(const rel of [...new Set(paths)].sort()){
      if(!rel.startsWith(projectId+'/'))throw Error('project_duplicate_foreign_managed_path');
      const absolute=await resolveExistingContainedNativePath(this.options.mediaRoot(),rel);
      if(!absolute){missing.push(rel);continue;}
      const stat=await fs.stat(absolute);if(!stat.isFile()){missing.push(rel);continue;}
      files.push({path:rel,size:stat.size,sha256:await fileHash(absolute)});
    }
    const bindings=this.bindings(projectId);return{version:digest({files,bindings,missing}),files,bindings,missing};
  }
  stage(input:Parameters<ProjectDuplicateNative['stage']>[0]){return this.serial(async()=>{
    for(const value of[input.operationId,input.sourceProjectId,input.targetProjectId])segment(value);
    if(input.sourceProjectId===input.targetProjectId)throw Error('project_duplicate_same_owner');
    const existing=await this.read(input.operationId);
    if(existing){if(existing.sourceProjectId!==input.sourceProjectId||existing.targetProjectId!==input.targetProjectId||existing.externalVersion!==input.expectedExternalVersion)throw Error('project_duplicate_operation_conflict');existing.discarded=false;existing.discarding=false;await this.write(existing);await this.copyStage(existing);return{operationId:existing.operationId,pathMap:existing.pathMap,version:existing.externalVersion};}
    const source=await this.inspect({projectId:input.sourceProjectId,paths:input.paths});
    if(source.version!==input.expectedExternalVersion||source.missing.length)throw Error('project_duplicate_external_conflict');
    const pathMap=Object.fromEntries(source.files.map(file=>[file.path,input.targetProjectId+file.path.slice(input.sourceProjectId.length)]));
    const stage:Stage={version:1,operationId:input.operationId,sourceProjectId:input.sourceProjectId,targetProjectId:input.targetProjectId,externalVersion:source.version,pathMap,bindings:source.bindings,files:source.files,complete:false};
    // Persist ownership BEFORE copying, so interrupted staging is retryable and never loses its target identity.
    await this.write(stage);
    await this.copyStage(stage);
    return{operationId:stage.operationId,pathMap,version:source.version};
  });}
  private async copyStage(stage:Stage){
    for(const file of stage.files){
      const target=await resolveWritableContainedNativePath(this.options.mediaRoot(),stage.pathMap[file.path]);if(!target)throw Error('project_duplicate_target_path_invalid');
      const present=await resolveExistingContainedNativePath(this.options.mediaRoot(),stage.pathMap[file.path]);if(present){if(await fileHash(present)!==file.sha256)throw Error('project_duplicate_target_file_conflict');continue;}
      const source=await resolveExistingContainedNativePath(this.options.mediaRoot(),file.path);if(!source||await fileHash(source)!==file.sha256)throw Error('project_duplicate_external_conflict');
      await fs.mkdir(path.dirname(target),{recursive:true});
      try{await fs.copyFile(source,target,fileConstants.COPYFILE_EXCL);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
      if(await fileHash(target)!==file.sha256)throw Error('project_duplicate_target_file_conflict');
    }
  }
  finalize(input:Parameters<ProjectDuplicateNative['finalize']>[0]){return this.serial(async()=>{
    const stage=await this.read(input.operationId);if(!stage||stage.discarded||stage.targetProjectId!==input.projectId)throw Error('project_duplicate_operation_missing');
    try{
      // An interrupted copy is resumed from its durable source manifest, not a new project operation.
      await this.copyStage(stage);
      const actual=this.bindings(stage.targetProjectId);
      if(actual.some(binding=>!stage.bindings.some(expected=>digest(expected)===digest(binding))))throw Error('project_duplicate_binding_conflict');
      if(stage.bindings.length){
        const filename=this.options.publishingLinksPath();await fs.mkdir(path.dirname(filename),{recursive:true});const database=new DatabaseSync(filename);
        try{database.exec('CREATE TABLE IF NOT EXISTS project_results(project_id TEXT,module TEXT,kind TEXT,object_id TEXT,title TEXT,artifact TEXT,PRIMARY KEY(project_id,module,kind,object_id)); BEGIN IMMEDIATE');
          for(const binding of stage.bindings){const old=database.prepare('SELECT title,artifact FROM project_results WHERE project_id=? AND module=? AND kind=? AND object_id=?').get(stage.targetProjectId,binding.module,binding.kind,binding.object_id);if(old&&(String(old.title)!==binding.title||digest(JSON.parse(String(old.artifact)))!==digest(binding.artifact)))throw Error('project_duplicate_binding_conflict');database.prepare('INSERT OR IGNORE INTO project_results VALUES(?,?,?,?,?,?)').run(stage.targetProjectId,binding.module,binding.kind,binding.object_id,binding.title,JSON.stringify(binding.artifact));}database.exec('COMMIT');
        }catch(error){try{database.exec('ROLLBACK');}catch{/* no transaction began */}throw error;}finally{database.close();}
      }
      stage.complete=true;await this.write(stage);return{complete:true,unfinished:[]};
    }catch(error){return{complete:false,unfinished:[error instanceof Error?error.message:String(error)]};}
  });}
  discard(input:Parameters<ProjectDuplicateNative['discard']>[0]){return this.serial(async()=>{
    const stage=await this.read(input.operationId);if(!stage||stage.discarded)return;if(stage.complete&&!input.removeCommitted)throw Error('project_duplicate_committed_resources');
    if(!stage.discarding){
      if(input.removeCommitted&&stage.bindings.length&&digest(this.bindings(stage.targetProjectId))!==digest(stage.bindings))throw Error('project_duplicate_binding_changed');
      for(const file of stage.files){const target=await resolveExistingContainedNativePath(this.options.mediaRoot(),stage.pathMap[file.path]);if(target&&await fileHash(target)!==file.sha256)throw Error('project_duplicate_target_file_changed');}
      stage.discarding=true;await this.write(stage);
    }
    if(input.removeCommitted&&stage.bindings.length){const database=new DatabaseSync(this.options.publishingLinksPath());try{database.exec('BEGIN IMMEDIATE');for(const binding of stage.bindings){const row=database.prepare('SELECT title,artifact FROM project_results WHERE project_id=? AND module=? AND kind=? AND object_id=?').get(stage.targetProjectId,binding.module,binding.kind,binding.object_id);if(row&&(String(row.title)!==binding.title||digest(JSON.parse(String(row.artifact)))!==digest(binding.artifact)))throw Error('project_duplicate_binding_changed');database.prepare('DELETE FROM project_results WHERE project_id=? AND module=? AND kind=? AND object_id=?').run(stage.targetProjectId,binding.module,binding.kind,binding.object_id);}database.exec('COMMIT');}catch(error){try{database.exec('ROLLBACK');}catch{/* no transaction */}throw error;}finally{database.close();}}
    // Never recurse over a computed project folder; delete only the file manifest this operation owns.
    for(const file of stage.files){const target=await resolveExistingContainedNativePath(this.options.mediaRoot(),stage.pathMap[file.path]);if(target){if(await fileHash(target)!==file.sha256)throw Error('project_duplicate_target_file_changed');await fs.unlink(target);}}
    stage.discarded=true;await this.write(stage);
  });}
}
let resources:ProjectDuplicateResources|undefined;
export function configureProjectDuplicate(options:ProjectDuplicateOptions){resources=new ProjectDuplicateResources(options);}
export function registerProjectDuplicateIpc(assertSender:(event:IpcMainInvokeEvent,channel:string)=>unknown){
  for(const name of ['inspect','stage','finalize','discard'] as const){const channel=`projectDuplicate:${name}`;ipcMain.handle(channel,(event,input)=>{assertSender(event,channel);if(!resources)throw Error('project_duplicate_resources_unconfigured');return (resources[name] as (input:never)=>Promise<unknown>)(input as never);});}
}
