import { createModelViewport, type ModelViewport, type Lighting, type CameraMode, type CameraDirection } from './viewport';
import { ModelError } from './portable';
import { readerModel } from './readerMarkup';
import { modelCopy } from './locales';

const styles = `[data-wh-model-reader]{display:block;min-width:0;max-width:100%;margin:1rem 0;font:13px/1.5 system-ui,sans-serif;color:inherit;break-inside:avoid}[data-model-controls]{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:10px}[data-model-controls] button,[data-model-controls] select{font:inherit;width:auto;min-height:36px;padding:6px 10px;background:transparent;color:inherit;border:1px solid currentColor;border-radius:4px}[data-model-controls] label{display:inline-flex;align-items:center;gap:6px;margin:0;font:inherit}[data-model-controls] input{width:auto;accent-color:currentColor}[data-model-controls] button:disabled{opacity:.5}[data-model-controls] :focus-visible{outline:2px solid currentColor;outline-offset:3px}[data-model-surface]{position:relative;width:100%;height:clamp(240px,42vw,420px);background:#202223;overflow:hidden;border-radius:6px}[data-model-status]{margin:8px 0}[data-model-status]:empty{display:none}@media(max-width:480px){[data-model-controls]{gap:6px}[data-model-controls] button{padding:6px 8px}}`;

/** One DOM mount shared by normal reading and the standalone local runtime. */
export function mountModelReader(element: HTMLElement): () => void {
  if (!document.querySelector('style[data-model-reader-style]')) {
    const style = document.createElement('style'); style.dataset.modelReaderStyle = 'true'; style.textContent = styles; document.head.append(style);
  }
  const locale = element.dataset.locale === 'es' ? 'es' : 'en', copy = modelCopy(locale);
  const controls = element.querySelector<HTMLElement>('[data-model-controls]')!, surface = element.querySelector<HTMLElement>('[data-model-surface]')!, status = element.querySelector<HTMLElement>('[data-model-status]')!;
  let disposed = false, controller: AbortController | undefined, viewport: ModelViewport | undefined;
  let inView = false, playing = false, animation = 0, auto = false;
  const events = new AbortController();
  const listen = (node: HTMLElement, event: string, handler: EventListener) => node.addEventListener(event, handler, { signal: events.signal });
  const button = (label: string, action: () => void, name: string) => {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.dataset.modelAction = name; listen(node, 'click', action); controls.append(node); return node;
  };
  const check = (label: string, action: (value: boolean) => void, name: string) => {
    const wrap = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.dataset.modelAction = name;
    listen(input, 'change', () => action(input.checked)); wrap.append(input, label); controls.append(wrap); return input;
  };
  const select = (label: string, options: [string,string][], action: (value:string)=>void, name:string) => {
    const wrap = document.createElement('label'), input = document.createElement('select'); input.dataset.modelAction = name;
    for (const [value, text] of options) { const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option); }
    listen(input,'change',()=>action(input.value)); wrap.append(label,input); controls.append(wrap); return input;
  };
  const showError = (error: unknown) => {
    if (disposed) return;
    viewport?.dispose(); viewport = undefined; controls.replaceChildren(); status.setAttribute('role','alert');
    status.textContent = copy[error instanceof ModelError ? error.code : 'failed'];
    button(locale === 'es' ? 'Volver a intentar' : 'Retry', () => { void load(); }, 'retry');
  };
  const visible = () => inView && !element.closest('[hidden]');
  const syncVisibility = () => viewport?.setActive(Boolean(visible()));
  const load = async () => {
    controller?.abort(); viewport?.dispose(); viewport = undefined; playing = false; animation = 0; auto = false;
    controls.replaceChildren(); status.setAttribute('role','status'); status.textContent = copy.loading;
    const current = new AbortController(); controller = current;
    try {
      const payload = element.querySelector<HTMLTemplateElement>('template[data-wh-model-data]');
      const asset = readerModel(JSON.parse(payload?.content.textContent ?? 'null'));
      const next = await createModelViewport(surface,asset,copy.canvas,showError,current.signal,mode=>{
        const camera=controls.querySelector<HTMLSelectElement>('[data-model-action="camera"]');if(camera)camera.value=mode;
        const moves=controls.querySelector<HTMLElement>('[data-model-moves]');if(moves)moves.hidden=mode!=='fly';
      });
      if (disposed || current.signal.aborted) { next.dispose(); return; }
      viewport = next; next.setActive(Boolean(visible()));
      button(copy.reset,()=>{ next.reset(); camera.value='orbit'; },'reset');
      button('−',()=>next.zoom('out'),'zoom-out').setAttribute('aria-label',copy.zoomOut);
      button('+',()=>next.zoom('in'),'zoom-in').setAttribute('aria-label',copy.zoomIn);
      button('↶',()=>next.rotate('left'),'rotate-left').setAttribute('aria-label',copy.rotateLeft);
      button('↷',()=>next.rotate('right'),'rotate-right').setAttribute('aria-label',copy.rotateRight);
      check(copy.autoRotate,value=>{auto=value;next.setAutoRotate(auto);},'autorotate');
      check(copy.wireframe,value=>next.setWireframe(value),'wireframe');
      select(copy.lighting,[['studio',copy.studio],['soft',copy.soft],['daylight',copy.daylight]],value=>next.setLighting(value as Lighting),'lighting');
      const camera=select(copy.camera,[['orbit',copy.orbit],['fly',copy.fly]],value=>next.setCameraMode(value as CameraMode),'camera');
      const moves=document.createElement('span');moves.dataset.modelMoves='true';moves.hidden=true;controls.append(moves);
      for(const direction of ['forward','back','left','right','up','down'] as CameraDirection[]) moves.append(button(copy[direction],()=>{camera.value='fly';next.setCameraMode('fly');next.move(direction);},direction));
      if (next.animations.length) {
        select(copy.animation,next.animations.map((name,index)=>[String(index),name]),value=>{animation=Number(value);next.setAnimation(animation,playing);},'animation');
        const play=button(copy.play,()=>{playing=!playing;next.setAnimation(animation,playing);play.textContent=playing?copy.pause:copy.play;play.setAttribute('aria-pressed',String(playing));},'play');
        play.setAttribute('aria-pressed','false');
      }
      status.textContent=copy.ready;
    } catch(error) { if(!current.signal.aborted)showError(error); }
  };
  const intersection = new IntersectionObserver(entries=>{inView=entries[0].isIntersecting;syncVisibility();}); intersection.observe(element);
  const visibility = new MutationObserver(()=>{if(!element.isConnected)dispose();else syncVisibility();}); visibility.observe(document.body,{attributes:true,attributeFilter:['hidden','style','class'],childList:true,subtree:true});
  void load();
  const dispose = () => { if(disposed)return;disposed=true;controller?.abort();viewport?.dispose();intersection.disconnect();visibility.disconnect();events.abort(); };
  window.addEventListener('pagehide',dispose,{signal:events.signal});
  return dispose;
}

export function mountModelReaders(root: ParentNode = document): () => void {
  const disposers=[...root.querySelectorAll<HTMLElement>('[data-wh-model-reader="true"]')].map(mountModelReader);
  return()=>disposers.forEach(dispose=>dispose());
}
