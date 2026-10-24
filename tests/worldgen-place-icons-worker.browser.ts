import { createRegionWorkerCore, type RegionWorkerHost } from '@/engines/worldgen/region/workerCore';
import { packRegionGeography, type RegionWorkerReply } from '@/engines/worldgen/region/workerProtocol';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS, type WorldData } from '@/engines/worldgen/core/types';
import { buildHumanGeography } from '@/engines/worldgen/core/settlements';
import { preparePlaceImages, webPlaceImageAdapter } from '@/engines/worldgen/cartography/placeImages';
import type { WorldSpatialStyle } from '@/engines/worldgen/core/spatialEntities';
import { renderRegion } from '@/engines/worldgen/region/render';
import { Cover, DEFAULT_REGION_PARAMS, type RegionData } from '@/engines/worldgen/region/types';
import { THEME_ANTIQUE } from '@/engines/worldgen/cartography/theme';
import { renderDeepTile, makeCanonCache, installCanon } from '@/engines/worldgen/region/deepTile';
import { canonRefinement, tileGeometry, tileKey } from '@/engines/worldgen/region/tiles';
import type { WorldEdit } from '@/engines/worldgen/core/edits';
import { encodeCanonTile } from '@/engines/worldgen/region/canonStore';
import { runRegionInfraTests } from './worldgen-region-infra.test';

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

export async function testWorldgenPlaceIconsWorkerPreparation(): Promise<string[]> {
  const world = generateWorld({ ...DEFAULT_PARAMS, width: 64, erosion: 0, seed: 'place-icons-worker' });
  const geography = buildHumanGeography(world);
  const replies: RegionWorkerReply[] = [];
  let preparations = 0, rendered = 0, released = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const host: RegionWorkerHost = {
    post: reply => { replies.push(reply); },
    preparePlaceImages: async (styles, signal) => {
      preparations++;
      const adapter = webPlaceImageAdapter();
      return preparePlaceImages(styles, { ...adapter, async decode(bytes, mime) {
        const image = await adapter.decode(bytes, mime);
        await gate;
        return { ...image, dispose() { released++; image.dispose?.(); } };
      } }, { signal, strict: true });
    },
    renderTile(px, draw) {
      rendered++;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = px;
      draw(canvas.getContext('2d')!);
      return { transfer: [] };
    },
  };
  const handle = createRegionWorkerCore(host);
  handle({ type: 'configure', contextId: 'icons', world, geography: packRegionGeography(geography) });
  await until(() => replies.some(r => r.type === 'configured'));
  const fixture=workerCanonFixture(world);await seedWorkerCanon(handle,replies,'icons',fixture);
  const request = { type: 'renderTile' as const, contextId: 'icons', requestId: 'first', ...fixture.key, consumeOnly:true,
    themeId: 'antique', layers: { settlements: true }, density: 0, reliefAmount: 0,
    edits: JSON.stringify([{ kind: 'style', key: fixture.sourceKey, style: { iconImage: icon() } }]) };
  handle(request);
  await pause();
  assert(preparations === 1 && rendered === 0, 'Regional tile rendered before awaiting place image preparation');
  handle({ type: 'cancel', requestId: 'first' });
  release();
  await until(() => replies.some(r => r.type === 'cancelled' && r.requestId === 'first'));
  await pause();
  assert(rendered === 0 && !replies.some(r => r.type === 'tile' && r.requestId === 'first'), 'Cancelled image preparation published a tile');
  assert(released === 1, 'Cancellation during real bitmap decode leaked its decoded image');
  return ['regional production queue awaits image preparation and drops cancellation before canvas creation'];
}

// Stage only during global hold. Insert into the existing author worker test after FIN.
// Requires its existing regionFixture/canon helpers plus encodeCanonTile import.
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

