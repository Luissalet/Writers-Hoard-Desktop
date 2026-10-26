// Geometry contract only. Exact raster diagnostics retain their separate FAIL results.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {build}=require('esbuild'),{DOMParser,XMLSerializer}=require('@xmldom/xmldom');
const root=path.resolve(__dirname,'..'),ns='http://www.w3.org/2000/svg',tau=2*Math.PI,eps=Number.EPSILON;
const arity={M:2,L:2,C:6,Q:4,A:7,Z:0};
const rootAttributes={xmlns:ns,width:'24',height:'24',viewBox:'0 0 24 24',overflow:'hidden',fill:'none','fill-rule':'nonzero',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round'};
const normalize=value=>value.replace(/\r\n/g,'\n').trimEnd();
function parseXml(svg){
 const errors=[];const doc=new DOMParser({errorHandler:{warning:m=>errors.push(m),error:m=>errors.push(m),fatalError:m=>errors.push(m)}}).parseFromString(svg,'image/svg+xml');
 assert.equal(errors.length,0,'XML parser diagnostics: '+errors.join('; '));assert(doc.documentElement,'XML root absent');return doc;
}
function attributes(node,expected){const actual={};for(let i=0;i<node.attributes.length;i++){const a=node.attributes.item(i);actual[a.name]=a.value;}assert.deepEqual(actual,expected,'Unexpected SVG attributes on '+node.nodeName);}
function elements(node){const result=[];for(let child=node.firstChild;child;child=child.nextSibling){if(child.nodeType===1)result.push(child);else assert(child.nodeType===3&&!child.nodeValue.trim(),'Unexpected XML content');}return result;}
function commands(value){
 const tokens=[];let index=0;const number=/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
 while(index<value.length){const white=/^\s+/.exec(value.slice(index));if(white){index+=white[0].length;continue;}const char=value[index];if(Object.hasOwn(arity,char)){tokens.push(char);index++;continue;}number.lastIndex=index;const found=number.exec(value);assert(found,'Invalid or unconsumed SVG path token at '+index);const n=Number(found[0]);assert(Number.isFinite(n),'Nonfinite path coordinate');tokens.push(n);index=number.lastIndex;}
 const result=[];for(let i=0;i<tokens.length;){const command=tokens[i++];assert.equal(typeof command,'string','Explicit path command required');const args=tokens.slice(i,i+arity[command]);assert.equal(args.length,arity[command]);assert(args.every(n=>typeof n==='number'),'Wrong command arity');result.push([command,...args]);i+=args.length;}return result;
}
function statistics(){return {icons:0,shapes:0,ellipses:0,arcs:0,operations:{M:0,L:0,C:0,Q:0,E:0,Z:0},maxCoordinateMargin:0,maxCoordinateError:0,maxConicResidual:0,maxConicMargin:0,maxPhaseError:0,maxPhaseMargin:0};}
function geometryPath(actual,source,stats,expectedSweeps){
 let cursor=0,current=null,subpath=null;
 function take(command,args){const row=actual[cursor++];assert(row,'Missing '+command+' command');assert.equal(row[0],command,'Path topology differs');if(args)assert.deepEqual(row.slice(1),args,'Original path coordinates differ');return row;}
 function move(command,args){take(command,args);current=args.slice();if(command==='M')subpath=current.slice();}
 for(let sourceIndex=0;sourceIndex<source.length;sourceIndex++){
  const op=source[sourceIndex],kind=op[0];assert(Object.hasOwn(stats.operations,kind),'Unknown original operation');stats.operations[kind]++;
  if(kind==='M'){move('M',op.slice(1));continue;}
  if(kind==='L'){move(current?'L':'M',op.slice(1));continue;}
  if(kind==='C'||kind==='Q'){if(!current)move('M',op.slice(1,3));take(kind,op.slice(1));current=op.slice(-2);continue;}
  if(kind==='Z'){if(current){take('Z',[]);current=subpath.slice();}continue;}
  const [,cx,cy,rx,ry,rotation,start,end,reverse]=op;assert([cx,cy,rx,ry,rotation,start,end,reverse].every(Number.isFinite));assert(rx>0&&ry>0);assert(reverse===0||reverse===1);
  const key=sourceIndex,explicit=expectedSweeps&&Object.hasOwn(expectedSweeps,key),delta=explicit?expectedSweeps[key]:end-start;
  if(!explicit){assert(Math.abs(delta)<=tau,'Catalogue raw span exceeds one turn');assert(reverse===1?delta<0:delta>0,'Catalogue direction premise changed');}
  assert(Number.isFinite(delta));assert(delta===0||(delta<0?reverse===1:reverse===0),'Expected synthetic direction invalid');assert(Math.abs(delta)<=tau);
  const connection=take(current?'L':'M');assert.equal(connection.length,3);const initial=connection.slice(1);if(!current)subpath=initial.slice();current=initial.slice();
  const arcs=[];while(actual[cursor]?.[0]==='A')arcs.push(actual[cursor++]);assert(arcs.length<=4,'More than four quarter arcs');
  const S=Math.max(1,Math.abs(cx),Math.abs(cy),rx,ry,...initial.map(Math.abs),...arcs.flatMap(a=>a.slice(-2).map(Math.abs))),e=256*eps*S;
  assert(e<=1e-9,'Coordinate error budget exceeds fixed cap');const q=e/Math.min(rx,ry),conicMargin=16*q+256*eps,a=8*q+256*eps*Math.max(1,Math.abs(start),Math.abs(end)),phaseMargin=(arcs.length+1)*a;
  assert(phaseMargin<=1e-7,'Phase error budget exceeds fixed cap');stats.maxCoordinateMargin=Math.max(stats.maxCoordinateMargin,e);stats.maxConicMargin=Math.max(stats.maxConicMargin,conicMargin);stats.maxPhaseMargin=Math.max(stats.maxPhaseMargin,phaseMargin);
  function expectedPoint(angle){return [cx+rx*Math.cos(angle)*Math.cos(rotation)-ry*Math.sin(angle)*Math.sin(rotation),cy+rx*Math.cos(angle)*Math.sin(rotation)+ry*Math.sin(angle)*Math.cos(rotation)];}
  function nearPoint(point,want){const error=Math.max(Math.abs(point[0]-want[0]),Math.abs(point[1]-want[1]));stats.maxCoordinateError=Math.max(stats.maxCoordinateError,error);assert(error<=e,'Ellipse endpoint/connection changed');}
  function phase(point){const x=point[0]-cx,y=point[1]-cy,u=(Math.cos(rotation)*x+Math.sin(rotation)*y)/rx,v=(-Math.sin(rotation)*x+Math.cos(rotation)*y)/ry,residual=Math.abs(u*u+v*v-1);stats.maxConicResidual=Math.max(stats.maxConicResidual,residual);assert(residual<=conicMargin,'Arc endpoint is not on the original conic');return Math.atan2(v,u);}
  nearPoint(initial,expectedPoint(start));let previous=phase(initial),progress=0;stats.ellipses++;
  if(delta===0){assert.equal(arcs.length,0,'Zero span acquired a traversal');take('L',initial);current=initial.slice();continue;}
  assert(arcs.length>0,'Ellipse traversal omitted');
  for(const row of arcs){const [,ax,ay,degrees,large,sweep,x,y]=row;assert.equal(ax,rx,'Original rx changed');assert.equal(ay,ry,'Original ry changed');assert.equal(degrees,rotation*180/Math.PI,'Original rotation changed');assert.equal(large,0,'Unexpected major arc');assert.equal(sweep,reverse===1?0:1,'Arc direction changed');const next=phase([x,y]);let advance=(reverse===1?-1:1)*(next-previous);if(advance<0)advance+=tau;assert(advance>0&&advance<=Math.PI/2+a,'Arc is not a directed quarter-or-less of the original conic');progress+=(reverse===1?-advance:advance);previous=next;current=[x,y];stats.arcs++;}
  const phaseError=Math.abs(progress-delta);stats.maxPhaseError=Math.max(stats.maxPhaseError,phaseError);assert(phaseError<=phaseMargin,'Arc progress differs from original raw span');
  if(Math.abs(delta)===tau)assert.deepEqual(current,initial,'Full traversal does not reuse its initial point');else nearPoint(current,expectedPoint(end));
 }
 assert.equal(cursor,actual.length,'Extra/reordered path commands');
}
function verifySvg(svg,shapes,license,stats=statistics(),syntheticSweeps){
 const doc=parseXml(svg),roots=elements(doc);assert.equal(roots.length,1,'One XML root required');const svgRoot=roots[0];assert.equal(svgRoot.nodeName,'svg');assert.equal(svgRoot.namespaceURI,ns);attributes(svgRoot,rootAttributes);
 const children=elements(svgRoot);assert.equal(children.length,shapes.length+1,'Shape omitted/duplicated');const metadata=children[0];assert.equal(metadata.nodeName,'metadata');assert.equal(metadata.namespaceURI,ns);attributes(metadata,{});for(let n=metadata.firstChild;n;n=n.nextSibling)assert.equal(n.nodeType,3,'Metadata must be literal escaped text');assert.equal(normalize(metadata.textContent),normalize(license),'License changed');
 for(let i=0;i<shapes.length;i++){const node=children[i+1],[fill,ops]=shapes[i];assert.equal(node.nodeName,'path');assert.equal(node.namespaceURI,ns);assert(fill===0||fill===1);attributes(node,{d:node.getAttribute('d'),fill:fill===1?'currentColor':'none'});assert.equal(elements(node).length,0);geometryPath(commands(node.getAttribute('d')),ops,stats,syntheticSweeps?.[i]);stats.shapes++;}
 return stats;
}
function editPath(svg,fn,index=0){const doc=parseXml(svg),paths=doc.getElementsByTagName('path'),node=paths.item(index);assert(node);const parsed=commands(node.getAttribute('d'));fn(parsed);node.setAttribute('d',parsed.map(row=>row.join(' ')).join(' '));return new XMLSerializer().serializeToString(doc);}
async function main(){
 const built=await build({stdin:{contents:"export {resolveLocalToolIconSvg,renderLocalToolIconSvgShapes} from './src/engines/local/iconSvg';export {PLACE_CATALOG_NAMES,PLACE_CATALOG_ID} from './src/engines/worldgen/core/placeIconCatalog';export {PLACE_ICON_DATA} from './src/engines/worldgen/core/placeIconData';",resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'cjs',target:'node22',alias:{'@':path.join(root,'src')},write:false,metafile:true,logLevel:'error'});
 const emitted=Object.values(built.metafile.outputs).flatMap(o=>Object.entries(o.inputs).filter(([,v])=>v.bytesInOutput>0).map(([p])=>p));assert(!emitted.some(p=>/src[\\/]db[\\/]|local[\\/](storage|registry|bootstrap)\.|aiBridge[\\/](dispatch|manifest)\.|node_modules[\\/]react/.test(p)),'Geometry acquired application/DB/React');
 const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'wh-icon-svg-geometry-')),file=path.join(runtime,'pure.cjs');fs.writeFileSync(file,built.outputFiles[0].contents);
 try{
  const api=require(file),license=fs.readFileSync(path.join(root,'public/licenses/writer-map-symbols-1.txt'),'utf8'),stats=statistics();assert.equal(api.PLACE_CATALOG_NAMES.length,1688);
  for(const name of api.PLACE_CATALOG_NAMES){try{const svg=await api.resolveLocalToolIconSvg(api.PLACE_CATALOG_ID+':'+name);assert.equal(typeof svg,'string');verifySvg(svg,api.PLACE_ICON_DATA[name],license,stats);stats.icons++;}catch(error){error.message='Catalogue '+name+': '+error.message;throw error;}}
  assert.equal(stats.icons,1688);assert.equal(stats.shapes,6717);assert.equal(stats.ellipses,7334);console.log('GEOMETRY catalogue '+JSON.stringify(stats));
  const fixtures=[
   {name:'diagonal',shapes:[[0,[['M',4,4],['L',20,20]]]]},
   {name:'cap',shapes:[[0,[['M',12,12],['L',12,12]]]]},
   {name:'filled',shapes:[[1,[['M',3,3],['L',21,3],['L',21,21],['L',3,21],['Z']]]]},
   {name:'curves',shapes:[[0,[['M',3,12],['C',3,2,21,2,21,12],['Q',12,24,3,12],['Z']]]]},
   {name:'intermediate-close',shapes:[[0,[['M',3,3],['L',18,3],['L',10,15],['Z'],['L',22,20],['M',4,20],['L',10,20]]]]},
   {name:'connected',shapes:[[0,[['M',2,2],['L',3,3],['E',12,12,8,4,3*Math.PI/4,0,2.1,0]]]]},
   {name:'full-cw',shapes:[[0,[['E',12,12,8,5,Math.PI/4,.2,.2+tau,0]]]],sweeps:[{0:tau}]},
   {name:'full-ccw',shapes:[[0,[['E',12,12,8,5,Math.PI/4,.3,.3-tau,1]]]],sweeps:[{0:-tau}]},
   {name:'opposite-positive-full',shapes:[[0,[['E',12,12,7,4,0,0,tau,1]]]],sweeps:[{0:-tau}]},
   {name:'opposite-negative-full',shapes:[[0,[['E',12,12,7,4,0,0,-tau,0]]]],sweeps:[{0:tau}]},
   {name:'opposite-positive-partial',shapes:[[0,[['E',12,12,7,4,0,0,3.5*tau,1]]]],sweeps:[{0:-Math.PI}]},
   {name:'opposite-negative-partial',shapes:[[0,[['E',12,12,7,4,0,0,-3.5*tau,0]]]],sweeps:[{0:Math.PI}]},
   {name:'over-cw',shapes:[[0,[['E',12,12,7,4,0,0,3*tau,0]]]],sweeps:[{0:tau}]},
   {name:'over-ccw',shapes:[[0,[['E',12,12,7,4,0,0,-3*tau,1]]]],sweeps:[{0:-tau}]},
   {name:'raw-zero',shapes:[[0,[['E',12,12,7,4,0,0,0,1]]]],sweeps:[{0:0}]},
  ];
  for(const f of fixtures){f.svg=api.renderLocalToolIconSvgShapes(f.shapes);try{verifySvg(f.svg,f.shapes,license,statistics(),f.sweeps);}catch(error){error.message='Synthetic '+f.name+': '+error.message;throw error;}}
  const get=name=>fixtures.find(f=>f.name===name),negatives=[];
  function reject(name,test,mutate){const fixture=get(test),bad=mutate(fixture.svg);assert.notEqual(bad,fixture.svg,'Negative mutation absent');assert.throws(()=>verifySvg(bad,fixture.shapes,license,statistics(),fixture.sweeps),undefined,'Verifier admitted '+name);negatives.push(name);console.log('REJECT negative '+name);}
  for(const px of [24,96])for(const name of ['diagonal','cap']){
   reject(name+'-shift-in-d-'+px,name,svg=>editPath(svg,rows=>{for(const row of rows)for(let i=1;i<row.length;i+=2)row[i]+=24/px;}));
   reject(name+'-shift-transform-'+px,name,svg=>svg.replace('<path ',`<g transform="translate(${24/px} 0)"><path `).replace('</svg>','</g></svg>'));
  }
  reject('ellipse-shift-in-d','full-cw',svg=>editPath(svg,rows=>{for(const row of rows){if(row[0]==='M')row[1]+=.25;else if(row[0]==='A')row[6]+=.25;}}));
  reject('shape-omitted','filled',svg=>svg.replace(/<path [^>]*\/>/,''));
  reject('fill-omitted','filled',svg=>svg.replace('fill="currentColor"','fill="none"'));
  reject('fill-inverted','diagonal',svg=>svg.replace(/(<path d="[^"]*" fill=")none/, '$1currentColor'));
  reject('cap-omitted','cap',svg=>editPath(svg,rows=>rows.splice(1,1)));
  reject('full-turn-omitted','full-cw',svg=>editPath(svg,rows=>{for(let i=rows.length-1;i>=0;i--)if(rows[i][0]==='A')rows.splice(i,1);}));
  reject('sweep-inverted','connected',svg=>editPath(svg,rows=>{const a=rows.find(r=>r[0]==='A');a[5]=a[5]===1?0:1;}));
  reject('arc-endpoint-off-conic','connected',svg=>editPath(svg,rows=>{rows.find(r=>r[0]==='A')[6]+=.25;}));
  reject('arc-radius-changed','connected',svg=>editPath(svg,rows=>{rows.find(r=>r[0]==='A')[1]+=.25;}));
  reject('cubic-control-changed','curves',svg=>editPath(svg,rows=>{rows.find(r=>r[0]==='C')[1]+=.25;}));
  reject('quadratic-control-changed','curves',svg=>editPath(svg,rows=>{rows.find(r=>r[0]==='Q')[1]+=.25;}));
  reject('close-omitted','intermediate-close',svg=>editPath(svg,rows=>rows.splice(rows.findIndex(r=>r[0]==='Z'),1)));
  reject('close-reordered','intermediate-close',svg=>editPath(svg,rows=>{const i=rows.findIndex(r=>r[0]==='Z');[rows[i],rows[i+1]]=[rows[i+1],rows[i]];}));
  reject('stroke-reduced','diagonal',svg=>svg.replace('stroke-width="2"','stroke-width="1"'));
  reject('opacity-reduced','diagonal',svg=>svg.replace('<path ','<path opacity="0.5" '));
  reject('extra-curve-command','curves',svg=>editPath(svg,rows=>rows.push(['L',3,12])));
  reject('malformed-xml','diagonal',svg=>svg.replace('</svg>',''));
  console.log('GEOMETRY PASS '+JSON.stringify({icons:stats.icons,shapes:stats.shapes,ellipses:stats.ellipses,syntheticFixtures:fixtures.length,rejectedNegatives:negatives.length,epsFactor:256,coordinateCap:1e-9,phaseCap:1e-7,raster:'Separate exact diagnostic remains FAIL; no pixel/AA PASS is asserted'}));
 }finally{fs.unlinkSync(file);fs.rmdirSync(runtime);}
}
main().catch(error=>{console.error('GEOMETRY FAIL');console.error(error.stack||String(error));process.exitCode=1;});
