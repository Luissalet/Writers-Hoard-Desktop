// Cold dependency regression using the retained shipping Native transport.
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),[mode,label]=process.argv.slice(2);
assert(['cold'].includes(mode),'Mode cold required');assert(/^[a-z][a-z0-9-]{0,47}$/.test(label||''),'Fresh own label up to 48 characters (phase suffix) required');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const rel=file=>path.relative(root,file).replaceAll('\\','/');
const guardPaths=()=>[...new Set(require('./production.cjs').collectPaths(root))].sort();
const snapshot=()=>guardPaths().map(file=>({path:rel(file),sha256:sha(file)}));
const proof=null; // Dev QA entry/normal loader, explicitly no production proof or claim.
const runs=path.join(__dirname,'runs');fs.mkdirSync(runs,{recursive:true});const receiptFile=path.join(runs,label+'.json');fs.closeSync(fs.openSync(receiptFile,'wx'));
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'writers-runtime59-transport-'+label+'-')),profile=path.join(directory,'profile'),startUtc=new Date().toISOString();
const before=snapshot();fs.writeFileSync(path.join(directory,'INPUTS.json'),JSON.stringify(before,null,2)+'\n');
const adapted=path.join(directory,'retained-native-adapted.cjs'),adaptation=require('./harness-adapter.cjs').prepare(root,adapted);fs.writeFileSync(path.join(directory,'ADAPTATION.json'),JSON.stringify(adaptation,null,2)+'\n');
async function phase(name){
 const phaseDirectory=path.join(directory,name);fs.mkdirSync(phaseDirectory);const env={...process.env,RUNTIME59_PHASE:name,RUNTIME59_PROFILE:profile,RUNTIME59_PHASE_DIRECTORY:phaseDirectory,RUNTIME59_SHARED_DIRECTORY:directory};delete env.ELECTRON_RUN_AS_NODE;
 const begin=new Date().toISOString(),child=spawn(require(path.join(root,'node_modules/electron')),[adapted,label+'-'+name],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
 const timer=setTimeout(()=>child.kill(),300000);child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
 const ended=await new Promise(resolve=>{child.once('error',error=>resolve({error:String(error)}));child.once('close',(code,signal)=>resolve({code,signal}));});clearTimeout(timer);
 fs.writeFileSync(path.join(phaseDirectory,'stdout.log'),stdout);fs.writeFileSync(path.join(phaseDirectory,'stderr.log'),stderr);
 const resultFile=path.join(phaseDirectory,'evidence/RESULT.json'),result=fs.existsSync(resultFile)?JSON.parse(fs.readFileSync(resultFile,'utf8')):null;
 const report={phase:name,startUtc:begin,endUtc:new Date().toISOString(),childPid:child.pid,...ended,resultPath:resultFile,resultSha256:result&&sha(resultFile),result,ok:ended.code===0&&result?.ok===true};
 fs.writeFileSync(path.join(phaseDirectory,'PHASE.json'),JSON.stringify(report,null,2)+'\n');return report;
}
void(async()=>{
 const phases=[];let error;
 try{
  const first=await phase('prepare');phases.push(first);assert(first.ok,'First Native phase failed; raw first result retained');
  const second=await phase('resume');phases.push(second);assert(second.ok,'Fresh dev process failed; raw first result retained');assert.notEqual(first.childPid,second.childPid);assert(second.result.cleanup?.allTablesEmpty,'Cold final cleanup not complete');
 }catch(reason){error=String(reason);}
 const after=snapshot(),sourceUnchanged=JSON.stringify(before)===JSON.stringify(after);fs.writeFileSync(path.join(directory,'INPUTS-AFTER.json'),JSON.stringify(after,null,2)+'\n');
 const result={ok:!error&&sourceUnchanged,mode,label,startUtc,endUtc:new Date().toISOString(),directory,profile,productionProof:proof,adaptation,sourceUnchanged,inputCount:before.length,phases:phases.map(({result,...value})=>({...value,ok:result?.ok,checks:result?.checks,toolCalls:result?.toolCalls,rpcCalls:result?.rpcCalls,ipcReplies:result?.ipcReplies,sessions:result?.sessions,revocations:result?.revocations,serverClosed:result?.serverClosed,windowDestroyed:result?.windowDestroyed,cleanup:result?.cleanup,failure:result?.failure,errors:result?.errors})),error,
  attribution:'Private fresh dev process/same profile/normal product loader and real Source Host; shipping two-key Native. No production CSP/Main/Browser claim.'};
 fs.writeFileSync(receiptFile,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({receiptFile,ok:result.ok,mode,label,inputCount:result.inputCount,sourceUnchanged,directory,error,phases:result.phases.map(row=>({phase:row.phase,ok:row.ok,toolCalls:row.toolCalls,rpcCalls:row.rpcCalls,ipcReplies:row.ipcReplies}))}));process.exitCode=result.ok?0:1;
})().catch(error=>{fs.writeFileSync(path.join(directory,'WRAPPER-ERROR.json'),JSON.stringify({error:String(error),stack:error.stack},null,2));console.error(String(error));process.exitCode=1;});
