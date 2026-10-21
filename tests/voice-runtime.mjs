import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
const root=process.cwd(),dir=await fs.mkdtemp(path.join(os.tmpdir(),'writer-voice-runtime-'));
const wav=path.join(dir,'speech.wav');
const fixture=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'tests','voice-fixture.ps1'),'-OutputPath',wav],{windowsHide:true,encoding:'utf8'});assert.equal(fixture.status,0,fixture.stderr);
await build({entryPoints:[path.join(root,'electron/media/voice.ts')],bundle:true,platform:'node',format:'cjs',outfile:path.join(dir,'voice.cjs'),logLevel:'warning'});
const require=createRequire(import.meta.url),api=require(path.join(dir,'voice.cjs'));
const base={projectRoot:root,runtimeDir:path.join(root,'publishing/runtime/voice/writer-voice-worker'),modelsDir:path.join(dir,'models'),isPackaged:false};
const wait=async id=>{const end=Date.now()+60000;while(Date.now()<end){const job=api.voiceTranscriptStatus(id);if(['done','error','cancelled'].includes(job.state))return job;await new Promise(done=>setTimeout(done,50));}throw new Error('Voice job timeout');};
for(const packaged of [false,true]){
  api.configureVoice({...base,isPackaged:packaged});assert.equal((await api.voiceStatus()).ready,true,'Cached CPU ASR not ready');
  const id=`test-${packaged}`;await api.startVoiceTranscript({requestId:id,bytes:new Uint8Array(await fs.readFile(wav)),mime:'audio/wav',language:'en',initialPrompt:'Ada, Borges, library.'});const job=await wait(id);assert.equal(job.state,'done',job.error);assert.equal(job.transcript.device,'cpu');assert.match(job.transcript.segments.map(segment=>segment.text).join(' '),/Ada.*Borges.*library.*story begins/i);assert(job.transcript.segments.flatMap(segment=>segment.words).length>=15);assert(job.transcript.segments.every(segment=>segment.words.every(word=>word.start<=word.end&&word.start>=segment.start&&word.end<=segment.end+.1)));
  console.log(`PASS ${packaged?'packaged frozen':'development'} runtime: real CPU SAPI ASR, names prompt, timed words/segments`);
}
api.configureVoice(base);await api.startVoiceTranscript({requestId:'cancel',bytes:new Uint8Array(await fs.readFile(wav)),mime:'audio/wav'});assert.equal(api.cancelVoiceTranscript('cancel').state,'cancelled');await new Promise(done=>setTimeout(done,100));assert.equal(api.voiceTranscriptStatus('cancel').state,'cancelled');
await api.startVoiceTranscript({requestId:'bad',bytes:new Uint8Array([1,2,3]),mime:'audio/wav'});assert.equal((await wait('bad')).state,'error');console.log('PASS explicit cancellation and malformed audio do not publish invented transcripts');
api.closeVoice();console.log(`Voice runtime QA: ${dir}`);
