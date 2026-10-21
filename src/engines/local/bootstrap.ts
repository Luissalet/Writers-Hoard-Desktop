import {registerLocalToolModules} from './registry';
// Vite resolves this literal glob at build time. Runtime/test environments
// without Vite MODE intentionally load nothing; they may register own fixtures.
const installed=typeof import.meta.env.MODE==='string'?import.meta.glob('./installed/*/module.tsx',{eager:true}):{};
const releases=typeof import.meta.env.MODE==='string'?import.meta.glob('./installed/*/versions/*/module.tsx',{eager:true}):{};
const manifests=typeof import.meta.env.MODE==='string'?import.meta.glob('./installed/*/versions/*/release.json',{eager:true,import:'default'}):{};
export function registerInstalledLocalTools(){return registerLocalToolModules({...installed,...releases},manifests);}
