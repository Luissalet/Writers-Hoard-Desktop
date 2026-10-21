// Diagnostic only: exact pre-change ModalBody bytes replace the public lazy gate.
const path=require('node:path'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'..'),resolved=require.resolve('esbuild');
require.cache[resolved].exports={...esbuild,build(options){return esbuild.build({...options,plugins:[{name:'exact-original-modal-baseline',setup(build){build.onResolve({filter:/(?:^|\/)Modal$/},()=>({path:path.join(root,'src/components/common/ModalBody.tsx')}));}},...(options.plugins??[])]});}};
const {app}=require('electron'),runner=require('../scripts/run-codex-properties-ui.cjs');
process.argv[2]='tests/modal-dirty-guards.browser.tsx';process.argv[3]='testModalDirtyGuards';
runner.main().catch(error=>{console.error(error.stack||String(error));app.exit(1);});
