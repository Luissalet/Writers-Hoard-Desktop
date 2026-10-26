// Preserve Vite import-query values in isolated file:// esbuild harnesses.
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
function viteCssTextPlugin(){return{name:'vite-css-text',setup(build){
 build.onResolve({filter:/\.css\?(?:raw|inline)$/},args=>({path:path.resolve(args.resolveDir,args.path.slice(0,args.path.lastIndexOf('?'))),namespace:'vite-css-text'}));
 build.onLoad({filter:/.*/,namespace:'vite-css-text'},args=>({contents:fs.readFileSync(args.path,'utf8'),loader:'text'}));
 // Raw JS factories are text, never parsed/executed in the host bundle.
 // URL imports retain their actual installed file; no fake asset bytes or model.
 build.onResolve({filter:/\?(?:raw|url)$/},args=>{
  const cut=args.path.lastIndexOf('?'),request=args.path.slice(0,cut),query=args.path.slice(cut+1);
  const resolved=path.isAbsolute(request)||request.startsWith('.')?path.resolve(args.resolveDir,request):require.resolve(request,{paths:[args.resolveDir]});
  return{path:resolved,namespace:'vite-asset-'+query};
 });
 build.onLoad({filter:/.*/,namespace:'vite-asset-raw'},args=>({contents:fs.readFileSync(args.path,'utf8'),loader:'text'}));
 build.onLoad({filter:/.*/,namespace:'vite-asset-url'},args=>({contents:'export default '+JSON.stringify(pathToFileURL(args.path).href),loader:'js'}));
}};}
module.exports={viteCssTextPlugin};
