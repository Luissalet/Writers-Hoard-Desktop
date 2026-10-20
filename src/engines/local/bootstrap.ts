import {registerLocalToolModules} from './registry';
// Vite resolves this literal glob at build time. Runtime/test environments
// without Vite MODE intentionally load nothing; they may register own fixtures.
const installed=typeof import.meta.env.MODE==='string'?import.meta.glob('./installed/*/module.tsx',{eager:true}):{};
export function registerInstalledLocalTools(){return registerLocalToolModules(installed);}
