import { db } from '@/db';
import type { Project } from '@/types';
import { deleteProject } from '@/db/operations';
import { assetFromFile } from '@/engines/model-viewer/model';
import { hydrateToolDocumentBlocks } from '@/components/editor/toolBlocks/reading';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { saveWorldEra, updateEraProjectMetadata } from '@/services/worldEras/store';
import { modelAnimationPresentationFixture } from './model-animation-presentation-fixture';

function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = (ms = 35) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean, message: string) { for (let n = 0; n < 200; n++) { if (predicate()) return; await pause(); } throw Error(message); }
const encoded = (value: unknown) => JSON.stringify(value);
type Receipt = {sha256:string;markerPixels:number};
type Presentation = {order:number[];labels:Record<string,string>};
const longLabel='Ascenso del faro durante la tormenta y llegada de los barcos al puerto antiguo';
async function viewport(width:number){const callback=(window as unknown as {__modelClipsExtraViewport?:(width:number,height:number)=>Promise<void>}).__modelClipsExtraViewport;check(callback,'Extra viewport callback missing');await callback(width,1000);}
async function capture(name: string, node: HTMLCanvasElement, frame?: HTMLIFrameElement): Promise<Receipt> {
  const callback = (window as unknown as {__modelClipsExtraCapture?:(name:string,rect:unknown)=>Promise<Receipt>}).__modelClipsExtraCapture; check(callback, 'Extra runner capture callback missing');
  const rect = node.getBoundingClientRect(), offset = frame?.getBoundingClientRect();
  return callback(name, { x: Math.round(rect.x + (offset?.x ?? 0)), y: Math.round(rect.y + (offset?.y ?? 0)), width: Math.round(rect.width), height: Math.round(rect.height) });
}