export async function testWorldgenPlaceIconsRegionPixels(): Promise<string[]> {
  const style: WorldSpatialStyle = { model: 'keep', icon: 'fort', color: '#285a86', iconImage: icon() };
  const painter = await preparePlaceImages([style], webPlaceImageAdapter(), { strict: true });
  const inked = { ...style, iconImage: { ...style.iconImage!, mode: 'inked' as const } };
  const layers = { paper: false, cover: false, shading: false, contours: false, woods: false,
    fields: false, water: false, tracks: false, places: true, labels: false, frame: false,
    legend: false, scaleBar: false };
  const base = canvas256(), out = canvas256();
  const region = regionFixture(style);
  const draw = (style: WorldSpatialStyle, withPainter = true) => {
    region.places[0].style = style;
    renderRegion(region, out.ctx, { theme: THEME_ANTIQUE, width: 256, height: 256, layers,
      placeImages: withPainter ? painter : undefined });
  };
  try {
    renderRegion({ ...region, places: [] }, base.ctx, { theme: THEME_ANTIQUE, width: 256, height: 256, layers });
    draw(style);
    colour(pixel(out.ctx, 119, 119), [250, 8, 8, 255], 'Sheet lost red quadrant');
    colour(pixel(out.ctx, 136, 119), [8, 248, 8, 255], 'Sheet lost green quadrant');
    colour(pixel(out.ctx, 119, 136), [8, 8, 250, 255], 'Sheet lost blue quadrant');
    colour(pixel(out.ctx, 136, 136), pixel(base.ctx, 136, 136), 'Sheet filled transparent quadrant or drew saved model underneath');
    draw(inked);
    colour(pixel(out.ctx, 119, 119), [40, 90, 134, 255], 'Sheet ignored effective custom ink');
    colour(pixel(out.ctx, 136, 136), pixel(base.ctx, 136, 136), 'Inked sheet lost transparency');
    const legacy = { ...style, iconImage: undefined };
    draw(legacy, false); const before = out.ctx.getImageData(0, 0, 256, 256).data.slice();
    draw({ ...legacy, iconImage: null });
    assert(out.ctx.getImageData(0, 0, 256, 256).data.every((v, i) => v === before[i]), 'Remove image did not restore exact saved legacy model pixels');
  } finally { painter.dispose(); }
  return ['regional sheet renderer paints original colour, alpha, effective ink and restores exact legacy model pixels'];
}

