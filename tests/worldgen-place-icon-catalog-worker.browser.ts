import { createRegionWorkerCore } from '@/engines/worldgen/region/workerCore';
import { packRegionGeography, type RegionWorkerReply } from '@/engines/worldgen/region/workerProtocol';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS, type WorldData } from '@/engines/worldgen/core/types';
import { buildHumanGeography } from '@/engines/worldgen/core/settlements';
import { preparePlaceImages, webPlaceImageAdapter } from '@/engines/worldgen/cartography/placeImages';
import type { WorldSpatialStyle } from '@/engines/worldgen/core/spatialEntities';
import { renderRegion } from '@/engines/worldgen/region/render';
import { Cover, DEFAULT_REGION_PARAMS, type RegionData } from '@/engines/worldgen/region/types';
import { THEME_ANTIQUE } from '@/engines/worldgen/cartography/theme';
import { canonRefinement, tileGeometry, tileKey } from '@/engines/worldgen/region/tiles';
import { encodeCanonTile } from '@/engines/worldgen/region/canonStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(check: () => boolean) {
  const deadline = Date.now() + 20_000;
  while (!check() && Date.now() < deadline) await pause();
  assert(check(), 'Regional icon fixture timed out');
}
function icon() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fa0808'; ctx.fillRect(0, 0, 4, 4);
  ctx.fillStyle = '#08f808'; ctx.fillRect(4, 0, 4, 4);
  ctx.fillStyle = '#0808fa'; ctx.fillRect(0, 4, 4, 4);
  return { dataUrl: canvas.toDataURL('image/png'), mode: 'colour' as const };
}

function workerCanonFixture(world: WorldData) {
  const id={tx:1,ty:1},key={z:10,tx:100,ty:100},geometry=tileGeometry(world,id),n=geometry.width*geometry.height;
  const region:RegionData={...regionFixture({}),...geometry,elevation:new Float32Array(n).fill(1),water:new Uint8Array(n),flow:new Float32Array(n),slope:new Float32Array(n),wet:new Float32Array(n),biome:new Uint8Array(n).fill(6),cover:new Uint8Array(n).fill(Cover.Grass)};
  const refinement=canonRefinement(world),cells=world.width*refinement/2**key.z;
  const worldX=(key.tx*cells+cells/2)/refinement,worldY=(key.ty*cells+cells/2)/refinement;
  region.places[0]={...region.places[0],x:(worldX-geometry.originX)*refinement,y:(worldY-geometry.originY)*refinement,worldX,worldY};
  const outsideX=(key.tx*cells-6)/refinement;
  region.places.push({...region.places[0],id:2,sourceKey:'region:habitation:15,16',x:(outsideX-geometry.originX)*refinement,worldX:outsideX});
  return{id,key,region,sourceKey:region.places[0].sourceKey,outsideKey:region.places[1].sourceKey,worldX,worldY};
}
async function seedWorkerCanon(handle:ReturnType<typeof createRegionWorkerCore>,replies:RegionWorkerReply[],contextId:string,fixture:ReturnType<typeof workerCanonFixture>){
  const bytes=await encodeCanonTile(fixture.region);
  handle({type:'seedCanon',contextId,tiles:[{key:tileKey(fixture.id),bytes:bytes.slice().buffer as ArrayBuffer}]});
  const requestId='seed-probe-'+contextId;
  handle({type:'probe',contextId,requestId,wx:fixture.worldX,wy:fixture.worldY});
  await until(()=>replies.some(reply=>reply.type==='probed'&&reply.requestId===requestId));
  const reply=replies.find(reply=>reply.type==='probed'&&reply.requestId===requestId);
  assert(reply?.type==='probed'&&reply.probe!==null,'Public seedCanon/probe did not install the consumed fixture canon');
}

