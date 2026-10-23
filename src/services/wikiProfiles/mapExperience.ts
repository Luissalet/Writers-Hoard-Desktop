import type { MapArtwork } from '@/types';
import type { WorldWikiOptions } from '@/types/worldWiki';

// Exported wiki maps: pan/zoom, illustration layers with parallax, clouds and ambience.
// Everything here is only used when the profile sets one of the map options, so a profile
// without them exports the same bytes as before. The two runtimes below are plain functions
// serialized verbatim into the page (like the voice reading runtime): they reference nothing
// outside themselves and no author data ever enters a script literal.

export const wikiMapsActive = (options: WorldWikiOptions) => !!(options.mapNavigation || options.mapArtwork || options.mapClouds || options.mapAmbience);

export const WIKI_MAP_COPY = {
  es: {
    region: 'mapa interactivo', hint: 'Arrastra para mover el mapa. Con el mapa enfocado: flechas para mover, + y − para ampliar, 0 para restablecer. Ctrl + rueda para ampliar.',
    zoomIn: 'Ampliar', zoomOut: 'Reducir', reset: 'Restablecer', resetLabel: 'Restablecer', clouds: 'Nubes', cloudsLabel: 'Nubes', controls: 'Controles del mapa',
    soundOn: 'Sonido: activar', soundOff: 'Sonido: silenciar', blocked: 'El navegador ha bloqueado el sonido. Pulsa de nuevo.',
  },
  en: {
    region: 'interactive map', hint: 'Drag to move the map. With the map focused: arrow keys to move, + and − to zoom, 0 to reset. Ctrl + wheel to zoom.',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', reset: 'Reset view', resetLabel: 'Reset', clouds: 'Clouds', cloudsLabel: 'Clouds', controls: 'Map controls',
    soundOn: 'Sound: turn on', soundOff: 'Sound: mute', blocked: 'The browser blocked the sound. Press again.',
  },
} as const;

export interface WikiMapAmbienceTrack { domId: string; volume: number }
export interface WikiMapFrameInput {
  key: string; title: string; image: string; vectors: string; markers: string; options: WorldWikiOptions; locale: 'es' | 'en';
  artwork: MapArtwork; ambience?: WikiMapAmbienceTrack; pinAmbience?: boolean; esc: (value: unknown) => string;
}

/** The map block of one exported map: layers, the two stages (picture, then shapes and pins), clouds and controls. */
export function wikiMapFrame(input: WikiMapFrameInput): string {
  const { options, esc, artwork } = input, copy = WIKI_MAP_COPY[input.locale], nav = options.mapNavigation, art = options.mapArtwork === true;
  const clouds = options.mapClouds === true || (art && artwork.clouds === true), sound = !!input.ambience || input.pinAmbience === true;
  const layer = (name: 'background' | 'mid' | 'front', css: string, depth: string) => art && artwork[name] ? `<div class="map-art ${css}" data-depth="${depth}" aria-hidden="true"><img src="${esc(artwork[name])}" alt=""></div>` : '';
  const buttons = [
    nav ? `<button type="button" data-map-zoom="in" aria-label="${copy.zoomIn}">+</button><button type="button" data-map-zoom="out" aria-label="${copy.zoomOut}">−</button><button type="button" data-map-reset aria-label="${copy.reset}">${copy.resetLabel}</button>` : '',
    clouds ? `<button type="button" data-map-clouds aria-pressed="true" aria-label="${copy.clouds}">${copy.cloudsLabel}</button>` : '',
    sound ? `<button type="button" data-map-sound-toggle aria-pressed="false" data-label-on="${copy.soundOn}" data-label-off="${copy.soundOff}" data-blocked="${copy.blocked}">${copy.soundOn}</button>` : '',
  ].join('');
  const attrs = [
    nav ? ` data-map-nav="${nav}" tabindex="0" role="group" aria-roledescription="${copy.region}" aria-label="${esc(input.title)}" aria-describedby="${input.key}-hint"` : '',
    sound ? ` data-map-sound="1"${input.ambience ? ` data-map-ambience="${input.ambience.domId}" data-map-ambience-volume="${input.ambience.volume}"` : ''}` : '',
  ].join('');
  return `<div class="map-wrap map-frame" id="${input.key}-frame"${attrs}>${layer('background', 'map-art-bg', '0.25')}<div class="map-stage"><img src="${esc(input.image)}" alt="${esc(input.title)}"></div>${layer('mid', 'map-art-mid', '0.6')}<div class="map-stage map-stage-top">${input.vectors ? `<svg class="map-vectors" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="${esc(input.title)}">${input.vectors}</svg>` : ''}${input.markers}</div>${layer('front', 'map-art-front', '1.25')}${clouds ? '<div class="map-clouds" aria-hidden="true"><i></i><i></i><i></i></div>' : ''}${buttons ? `<div class="map-controls" role="toolbar" aria-label="${copy.controls}">${buttons}<span class="map-sound-status" role="status" aria-live="polite"></span></div>` : ''}</div>${nav ? `<p class="map-hint" id="${input.key}-hint">${copy.hint}</p>` : ''}`;
}

