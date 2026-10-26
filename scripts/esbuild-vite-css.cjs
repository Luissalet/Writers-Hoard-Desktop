// Preserve Vite's CSS text imports in the isolated esbuild renderer harnesses.
const fs=require('node:fs'),path=require('node:path');
function viteCssTextPlugin(){return{name:'vite-css-text',setup(build){
 build.onResolve({filter:/\.css\?(?:raw|inline)$/},args=>({path:path.resolve(args.resolveDir,args.path.slice(0,args.path.lastIndexOf('?'))),namespace:'vite-css-text'}));
 build.onLoad({filter:/.*/,namespace:'vite-css-text'},args=>({contents:fs.readFileSync(args.path,'utf8'),loader:'text'}));
}};}
module.exports={viteCssTextPlugin};
