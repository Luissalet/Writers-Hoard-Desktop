const assert=require('node:assert/strict');
exports.checkProjectPin=async({win,call,rpc,url,token})=>{
 const projectId='transport-world',get=async()=>(await call('wh_list_projects',{})).projects.find(p=>p.id===projectId),undo=async index=>(await(await fetch(url+'/api/undo',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({index})})).json());
 const metadata=()=>win.webContents.executeJavaScript('window.__transportSnapshot().then(({project})=>({title:project.title,description:project.description,enabledEngines:project.enabledEngines}))');
 const before=await metadata();assert.equal((await get()).pinned,false);
 const first=await call('wh_project_pin_set',{projectId,pinned:true,expectedPinned:false});assert.equal((await get()).pinned,true);assert(Number.isInteger(first._undo.audit_index));
 const stale=await rpc('tools/call',{name:'wh_project_pin_set',arguments:{projectId,pinned:false,expectedPinned:false}});assert(stale.result.isError);assert.equal((await get()).pinned,true);
 const second=await call('wh_project_pin_set',{projectId,pinned:false,expectedPinned:true});assert(!(await undo(first._undo.audit_index)).ok);assert.equal((await get()).pinned,false);
 assert((await undo(second._undo.audit_index)).ok);assert((await undo(first._undo.audit_index)).ok);assert(!(await undo(first._undo.audit_index)).ok);assert.equal((await get()).pinned,false);
 const invalid=await rpc('tools/call',{name:'wh_project_pin_set',arguments:{projectId,pinned:'yes',expectedPinned:false}});assert(invalid.result.isError);assert.equal((await get()).pinned,false);assert.deepEqual(await metadata(),before);
 console.log('PASS external native project pin/list, stale field CAS, real audit Undo recovery and one-use, unchanged project metadata');
};
