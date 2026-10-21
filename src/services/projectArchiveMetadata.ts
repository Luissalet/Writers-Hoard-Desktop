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

export function validateProjectArchiveMetadata(project: { writingToolDock?:unknown; pinned?:unknown; worldFolderImports?:unknown; genres?:unknown; sourceToolDocuments?: unknown; entityDetectionPreferences?: unknown; wikiProfiles?: unknown; localToolInstallations?: unknown; localToolContracts?:unknown; localToolStates?:Project['localToolStates']; worldEras?:Project['worldEras'] } & Parameters<typeof validateProjectCoverMetadata>[0]): void {
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
type PortableMetadata = Pick<Project, 'worldEras' | 'writingToolDock' | 'pinned' | 'worldFolderImports' | 'genres' | 'sourceToolDocuments' | 'codexOptionLists' | 'entityDetectionPreferences' | 'wikiProfiles' | 'localToolInstallations' | 'localToolContracts'>;
export function preserveLegacyProjectMetadata<T extends PortableMetadata>(incoming: T, existing?: PortableMetadata): T {
  const result = { ...incoming };
  for (const key of ['writingToolDock', 'pinned', 'worldFolderImports', 'genres', 'sourceToolDocuments', 'codexOptionLists', 'entityDetectionPreferences', 'wikiProfiles', 'localToolInstallations', 'localToolContracts'] as const) {
    if (incoming[key] === undefined && existing?.[key] !== undefined) Object.assign(result, { [key]: structuredClone(existing[key]) });
  }
  if(incoming.worldEras&&existing?.worldEras)result.worldEras=incoming.worldEras.map(era=>{
    const previous=existing.worldEras!.find(row=>row.id===era.id)?.defaults?.writingToolDock;
    return era.defaults?.writingToolDock===undefined&&previous!==undefined?{...era,defaults:{...era.defaults,writingToolDock:structuredClone(previous)}}:era;
  });
  return result;
}

/** Legacy same-ID restores did not carry the chapter authoring sidecar. */
export function preserveLegacyWritingToolDock<T extends {toolDock?:Project['writingToolDock']}>(incoming:T,existing?:{toolDock?:Project['writingToolDock']}):T {
  return incoming.toolDock===undefined&&existing?.toolDock!==undefined?{...incoming,toolDock:structuredClone(existing.toolDock)}:incoming;
}

/** Same logical era document only; retained states match their own revision. */
export function preserveLegacyEraWritingToolDock(incoming:WorldEraVariant,existing?:WorldEraVariant):WorldEraVariant{
 if(incoming.kind!=='writings'||!existing||incoming.id!==existing.id||incoming.projectId!==existing.projectId||incoming.eraId!==existing.eraId||incoming.entityId!==existing.entityId||existing.kind!=='writings')return incoming;
 const preserve=<T extends WorldEraVariantState>(state:T,previous?:WorldEraVariantState):T=>{
  if(!state.document||state.document.root.toolDock!==undefined||previous?.document?.root.toolDock===undefined)return state;
  return{...state,document:{...state.document,root:{...state.document.root,toolDock:structuredClone(previous.document.root.toolDock)}}};
 };
 return{...preserve(incoming,existing),history:incoming.history?.map(state=>preserve(state,[existing,...existing.history??[]].find(row=>row.revision===state.revision)))};
}
