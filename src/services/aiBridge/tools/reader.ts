import { db } from '@/db';
import type { ReaderPresentation } from '@/engines/writings/readerPresentationTypes';
import { safeReaderPresentation, saveReaderPresentation } from '@/engines/writings/readerPresentation';
import { buildReaderHtml } from '@/engines/writings/readerExport';
import { getEraProject, listEraRows } from '@/services/worldEras/store';
import type { Writing } from '@/types';
import { assertEngineEnabled, BridgeError, optString, resolveProjectId, withAudit, type ToolArgs } from './shared';
import {applyEraReaderCover} from '@/engines/writings/coverDesign/model';
import {exportCoverImage} from '@/engines/writings/coverDesign/export';
import type {CoverFace} from '@/engines/writings/coverDesign/types';
async function readerProject(args:ToolArgs){const projectId=resolveProjectId(args),project=await db.projects.get(projectId);if(!project)throw new BridgeError('not-found','Project not found.');const eraId=optString(args,'eraId'),era=eraId?project.worldEras?.find(item=>item.id===eraId):undefined;if(eraId&&!era)throw new BridgeError('not-found','Source era not found.');return applyEraReaderCover(project,era);}

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
    const presentation = await saveReaderPresentation(projectId, args.presentation as ReaderPresentation, base, optString(args, 'eraId'));
    return withAudit({ projectId, presentation }, { projectId, entityId: projectId, summary: 'Update reader presentation', before: base });
  },
  async wh_reader_export(args: ToolArgs) {
    const scope = { projectId: resolveProjectId(args), eraId: optString(args, 'eraId') };
    const project = await getEraProject(scope); if (!project) throw new BridgeError('not-found', 'Project not found.');
    const writings = await listEraRows<Writing>(scope, 'writings'); writings.sort((a, b) => (a.chapter ?? Infinity) - (b.chapter ?? Infinity) || a.createdAt - b.createdAt);
    return { projectId: project.id, eraId: scope.eraId ?? null, ...await buildReaderHtml(project, writings, safeReaderPresentation(project.readerPresentation), args.locale === 'es' ? 'es' : 'en', scope) };
  },
  async wh_reader_cover_export(args:ToolArgs){const project=await readerProject(args);return{projectId:project.id,eraId:optString(args,'eraId')??null,...await exportCoverImage(project.title,project.coverImage,safeReaderPresentation(project.readerPresentation).cover,(optString(args,'face')??'spread')as CoverFace,(optString(args,'format')??'png')as 'png'|'svg',typeof args.pixelRatio==='number'?args.pixelRatio:1)};},
};