export const WIKI_MAP_CSS = `.map-frame{overflow:hidden;background:var(--line);touch-action:pan-y;user-select:none;-webkit-user-select:none}.map-frame:focus-visible{outline:3px solid var(--accent);outline-offset:2px}.map-frame[data-map-nav]{cursor:grab}.map-frame.is-dragging{cursor:grabbing}.map-frame[data-map-nav=free],.map-frame.is-zoomed{touch-action:none}.map-stage{position:relative;z-index:1;transform-origin:0 0;will-change:transform}.map-stage>img{width:100%;display:block;-webkit-user-drag:none}.map-stage-top{position:absolute;left:0;top:0;width:100%;height:100%;z-index:3}.map-frame .pin{transform:translate(-50%,-50%) scale(var(--inv,1))}.map-art{position:absolute;inset:-25%;pointer-events:none;will-change:transform}.map-art img{width:100%;height:100%;object-fit:cover;display:block}.map-art-bg{z-index:0}.map-art-mid{z-index:2}.map-art-front{z-index:4}.map-clouds{position:absolute;inset:0;z-index:5;pointer-events:none;overflow:hidden}.map-frame.no-clouds .map-clouds{display:none}.map-clouds i{position:absolute;width:60%;height:34%;border-radius:50%;background:radial-gradient(ellipse at center,rgba(255,255,255,.55),rgba(255,255,255,0) 70%);filter:blur(6px);animation:map-drift 80s linear infinite}.map-clouds i:nth-child(1){top:6%;left:-60%}.map-clouds i:nth-child(2){top:38%;left:-60%;animation-duration:110s;animation-delay:-40s;opacity:.8}.map-clouds i:nth-child(3){top:68%;left:-60%;animation-duration:95s;animation-delay:-70s;opacity:.65}@keyframes map-drift{from{transform:translateX(0)}to{transform:translateX(260%)}}.map-controls{position:absolute;right:8px;top:8px;z-index:6;display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end;align-items:center;max-width:calc(100% - 16px)}.map-controls button{min-width:32px;height:32px;padding:0 8px;font:13px system-ui,sans-serif;border:1px solid var(--line);border-radius:6px;cursor:pointer}.map-controls button[aria-pressed=true]{outline:2px solid var(--accent)}.map-sound-status{font:12px system-ui,sans-serif;background:var(--paper);color:var(--ink);border-radius:4px;padding:0 4px}.map-sound-status:empty{display:none}.map-hint{font-size:13px;color:var(--muted);margin:6px 0 0}@media(prefers-reduced-motion:reduce){.map-clouds i{animation:none}.map-clouds i:nth-child(1){left:8%}.map-clouds i:nth-child(2){left:40%}.map-clouds i:nth-child(3){left:20%}}@media print{.map-controls,.map-clouds,.map-hint{display:none}}`;

