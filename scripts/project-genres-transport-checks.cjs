const assert=require('node:assert/strict');
exports.checkProjectGenres=async({win,call,rpc,url,token})=>{
 const projectId='transport-world',get=()=>call('wh_project_genres_get',{projectId}),undo=async index=>(await(await fetch(url+'/api/undo',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({index})})).json());
 const metadata=()=>win.webContents.executeJavaScript('window.__transportSnapshot().then(({project})=>({title:project.title,description:project.description,enabledEngines:project.enabledEngines}))');
 const before=await metadata(),start=await get();assert.deepEqual(start.genres,[]);
 const first=await call('wh_project_genres_set',{projectId,genres:['Fantasy','Ensayo histórico 🧭'],expectedGenres:start.genres});assert.deepEqual((await get()).genres,first.genres);assert(Number.isInteger(first._undo.audit_index));
 const stale=await rpc('tools/call',{name:'wh_project_genres_set',arguments:{projectId,genres:['Horror'],expectedGenres:[]}});assert(stale.result.isError);assert.deepEqual((await get()).genres,first.genres);
 const second=await call('wh_project_genres_set',{projectId,genres:['Horror'],expectedGenres:first.genres});assert(!(await undo(first._undo.audit_index)).ok);assert.deepEqual((await get()).genres,['Horror']);
 assert((await undo(second._undo.audit_index)).ok);assert((await undo(first._undo.audit_index)).ok);assert(!(await undo(first._undo.audit_index)).ok);assert.deepEqual((await get()).genres,[]);
 const invalid=await rpc('tools/call',{name:'wh_project_genres_set',arguments:{projectId,genres:{},expectedGenres:[]}});assert(invalid.result.isError);assert.deepEqual((await get()).genres,[]);assert.deepEqual(await metadata(),before);
 console.log('PASS external native project genres get/set, custom Unicode, stale field CAS, real audit Undo recovery and one-use, unchanged project metadata');
};