export async function testWorldgenPlaceIconsWorkerPixels(): Promise<string[]> {
  const world=generateWorld({...DEFAULT_PARAMS,width:64,erosion:0,seed:'place-icons-worker-pixels'});
  const geography=buildHumanGeography(world),fixture=workerCanonFixture(world);
  const replies:RegionWorkerReply[]=[],canvases=new Map<string,HTMLCanvasElement>(),prepared:WorldSpatialStyle[][]=[];
  let latestId='',preparations=0,disposals=0;
  const handle=createRegionWorkerCore({
    post(reply){replies.push(reply);},
    async preparePlaceImages(styles,signal){
      preparations++;const list=[...styles];prepared.push(list);
      const painter=await preparePlaceImages(list,webPlaceImageAdapter(),{signal,strict:true});
      return{...painter,dispose(){disposals++;painter.dispose();}};
    },
    renderTile(px,draw){const{canvas,ctx}=canvas256();assert(px===256,'Worker changed tile dimensions');draw(ctx);canvases.set(latestId,canvas);return{transfer:[]};},
  });
  handle({type:'configure',contextId:'pixels',world,geography:packRegionGeography(geography)});
  await until(()=>replies.some(r=>r.type==='configured'));
  await seedWorkerCanon(handle,replies,'pixels',fixture);
  const request=async(id:string,edits:WorldEdit[],extra:Partial<import('@/engines/worldgen/region/workerProtocol').RegionRenderTileWorkerRequest>={})=>{
    latestId=id;handle({type:'renderTile',contextId:'pixels',requestId:id,...fixture.key,themeId:THEME_ANTIQUE.id,layers:{roads:false,rivers:false,forests:false,relief:false},density:0,reliefAmount:0,consumeOnly:true,edits:JSON.stringify(edits),...extra});
    await until(()=>replies.some(r=>'requestId' in r&&r.requestId===id&&(r.type==='tile'||r.type==='error')));
    return replies.find(r=>'requestId' in r&&r.requestId===id&&(r.type==='tile'||r.type==='error'))!;
  };
  const edit=(image:WorldSpatialStyle['iconImage'],key=fixture.sourceKey):WorldEdit=>({kind:'style',key,style:{model:'keep',size:2,iconImage:image}});
  const image=icon(),bad={dataUrl:'data:image/png;base64,AAAA',mode:'colour' as const};
  const first=await request('colour',[edit(image)]);
  assert(first.type==='tile','Worker rejected valid local raster: '+JSON.stringify(first));
  colour(pixel(canvases.get('colour')!.getContext('2d')!,119,119),[250,8,8,255],'Deep worker tile lost actual decoded red quadrant');
  assert((await request('inked',[edit(image),edit({...image,mode:'inked'})])).type==='tile','Worker rejected inked raster');
  colour(pixel(canvases.get('inked')!.getContext('2d')!,119,119),[64,47,20,255],'Deep worker tile ignored theme ink');
  assert(prepared[1].length===1&&prepared[1][0].iconImage?.mode==='inked','Worker decoded superseded historical descriptors');
  await request('removed',[edit(image),edit(null)]);
  assert(preparations===2&&disposals===2,'Removal decoded inactive history or leaked a per-tile lease');
  const failed=await request('bad',[edit(bad)]);
  assert(failed.type==='error'&&!canvases.has('bad'),'Broken visible raster returned a successful incomplete tile');
  assert((await request('legacy',[])).type==='tile','Failed image preparation stalled the production queue');
  const legacy=canvases.get('legacy')!.toDataURL();
  const count=preparations;
  assert((await request('off-frame',[edit(bad,fixture.outsideKey)])).type==='tile','Wholly off-frame descriptor blocked a deep tile');
  assert(preparations===count&&canvases.get('off-frame')!.toDataURL()===legacy,'Off-frame image decoded or changed legacy pixels');
  assert((await request('ghost',[edit(bad,'settlement:999999,999999')])).type==='tile'&&preparations===count,'Nonexistent global descriptor blocked deep tile');
  for(const ink of ['carta','satellite'] as const){
    const reply=await request('shallow-'+ink,[edit(bad)],{ink,z:2,tx:0,ty:0});
    assert(reply.type==='tile'&&!reply.declined&&preparations===count,'Ground-only shallow tile decoded an overlay resource');
  }
  const satellite=await request('deep-satellite',[edit(bad)],{ink:'satellite'});
  assert(satellite.type==='tile'&&!satellite.declined&&preparations===count,'Satellite ground decoded its main-thread overlay descriptor');
  assert(satellite.type==='tile'&&satellite.places?.some(p=>p.sourceKey===fixture.sourceKey&&p.style?.iconImage?.dataUrl===bad.dataUrl),'Satellite omitted effective style metadata needed by its own live overlay');
  return ['Real seeded deep-carta core strictly decodes visible/latest images, paints colour/ink and recovers errors; off-frame/ghost/shallow/satellite resources never decode or alter unrelated pixels'];
}

