import { generateWorld } from './core/pipeline';
import { packWorld, unpackWorld, type WorldTransfer, type WorldParams } from './core/types';
import { applyEdits, deserializeEdits } from './core/edits';
import { captureDomainCatalogue, extendDomainCatalogue } from './core/domainCatalogue';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from './core/settlements';
import { adoptDomainDocument, appendDomainResize, readDomainDocument, serializeDomainDocument, type DomainDocument } from './core/domainDocument';
import { materializeDomain, projectDomainEdit, replayDomain } from './core/domainReplay';
import { cellKmOf } from './core/geoScale';
import type { DomainAnchor, DomainBounds } from './core/worldDomain';

export type DomainPreparationRequest = {
  type: 'create'; params: WorldParams; initial: DomainBounds; legacy: string;
} | {
  type: 'replay'; params: WorldParams; pristine: WorldTransfer; legacy: string; revision: number;
} | {
  type: 'resize'; params: WorldParams; legacy: string; activeCount?: number;
  pristine?: WorldTransfer; current?: WorldTransfer; painted?: import('./core/edits').AppliedEdits;
  bounds: DomainBounds; anchor: DomainAnchor; fill: 'sea' | 'land'; seaLevelM: number; revision: number;
};
export type DomainPreparationReply = { type: 'progress'; stage: string; progress: number }
  | { type: 'error'; error: string }
  | { type: 'done'; source?: WorldTransfer; world: WorldTransfer; document: string };

const ctx = self as unknown as { onmessage: ((event: MessageEvent<DomainPreparationRequest>) => void) | null; postMessage: (reply: DomainPreparationReply, buffers?: Transferable[]) => void };
ctx.onmessage = event => {
  try {
    const request = event.data;
    const source = request.type !== 'create' && request.pristine ? unpackWorld(request.pristine) : generateWorld(request.params, (stage, progress) => ctx.postMessage({ type: 'progress', stage, progress: progress * 0.7 }));
    let document: DomainDocument;
    let world;
    ctx.postMessage({ type: 'progress', stage: 'catalogue', progress: 0.75 });
    if (request.type === 'replay') {
      document = readDomainDocument(request.legacy)!;
      if (!document) throw new Error('Missing finite journal');
      world = replayDomain(source, document, request.revision);
    } else if (request.type === 'create') {
      const current = structuredClone(source);
      applyEdits(current, deserializeEdits(request.legacy));
      const catalogue = captureDomainCatalogue(current, buildHumanGeography(current, { ...DEFAULT_HUMAN_PARAMS, sites: 'auto' }, 'full', false), request.legacy);
      document = adoptDomainDocument(source, request.legacy, catalogue, request.initial);
      world = replayDomain(source, document, 0);
    } else {
      const existing = request.legacy ? readDomainDocument(request.legacy) : null;
      const current = request.current ? unpackWorld(request.current) : existing ? replayDomain(source, existing, request.revision - 1) : structuredClone(source);
      if (request.current) current.painted = request.painted;
      else if (!existing) applyEdits(current, deserializeEdits(request.legacy).slice(0, request.activeCount));
      if (existing) document = existing;
      else {
        const catalogue = captureDomainCatalogue(current, buildHumanGeography(current, { ...DEFAULT_HUMAN_PARAMS, sites: 'auto' }, 'full', false), request.legacy);
        document = adoptDomainDocument(source, request.legacy, catalogue, undefined, request.activeCount);
      }
      if (!current.domain) current.domain = { version: 1, bounds: { x: 0, y: 0, width: current.width, height: current.height }, topology: 'legacy', revision: request.revision - 1,
        source: { width: source.width, height: source.height, baseCellKm: cellKmOf(source.params, source.width), sourceKey: document.catalogue.sourceKey }, catalogue: document.catalogue };
      document = appendDomainResize(document, request.bounds, request.anchor, request.fill, request.seaLevelM);
      world = materializeDomain(current, request.bounds, { version: 1, kind: request.fill, seaLevelM: request.seaLevelM });
      world.domain = { ...current.domain, bounds: request.bounds, topology: 'finite', revision: request.revision, catalogue: document.catalogue };
      // No physical stroke is applied again to the retained arrays. Narrative overlays are rebuilt from the journal.
      const all = [...deserializeEdits(document.legacy.json).slice(0, document.legacy.count), ...document.steps.flatMap(step => step.kind === 'edit' ? [step.edit] : [])];
      applyEdits(world, all.map(edit => projectDomainEdit(edit, request.bounds)), request.seaLevelM, true);
    }
    if (request.type !== 'replay') {
      document = { ...document, catalogue: extendDomainCatalogue(world, buildHumanGeography(world, { ...DEFAULT_HUMAN_PARAMS, sites: 'auto' }, 'full', false), document.catalogue) };
      world.domain = { ...world.domain!, catalogue: document.catalogue };
    }
    ctx.postMessage({ type: 'progress', stage: 'finish', progress: 1 });
    const packed = packWorld(world), pristine = packWorld(source);
    ctx.postMessage({ type: 'done', world: packed.transfer, source: pristine.transfer, document: serializeDomainDocument(document) }, [...new Set([...packed.buffers, ...pristine.buffers])]);
  } catch (error) { ctx.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) }); }
};
