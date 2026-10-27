import {registerLocalAppModules} from './apps/registry';
import {registerLocalAssetFileBackup} from './assetFiles';
registerLocalAssetFileBackup();
import {registerLocalToolModules} from './registry';
// Vite resolves this literal glob at build time. Runtime/test environments
// without Vite MODE intentionally load nothing; they may register own fixtures.
const installed=typeof import.meta.env.MODE==='string'?import.meta.glob('./installed/*/module.tsx',{eager:true}):{};
const releases=typeof import.meta.env.MODE==='string'?import.meta.glob('./installed/*/versions/*/module.tsx',{eager:true}):{};
const manifests=typeof import.meta.env.MODE==='string'?import.meta.glob('./installed/*/versions/*/release.json',{eager:true,import:'default'}):{};
const descriptors=typeof import.meta.env.MODE==='string'?import.meta.glob('./installed/*/versions/*/app-definition.json',{eager:true,import:'default'}):{};
const developmentDescriptors=typeof import.meta.env.MODE==='string'?import.meta.glob('./installed/*/app-definition.json',{eager:true,import:'default'}):{};
export function registerInstalledLocalTools(){const modules={...installed,...releases},apps:Record<string,unknown>={},tools:Record<string,unknown>={};for(const [path,module]of Object.entries(modules))((module as {default?:{app?:unknown}})?.default?.app?apps:tools)[path]=module;return [...registerLocalToolModules(tools,manifests),...registerLocalAppModules(apps,manifests,{...developmentDescriptors,...descriptors})];}