/** Pan, zoom, parallax and the cloud switch for every `.map-frame`. */
export function installWikiMaps(doc: Document) {
  const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  doc.querySelectorAll<HTMLElement>('.map-frame').forEach(frame => {
    const stages = [...frame.querySelectorAll<HTMLElement>('.map-stage')];
    const layers = [...frame.querySelectorAll<HTMLElement>('.map-art')];
    const mode = frame.dataset.mapNav;
    const cloudsButton = frame.querySelector<HTMLButtonElement>('[data-map-clouds]');
    if (cloudsButton) cloudsButton.addEventListener('click', () => { const hidden = frame.classList.toggle('no-clouds'); cloudsButton.setAttribute('aria-pressed', String(!hidden)); });
    if (!mode) return;
    const MAX = 8, MIN = mode === 'free' ? 0.5 : 1;
    let s = 1, tx = 0, ty = 0, dragged = false;
    const size = () => ({ w: frame.clientWidth, h: stages[0] ? stages[0].offsetHeight : frame.clientHeight });
    const clamp = () => {
      const { w, h } = size();
      s = Math.max(MIN, Math.min(MAX, s));
      if (mode === 'contained') { tx = Math.max(w - w * s, Math.min(0, tx)); ty = Math.max(h - h * s, Math.min(0, ty)); }
      else { tx = Math.max(-w * s * 0.75, Math.min(w * 0.75, tx)); ty = Math.max(-h * s * 0.75, Math.min(h * 0.75, ty)); }
    };
    const apply = () => {
      clamp();
      const { w, h } = size();
      const transform = 'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px) scale(' + s.toFixed(4) + ')';
      stages.forEach(stage => { stage.style.transform = transform; });
      if (!reduce) layers.forEach(layer => {
        const depth = parseFloat(layer.dataset.depth || '0') || 0, mx = w * 0.25, my = h * 0.25;
        const dx = Math.max(-mx, Math.min(mx, tx * depth)), dy = Math.max(-my, Math.min(my, ty * depth));
        layer.style.transform = 'translate(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px)';
      });
      frame.style.setProperty('--inv', String(1 / s));
      frame.classList.toggle('is-zoomed', s > 1.001);
      frame.dataset.z = s.toFixed(3);
      frame.dataset.tx = tx.toFixed(1);
      frame.dataset.ty = ty.toFixed(1);
      frame.dataset.cx = (w ? ((w / 2 - tx) / s / w) * 100 : 50).toFixed(2);
      frame.dataset.cy = (h ? ((h / 2 - ty) / s / h) * 100 : 50).toFixed(2);
      frame.dispatchEvent(new CustomEvent('wh-map-view'));
    };
    const zoomAt = (factor: number, px: number, py: number) => {
      const next = Math.max(MIN, Math.min(MAX, s * factor)), ratio = next / s;
      tx = px - (px - tx) * ratio; ty = py - (py - ty) * ratio; s = next; apply();
    };
    const centre = () => { const { w, h } = size(); return { x: w / 2, y: h / 2 }; };
    const local = (clientX: number, clientY: number) => { const box = frame.getBoundingClientRect(); return { x: clientX - box.left, y: clientY - box.top }; };
    const pointers = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number; tx: number; ty: number } | null = null, pinch = 0;
    frame.addEventListener('pointerdown', event => {
      if ((event.target as HTMLElement).closest('.map-controls')) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      dragged = false;
      if (pointers.size === 1) start = { x: event.clientX, y: event.clientY, tx, ty };
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); start = null; }
    });
    frame.addEventListener('pointermove', event => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()], distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && distance > 0) { const mid = local((a.x + b.x) / 2, (a.y + b.y) / 2); zoomAt(distance / pinch, mid.x, mid.y); }
        pinch = distance; dragged = true; return;
      }
      if (!start) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (!dragged && Math.hypot(dx, dy) < 4) return;
      if (!dragged) { dragged = true; frame.classList.add('is-dragging'); try { frame.setPointerCapture(event.pointerId); } catch { /* a pointer that already ended */ } }
      tx = start.tx + dx; ty = start.ty + dy; apply();
    });
    const end = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = 0;
      // The click that follows a drag arrives right after pointerup; any later click is a normal one.
      if (pointers.size === 0) { start = null; frame.classList.remove('is-dragging'); setTimeout(() => { dragged = false; }, 0); }
      else if (pointers.size === 1) { const [only] = [...pointers.values()]; start = { x: only.x, y: only.y, tx, ty }; }
    };
    frame.addEventListener('pointerup', end);
    frame.addEventListener('pointercancel', end);
    // A drag must not follow the pin or shape the pointer ended on.
    frame.addEventListener('click', event => { if (dragged) { event.preventDefault(); event.stopPropagation(); dragged = false; } }, true);
    frame.addEventListener('wheel', event => {
      // Page scrolling stays with the page unless the reader asked for the map: Ctrl/Cmd, or the map (or something in it) has focus.
      if (!(event.ctrlKey || event.metaKey || (doc.activeElement && frame.contains(doc.activeElement)))) return;
      event.preventDefault();
      const point = local(event.clientX, event.clientY);
      zoomAt(Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0015)), point.x, point.y);
    }, { passive: false });
    frame.addEventListener('keydown', event => {
      if ((event.target as HTMLElement).closest('button') || event.altKey || event.ctrlKey || event.metaKey) return;
      const step = 48, c = centre();
      const keys: Record<string, () => void> = {
        ArrowLeft: () => { tx += step; apply(); }, ArrowRight: () => { tx -= step; apply(); }, ArrowUp: () => { ty += step; apply(); }, ArrowDown: () => { ty -= step; apply(); },
        '+': () => zoomAt(1.25, c.x, c.y), '=': () => zoomAt(1.25, c.x, c.y), '-': () => zoomAt(0.8, c.x, c.y), '_': () => zoomAt(0.8, c.x, c.y), '0': () => { s = 1; tx = 0; ty = 0; apply(); },
      };
      const action = keys[event.key];
      if (action) { event.preventDefault(); action(); }
    });
    // Tabbing to a pin that is out of view brings it back into the frame.
    frame.addEventListener('focusin', event => {
      frame.scrollLeft = 0; frame.scrollTop = 0;
      const pin = (event.target as HTMLElement).closest('.pin, .map-vectors a');
      if (!pin) return;
      const box = frame.getBoundingClientRect(), at = pin.getBoundingClientRect();
      if (at.left < box.left || at.right > box.right || at.top < box.top || at.bottom > box.bottom) { tx += box.left + box.width / 2 - (at.left + at.width / 2); ty += box.top + box.height / 2 - (at.top + at.height / 2); apply(); }
    });
    frame.querySelectorAll<HTMLElement>('[data-map-zoom]').forEach(button => button.addEventListener('click', () => { const c = centre(); zoomAt(button.dataset.mapZoom === 'in' ? 1.4 : 1 / 1.4, c.x, c.y); }));
    const resetButton = frame.querySelector('[data-map-reset]');
    if (resetButton) resetButton.addEventListener('click', () => { s = 1; tx = 0; ty = 0; apply(); });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => apply()).observe(frame);
    apply();
  });
}

