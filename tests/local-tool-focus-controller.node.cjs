// Internal controller state only; this does not certify an actual mounted shell.
const {build}=require('esbuild');
const path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'..');
const source=String.raw`
import assert from 'node:assert/strict';
import {createWorkspaceFocusController,workspaceFocusTargets,setWorkspaceFocus} from '@/components/project/workspace/workspaceFocus';
export function run(){
 const c=createWorkspaceFocusController(),end=c.begin('own-focus'),target=(documentId:string)=>({projectId:'own-focus',namespace:'tests.focus',documentId,instanceId:documentId});
 const a=c.bind(target('A'),()=>true),b=c.bind({...target('B'),eraId:'past'},()=>true);let changes=0;const stop=a.port.subscribe(()=>changes++);
 assert.equal(a.port.getState().available,true);const initial=a.port.getState();assert.equal(a.port.getState(),initial);a.port.set(true);assert.equal(changes,1);a.port.set(true);assert.equal(changes,1);b.port.set(true);b.dispose();assert.equal(a.port.getState().active,true,'Idempotent sibling stole owner');
 assert.throws(()=>a.port.set('false' as any),/invalid_state/);assert.equal(a.port.getState().active,true);
 const first=workspaceFocusTargets('own-focus')[0];assert.equal(first.documentId,'A');assert.deepEqual(workspaceFocusTargets('foreign'),[]);setWorkspaceFocus('foreign',first.hostId,false);assert.equal(c.getState().active,true);
 a.dispose();assert.deepEqual(a.port.getState(),{available:false,active:false});assert.equal(c.getState().active,false);const after=changes;a.port.toggle();assert.equal(changes,after);stop();
 console.log('PASS owner/idempotence, sibling disposal, detached targets, invalid boolean and revoked actions');
 const old=c.bind(target('A'),()=>true);old.port.set(true);const oldTarget=workspaceFocusTargets('own-focus')[0];end();assert.equal(old.port.getState().available,false);assert.equal(c.getState().active,false);
 const end2=c.begin('own-focus'),fresh=c.bind(target('A'),()=>true);fresh.port.set(true);old.port.set(false);assert.equal(fresh.port.getState().active,true,'Same-id ABA revived old port');assert.deepEqual(setWorkspaceFocus('own-focus',oldTarget.hostId,false),{available:false,active:false});assert.equal(fresh.port.getState().active,true);end();assert.equal(fresh.port.getState().active,true,'Old session cleanup revoked later session');end2();assert.equal(fresh.port.getState().available,false);assert.deepEqual(workspaceFocusTargets('own-focus'),[]);
 console.log('PASS whole-session teardown, same-project ABA, old target no-op and old cleanup isolation');
 const late=c.bind(target('precommit'),()=>true);assert.equal(late.port.getState().available,false);const end3=c.begin('own-focus');assert.equal(late.port.getState().available,true);late.port.toggle();assert.equal(late.port.getState().active,true);let invalidated=0;late.port.subscribe(()=>invalidated++);end3();assert.ok(invalidated>0);assert.equal(late.port.getState().available,false);
 console.log('PASS child host before workspace commit and final availability notification; internal state only');
}
`;
(async()=>{const result=await build({stdin:{contents:source,sourcefile:'focus-controller.fixture.ts',resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'cjs',target:'node22',alias:{'@':path.join(root,'src')},write:false,logLevel:'error'});const filename=path.join(root,'focus-controller.generated.cjs'),entry=new Module(filename,module);entry.filename=filename;entry.paths=module.paths;entry._compile(result.outputFiles[0].text,filename);entry.exports.run();})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