export async function testModelAnimationPresentationReader() {
  const P = 'synthetic-clips-reader', host = document.getElementById('root'); check(host, 'Missing root');
  host.style.cssText = 'max-width:900px;margin:20px auto';
  let dispose: (() => void) | undefined;
  try {
    const source = await assetFromFile(new File([await modelAnimationPresentationFixture()], 'Reader-clips.glb'));
    const model = { ...source, animationPresentation: { order: [2, 0, 1], labels: { '0': longLabel, '2': 'Depth reference' } as Record<string,string> } };
    const project: Project = { id: P, title: 'Synthetic clip reader', description: '', mode: 'novelist', type: 'standalone', status: 'draft', color: '#777777', enabledEngines: ['model-viewer', 'writings', 'codex'], createdAt: 1, updatedAt: 1, modelAssets: [model] };
    const block = `<figure data-wh-tool-block="true" data-project-id="${P}" data-tool-kind="model-viewer" data-document-id="${model.id}" data-label="Synthetic reference"></figure>`;
    await db.projects.add(project);
    await db.writings.add({ id: P + '-writing', projectId: P, title: 'Clip reference', content: '<p>Authored synthetic model.</p>' + block, status: 'draft', wordCount: 3, tags: [], createdAt: 1, updatedAt: 1 });
    await db.codexEntries.add({ id: P + '-entry', projectId: P, title: 'Clip index', content: block, type: 'location', fields: {}, tags: [], relations: [], createdAt: 1, updatedAt: 1 });
    await saveWorldEra(P, { id: 'past', name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    const eraModel = { ...model, animationPresentation: { order: [1, 2, 0], labels: { '1': 'Era lift', '2': 'Era depth' } } };
    await updateEraProjectMetadata({ projectId: P, eraId: 'past' }, { modelAssets: [eraModel] });
    const beforeReads = encoded(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
    const artifacts: Array<{name:string;html:string;presentation:Presentation}> = [];
    for (const eraId of [undefined, 'past']) {
      const expected = eraId ? eraModel : model;
      host.innerHTML = block; dispose = hydrateToolDocumentBlocks(host, P, 'en', eraId);
      await until(() => host.textContent?.includes('Model ready') === true && !!host.querySelector('canvas'), 'Normal reader did not mount scoped model');
      const selector = host.querySelector<HTMLSelectElement>('[data-model-action="animation"]'); check(selector, 'Normal reader has no clip selector');
      check(encoded([...selector.options].map(option => Number(option.value))) === encoded(expected.animationPresentation.order), 'Normal reader lost scoped presentation order');
      check(selector.options[0].textContent === (eraId ? 'Era lift' : 'Depth reference') && !host.querySelector('[aria-label="Animation label"]'), 'Normal reader lost labels or gained an editor');
      const gl = host.querySelector('canvas')!.getContext('webgl2'); check(gl && !gl.isContextLost(), 'Normal reader has no WebGL'); dispose(); dispose = undefined; check(gl.isContextLost(), 'Normal reader did not dispose WebGL');
      host.replaceChildren();
      for (const tool of ['wh_reader_export', 'wh_wiki_export']) {
        const reply = await runBridgeTool(tool, { projectId: P, eraId, locale: 'en' }); check(reply.ok, 'Normal export failed: ' + JSON.stringify(reply));
        const html = (reply.result as {html:string}).html, document = new DOMParser().parseFromString(html, 'text/html');
        const templates = document.querySelectorAll<HTMLTemplateElement>('template[data-wh-model-data]'); check(templates.length === 1, 'Export duplicated or omitted model');
        const payload = JSON.parse(templates[0].content.textContent!) as typeof model;
        check(encoded(payload.animationPresentation) === encoded(expected.animationPresentation) && payload.dataUrl === source.dataUrl && payload.size === source.size, 'Reader/wiki payload lost exact scoped presentation or binary');
        check(!Object.hasOwn(payload, 'sourceFiles') && html.includes('WebGLRenderer'), 'Export lacks current offline renderer or leaked originals');
        artifacts.push({ name: (tool === 'wh_reader_export' ? 'reader' : 'wiki') + (eraId ? '-era' : '-base'), html, presentation: expected.animationPresentation });
      }
    }
    check(encoded(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()]))) === beforeReads, 'Normal reading/export wrote any database rows');
    for (const artifact of artifacts) {
      const frame = document.createElement('iframe'); frame.title = 'Synthetic standalone ' + artifact.name; frame.style.cssText = 'width:100%;height:930px;border:0'; frame.srcdoc = artifact.html; host.replaceChildren(frame);
      await until(() => !!frame.contentDocument?.querySelector('[data-wh-model-reader]'), 'Standalone HTML did not initialize');
      const surface = frame.contentDocument!.querySelector<HTMLElement>('[data-wh-model-reader]')!; surface.scrollIntoView({ block: 'center' });
      await until(() => surface.querySelector('[data-model-status]')?.textContent === 'Model ready' && !!surface.querySelector('canvas'), 'Current generated standalone runtime did not mount');
      const selector = surface.querySelector<HTMLSelectElement>('[data-model-action="animation"]')!, play = surface.querySelector<HTMLButtonElement>('[data-model-action="play"]')!, view = surface.querySelector('canvas')!;
      check(encoded([...selector.options].map(option => Number(option.value))) === encoded(artifact.presentation.order), artifact.name + ' runtime ignored order');
      check(selector.options[0].textContent === artifact.presentation.labels[String(artifact.presentation.order[0])], artifact.name + ' runtime ignored authored label');
      check(!surface.querySelector('[aria-label="Animation label"]') && !surface.textContent?.includes('Save animation label'), 'Standalone runtime obtained authoring controls');
      const gl = view.getContext('webgl2'); check(gl && !gl.isContextLost(), 'Standalone runtime has no actual WebGL');
      for (const index of artifact.presentation.order) {
        selector.value = String(index); selector.dispatchEvent(new Event('change', { bubbles: true }));
        play.click(); await pause(200); check(play.getAttribute('aria-pressed') === 'true' && Number(selector.value) === index, 'Standalone source selection/play failed');
        play.click(); check(play.getAttribute('aria-pressed') === 'false', 'Standalone pause failed');
      }
      selector.value = String(artifact.presentation.order[0]); selector.dispatchEvent(new Event('change', { bubbles: true }));
      const paused = await capture(artifact.name + '-paused', view, frame); check(paused.markerPixels > 30, 'Standalone screenshot has no rendered authored marker');
      play.click(); await pause(450); const moving = await capture(artifact.name + '-moving', view, frame); play.click();
      check(moving.sha256 !== paused.sha256, artifact.name + ' animation did not change real visible geometry');
      await viewport(390); surface.scrollIntoView({block:'center'});await pause(80);
      check(frame.contentDocument!.documentElement.scrollWidth<=frame.contentWindow!.innerWidth,artifact.name+' long-label standalone controls overflow narrow viewport');
      if(artifact.name.endsWith('-base'))check([...selector.options].some(option=>option.textContent===longLabel),'Narrow reader truncated stored label data');
      await capture(artifact.name+'-narrow',view,frame);await viewport(1280);
      surface.remove(); await pause(70); check(gl.isContextLost(), 'Standalone removal leaked WebGL'); frame.remove();
    }
    check(encoded(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()]))) === beforeReads, 'Standalone runtime wrote database rows');
    return ['Normal reading and actual Reader/wiki exports retain scoped Base/era clip labels, order and exact GLB without writes or originals', 'Four exported standalone HTML runtimes compiled from current source render actual WebGL, source-index selection/play/pause and moving geometry; readonly surfaces dispose their contexts'];
  } finally { dispose?.(); host.replaceChildren(); await deleteProject(P); }
}
