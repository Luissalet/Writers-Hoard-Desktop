import {mkdir,lstat,realpath,readFile,writeFile,unlink,rmdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function createLocalToolScaffold({rootDir=repository,namespace,name=namespace}){
  if(typeof namespace!=='string'||namespace.length>80||!/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/.test(namespace))throw new Error('Use a lowercase developer namespace, for example me.world-notes.');
  if(typeof name!=='string'||!name.trim()||name.length>100||Array.from(name).some(character=>character.charCodeAt(0)<32))throw new Error('Use a name of 1–100 characters without control characters.');
  const root=await realpath(rootDir);let installed=root;
  for(const part of ['src','engines','local','installed']){installed=path.join(installed,part);try{const stat=await lstat(installed);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Refusing a symlink or non-directory installation path.');}catch(error){if(error.code==='ENOENT')await mkdir(installed);else throw error;}}
  const directory=path.join(installed,namespace);if(path.dirname(directory)!==installed)throw new Error('Invalid destination.');
  // Atomic mkdir is the no-overwrite check. Existing files/directories/symlinks
  // are never removed, merged or replaced.
  await mkdir(directory);const created=[];
  try{
    const template=await readFile(path.join(repository,'scripts/templates/local-tool.tsx.txt'),'utf8');
    const module=template.replaceAll('__NAMESPACE__',JSON.stringify(namespace)).replaceAll('__NAME__',JSON.stringify(name.trim()));
    const test=(await readFile(path.join(repository,'scripts/templates/local-tool.test.ts.txt'),'utf8')).replaceAll('__NAMESPACE_FLAG__',namespace);
    for(const [file,content]of [['module.tsx',module],['module.test.ts',test],['local-tool.source.json',JSON.stringify({namespace,version:'0.1.0',files:['module.tsx']},null,2)+'\n'],['README.md',`# ${name.trim()}\n\nTrusted source extension: ${namespace}.\n\nRebuild Writer’s Hoard, then enable this tool manually in the project’s engine manager. No project is enabled by scaffolding. Read docs/local-tool-sdk.md before editing or distributing source code.\n\nRun your memory-host author test: node scripts/test-local-tool.mjs --id ${namespace}\n`]]){const filePath=path.join(directory,file);await writeFile(filePath,content,{flag:'wx'});created.push(filePath);}
    return {directory,modulePath:path.join(directory,'module.tsx'),engineId:`local-tool-${namespace}`,testPath:path.join(directory,'module.test.ts')};
  }catch(error){for(const file of created)await unlink(file).catch(()=>{});await rmdir(directory).catch(()=>{});throw error;}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2);
  if(args.includes('--help')){console.log('Create an explicit local source extension (no automatic enable):\nnode scripts/create-local-tool.mjs --id me.world-notes --name "World notes"\nRebuild, then enable it manually. See docs/local-tool-sdk.md.');}
  else{try{const allowed=new Set(['--id','--name']);for(let i=0;i<args.length;i+=2)if(!allowed.has(args[i])||!args[i+1])throw new Error('Expected --id namespace [--name title].');const find=flag=>args[args.indexOf(flag)+1];if(!args.includes('--id'))throw new Error('Missing --id.');const result=await createLocalToolScaffold({namespace:find('--id'),name:args.includes('--name')?find('--name'):find('--id')});console.log(`Created ${result.modulePath}\nRecompile, then enable ${result.engineId} manually in the project.`);}catch(error){console.error(error.message);process.exitCode=1;}}
}
