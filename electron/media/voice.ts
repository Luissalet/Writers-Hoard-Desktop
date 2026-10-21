import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { VoiceJob, VoiceRuntimeStatus, VoiceTranscriptRequest } from '../../src/engines/media/voiceTypes';
import { MAX_MEDIA_BYTES } from '../../src/engines/media/types';

export interface VoiceConfig { projectRoot:string; runtimeDir:string; modelsDir:string; isPackaged:boolean; python?:string }
let config:VoiceConfig|null=null, setupRunning=false, closing=false;
const children=new Set<ChildProcessWithoutNullStreams>();
const jobs=new Map<string,VoiceJob>();
const queue:Array<{request:VoiceTranscriptRequest;start:()=>Promise<void>}>=[];
let running=false;
export function configureVoice(value:VoiceConfig){config=value;closing=false;}
function configured(){if(!config)throw new Error('voice_not_configured');return config;}
function executable(){const c=configured();return c.isPackaged?{command:path.join(c.runtimeDir,process.platform==='win32'?'writer-voice-worker.exe':'writer-voice-worker'),args:[]}: {command:c.python||path.join(c.projectRoot,'publishing','.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'),args:[path.join(c.projectRoot,'publishing','voice','worker.py')]};}
function worker(request:Record<string,unknown>,onProgress?:(value:number)=>void,owner?:string):Promise<unknown>{
  const c=configured(),run=executable();
  return new Promise((resolve,reject)=>{
    const child=spawn(run.command,run.args,{cwd:c.projectRoot,windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',...(request.action==='transcribe'?{HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}:{})}});
    children.add(child);if(owner)Object.assign(child,{voiceOwner:owner});let result:unknown,error='',stderr='';
    const lines=createInterface({input:child.stdout});lines.on('line',line=>{try{const item=JSON.parse(line);if(item.event==='progress')onProgress?.(Number(item.progress)||0);else if(item.event==='result')result=item.result;else if(item.event==='error')error=String(item.error);}catch{/* Third-party diagnostics do not replace a structured result. */}});
    child.stderr.on('data',(bytes:Buffer)=>{stderr=(stderr+bytes.toString('utf8')).slice(-8000);});
    child.once('error',reason=>{children.delete(child);reject(reason);});
    child.once('close',code=>{children.delete(child);lines.close();if(code===0&&result!==undefined)resolve(result);else reject(new Error(error||stderr.trim()||`voice_worker_exit_${code}`));});
    child.stdin.end(JSON.stringify({...request,modelsDir:c.modelsDir})+'\n');
  });
}
export async function voiceStatus():Promise<VoiceRuntimeStatus>{
  try{return {...await worker({action:'status'}) as VoiceRuntimeStatus,setupRunning};}
  catch(error){return {ready:false,runtime:false,model:false,device:'cpu',modelName:'tiny',setupRunning,error:error instanceof Error?error.message:String(error)};}
}
export async function setupVoice():Promise<VoiceRuntimeStatus>{
  if(setupRunning)return voiceStatus();setupRunning=true;
  try{
    const c=configured(),before=await voiceStatus();
    if(!before.runtime&&!c.isPackaged)await new Promise<void>((resolve,reject)=>{const child=spawn(process.execPath,[path.join(c.projectRoot,'scripts','build-voice-runtime.mjs'),'--setup-only'],{cwd:c.projectRoot,windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});children.add(child);let error='';child.stderr.on('data',(bytes:Buffer)=>{error=(error+bytes.toString()).slice(-8000);});child.stdout.resume();child.once('error',reject);child.once('close',code=>{children.delete(child);if(code===0)resolve();else reject(new Error(error||'voice_setup_failed'));});});
    await fs.mkdir(c.modelsDir,{recursive:true});return await worker({action:'setup'}) as VoiceRuntimeStatus;
  }finally{setupRunning=false;}
}
function pump(){if(running||closing)return;const item=queue.shift();if(!item)return;if(jobs.get(item.request.requestId)?.state==='cancelled'){pump();return;}running=true;void item.start().finally(()=>{running=false;pump();});}
export async function startVoiceTranscript(request:VoiceTranscriptRequest):Promise<VoiceJob>{
  configured();if(closing)throw new Error('voice_closing');if(!request||typeof request.requestId!=='string'||!request.requestId||jobs.has(request.requestId))throw new Error('invalid_voice_request');
  if(!(request.bytes instanceof Uint8Array)||!request.bytes.byteLength||request.bytes.byteLength>MAX_MEDIA_BYTES||typeof request.mime!=='string'||!request.mime.startsWith('audio/'))throw new Error('invalid_voice_audio');
  const job:VoiceJob={requestId:request.requestId,state:'queued',progress:0};jobs.set(request.requestId,job);
  const cancelled=()=>job.state==='cancelled';
  queue.push({request,start:async()=>{
    let folder:string|undefined;
    try{if(cancelled())return;job.state='running';folder=await fs.mkdtemp(path.join(os.tmpdir(),'writer-voice-'));const audio=path.join(folder,'recording.audio');await fs.writeFile(audio,request.bytes);if(cancelled())return;
      const result=await worker({action:'transcribe',audio,language:request.language,initialPrompt:request.initialPrompt??''},progress=>{job.progress=progress;},request.requestId);
      if(!cancelled()){job.transcript=result as VoiceJob['transcript'];job.progress=1;job.state='done';}
    }catch(error){if(job.state!=='cancelled'){job.state='error';job.error=error instanceof Error?error.message:String(error);}}
    finally{if(folder&&path.dirname(folder)===os.tmpdir()&&path.basename(folder).startsWith('writer-voice-'))await fs.rm(folder,{recursive:true,force:true});}
  }});pump();return structuredClone(job);
}
export function voiceTranscriptStatus(id:string):VoiceJob{const job=jobs.get(id);if(!job)throw new Error('voice_job_missing');return structuredClone(job);}
export function cancelVoiceTranscript(id:string):VoiceJob{
  const job=jobs.get(id);if(!job)throw new Error('voice_job_missing');if(job.state==='queued'||job.state==='running'){job.state='cancelled';for(const child of children)if((child as ChildProcessWithoutNullStreams&{voiceOwner?:string}).voiceOwner===id)child.kill();}return structuredClone(job);
}
export function closeVoice(){closing=true;for(const job of jobs.values())if(job.state==='running'||job.state==='queued')job.state='cancelled';queue.length=0;for(const child of children)child.kill();children.clear();}
