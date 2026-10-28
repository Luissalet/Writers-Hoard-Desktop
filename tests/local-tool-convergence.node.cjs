// Public core and author-host contracts; no browser, database or service startup.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {build}=require('esbuild');
const root=path.resolve(__dirname,'..'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'wh-convergence-contract-'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const guards=new Map(),save=(name,value)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(value,null,2)+'\n');
async function compile(name,contents){
 const built=await build({stdin:{contents,resolveDir:root,sourcefile:name+'.entry.ts'},bundle:true,platform:'node',format:'cjs',target:'node22',alias:{'@':path.join(root,'src')},write:false,metafile:true,logLevel:'error'});
 const inputs=Object.keys(built.metafile.inputs).map(file=>path.resolve(root,file)).filter(file=>fs.existsSync(file));
 for(const file of inputs)guards.set(file,hash(file));
 const file=path.join(directory,name+'.cjs');fs.writeFileSync(file,built.outputFiles[0].contents);save(name+'.metafile.json',built.metafile);
 return{run:require(file),inputs};
}
void(async()=>{
 const pure=await compile('format',"export {testConvergenceFormatBudget} from './tests/local-tool-convergence.format';");
 const forbidden=pure.inputs.filter(file=>/[\\/]node_modules[\\/](yjs|dexie|react)[\\/]|[\\/]convergence[\\/]replica\.|[\\/]src[\\/]db[\\/]|[\\/]local[\\/](storage|registry|bootstrap)\./.test(file));
 if(forbidden.length)throw Error('Pure format graph imported engine/application: '+forbidden.join(','));
 console.log('PASS '+pure.run.testConvergenceFormatBudget());
 const contracts=await compile('contracts',"export {runCoreOracle} from './tests/local-tool-convergence.core';export {runOracle} from './tests/local-tool-convergence.memory';export {assertMemoryStartFlags} from './tests/local-tool-convergence.start-flags';");
 const core=await contracts.run.runCoreOracle((name,value)=>save('core-'+name,value));if(!core.ok)throw Error('Core convergence failed; see '+directory);
 for(const group of core.groups)console.log('PASS core '+group.name);
 const memory=await contracts.run.runOracle((name,value)=>save('memory-'+name,value));if(!memory.ok)throw Error('Memory convergence failed; see '+directory);
 for(const check of memory.checks)console.log('PASS '+check);
 console.log('PASS '+await contracts.run.assertMemoryStartFlags());
 const changed=[...guards].filter(([file,before])=>!fs.existsSync(file)||hash(file)!==before).map(([file])=>file);
 save('GUARDS.json',{inputs:guards.size,changed});if(changed.length)throw Error('Inputs changed during convergence contract');
 console.log('PASS pure format graph excludes engine/DB/React; '+guards.size+' inputs stable. Evidence '+directory);
})().catch(error=>{save('FAILURE.json',{error:String(error),stack:error.stack});console.error(error);process.exitCode=1;});
