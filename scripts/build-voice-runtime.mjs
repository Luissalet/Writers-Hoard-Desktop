// Product build/setup command. Shares the product publishing venv, never a different repo.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const python=path.join(root,'publishing','.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
function run(command,args){const result=spawnSync(command,args,{cwd:root,windowsHide:true,stdio:'inherit'});if(result.error)throw result.error;if(result.status)throw new Error(`Voice runtime command exited ${result.status}`);}
if(!existsSync(python))run(process.env.PYTHON||'python',['-m','venv',path.join(root,'publishing','.venv')]);
run(python,['-m','pip','install','-r','publishing/voice/requirements.txt']);
if(!process.argv.includes('--setup-only'))run(python,['-m','PyInstaller','--noconfirm','--clean','--onedir','--name','writer-voice-worker','--distpath','publishing/runtime/voice','--workpath','publishing/.build/voice/work','--specpath','publishing/.build/voice','--paths',path.join(root,'publishing/voice'),'--collect-all','faster_whisper','--collect-all','ctranslate2','--collect-all','tokenizers','--collect-all','onnxruntime','--collect-all','av',path.join(root,'publishing/voice/worker.py')]);