function regionFixture(style: WorldSpatialStyle, side = 32): RegionData {
  const n = side * side;
  return {
    window: { cx: 8, cy: 8, spanKm: 30 }, params: DEFAULT_REGION_PARAMS,
    width: side, height: side, margin: 0, metresPerCell: 1000, originX: 0, originY: 0,
    worldPerCellX: .5, worldPerCellY: .5,
    elevation: new Float32Array(n).fill(1), water: new Uint8Array(n), flow: new Float32Array(n),
    slope: new Float32Array(n), wet: new Float32Array(n), biome: new Uint8Array(n), cover: new Uint8Array(n).fill(Cover.Grass),
    streams: [], tracks: [], fields: [], hedges: [], dykes: [], title: 'Icon countryside', subtitle: '',
    places: [{ id: 1, sourceKey: 'region:habitation:16,16', kind: 'farm', x: side / 2, y: side / 2,
      worldX: 8, worldY: 8, name: 'Own place', importance: 1, style }],
  };
}
function canvas256() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  return { canvas, ctx: canvas.getContext('2d')! };
}
function pixel(ctx: CanvasRenderingContext2D, x: number, y: number) { return [...ctx.getImageData(x, y, 1, 1).data]; }
function colour(actual: number[], expected: number[], message: string) {
  assert(expected.every((v, i) => Math.abs(v - actual[i]) <= 3), `${message}: ${actual} expected ${expected}`);
}

