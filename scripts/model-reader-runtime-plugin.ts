import type { Plugin } from 'vite';
import { readFile } from 'node:fs/promises';
import { buildModelReaderRuntime } from './build-model-reader-runtime.mjs';

/** Real text asset: native esbuild text loader and Vite use identical bytes. */
export function modelReaderRuntimePlugin(): Plugin {
  return {
    name:'offline-model-runtime',
    async configResolved(){await buildModelReaderRuntime();},
    async load(source){
      if(source.endsWith('/model-viewer/runtime.generated.txt'))return `export default ${JSON.stringify(await readFile(source,'utf8'))}`;
    },
  };
}
