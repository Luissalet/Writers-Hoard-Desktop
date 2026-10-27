// Launch the real hidden Electron Main runtime; no second server or simulated transport.
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const label=process.argv[2];if(!/^[a-z][a-z0-9-]{0,63}$/.test(label||''))throw Error('Use a fresh own Native label');
const root=path.resolve(__dirname,'..'),output=fs.mkdtempSync(path.join(os.tmpdir(),'writers-sdk-native-launch-'+label+'-')),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const startUtc=new Date().toISOString(),child=spawn(require(path.join(root,'node_modules/electron')),[path.join(__dirname,'local-app-host.native.cjs'),label],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});child.on('error',error=>{stderr+='\n'+String(error);});
child.on('close',(code,signal)=>{fs.writeFileSync(path.join(output,'stdout.log'),stdout);fs.writeFileSync(path.join(output,'stderr.log'),stderr);const resultLine=stdout.split(/\r?\n/).find(line=>line.startsWith('LOCAL_APP_NATIVE_RESULT ')),result=resultLine?JSON.parse(resultLine.slice('LOCAL_APP_NATIVE_RESULT '.length)):null,receipt={label,startUtc,endUtc:new Date().toISOString(),childPid:child.pid,childExitCode:code,signal,ok:code===0&&result?.ok===true,output,result};fs.writeFileSync(path.join(output,'RESULT.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));process.exitCode=receipt.ok?0:1;});
