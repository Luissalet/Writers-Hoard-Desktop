import path from 'node:path';
import type {Plugin} from 'vite';
import {verifyInstalledLocalToolReleases} from './local-tool-packages.mjs';
/** Verify source identities at the ordinary build boundary, before Vite compiles releases. */
export function localToolReleasePlugin():Plugin{let root='';return{name:'local-tool-source-releases',configResolved(config){root=config.root;},async buildStart(){await verifyInstalledLocalToolReleases(path.join(root,'src/engines/local/installed'));},async handleHotUpdate(context){const installed=path.resolve(root,'src/engines/local/installed');if(path.resolve(context.file).startsWith(installed+path.sep))await verifyInstalledLocalToolReleases(installed);}};}
