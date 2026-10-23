import '@/engines';
import { db } from '@/db';
import { exportProjectData, importProjectData } from '@/db/operations';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { importLocalMedia } from '@/engines/media/operations';
import { buildWorldWiki, loadWorldWikiData } from '@/services/worldWikiExport';
import { validateWikiOptions } from '@/services/wikiProfiles/validation';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';
import { getBridgeTool } from '@/services/aiBridge/manifest';
import { sha256Hex } from '@/services/judge/text';
import { setMapArtwork } from '@/engines/maps/operations';
import { usableMapArtwork, validateMapArtwork, MAP_ARTWORK_LIMITS } from '@/engines/maps/mapArtwork';
import type { MapPin, Project, WorldMap } from '@/types';
import type { WorldWikiOptions } from '@/types/worldWiki';
import { silentWav } from './vvd-media.browser';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(read: () => T | null | undefined | false, label: string): Promise<T> { for (let i = 0; i < 300; i++) { const value = read(); if (value) return value; await pause(20); } throw Error('Timed out: ' + label); }
const png = (width: number, height: number, colour: string) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d')!; context.fillStyle = colour; context.fillRect(0, 0, width, height); return canvas.toDataURL('image/png'); };
// The page carries a fresh nonce every build; everything else must be identical.
const stable = (html: string) => html.replace(/nonce-[0-9a-f]{36}/g, 'nonce-N').replace(/nonce="[0-9a-f]{36}"/g, 'nonce="N"');
const audit = (reply: BridgeReply) => (reply.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
const undo = (tool: string, reply: BridgeReply) => { const a = audit(reply); return runBridgeTool('__undo', { entry: { tool, kind: 'update', entityId: a.entityId, projectId: a.projectId, before: a.before } }); };
const refused = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: expected a refusal matching ${pattern}, got ${JSON.stringify(reply).slice(0, 300)}`);
const dom = (page: string) => new DOMParser().parseFromString(page, 'text/html');
const build = async (P: string, options: WorldWikiOptions) => buildWorldWiki(await loadWorldWikiData(P, options), options).html;

interface Mounted { frame: HTMLIFrameElement; win: Window & typeof globalThis; doc: Document; map: HTMLElement; played: { id: string; volume: number }[]; close: () => void }
async function mount(html: string, reduceMotion = false): Promise<Mounted> {
  let page = html;
  if (reduceMotion) {
    const nonce = /script-src 'nonce-([0-9a-f]+)'/.exec(html)![1];
    page = html.replace('<body', `<script nonce="${nonce}">window.matchMedia=function(q){return{matches:/reduce/.test(q),media:q,addEventListener(){},removeEventListener(){}}}</script><body`);
  }
  const frame = document.createElement('iframe'); frame.setAttribute('sandbox', 'allow-scripts allow-same-origin'); frame.style.cssText = 'width:900px;height:640px;border:0'; frame.srcdoc = page; document.body.append(frame);
  await until(() => frame.contentDocument?.readyState === 'complete' && frame.contentDocument.querySelector('.map-frame'), 'wiki frame loaded');
  const win = frame.contentWindow as Window & typeof globalThis, doc = frame.contentDocument!, map = doc.querySelector<HTMLElement>('.map-frame')!;
  await until(() => map.dataset.z, 'map runtime installed');
  const played: { id: string; volume: number }[] = [];
  // Real audio output is not needed: the stub records who plays at which volume and tracks paused.
  const proto = win.HTMLMediaElement.prototype as unknown as Record<string, unknown>;
  proto.play = function (this: HTMLAudioElement) { played.push({ id: this.id, volume: this.volume }); Object.defineProperty(this, 'paused', { configurable: true, get: () => false }); return Promise.resolve(); };
  proto.pause = function (this: HTMLAudioElement) { Object.defineProperty(this, 'paused', { configurable: true, get: () => true }); };
  return { frame, win, doc, map, played, close: () => frame.remove() };
}
const num = (map: HTMLElement, key: 'z' | 'tx' | 'ty' | 'cx' | 'cy') => Number(map.dataset[key]);
const frames = (win: Window) => new Promise<void>(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve())));
function pointer(m: Mounted, type: string, x: number, y: number, id = 1) { m.map.dispatchEvent(new (m.win as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, isPrimary: id === 1, clientX: x, clientY: y, pointerType: 'mouse', button: 0 })); }
async function drag(m: Mounted, dx: number, dy: number) {
  const box = m.map.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
  pointer(m, 'pointerdown', x, y); pointer(m, 'pointermove', x + dx / 2, y + dy / 2); pointer(m, 'pointermove', x + dx, y + dy); pointer(m, 'pointerup', x + dx, y + dy);
  await frames(m.win);
}
function wheel(m: Mounted, deltaY: number, at?: { x: number; y: number }, ctrlKey = true) {
  const box = m.map.getBoundingClientRect();
  m.map.dispatchEvent(new (m.win as unknown as { WheelEvent: typeof WheelEvent }).WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, ctrlKey, clientX: at ? at.x : box.left + box.width / 2, clientY: at ? at.y : box.top + box.height / 2 }));
}
const key = (m: Mounted, name: string) => m.map.dispatchEvent(new (m.win as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: name }));

export async function testWikiMapNavigation(): Promise<string[]> {
  const passed: string[] = [], P = 'wiki-map-nav', M = P + '-map', pinA = P + '-pin-a', pinB = P + '-pin-b';
  const mounts: Mounted[] = [];
  try {
    for (const table of db.tables) if (table.schema.indexes.some(index => index.name === 'projectId')) await table.where('projectId').equals(P).delete().catch(() => 0);
    await db.projects.delete(P);
    const project: Project = { id: P, title: 'Atlas', description: 'Maps', mode: 'custom', type: 'standalone', color: '#c5a15b', status: 'draft', enabledEngines: ['maps', 'media', 'codex'], engineOrder: ['maps', 'media', 'codex'], createdAt: 1, updatedAt: 1 };
    await db.projects.put(project);
    const wav = (name: string) => importLocalMedia(P, new File([silentWav()], name + '.wav', { type: 'audio/wav' }));
    const [soundMap, soundA, soundB] = [await wav('Sea wind'), await wav('Harbour'), await wav('Forest')];
    const ground = png(400, 200, '#446655'), back = png(40, 20, '#223344'), mid = png(40, 20, '#556677'), front = png(40, 20, '#778899');
    await db.worldMaps.put({ id: M, projectId: P, title: 'Coast', backgroundImage: ground, createdAt: 1, updatedAt: 5 });
    await db.mapPins.bulkPut([
      { id: pinA, projectId: P, mapId: M, name: 'Harbour', icon: 'port', position: { x: 25, y: 35 } },
      { id: pinB, projectId: P, mapId: M, name: 'Forest', icon: 'forest', position: { x: 80, y: 70 } },
    ] as MapPin[]);

    // ------------------------------------------------------------------ 1. Default export is untouched
    const plain = await build(P, { locale: 'en' });
    assert(!/map-frame|map-stage|map-art|map-controls|wiki-amb|data-map/.test(plain), 'A default export must not carry any map extras');
    await db.worldMaps.update(M, { artwork: { background: back, mid, front, clouds: true }, ambience: { assetId: soundMap.id, volume: 0.6 } });
    await db.mapPins.update(pinA, { ambience: { assetId: soundA.id, radius: 15, volume: 0.8 } });
    await db.mapPins.update(pinB, { ambience: { assetId: soundB.id, radius: 20 } });
    const withData = await build(P, { locale: 'en' });
    assert(stable(plain) === stable(withData) && await sha256Hex(stable(plain)) === await sha256Hex(stable(withData)), 'Artwork and ambience stored on the map must not change a default export by a single byte');
    for (const options of [{ locale: 'en' as const, theme: 'night' as const }, { locale: 'es' as const, includeMaps: false }]) { const a = await build(P, options); assert(!/map-frame|wiki-amb/.test(a), 'Other existing options stay free of map extras'); }
    passed.push('Default export has no map extras and stays byte-identical (nonce aside) when the map stores artwork and ambience');

    // ------------------------------------------------------------------ 2. Options validate additively
    for (const good of [{ mapNavigation: 'free' }, { mapNavigation: 'contained', mapArtwork: true, mapClouds: false, mapAmbience: true }, {}]) validateWikiOptions(good);
    for (const bad of [{ mapNavigation: 'fly' }, { mapNavigation: true }, { mapArtwork: 'yes' }, { mapClouds: 1 }, { mapAmbience: null }]) { let failed = false; try { validateWikiOptions(bad); } catch { failed = true; } assert(failed, 'Invalid map option accepted: ' + JSON.stringify(bad)); }
    passed.push('Profile options mapNavigation/mapArtwork/mapClouds/mapAmbience validate and reject wrong values');

    // ------------------------------------------------------------------ 3. Contained navigation in a mounted export
    const all: WorldWikiOptions = { locale: 'en', mapNavigation: 'contained', mapArtwork: true, mapClouds: true, mapAmbience: true };
    const html = await build(P, all);
    // CSP and the no-remote-load rule survive.
    const csp = (page: string) => /Content-Security-Policy" content="([^"]+)"/.exec(page)![1].replace(/nonce-[0-9a-f]+/, 'nonce-N');
    assert(csp(html) === csp(plain) && !/unsafe-eval|https?:/.test(csp(html)), 'The content security policy must be unchanged');
    const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map(match => match[1]);
    const nonce = /script-src 'nonce-([0-9a-f]+)'/.exec(html)![1];
    assert(scripts.length >= 2 && scripts.every(attributes => attributes.includes(`nonce="${nonce}"`)), 'Every script keeps the nonce');
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    assert([...parsed.querySelectorAll('[src]')].every(node => (node.getAttribute('src') ?? '').startsWith('data:')) && !parsed.querySelector('link[href],script[src],[onclick],[onload]'), 'Nothing is loaded from outside the file and no inline handlers exist');
    assert(parsed.querySelectorAll('audio[data-map-audio]').length === 3 && [...parsed.querySelectorAll('audio[data-map-audio]')].every(node => node.hasAttribute('loop') && !node.hasAttribute('autoplay') && node.getAttribute('preload') === 'none'), 'Three ambience tracks, looping, never autoplay');
    assert(parsed.querySelector('.map-art-bg') && parsed.querySelector('.map-art-mid') && parsed.querySelector('.map-art-front') && parsed.querySelector('.map-clouds'), 'Layers and clouds are rendered');
    passed.push('Export with the map options keeps the same CSP, every script carries the nonce, nothing remote, three looping non-autoplay tracks, three layers and clouds');

    const m = await mount(html); mounts.push(m);
    const box = m.map.getBoundingClientRect();
    assert(box.width > 300 && num(m.map, 'z') === 1 && num(m.map, 'tx') === 0, 'Map starts at rest');
    wheel(m, -400); await frames(m.win);
    const zoomed = num(m.map, 'z');
    assert(zoomed > 1.5 && Math.abs(Number(/scale\(([\d.]+)\)/.exec(m.doc.querySelector<HTMLElement>('.map-stage')!.style.transform)?.[1]) - zoomed) < 0.001, `Ctrl+wheel zooms the stage (z=${zoomed})`);
    const plainWheel = new (m.win as unknown as { WheelEvent: typeof WheelEvent }).WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -400 });
    m.map.dispatchEvent(plainWheel);
    assert(!plainWheel.defaultPrevented && num(m.map, 'z') === zoomed, 'A plain wheel scrolls the page and does not zoom an unfocused map');
    m.map.focus(); wheel(m, -300, undefined, false); await frames(m.win);
    assert(num(m.map, 'z') > zoomed, 'A plain wheel zooms once the map has focus');
    // Zoom back to a known level with the keyboard.
    key(m, '0'); await frames(m.win); assert(num(m.map, 'z') === 1 && num(m.map, 'tx') === 0, 'Key 0 resets');
    key(m, '+'); key(m, '+'); await frames(m.win); const z2 = num(m.map, 'z'); assert(Math.abs(z2 - 1.5625) < 0.01, 'Plus keys zoom in steps (' + z2 + ')');
    const W = m.map.clientWidth, H = m.doc.querySelector<HTMLElement>('.map-stage')!.offsetHeight;
    const [tx0, ty0] = [num(m.map, 'tx'), num(m.map, 'ty')];
    await drag(m, 30, 10);
    assert(Math.abs(num(m.map, 'tx') - (tx0 + 30)) < 1 && Math.abs(num(m.map, 'ty') - (ty0 + 10)) < 1, `Dragging pans by the pointer distance (${tx0} -> ${m.map.dataset.tx})`);
    await drag(m, 5000, 5000);
    assert(num(m.map, 'tx') === 0 && num(m.map, 'ty') === 0, 'Contained: cannot be dragged past the top-left edge');
    await drag(m, -5000, -5000);
    assert(Math.abs(num(m.map, 'tx') - (W - W * z2)) < 0.6 && Math.abs(num(m.map, 'ty') - (H - H * z2)) < 0.6, `Contained: clamped to the far edge (${m.map.dataset.tx} vs ${W - W * z2})`);
    key(m, 'ArrowRight'); await frames(m.win); assert(num(m.map, 'tx') < W - W * z2 + 0.6 + 0, 'Arrow keys pan within the clamp');
    key(m, 'ArrowLeft'); await frames(m.win); assert(num(m.map, 'tx') > W - W * z2 + 40, 'Arrow left moves the view back');
    key(m, '0'); key(m, '-'); await frames(m.win); assert(num(m.map, 'z') === 1, 'Contained cannot zoom out below the frame');
    passed.push('Contained mode: Ctrl+wheel and focused wheel zoom, plain wheel is left to the page, drag pans, keys +/-/0/arrows work, edges clamp');

    // Pins keep their size; the reset button restores the view.
    const pin = m.doc.querySelector<HTMLElement>('.pin')!;
    const base = pin.getBoundingClientRect().width;
    wheel(m, -900); await frames(m.win);
    assert(num(m.map, 'z') > 2.5 && Math.abs(pin.getBoundingClientRect().width - base) < 1.2, `Pins keep their size while zooming (${base} -> ${pin.getBoundingClientRect().width})`);
    m.doc.querySelector<HTMLButtonElement>('[data-map-reset]')!.click(); await frames(m.win);
    assert(num(m.map, 'z') === 1 && num(m.map, 'tx') === 0, 'Reset button');
    m.doc.querySelector<HTMLButtonElement>('[data-map-zoom="in"]')!.click(); await frames(m.win);
    assert(num(m.map, 'z') > 1.3, 'Zoom button');
    passed.push('Pins keep their size at any zoom; reset and zoom buttons work');

    // A click on a pin still follows its link; a drag that ends on it does not. (A fragment link inside a srcdoc frame would navigate the frame away, so the test only observes the click.)
    m.doc.querySelector<HTMLButtonElement>('[data-map-reset]')!.click(); await frames(m.win);
    const seen: boolean[] = []; m.doc.addEventListener('click', event => { seen.push(event.defaultPrevented); event.preventDefault(); });
    (pin as HTMLAnchorElement).click();
    assert(seen.length === 1 && seen[0] === false && (pin as HTMLAnchorElement).getAttribute('href')!.includes('-pin-0'), 'A plain click on a pin reaches its link untouched');
    const pb = pin.getBoundingClientRect(); wheel(m, -400); await frames(m.win);
    pointer(m, 'pointerdown', pb.left + 3, pb.top + 3); pointer(m, 'pointermove', pb.left + 40, pb.top + 30); pointer(m, 'pointerup', pb.left + 40, pb.top + 30); (pin as HTMLAnchorElement).click();
    assert(seen.length === 1, 'The click that ends a drag is swallowed instead of opening the pin');
    await pause(10); (pin as HTMLAnchorElement).click(); assert(seen.length === 2, 'The next click works again');
    passed.push('Pin links still work after pan/zoom code is installed');

    // ------------------------------------------------------------------ 4. Parallax on pan
    m.doc.querySelector<HTMLButtonElement>('[data-map-reset]')!.click(); await frames(m.win); wheel(m, -200); await frames(m.win);
    assert(num(m.map, 'z') > 1.2 && num(m.map, 'z') < 1.6, `Zoom for the parallax check (z ${m.map.dataset.z})`);
    await drag(m, 30, 10);
    const shift = (selector: string) => Number(/translate\((-?[\d.]+)px/.exec(m.doc.querySelector<HTMLElement>(selector)!.style.transform)?.[1]);
    const tx = num(m.map, 'tx');
    assert(Math.abs(shift('.map-art-bg') - tx * 0.25) < 0.1 && Math.abs(shift('.map-art-mid') - tx * 0.6) < 0.1 && Math.abs(shift('.map-art-front') - tx * 1.25) < 0.1, `Layers drift at their own depths (tx ${tx}, bg ${shift('.map-art-bg')}, mid ${shift('.map-art-mid')}, front ${shift('.map-art-front')})`);
    assert(Math.abs(shift('.map-art-front')) > Math.abs(shift('.map-art-mid')) && Math.abs(shift('.map-art-mid')) > Math.abs(shift('.map-art-bg')), `Front moves most, background least (${shift('.map-art-bg')}, ${shift('.map-art-mid')}, ${shift('.map-art-front')}, tx ${tx}, z ${m.map.dataset.z})`);
    const clouds = m.doc.querySelector<HTMLButtonElement>('[data-map-clouds]')!; clouds.click();
    assert(m.map.classList.contains('no-clouds') && clouds.getAttribute('aria-pressed') === 'false', 'Cloud switch hides the overlay'); clouds.click(); assert(!m.map.classList.contains('no-clouds'), 'And shows it again');
    const calm = await mount(html, true); mounts.push(calm);
    wheel(calm, -500); await frames(calm.win); await drag(calm, -60, -20);
    assert(num(calm.map, 'tx') < 0 && ['.map-art-bg', '.map-art-mid', '.map-art-front'].every(selector => !calm.doc.querySelector<HTMLElement>(selector)!.style.transform), 'prefers-reduced-motion: the map pans but the layers stay still');
    passed.push('Parallax layers drift at depths 0.25/0.6/1.25 on pan, clouds can be switched off, reduced motion keeps the layers still');

    // ------------------------------------------------------------------ 5. Sound only after the toggle, pin ambience by distance
    m.doc.querySelector<HTMLButtonElement>('[data-map-reset]')!.click(); await frames(m.win);
    m.map.scrollIntoView(); wheel(m, -500); await frames(m.win); await drag(m, 40, 10); await frames(m.win);
    assert(m.played.length === 0 && [...m.doc.querySelectorAll<HTMLAudioElement>('audio[data-map-audio]')].every(audio => audio.paused), 'Nothing plays on load or while the reader pans');
    const sound = m.doc.querySelector<HTMLButtonElement>('[data-map-sound-toggle]')!;
    assert(sound.getAttribute('aria-pressed') === 'false', 'The sound toggle starts off');
    m.doc.querySelector<HTMLButtonElement>('[data-map-reset]')!.click(); await frames(m.win);
    sound.click(); await frames(m.win);
    const track = m.doc.querySelector('.map-frame')!.getAttribute('data-map-ambience')!;
    assert(sound.getAttribute('aria-pressed') === 'true' && m.played.some(entry => entry.id === track && Math.abs(entry.volume - 0.6) < 0.01), 'Pressing the toggle starts the map track at its volume');
    assert(!m.played.some(entry => entry.id !== track), 'Pins far from the centre stay silent');
    // Centre the view on the harbour pin: its loop fades in.
    wheel(m, -500); await frames(m.win);
    const harbour = m.doc.querySelector<HTMLElement>('.pin[data-amb]')!, harbourTrack = harbour.dataset.amb!;
    const centre = () => { const f = m.map.getBoundingClientRect(), p = harbour.getBoundingClientRect(); return { dx: f.left + f.width / 2 - (p.left + p.width / 2), dy: f.top + f.height / 2 - (p.top + p.height / 2) }; };
    for (let i = 0; i < 4; i++) { const c = centre(); await drag(m, c.dx, c.dy); }
    const audio = m.doc.getElementById(harbourTrack) as HTMLAudioElement;
    assert(Math.abs(num(m.map, 'cx') - 25) < 4 && !audio.paused && audio.volume > 0.5 && audio.volume <= 0.8, `Pin loop plays near its pin (cx ${m.map.dataset.cx}, volume ${audio.volume})`);
    const near = audio.volume; await drag(m, -60, 0); await drag(m, -60, 0);
    assert(audio.paused || audio.volume < near, 'The loop fades out as the view moves away');
    sound.click(); await frames(m.win);
    assert(sound.getAttribute('aria-pressed') === 'false' && [...m.doc.querySelectorAll<HTMLAudioElement>('audio[data-map-audio]')].every(node => node.paused), 'Pressing again silences everything');
    passed.push('Sound: nothing plays before the toggle; the toggle starts the map loop; a pin loop fades in with the distance of the view centre and out again; toggling off pauses all');

    // ------------------------------------------------------------------ 6. Free mode
    const freeHtml = await build(P, { locale: 'en', mapNavigation: 'free' });
    { const page = dom(freeHtml); assert(page.querySelector('.map-frame[data-map-nav=free]') && !page.querySelector('.map-art, audio, .map-clouds, [data-map-sound], [data-map-clouds]'), 'Navigation alone adds no layers, sound or clouds'); }
    const f = await mount(freeHtml); mounts.push(f);
    await drag(f, 120, 60);
    assert(num(f.map, 'tx') > 100 && num(f.map, 'ty') > 50, 'Free: the map may leave the frame at rest');
    key(f, '0'); key(f, '-'); key(f, '-'); key(f, '-'); await frames(f.win);
    assert(num(f.map, 'z') < 0.7 && num(f.map, 'z') >= 0.5, 'Free: can zoom out below the frame size');
    passed.push('Free mode lets the map leave the frame and zoom out; navigation alone adds no layers, sound or clouds');

    // ------------------------------------------------------------------ 7. Caps
    const huge = 'data:image/png;base64,' + 'A'.repeat(MAP_ARTWORK_LIMITS.layerChars + 10);
    await db.worldMaps.update(M, { artwork: { background: back, front: huge, mid: 'data:image/svg+xml;base64,PHN2Zy8+' } });
    const capped = await build(P, all);
    { const page = dom(capped); assert(page.querySelector('.map-art-bg') && !page.querySelector('.map-art-front, .map-art-mid') && capped.length < 3_000_000, 'Oversized and non-raster layers are left out of the page'); }
    assert(Object.keys(usableMapArtwork({ background: back, front: huge })).join() === 'background', 'usableMapArtwork drops oversized layers');
    let rejected = 0; for (const bad of [{ front: huge }, { mid: 'https://example.com/x.png' }, { background: 'data:image/svg+xml;base64,AAAA' }, { extra: back }, { clouds: 'yes' }]) { try { validateMapArtwork(bad); } catch { rejected++; } } assert(rejected === 5, 'validateMapArtwork rejects oversized, remote, SVG, unknown and mistyped input');
    await db.worldMaps.update(M, { artwork: { background: back, mid, front, clouds: true } });
    passed.push('Oversized or non-raster layers never reach the self-contained page; validation rejects them');

    // ------------------------------------------------------------------ 8. Bridge
    const get = await runBridgeTool('wh_map_artwork_get', { mapId: M });
    assert(get.ok, 'wh_map_artwork_get: ' + get.error);
    const info = get.result as { updatedAt: number; layers: Record<string, { present: boolean }>; clouds: boolean; ambience: { assetId: string } | null; pinsWithAmbience: unknown[] };
    assert(info.layers.background.present && info.layers.mid.present && info.clouds && info.ambience?.assetId === soundMap.id && info.pinsWithAmbience.length === 2 && !JSON.stringify(get.result).includes('base64'), 'The read tool describes layers without sending pictures');
    refused(await runBridgeTool('wh_map_artwork', { mapId: M, clouds: false }), /expectedUpdatedAt/, 'missing revision');
    refused(await runBridgeTool('wh_map_artwork', { mapId: M, expectedUpdatedAt: info.updatedAt + 1, clouds: false }), /changed since|read wh_map_artwork_get/, 'stale revision');
    refused(await runBridgeTool('wh_map_artwork', { mapId: M, expectedUpdatedAt: info.updatedAt, background: 'data:image/svg+xml;base64,PHN2Zy8+' }), /data:image/, 'svg refused');
    refused(await runBridgeTool('wh_map_artwork', { mapId: M, expectedUpdatedAt: info.updatedAt, ambience: { assetId: 'nope' } }), /No local audio/, 'unknown audio');
    refused(await runBridgeTool('wh_map_artwork', { mapId: M, expectedUpdatedAt: info.updatedAt }), /Nothing to change/, 'empty');
    refused(await runBridgeTool('wh_map_artwork', { mapId: M, expectedUpdatedAt: info.updatedAt, clouds: true }), /Nothing to change/, 'no-op');
    const newBack = png(40, 20, '#990000');
    const set = await runBridgeTool('wh_map_artwork', { mapId: M, expectedUpdatedAt: info.updatedAt, background: newBack, front: null, clouds: false });
    assert(set.ok, 'wh_map_artwork: ' + set.error);
    let row = (await db.worldMaps.get(M))!;
    assert(row.artwork?.background === newBack && !row.artwork.front && row.artwork.mid === mid && !row.artwork.clouds, 'Layers set and removed in one write');
    assert(JSON.stringify(audit(set).before).length < 2000 && !JSON.stringify(audit(set).before).includes('base64'), 'The undo receipt carries marks, not pictures');
    refused(await runBridgeTool('wh_map_artwork', { mapId: M, expectedUpdatedAt: info.updatedAt, clouds: true }), /changed since|read wh_map_artwork_get/, 'second writer on the old revision');
    const reverted = await undo('wh_map_artwork', set);
    assert(reverted.ok, 'undo: ' + reverted.error);
    row = (await db.worldMaps.get(M))!;
    assert(row.artwork?.background === back && row.artwork.front === front && row.artwork.clouds === true, 'Undo brings the earlier layers back byte for byte');
    // An edit after the change blocks the undo.
    const again = await runBridgeTool('wh_map_artwork', { mapId: M, expectedUpdatedAt: row.updatedAt, mid: null });
    assert(again.ok, 'second change');
    const next = await runBridgeTool('wh_map_artwork', { mapId: M, expectedUpdatedAt: (await db.worldMaps.get(M))!.updatedAt, mid: png(40, 20, '#ffffff') });
    assert(next.ok, 'third change');
    refused(await undo('wh_map_artwork', again), /changed after/, 'undo after the same layer was set again');
    const otherPart = await runBridgeTool('wh_map_artwork', { mapId: M, expectedUpdatedAt: (await db.worldMaps.get(M))!.updatedAt, clouds: false }); assert(otherPart.ok, 'a change to another part');
    assert((await undo('wh_map_artwork', otherPart)).ok && (await db.worldMaps.get(M))!.artwork?.clouds === true, 'Undo of a part leaves later work on other parts alone');
    // Engine guard.
    await db.projects.update(P, { enabledEngines: ['media', 'codex'] });
    refused(await runBridgeTool('wh_map_artwork', { mapId: M, expectedUpdatedAt: 0, clouds: true }), /maps|enabled|off/i, 'engine off');
    await db.projects.update(P, { enabledEngines: ['maps', 'media', 'codex'] });
    // Ambience on the map and on a pin.
    const cur = (await db.worldMaps.get(M))!;
    const amb = await runBridgeTool('wh_map_artwork', { mapId: M, expectedUpdatedAt: cur.updatedAt, ambience: { assetId: soundA.id, volume: 0.3 } });
    assert(amb.ok && (await db.worldMaps.get(M))!.ambience?.assetId === soundA.id, 'Map ambience set');
    assert((await undo('wh_map_artwork', amb)).ok && (await db.worldMaps.get(M))!.ambience?.assetId === soundMap.id, 'Map ambience undone');
    const pinSet = await runBridgeTool('wh_update_map_pin', { id: pinA, ambience: { assetId: soundB.id, volume: 0.4, radius: 30 } });
    assert(pinSet.ok && (await db.mapPins.get(pinA))!.ambience?.radius === 30, 'Pin ambience set through wh_update_map_pin');
    refused(await runBridgeTool('wh_update_map_pin', { id: pinA, ambience: { assetId: soundB.id, radius: 99 } }), /radius|ambience/, 'radius out of range');
    refused(await runBridgeTool('wh_update_map_pin', { id: pinA, ambience: { assetId: 'missing' } }), /No local audio/, 'pin ambience needs real audio');
    assert((await undo('wh_update_map_pin', pinSet)).ok && (await db.mapPins.get(pinA))!.ambience?.assetId === soundA.id, 'Pin ambience undone');
    const cleared = await runBridgeTool('wh_update_map_pin', { id: pinA, ambience: null });
    assert(cleared.ok && (await db.mapPins.get(pinA))!.ambience === undefined, 'Pin ambience cleared with null');
    await db.mapPins.update(pinA, { ambience: { assetId: soundA.id, radius: 15, volume: 0.8 } });
    const toolNames = ['wh_map_artwork', 'wh_map_artwork_get'].map(name => getBridgeTool(name)); assert(toolNames[0]?.writes === true && toolNames[1]?.writes === false, 'Tools are declared with the right write flags');
    // The profile bridge accepts the options additively.
    const profile = await runBridgeTool('wh_wiki_profile_save', { projectId: P, name: 'Maps', expectedRevision: null, options: { mapNavigation: 'contained', mapArtwork: true, mapClouds: true, mapAmbience: true } });
    assert(profile.ok, 'wh_wiki_profile_save with map options: ' + profile.error);
    const saved = profile.result as { id: string; options: WorldWikiOptions; revision: number };
    assert(saved.options.mapNavigation === 'contained' && saved.options.mapAmbience === true, 'The profile keeps the map options');
    refused(await runBridgeTool('wh_wiki_profile_save', { projectId: P, name: 'Bad', expectedRevision: null, options: { mapNavigation: 'sideways' } }), /options|mapNavigation|invalid|enum/i, 'bad mapNavigation');
    const preview = await runBridgeTool('wh_wiki_profile_preview', { projectId: P, profileId: saved.id });
    assert(preview.ok && String((preview.result as { html: string }).html).includes('data-map-nav="contained"'), 'The profile preview renders the navigable map');
    const published = await runBridgeTool('wh_wiki_profile_publish', { projectId: P, profileId: saved.id, expectedRevision: saved.revision });
    assert(published.ok, 'publish: ' + published.error);
    passed.push('Bridge: artwork read/write with revision check, raster-only, undo from a receipt without pictures, refused after later edits and with the maps engine off; pin and map ambience; wiki profile accepts and previews/publishes the new options');

    // ------------------------------------------------------------------ 9. Persistence, JSON clone, ZIP
    const realMap = (await db.worldMaps.get(M))!;
    const portable = await exportProjectData(P);
    const exportedMap = portable.worldMaps!.find(item => item.id === M)!;
    assert(exportedMap.artwork?.background === realMap.artwork?.background && exportedMap.ambience?.assetId === soundMap.id && portable.mapPins!.find(item => item.id === pinA)!.ambience?.assetId === soundA.id, 'JSON backup carries artwork and ambience');
    const cloneId = await importProjectData(portable);
    const cloneMap = (await db.worldMaps.where('projectId').equals(cloneId).toArray())[0] as WorldMap;
    const cloneMedia = (await db.localMediaAssets.where('projectId').equals(cloneId).toArray()).map(asset => asset.id);
    const clonePins = await db.mapPins.where('projectId').equals(cloneId).toArray();
    assert(cloneMap.artwork?.background === realMap.artwork?.background && cloneMap.artwork?.mid === realMap.artwork?.mid, 'Clone keeps the layers');
    assert(cloneMap.ambience && cloneMap.ambience.assetId !== soundMap.id && cloneMedia.includes(cloneMap.ambience.assetId) && clonePins.every(item => !item.ambience || (item.ambience.assetId !== soundA.id && item.ambience.assetId !== soundB.id && cloneMedia.includes(item.ambience.assetId))), 'Clone points the ambience at the copied audio, not the original');
    const cloned = await build(cloneId, { ...all, locale: 'en' });
    { const page = dom(cloned); assert(page.querySelector('.map-art-bg') && page.querySelector('.pin[data-amb]') && page.querySelector('[data-map-ambience]'), 'The clone exports with layers and ambience'); }
    const zip = await createProjectZipArchive(P);
    await db.worldMaps.update(M, { artwork: undefined, ambience: undefined }); await db.mapPins.update(pinA, { ambience: undefined });
    await importProjectZip(new File([zip.blob], 'maps.zip', { type: 'application/zip' }), { replaceProjectIds: [P] });
    const restored = (await db.worldMaps.get(M))!;
    assert(restored.artwork?.background === realMap.artwork?.background && restored.artwork?.mid === realMap.artwork?.mid && restored.ambience?.assetId === soundMap.id && (await db.mapPins.get(pinA))!.ambience?.assetId === soundA.id, 'ZIP restore brings artwork and ambience back');
    passed.push('Artwork and ambience persist in JSON backup, project clone (audio ids follow the copied assets) and ZIP restore');

    // ------------------------------------------------------------------ 10. Ambience respects the other media rules
    const noMedia = await build(P, { ...all, includeMedia: false });
    assert(!dom(noMedia).querySelector('audio, [data-map-sound], .pin[data-amb]'), 'includeMedia:false leaves out every ambience track');
    const noImages = await build(P, { ...all, includeImages: false });
    assert(!dom(noImages).querySelector('.map-frame, .map-art'), 'includeImages:false leaves out the map picture block, layers and all');
    const direct = await setMapArtwork(M, { clouds: true }, undefined, (await db.worldMaps.get(M))!.updatedAt).catch(error => error as Error);
    assert(direct instanceof Error ? /unchanged/.test(direct.message) : direct.receipt.clouds, 'setMapArtwork refuses a no-op or applies it');
    passed.push('includeMedia:false drops the ambience, includeImages:false drops the whole picture block');
    return passed;
  } finally {
    for (const mounted of mounts) mounted.close();
  }
}
