import {defineConfig,mergeConfig} from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import realConfig from '../../vite.config';
import {threeGraphPlugin} from './three-graph-plugin';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..');
export default defineConfig(async environment=>{
 const output=process.env.THREE_QA_OUTPUT;if(!output)throw Error('Run this dedicated config through harness.cjs build or all');
 const resolved=path.resolve(output),buildRoot=path.dirname(resolved),tempRoot=fs.realpathSync(os.tmpdir());
 if(path.dirname(buildRoot)!==tempRoot||!path.basename(buildRoot).startsWith('wh-local-tool-three-runtime-build-')||path.basename(resolved)!=='output')throw Error('Three output must remain inside its own fresh QA temp directory');
 const metadata=JSON.parse(fs.readFileSync(path.join(buildRoot,'BUILD.json'),'utf8'));
 if(metadata.format!=='wh-local-tool-three-runtime-v1'||metadata.root!==root||metadata.status!=='running')throw Error('Own current build marker required');
 const base=typeof realConfig==='function'?await realConfig(environment):await realConfig;
 return mergeConfig(base,{root,base:'/',plugins:[threeGraphPlugin()],build:{outDir:resolved,emptyOutDir:false,rollupOptions:{input:{'three-author':path.join(here,'index.html')}}}});
});