/** Map and pin ambience. Nothing plays until the reader presses a map's sound button; a pin's loop fades in as the view centres on it. */
export function installWikiMapAmbience(doc: Document) {
  const maps = [...doc.querySelectorAll<HTMLElement>('.map-frame[data-map-sound]')].map(frame => ({
    frame, on: false,
    button: frame.querySelector<HTMLButtonElement>('[data-map-sound-toggle]'),
    status: frame.querySelector<HTMLElement>('.map-sound-status'),
    pins: [...frame.querySelectorAll<HTMLElement>('.pin[data-amb]')],
  }));
  if (!maps.length) return;
  let frameRequest = 0;
  const visible = (frame: HTMLElement) => {
    const article = frame.closest('article');
    if ((article && article.hidden) || doc.hidden) return false;
    const box = frame.getBoundingClientRect();
    return box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth;
  };
  const refresh = () => {
    frameRequest = 0;
    const wanted = new Map<string, number>();
    const bump = (id: string, volume: number) => { wanted.set(id, Math.max(wanted.get(id) || 0, volume)); };
    for (const map of maps) {
      if (!map.on || !visible(map.frame)) continue;
      const own = map.frame.dataset.mapAmbience;
      if (own) bump(own, parseFloat(map.frame.dataset.mapAmbienceVolume || '0.5'));
      const cx = parseFloat(map.frame.dataset.cx || '50'), cy = parseFloat(map.frame.dataset.cy || '50');
      const base = map.frame.querySelector<HTMLElement>('.map-stage'), aspect = base && base.offsetWidth ? base.offsetHeight / base.offsetWidth : 1;
      for (const pin of map.pins) {
        const radius = parseFloat(pin.dataset.ambR || '15') || 15;
        const distance = Math.hypot(parseFloat(pin.style.left) - cx, (parseFloat(pin.style.top) - cy) * aspect);
        const gain = Math.max(0, Math.min(1, 1 - distance / radius));
        if (gain > 0) bump(pin.dataset.amb as string, parseFloat(pin.dataset.ambV || '0.5') * gain);
      }
    }
    doc.querySelectorAll<HTMLAudioElement>('audio[data-map-audio]').forEach(audio => {
      const volume = wanted.get(audio.id) || 0;
      if (volume > 0.001) {
        audio.volume = Math.max(0, Math.min(1, volume));
        if (audio.paused) {
          const started = audio.play();
          if (started && started.catch) started.catch(() => { for (const map of maps) if (map.on && map.status) map.status.textContent = map.button ? map.button.dataset.blocked || '' : ''; });
        }
      } else if (!audio.paused) audio.pause();
    });
  };
  const schedule = () => { if (!frameRequest) frameRequest = requestAnimationFrame(refresh); };
  for (const map of maps) {
    map.frame.addEventListener('wh-map-view', schedule);
    if (map.button) map.button.addEventListener('click', () => {
      map.on = !map.on;
      map.button!.setAttribute('aria-pressed', String(map.on));
      map.button!.textContent = (map.on ? map.button!.dataset.labelOff : map.button!.dataset.labelOn) || '';
      if (map.status) map.status.textContent = '';
      // The first refresh runs inside the click so the browser counts it as the reader's gesture.
      refresh();
    });
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  doc.addEventListener('visibilitychange', schedule);
  for (const name of ['input', 'change', 'hashchange']) (name === 'hashchange' ? window : doc).addEventListener(name, schedule);
}

export const wikiMapScript = (nonce: string, ambience: boolean) => `<script nonce="${nonce}">(${installWikiMaps.toString()})(document);${ambience ? `(${installWikiMapAmbience.toString()})(document);` : ''}</script>`;
