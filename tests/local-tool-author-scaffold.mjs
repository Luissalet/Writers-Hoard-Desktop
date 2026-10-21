import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createLocalToolScaffold} from '../scripts/create-local-tool.mjs';
import {testLocalToolSource} from '../scripts/test-local-tool.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'wh-author-scaffold-'));
try{const generated=await createLocalToolScaffold({rootDir:root,namespace:'author.testable',name:'Testable notebook'}),test=await readFile(generated.testPath,'utf8');assert(test.includes('createFakeLocalToolHost'));assert((await testLocalToolSource({rootDir:root,namespace:'author.testable'})).length===1);console.log('PASS normal scaffold creates runnable public-kit author fixture; normal author CLI compiles/runs against scoped memory state');await writeFile(generated.testPath,'export async function testLocalToolScaffold(){throw Error("Author assertion failed");}');await assert.rejects(()=>testLocalToolSource({rootDir:root,namespace:'author.testable'}),/Author assertion failed/);assert((await readFile(generated.modulePath,'utf8')).includes('LocalNotebook'));console.log('PASS author test failures propagate without replacing module/state or enabling an engine');assert(!(await readdir(new URL('../src/engines/local/installed/',import.meta.url))).some(name=>name!=='.gitkeep'&&name!=='README.md'));}finally{const target=path.resolve(root);assert(target.startsWith(path.resolve(os.tmpdir())+path.sep+'wh-author-scaffold-'));await rm(target,{recursive:true,force:true});}