export async function testWorldgenPlaceIconsDeepTilePixels(): Promise<string[]> {
  const world = generateWorld({ ...DEFAULT_PARAMS, width: 64, erosion: 0, seed: 'place-icons-deep-tile' });
  const geography = buildHumanGeography(world);
  const style: WorldSpatialStyle = { model: 'keep', color: '#285a86', iconImage: icon() };
  const painter = await preparePlaceImages([style], webPlaceImageAdapter(), { strict: true });
  const id = { tx: 1, ty: 1 }, geometry = tileGeometry(world, id), n = geometry.width * geometry.height;
  const region: RegionData = {
    ...regionFixture({}), ...geometry,
    elevation: new Float32Array(n).fill(1), water: new Uint8Array(n), flow: new Float32Array(n),
    slope: new Float32Array(n), wet: new Float32Array(n), biome: new Uint8Array(n).fill(6), cover: new Uint8Array(n).fill(Cover.Grass),
  };
  const key = { z: 10, tx: 100, ty: 100 }, refin = canonRefinement(world);
  const worldX = (100 * 32 + 16) / refin, worldY = worldX;
  region.places[0] = { ...region.places[0], x: (worldX - geometry.originX) * refin,
    y: (worldY - geometry.originY) * refin, worldX, worldY };
  const cache = makeCanonCache(); installCanon(cache, tileKey(id), region);
  const out = canvas256();
  const render = (patch: WorldSpatialStyle, withPainter = true) => renderDeepTile(world, geography, cache, out.ctx, key, {
    theme: THEME_ANTIQUE, layers: { roads: false, rivers: false }, density: 0,
    edits: [{ kind: 'style', key: region.places[0].sourceKey, style: patch }],
    placeImages: withPainter ? painter : undefined,
  });
  try {
    const first = render(style);
    assert(first.generated === 0 && first.places.length === 1, 'Deep tile did not consume the seeded production canon window');
    colour(pixel(out.ctx, 119, 119), [250, 8, 8, 255], 'Deep carta lost red quadrant');
    colour(pixel(out.ctx, 136, 119), [8, 248, 8, 255], 'Deep carta lost green quadrant');
    const transparent = pixel(out.ctx, 136, 136);
    render({ ...style, iconImage: { ...style.iconImage!, mode: 'inked' } });
    colour(pixel(out.ctx, 119, 119), [40, 90, 134, 255], 'Deep carta ignored effective ink');
    colour(pixel(out.ctx, 136, 136), transparent, 'Deep carta changed transparent ground after tint');
    const legacy = { model: 'keep' as const, color: '#285a86' };
    render(legacy, false); const before = out.ctx.getImageData(0, 0, 256, 256).data.slice();
    render({ ...legacy, iconImage: null });
    assert(out.ctx.getImageData(0, 0, 256, 256).data.every((v, i) => v === before[i]), 'Deep carta removal changed legacy pixels');
  } finally { painter.dispose(); cache.map.clear(); cache.order.length = 0; }
  return ['deep carta production render consumes seeded canon and paints colour/alpha/inked with exact legacy restoration'];
}

export async function testWorldgenPlaceIconsWorkerRetarget(): Promise<string[]> {
  const world = generateWorld({ ...DEFAULT_PARAMS, width: 64, erosion: 0, seed: 'place-icons-retarget' });
  const geography = packRegionGeography(buildHumanGeography(world));
  const replies: RegionWorkerReply[] = [];
  let started = false, disposed = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const handle = createRegionWorkerCore({
    post(reply) { replies.push(reply); },
    async preparePlaceImages(styles, signal) {
      const adapter = webPlaceImageAdapter();
      return preparePlaceImages(styles, { ...adapter, async decode(bytes, mime) {
        const decoded = await adapter.decode(bytes, mime); started = true;
        await gate;
        return { ...decoded, dispose() { disposed++; decoded.dispose?.(); } };
      } }, { signal, strict: true });
    },
    renderTile() { throw new Error('Consume-only fixture unexpectedly opened a canvas'); },
  });
  const configure = (contextId: string) => handle({ type: 'configure', contextId, world, geography });
  configure('old'); await until(() => replies.some(r => r.type === 'configured'));
  const fixture=workerCanonFixture(world);await seedWorkerCanon(handle,replies,'old',fixture);
  const request = { type: 'renderTile' as const, contextId: 'old', requestId: 'decode-old', z: 10,
    tx: 100, ty: 100, themeId: THEME_ANTIQUE.id, layers: {}, density: 1, reliefAmount: 0, consumeOnly: true,
    edits: JSON.stringify([{ kind: 'style', key: fixture.sourceKey, style: { iconImage: icon() } }]) };
  handle(request); await until(() => started);
  handle({ ...request, requestId: 'queued-old' });
  configure('new'); release();
  await until(() => replies.some(r => r.type === 'configured' && r.contextId === 'new'));
  assert(disposed === 1, 'Retarget did not close the image decoded for its retired context');
  assert(!replies.some(r => r.type === 'tile' && (r.requestId === 'decode-old' || r.requestId === 'queued-old')),
    'A retired or queued-old context published a completed tile');
  handle({ ...request, contextId: 'new', requestId: 'new-request', edits: undefined });
  await until(() => replies.some(r => r.type === 'tile' && r.requestId === 'new-request'));
  const next = replies.find(r => r.type === 'tile' && r.requestId === 'new-request');
  assert(next?.type === 'tile' && next.declined === true, 'Retarget changed the existing consume-only no-generation contract');
  return ['configure retires active decoder and queued old work without publishing stale tiles; next context retains consume-only behavior'];
}

