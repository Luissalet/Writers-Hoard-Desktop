import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
export async function buildModelReaderRuntime(){
  await build({entryPoints:[path.join(root,'src/engines/model-viewer/offlineEntry.ts')],outfile:path.join(root,'src/engines/model-viewer/runtime.generated.txt'),bundle:true,format:'iife',platform:'browser',target:'es2022',minify:true,legalComments:'inline'});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildModelReaderRuntime();
