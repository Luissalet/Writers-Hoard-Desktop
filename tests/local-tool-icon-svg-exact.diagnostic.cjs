// Separate geometry oracle: the public Source-port RED/GREEN remains untouched.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{build}=require('esbuild');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const root=path.resolve(__dirname,'..'),stage=path.join(root,'_stage','sdk-icon-svg-next');
const evidence=process.argv[2]?path.resolve(root,process.argv[2]):undefined;
if(evidence&&!evidence.startsWith(stage+path.sep))throw Error('Evidence must stay within own SVG stage');
if(evidence){if(fs.existsSync(path.join(evidence,'metrics.json')))throw Error('Refusing to overwrite an earlier raster receipt');fs.mkdirSync(evidence,{recursive:true});}
const tau=2*Math.PI;
const examples=[
 {name:'full-clockwise-open',shapes:[[0,[['E',12,12,8,5,Math.PI/4,.2,.2+tau,0]]]],paint:c=>{c.beginPath();c.ellipse(12,12,8,5,Math.PI/4,.2,.2+tau,false);c.stroke();}},
 {name:'full-counterclockwise-open',shapes:[[0,[['E',12,12,8,5,Math.PI/4,.3,.3-tau,1]]]],paint:c=>{c.beginPath();c.ellipse(12,12,8,5,Math.PI/4,.3,.3-tau,true);c.stroke();}},
 {name:'clockwise-span-over-tau',shapes:[[0,[['E',12,12,7,4,0,0,3*tau,0]]]],paint:c=>{c.beginPath();c.ellipse(12,12,7,4,0,0,3*tau,false);c.stroke();}},
 {name:'counterclockwise-span-over-tau',shapes:[[0,[['E',12,12,7,4,0,0,-3*tau,1]]]],paint:c=>{c.beginPath();c.ellipse(12,12,7,4,0,0,-3*tau,true);c.stroke();}},
 {name:'opposite-direction-full-clamp',shapes:[[0,[['E',12,12,7,4,0,0,tau,1]]]],paint:c=>{c.beginPath();c.ellipse(12,12,7,4,0,0,tau,true);c.stroke();}},
 {name:'negative-angles',shapes:[[0,[['E',12,12,7,4,Math.PI/4,-2.9,-6.8,1]]]],paint:c=>{c.beginPath();c.ellipse(12,12,7,4,Math.PI/4,-2.9,-6.8,true);c.stroke();}},
 {name:'long-connected-rotated-arc',shapes:[[0,[['M',2,2],['L',3,3],['E',12,12,8,4,3*Math.PI/4,0,2.1,0]]]],paint:c=>{c.beginPath();c.moveTo(2,2);c.lineTo(3,3);c.ellipse(12,12,8,4,3*Math.PI/4,0,2.1,false);c.stroke();}},
 {name:'one-degree-rotation',shapes:[[0,[['M',1,1],['E',12,12,7,4,Math.PI/180,-1,1.8,0]]]],paint:c=>{c.beginPath();c.moveTo(1,1);c.ellipse(12,12,7,4,Math.PI/180,-1,1.8,false);c.stroke();}},
 {name:'close-followed-by-line-and-move',shapes:[[0,[['M',3,3],['L',18,3],['L',10,15],['Z'],['L',22,20],['M',4,20],['L',10,20]]]],paint:c=>{c.beginPath();c.moveTo(3,3);c.lineTo(18,3);c.lineTo(10,15);c.closePath();c.lineTo(22,20);c.moveTo(4,20);c.lineTo(10,20);c.stroke();}},
 {name:'compound-fill-nonzero',shapes:[[1,[['M',3,3],['L',21,3],['L',21,21],['L',3,21],['Z'],['M',8,8],['L',8,16],['L',16,16],['L',16,8],['Z']]]],paint:c=>{c.beginPath();c.moveTo(3,3);c.lineTo(21,3);c.lineTo(21,21);c.lineTo(3,21);c.closePath();c.moveTo(8,8);c.lineTo(8,16);c.lineTo(16,16);c.lineTo(16,8);c.closePath();c.fill();c.stroke();}},
 {name:'zero-length-round-cap',shapes:[[0,[['M',12,12],['L',12,12]]]],paint:c=>{c.beginPath();c.moveTo(12,12);c.lineTo(12,12);c.stroke();}},
 {name:'cubic-and-quadratic',shapes:[[0,[['M',3,12],['C',3,2,21,2,21,12],['Q',12,24,3,12],['Z']]]],paint:c=>{c.beginPath();c.moveTo(3,12);c.bezierCurveTo(3,2,21,2,21,12);c.quadraticCurveTo(12,24,3,12);c.closePath();c.stroke();}},
];
function canvasImage(px,paint){const canvas=createCanvas(px,px),c=canvas.getContext('2d');c.scale(px/24,px/24);c.strokeStyle='#000';c.fillStyle='#000';c.lineWidth=2;c.lineCap='round';c.lineJoin='round';c.setLineDash([]);paint(c);return canvas;}
async function vectorImage(svg,px){
 assert(svg.includes('width="24" height="24"'));
 // Only root viewport dimensions change; vector paths/viewBox/styles/notices stay exact.
 const sized=svg.replace('width="24" height="24"','width="'+px+'" height="'+px+'"');
 const image=await loadImage(Buffer.from(sized));assert.equal(image.width,px);assert.equal(image.height,px);
 const canvas=createCanvas(px,px);canvas.getContext('2d').drawImage(image,0,0);return canvas;
}
function bounds(data,px){let x0=px,y0=px,x1=-1,y1=-1,coverage=0;for(let p=0;p<data.length;p+=4)if(data[p+3]){const x=(p/4)%px,y=Math.floor(p/4/px);x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);coverage++;}return{bbox:coverage?[x0,y0,x1,y1]:null,coverage};}
function compare(a,b,px){const x=a.getContext('2d').getImageData(0,0,px,px).data,y=b.getContext('2d').getImageData(0,0,px,px).data;let diffPixels=0,sum=0,max=0;for(let p=0;p<x.length;p+=4){let changed=false;for(let k=0;k<4;k++){const d=Math.abs(x[p+k]-y[p+k]);sum+=d;max=Math.max(max,d);changed||=d!==0;}diffPixels+=Number(changed);}return{exact:diffPixels===0,diffPixels,maxRGBA:max,meanRGBA:sum/x.length,canvas:bounds(x,px),svg:bounds(y,px)};}
function savePair(prefix,svg,a,b){if(!evidence)return;fs.writeFileSync(path.join(evidence,prefix+'.svg'),svg);fs.writeFileSync(path.join(evidence,prefix+'-canvas.png'),a.toBuffer('image/png'));fs.writeFileSync(path.join(evidence,prefix+'-svg.png'),b.toBuffer('image/png'));}
async function main(){
 const built=await build({stdin:{contents:"export {resolveLocalToolIconSvg,renderLocalToolIconSvgShapes} from './src/engines/local/iconSvg';export {PLACE_CATALOG_NAMES,PLACE_CATALOG_ID} from './src/engines/worldgen/core/placeIconCatalog';export {PLACE_ICON_DATA} from './src/engines/worldgen/core/placeIconData';export {drawPlaceCatalogIcon} from './src/engines/worldgen/cartography/placeIcon';",resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'cjs',target:'node22',alias:{'@':path.join(root,'src')},write:false,metafile:true,logLevel:'error'});
 const emitted=Object.values(built.metafile.outputs).flatMap(o=>Object.entries(o.inputs).filter(([,v])=>v.bytesInOutput>0).map(([p])=>p));assert(!emitted.some(p=>/src[\\/]db[\\/]|local[\\/](storage|registry|bootstrap)\.|aiBridge[\\/](dispatch|manifest)\.|node_modules[\\/]react/.test(p)),'Pure SVG entry acquired application/database/UI');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wh-icon-svg-render-')),file=path.join(dir,'pure.cjs');
 try{
  fs.writeFileSync(file,built.outputFiles[0].contents);const api=require(file);
  assert.equal(api.PLACE_CATALOG_NAMES.length,1688);
  const sample=await api.resolveLocalToolIconSvg('Castle');assert(sample);
  const normalize=t=>t.replace(/\r\n/g,'\n').trimEnd(),decode=t=>t.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  const license=fs.readFileSync(path.join(root,'public/licenses/writer-map-symbols-1.txt'),'utf8');
  assert.equal(normalize(decode(sample.match(/<metadata>([\s\S]*?)<\/metadata>/)[1])),normalize(license));
  assert.equal(await api.resolveLocalToolIconSvg(api.PLACE_CATALOG_ID+':Castle'),sample);
  assert.equal(await api.resolveLocalToolIconSvg('Wand2'),await api.resolveLocalToolIconSvg('WandSparkles'));
  for(const id of ['UnknownSymbol','foreign:Castle','castle','','<svg/>',null,undefined,7])assert.equal(await api.resolveLocalToolIconSvg(id),null);
  console.log('PASS real opt-in SVG entry preserves own identity/aliases/null and exact normalized notices; emitted graph excludes DB/application/React');
  const rows=[],synthetic=[],negatives=[];let first,firstCatalog,worst;
  function record(kind,name,px,svg,a,b){const m={kind,name,px,...compare(a,b,px)};(kind==='catalogue'?rows:synthetic).push(m);if(!m.exact){if(!first){first=m;savePair('first',svg,a,b);}if(kind==='catalogue'&&!firstCatalog){firstCatalog=m;savePair('first-catalogue',svg,a,b);}if(!worst||m.meanRGBA>worst.metric.meanRGBA)worst={metric:m,svg,a:a.toBuffer('image/png'),b:b.toBuffer('image/png')};}return m;}
  for(const example of examples){const svg=api.renderLocalToolIconSvgShapes(example.shapes);for(const px of [24,96])record('synthetic',example.name,px,svg,canvasImage(px,example.paint),await vectorImage(svg,px));}
  for(const name of api.PLACE_CATALOG_NAMES){
   const svg=await api.resolveLocalToolIconSvg(api.PLACE_CATALOG_ID+':'+name);assert(svg);
   assert(svg.includes('viewBox="0 0 24 24"'));assert(svg.includes('overflow="hidden"'));
   assert(!/<(?:script|image|foreignObject|use)\b|\b(?:href|xlink:href|on\w+)\s*=/.test(svg));
   const paths=[...svg.matchAll(/<path d="([^"]*)" fill="(none|currentColor)"\/>/g)];assert.equal(paths.length,api.PLACE_ICON_DATA[name].length);
   for(const p of paths)for(const value of p[1].replace(/[MLCQAZ]/g,' ').trim().split(/\s+/).filter(Boolean))assert(Number.isFinite(Number(value)),'Nonfinite SVG '+name);
   for(const px of [24,96]){
    const canvas=createCanvas(px,px),c=canvas.getContext('2d');c.translate(px/2,px/2);
    assert(api.drawPlaceCatalogIcon(c,{catalogIcon:{catalog:api.PLACE_CATALOG_ID,name},color:'#000'},px/2));
    const m=record('catalogue',name,px,svg,canvas,await vectorImage(svg,px));assert(m.canvas.coverage>0&&m.svg.coverage>0,'Empty raster '+name+'@'+px);
   }
  }
  const negativeCases=[
   {name:'arc-sweep-inverted',example:examples[6],mutate:svg=>svg.replace(/( A [^ ]+ [^ ]+ [^ ]+ 0 )([01]) /,(_,p,s)=>p+(s==='1'?'0':'1')+' ')},
   {name:'shape-omitted',example:examples[9],mutate:svg=>svg.replace(/<path [^>]*\/>/,'')},
   {name:'fill-omitted',example:examples[9],mutate:svg=>svg.replace('fill="currentColor"','fill="none"')},
   {name:'zero-cap-omitted',example:examples[10],mutate:svg=>svg.replace(' L 12 12','')},
  ];
  for(const test of negativeCases){const svg=api.renderLocalToolIconSvgShapes(test.example.shapes),bad=test.mutate(svg);assert.notEqual(bad,svg,'Negative mutation did not apply '+test.name);const m=compare(canvasImage(96,test.example.paint),await vectorImage(bad,96),96);assert(!m.exact,'Comparator missed '+test.name);negatives.push({name:test.name,...m});}
  const failed=rows.filter(r=>!r.exact),syntheticFailed=synthetic.filter(r=>!r.exact),report={criterion:'exactRGBA; no AA tolerance',cataloguePairs:rows.length,catalogueExact:rows.length-failed.length,catalogueFailed:failed.length,syntheticPairs:synthetic.length,syntheticFailed:syntheticFailed.length,first,firstCatalog,worst:worst?.metric,negatives,rows,synthetic};
  assert.equal(rows.length,3376);assert.equal(synthetic.length,examples.length*2);
  if(evidence){fs.writeFileSync(path.join(evidence,'metrics.json'),JSON.stringify(report,null,2)+'\n');if(worst){fs.writeFileSync(path.join(evidence,'worst.svg'),worst.svg);fs.writeFileSync(path.join(evidence,'worst-canvas.png'),worst.a);fs.writeFileSync(path.join(evidence,'worst-svg.png'),worst.b);}}
  console.log(JSON.stringify({criterion:report.criterion,cataloguePairs:rows.length,catalogueExact:report.catalogueExact,catalogueFailed:failed.length,syntheticPairs:synthetic.length,syntheticFailed:syntheticFailed.length,first,firstCatalog,worst:worst?.metric,negativeControls:negatives.length},null,2));
  assert.equal(failed.length+syntheticFailed.length,0,'SVG raster differs from existing Canvas; exact criterion is not met. Preserve first evidence and stop before MCP/UI.');
  console.log('PASS all3376 catalogue pairs and independent Canvas semantics exactly match real SVG vector rasters at24/96');
 }finally{fs.unlinkSync(file);fs.rmdirSync(dir);}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