export async function testWorldgenPlaceIconsRegionLegacy(): Promise<string[]> {
  await runRegionInfraTests();
  return ['unchanged original regional coordinates, identity and client infrastructure assertions'];
}

export async function testWorldgenPlaceIconsRegionFootprint(): Promise<string[]> {
  const source = icon();
  const painter = await preparePlaceImages([{ iconImage: source }], webPlaceImageAdapter(), { strict: true });
  try {
    for (const dpr of [1, 2]) for (const size of [.65, 1, 2.4]) {
      const style: WorldSpatialStyle = { size, iconImage: source };
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256 * dpr;
      const raw = canvas.getContext('2d')!;
      const images: { left: number; top: number; width: number; height: number }[] = [];
      const labels: { left: number; top: number; width: number; height: number }[] = [];
      const ctx = new Proxy(raw, { get(target, key) {
        if (key === 'drawImage') return (image: CanvasImageSource, x: number, y: number, w: number, h: number) => {
          const transform = target.getTransform();
          const left = transform.transformPoint({ x, y }), right = transform.transformPoint({ x: x + w, y: y + h });
          images.push({ left: left.x, top: left.y, width: right.x - left.x, height: right.y - left.y });
          target.drawImage(image, x, y, w, h);
        };
        if (key === 'fillText') return (text: string, x: number, y: number) => {
          const fontSize = Number(target.font.match(/([\d.]+)px/)?.[1]);
          labels.push({ left: x, top: y - fontSize / 2, width: target.measureText(text).width, height: fontSize });
          target.fillText(text, x, y);
        };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }, set(target, key, value) { return Reflect.set(target, key, value, target); } });
      renderRegion(regionFixture(style, 256), ctx, {
        theme: THEME_ANTIQUE, width: canvas.width, height: canvas.height, typeScale: dpr, placeImages: painter,
        layers: { paper: false, cover: false, shading: false, contours: false, woods: false, fields: false,
          water: false, tracks: false, places: true, labels: true, frame: false, legend: false, scaleBar: false },
      });
      const frame = images[0], expected = 16 * size * dpr;
      assert(images.length === 1 && Math.abs(frame.width - expected) < .01 && Math.abs(frame.height - expected) < .01,
        `Regional prepared image has wrong logical footprint at size=${size}, DPR=${dpr}: ${JSON.stringify(frame)}, expected ${expected}px`);
      assert(labels.length === 1, 'Regional footprint fixture lost its place label');
      assert(labels.every(label => label.left >= frame.left + frame.width || label.left + label.width <= frame.left
        || label.top >= frame.top + frame.height || label.top + label.height <= frame.top),
      `Regional label overlaps prepared image at size=${size}, DPR=${dpr}`);
    }
    const unavailable: WorldSpatialStyle = { model: 'keep', iconImage: { dataUrl: 'data:image/png;base64,AAAA', mode: 'colour' } };
    const control = canvas256(), fallback = canvas256();
    const fallbackRegion = regionFixture(unavailable, 256);
    const options = { theme: THEME_ANTIQUE, width: 256, height: 256,
      layers: { paper: false, cover: false, shading: false, contours: false, woods: false, fields: false,
        water: false, tracks: false, places: true, labels: true, frame: false, legend: false, scaleBar: false } };
    renderRegion(fallbackRegion, control.ctx, options);
    renderRegion(fallbackRegion, fallback.ctx, { ...options, placeImages: painter });
    const before = control.ctx.getImageData(0, 0, 256, 256).data;
    assert(fallback.ctx.getImageData(0, 0, 256, 256).data.every((v, i) => v === before[i]),
      'Unprepared image changed the exact legacy symbol or label pixels');
  } finally { painter.dispose(); }
  return ['regional prepared image keeps 16 logical pixels times size at DPR1/2, reserves its label frame and leaves unprepared legacy pixels exact'];
}
