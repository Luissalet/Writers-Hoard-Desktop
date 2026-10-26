import {manuscriptProject,selectManuscriptWritings,writingSelection} from '@/engines/writings/manuscripts';
import { db } from '@/db';
import type { ReaderPresentation } from '@/engines/writings/readerPresentationTypes';
import { safeReaderPresentation, saveReaderPresentation } from '@/engines/writings/readerPresentation';
import { buildReaderHtml } from '@/engines/writings/readerExport';
import { listEraRows } from '@/services/worldEras/store';
import type { Writing } from '@/types';
import { assertEngineEnabled, BridgeError, optString, resolveProjectId, withAudit, type ToolArgs } from './shared';
import {exportCoverImage} from '@/engines/writings/coverDesign/export';
import type {CoverFace} from '@/engines/writings/coverDesign/types';
import {assertPrintPdfPage,printCoverGeometry,capturePrintCover,encodePrintCover,type PrintCoverLayout,type PrintCoverFormat} from '@/engines/writings/coverDesign/print';
async function readerProject(args:ToolArgs){const projectId=resolveProjectId(args),project=await db.projects.get(projectId);if(!project)throw new BridgeError('not-found','Project not found.');const eraId=optString(args,'eraId'),era=eraId?project.worldEras?.find(item=>item.id===eraId):undefined;if(eraId&&!era)throw new BridgeError('not-found','Source era not found.');return manuscriptProject(project,{kind:'manuscript',id:optString(args,'manuscriptId')??'main'},era?.id);}

export const READER_HANDLERS = {
  async wh_reader_settings(args: ToolArgs) {
    const project=await readerProject(args);
    return { projectId:project.id, eraId:optString(args,'eraId')??null,presentation: safeReaderPresentation(project.readerPresentation) };
  },
  async wh_reader_settings_save(args: ToolArgs) {
    const projectId = resolveProjectId(args); await assertEngineEnabled(projectId, 'writings');
    const project = await readerProject(args);
    const base = safeReaderPresentation(project.readerPresentation);
    if (args.expectedRevision !== base.revision) throw new BridgeError('conflict', 'Reader presentation changed. Read settings before saving.');
    if (!args.presentation || typeof args.presentation !== 'object' || Array.isArray(args.presentation)) throw new BridgeError('bad-args', 'presentation must be the complete object returned by wh_reader_settings.');
    const presentation = await saveReaderPresentation(projectId, args.presentation as ReaderPresentation, base, optString(args, 'eraId'),optString(args,'manuscriptId'));
    return withAudit({ projectId, presentation }, { projectId, entityId: projectId, summary: 'Update reader presentation', before: base });
  },
  async wh_reader_export(args: ToolArgs) {
    const scope = { projectId: resolveProjectId(args), eraId: optString(args, 'eraId') };
    const stored = await db.projects.get(scope.projectId);if(!stored)throw new BridgeError('not-found','Project not found.');const selection=writingSelection(args.writingScope),project=manuscriptProject(stored,selection,scope.eraId);
    const writings = selectManuscriptWritings(await listEraRows<Writing>(scope, 'writings'),selection); writings.sort((a, b) => (a.chapter ?? Infinity) - (b.chapter ?? Infinity) || a.createdAt - b.createdAt);
    return { projectId: project.id, eraId: scope.eraId ?? null, ...await buildReaderHtml(project, writings, safeReaderPresentation(project.readerPresentation), args.locale === 'es' ? 'es' : 'en', scope,undefined,selection) };
  },
  async wh_reader_cover_export(args:ToolArgs){
    const project=await readerProject(args),face=optString(args,'face')??'spread',format=optString(args,'format')??'png';
    if(args.printLayout!==undefined||format==='pdf'||format==='jpeg'){
      if(face!=='spread'||!['pdf','png','jpeg'].includes(format)||args.printLayout===undefined||args.pixelRatio!==undefined||args.dpi!==undefined&&typeof args.dpi!=='number')throw new BridgeError('bad-args','Physical export requires printLayout, face spread and format pdf/png/jpeg; use dpi instead of pixelRatio.');
      if(format==='pdf')assertPrintPdfPage(printCoverGeometry(args.printLayout,typeof args.dpi==='number'?args.dpi:300).boxesPt.media);
      const raster=await capturePrintCover(project.title,project.coverImage,safeReaderPresentation(project.readerPresentation).cover,args.printLayout as PrintCoverLayout,typeof args.dpi==='number'?args.dpi:300);
      return{projectId:project.id,eraId:optString(args,'eraId')??null,...await encodePrintCover(raster,format as PrintCoverFormat)};
    }
    if(args.dpi!==undefined)throw new BridgeError('bad-args','dpi requires printLayout. Canonical SVG/PNG uses pixelRatio.');
    return{projectId:project.id,eraId:optString(args,'eraId')??null,...await exportCoverImage(project.title,project.coverImage,safeReaderPresentation(project.readerPresentation).cover,face as CoverFace,format as 'png'|'svg',typeof args.pixelRatio==='number'?args.pixelRatio:1)};
  },
};
