import {validateManuscriptProject} from '@/engines/writings/manuscripts';
import {validateLocalToolContractStates} from '@/engines/local/stateCodec';
import type { Project } from '@/types';
import { validateEntityDetectionPreferences } from '@/services/entityDetection/preferencesValidation';
import { validateWikiProfilesProject } from '@/services/wikiProfiles/validation';
import { validateLocalToolInstallations } from '@/engines/local/installations';
import { validateProjectCoverMetadata } from '@/engines/writings/coverDesign/model';
import { validateSourceToolDocuments } from '@/engines/local/documents/types';
import {normalizeProjectGenres} from '@/services/projectGenres/types';
import {validateLocalToolBlockRichContent} from '@/engines/local/blocks/types';
import {validateWorldFolderImportsProject} from '@/services/worldFolderImport/portability';
import {validateProjectPin} from '@/services/projectPin/types';
import {validateToolDockProjectMetadata} from '@/engines/writings/toolDock/types';
import type {WorldEraVariant,WorldEraVariantState} from '@/services/worldEras/types';

export function validateProjectArchiveMetadata(project: { manuscriptCatalog?:unknown; writingToolDock?:unknown; pinned?:unknown; worldFolderImports?:unknown; genres?:unknown; sourceToolDocuments?: unknown; entityDetectionPreferences?: unknown; wikiProfiles?: unknown; localToolInstallations?: unknown; localToolContracts?:unknown; localToolStates?:Project['localToolStates']; worldEras?:Project['worldEras'] } & Parameters<typeof validateProjectCoverMetadata>[0]): void {
  validateManuscriptProject(project);
  validateToolDockProjectMetadata(project);
  normalizeProjectGenres(project.genres);
  validateProjectPin(project.pinned);
  validateWorldFolderImportsProject(project);
  validateLocalToolBlockRichContent(project, 'id' in project && typeof project.id === 'string' ? project.id : undefined);
  validateSourceToolDocuments(project.sourceToolDocuments);
  validateEntityDetectionPreferences(project.entityDetectionPreferences);
  validateWikiProfilesProject(project);
  validateLocalToolInstallations(project.localToolInstallations);
  validateLocalToolContractStates(project);
  validateProjectCoverMetadata(project);
}

/** Absence in a legacy archive cannot erase settings its format did not carry. */
type PortableMetadata = Pick<Project, 'manuscriptCatalog' | 'worldEras' | 'writingToolDock' | 'pinned' | 'worldFolderImports' | 'genres' | 'sourceToolDocuments' | 'codexOptionLists' | 'entityDetectionPreferences' | 'wikiProfiles' | 'localToolInstallations' | 'localToolContracts'>;
export function preserveLegacyProjectMetadata<T extends PortableMetadata>(incoming: T, existing?: PortableMetadata): T {
  const result = { ...incoming };
  for (const key of ['manuscriptCatalog', 'writingToolDock', 'pinned', 'worldFolderImports', 'genres', 'sourceToolDocuments', 'codexOptionLists', 'entityDetectionPreferences', 'wikiProfiles', 'localToolInstallations', 'localToolContracts'] as const) {
    if (incoming[key] === undefined && existing?.[key] !== undefined) Object.assign(result, { [key]: structuredClone(existing[key]) });
  }
  if(incoming.worldEras&&existing?.worldEras)result.worldEras=incoming.worldEras.map(era=>{
    const previous=existing.worldEras!.find(row=>row.id===era.id)?.defaults?.writingToolDock;
    return era.defaults?.writingToolDock===undefined&&previous!==undefined?{...era,defaults:{...era.defaults,writingToolDock:structuredClone(previous)}}:era;
  });
  return result;
}

/** Legacy same-ID restores did not carry the chapter authoring sidecar. */
export function preserveLegacyWritingToolDock<T extends {toolDock?:Project['writingToolDock'];manuscriptId?:string}>(incoming:T,existing?:{toolDock?:Project['writingToolDock'];manuscriptId?:string},structuralOwner?:string):T {
  const ownerBefore=structuralOwner??existing?.manuscriptId;
  if(incoming.manuscriptId!==undefined&&ownerBefore!==undefined&&incoming.manuscriptId!==ownerBefore)throw Error('manuscript_owner_conflict');
  const toolDock=incoming.toolDock===undefined&&existing?.toolDock!==undefined,owner=incoming.manuscriptId===undefined&&ownerBefore!==undefined&&ownerBefore!=='main';
  return toolDock||owner?{...incoming,...(toolDock?{toolDock:structuredClone(existing!.toolDock)}:{}),...(owner?{manuscriptId:ownerBefore}:{})}:incoming;
}

/** Same logical era document only; retained states match their own revision. */
export function preserveLegacyEraWritingToolDock(incoming:WorldEraVariant,existing?:WorldEraVariant,structuralOwner?:string):WorldEraVariant{
 if(incoming.kind!=='writings')return incoming;
 if(!existing||incoming.id!==existing.id||incoming.projectId!==existing.projectId||incoming.eraId!==existing.eraId||incoming.entityId!==existing.entityId||existing.kind!=='writings')existing=undefined;
 const preserve=<T extends WorldEraVariantState>(state:T,previous?:WorldEraVariantState):T=>{
  if(!state.document)return state;
  const root=preserveLegacyWritingToolDock(state.document.root as {toolDock?:Project['writingToolDock'];manuscriptId?:string},previous?.document?.root as {toolDock?:Project['writingToolDock'];manuscriptId?:string}|undefined,structuralOwner);
  return root===state.document.root?state:{...state,document:{...state.document,root:{...state.document.root,...root}}};
 };
 return{...preserve(incoming,existing),history:incoming.history?.map(state=>preserve(state,existing?[existing,...existing.history??[]].find(row=>row.revision===state.revision):undefined))};
}