const catalogIcon={catalog:'writer-map-symbols/1' as const,name:'Castle'};
function magenta(canvas:HTMLCanvasElement){const d=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;for(let i=0;i<d.length;i+=4)if(d[i]>235&&d[i+1]<20&&d[i+2]>235&&d[i+3]>200)return true;return false;}
export async function testWorldgenPlaceCatalogRegion(){
 const region=regionFixture({model:'keep',color:'#fb02fc'}),out=canvas256(),layers={paper:false,cover:false,shading:false,contours:false,woods:false,fields:false,water:false,tracks:false,places:true,labels:false,frame:false,legend:false,scaleBar:false};
 const draw=(style:WorldSpatialStyle,painter?:import('@/engines/worldgen/cartography/placeImages').PlaceImagePainter)=>{region.places[0].style=style;out.ctx.clearRect(0,0,256,256);renderRegion(region,out.ctx,{theme:THEME_ANTIQUE,width:256,height:256,layers,placeImages:painter});};
 draw({model:'keep',color:'#fb02fc'});const legacy=out.canvas.toDataURL();draw({model:'keep',color:'#fb02fc',catalogIcon});assert(magenta(out.canvas)&&out.canvas.toDataURL()!==legacy,'Regional vector did not replace real construction');
 draw({model:'keep',color:'#fb02fc',catalogIcon:{...catalogIcon,name:'Unknown'}});assert(out.canvas.toDataURL()===legacy,'Unknown imported identity changed exact fallback');
 const style:WorldSpatialStyle={model:'keep',color:'#fb02fc',catalogIcon,iconImage:icon()},painter=await preparePlaceImages([style],webPlaceImageAdapter(),{strict:true});try{draw(style,painter);colour(pixel(out.ctx,119,119),[250,8,8,255],'Prepared raster did not take priority over catalog');draw({...style,iconImage:null},painter);assert(magenta(out.canvas),'Raster removal did not reveal retained catalog');}finally{painter.dispose();}
 return ['Real regional Canvas vector replaces retained construction, raster wins and removal reveals vector; unavailable imported identity is exact legacy fallback'];
}
export async function testWorldgenPlaceCatalogWorker(){
 const world=generateWorld({...DEFAULT_PARAMS,width:64,erosion:0,seed:'place-icons-catalog-worker'}),geography=buildHumanGeography(world),fixture=workerCanonFixture(world),replies:RegionWorkerReply[]=[],canvases=new Map<string,HTMLCanvasElement>();let id='',prepared=0;
 const handle=createRegionWorkerCore({post:r=>replies.push(r),preparePlaceImages:async(styles,signal)=>{prepared++;return preparePlaceImages(styles,webPlaceImageAdapter(),{strict:true,signal});},renderTile(px,draw){const c=document.createElement('canvas');c.width=c.height=px;draw(c.getContext('2d')!);canvases.set(id,c);return{transfer:[]};}});
 handle({type:'configure',contextId:'catalog',world,geography:packRegionGeography(geography)});await until(()=>replies.some(r=>r.type==='configured'));await seedWorkerCanon(handle,replies,'catalog',fixture);
 const request=async(name:string,style:WorldSpatialStyle,extra:Partial<import('@/engines/worldgen/region/workerProtocol').RegionRenderTileWorkerRequest>={})=>{id=name;handle({type:'renderTile',contextId:'catalog',requestId:name,...fixture.key,themeId:'antique',layers:{roads:false,rivers:false,forests:false,relief:false},density:0,reliefAmount:0,consumeOnly:true,edits:JSON.stringify([{kind:'style',key:fixture.sourceKey,style}]),...extra});await until(()=>replies.some(r=>'requestId'in r&&r.requestId===name&&(r.type==='tile'||r.type==='error')));return replies.find(r=>'requestId'in r&&r.requestId===name&&(r.type==='tile'||r.type==='error'))!;};
 assert((await request('vector',{model:'keep',color:'#fb02fc',catalogIcon})).type==='tile'&&magenta(canvases.get('vector')!),'Production deep worker omitted real numeric vector');assert(prepared===0,'Vector unnecessarily called raster decoder');
 assert((await request('legacy',{model:'keep',color:'#fb02fc'})).type==='tile','Legacy control failed');assert((await request('unknown',{model:'keep',color:'#fb02fc',catalogIcon:{...catalogIcon,name:'Unknown'}})).type==='tile','Imported unknown should fall back');assert(canvases.get('unknown')!.toDataURL()===canvases.get('legacy')!.toDataURL(),'Worker unknown fallback changed pixels');
 const bad:WorldSpatialStyle={catalogIcon,iconImage:{dataUrl:'data:image/png;base64,AAAA',mode:'colour'}};assert((await request('corrupt',bad)).type==='error'&&!canvases.has('corrupt'),'Catalog hid a visible corrupt raster from strict export');
 const satellite=await request('satellite',{catalogIcon,color:'#fb02fc'},{ink:'satellite'});assert(satellite.type==='tile'&&satellite.places?.some(p=>p.sourceKey===fixture.sourceKey&&p.style?.catalogIcon?.name==='Castle'),'Satellite lost own overlay identity');
 return ['Production seeded deep worker paints own numeric catalog with no decode; exact unavailable fallback, strict visible raster failure and satellite overlay metadata survive'];
}
import {getGeography,getCartoTexture} from '@/engines/worldgen/cartography/texture';
import {applyEdits} from '@/engines/worldgen/core/edits';
import {applyWorldPreset,WORLD_PRESETS} from '@/engines/worldgen/core/presets';
import {themeById} from '@/engines/worldgen/cartography/theme';
export async function testWorldgenPlaceCatalogTexture(){
 const world=generateWorld(applyWorldPreset({...DEFAULT_PARAMS,width:512,seed:'carto-quality-continents'},WORLD_PRESETS.find(p=>p.id==='continents')!)),geo=getGeography(world),town=geo.settlements.find(s=>s.rank==='capital')!;assert(town,'Needs generated capital');const key=town.sourceKey??`settlement:${Math.round(town.x)},${Math.round(town.y)}`,a={...world};a.painted=applyEdits(a,[{kind:'style',target:'settlement',key,style:{catalogIcon}}]);const c=document.createElement('canvas');c.width=c.height=2;const style={catalogIcon,iconImage:{dataUrl:c.toDataURL('image/png'),mode:'colour' as const}},b={...world};b.painted=applyEdits(b,[{kind:'style',target:'settlement',key,style}]);const painter=await preparePlaceImages([style],webPlaceImageAdapter(),{strict:true});
 try{const theme=themeById('wonder'),visibility={rivers:false,roads:false,borders:false},ca=getCartoTexture(a,theme,geo,512,visibility),cb=getCartoTexture(b,theme,geo,512,visibility,painter),aa=ca.getContext('2d')!.getImageData(0,0,512,256).data,bb=cb.getContext('2d')!.getImageData(0,0,512,256).data;assert(aa.every((v,i)=>v===bb[i]),'Vector baked into ground without painter; it belongs to projected overlay');const unknown={...world};unknown.painted=applyEdits(unknown,[{kind:'style',target:'settlement',key,style:{model:'keep',catalogIcon:{...catalogIcon,name:'Unknown'}}}]);const legacy={...world};legacy.painted=applyEdits(legacy,[{kind:'style',target:'settlement',key,style:{model:'keep'}}]);const cu=getCartoTexture(unknown,theme,geo,512,visibility),cl=getCartoTexture(legacy,theme,geo,512,visibility);assert(cu.toDataURL()===cl.toDataURL(),'Unknown catalog masked legacy terrain construction');return ['Real3D texture omits projected vector with no raster painter; equals prepared transparent mask and preserves exact unavailable legacy'];}finally{painter.dispose();}
}
/** Same bundled WEB entry as the product, supplied by the existing Node/CSS harness. */
export async function testWorldgenPlaceCatalogWorkerEntry(){
 const built=(window as unknown as{__placeCatalogWorker?:{url:string;sha256:string}}).__placeCatalogWorker;assert(built?.url&&built.sha256,'Run node test --worker after normal product build');const worker=new Worker(built.url,{type:'module'}),replies:RegionWorkerReply[]=[];worker.onmessage=e=>replies.push(e.data);let failure='';worker.onerror=e=>{failure=e.message;};
 const world=generateWorld({...DEFAULT_PARAMS,width:64,erosion:0,seed:'place-icons-catalog-web'}),geography=buildHumanGeography(world),fixture=workerCanonFixture(world);
 try{worker.postMessage({type:'configure',contextId:'catalog-web',world,geography:packRegionGeography(geography)});await until(()=>!!failure||replies.some(r=>r.type==='configured'));assert(!failure,'Built WEB entry failed '+failure);await seedWorkerCanon(message=>worker.postMessage(message),replies,'catalog-web',fixture);
 worker.postMessage({type:'renderTile',contextId:'catalog-web',requestId:'own-vector',...fixture.key,themeId:'antique',layers:{roads:false,rivers:false,forests:false,relief:false},density:0,reliefAmount:0,consumeOnly:true,edits:JSON.stringify([{kind:'style',key:fixture.sourceKey,style:{catalogIcon,color:'#fb02fc'}}])});await until(()=>replies.some(r=>'requestId'in r&&r.requestId==='own-vector'&&(r.type==='tile'||r.type==='error')));const reply=replies.find(r=>'requestId'in r&&r.requestId==='own-vector'&&(r.type==='tile'||r.type==='error'));assert(reply?.type==='tile'&&reply.bitmap,'Actual WEB worker did not transfer a tile '+JSON.stringify(reply));const canvas=document.createElement('canvas');canvas.width=reply.bitmap.width;canvas.height=reply.bitmap.height;canvas.getContext('2d')!.drawImage(reply.bitmap,0,0);assert(magenta(canvas),'Built WEB worker omitted numeric catalog pixels');console.log('ACTUAL_WEB_WORKER '+JSON.stringify(built));return ['Normal built WEB entry transfers real OffscreenCanvas bitmap with own catalog geometry; no fake worker/Forge or extra build'];
 }finally{worker.terminate();for(const reply of replies)if(reply.type==='tile')reply.bitmap?.close();}
}
