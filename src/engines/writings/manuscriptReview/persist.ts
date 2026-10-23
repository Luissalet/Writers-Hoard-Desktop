import {assertManuscriptOwner,selectManuscriptWritings,writingManuscriptId} from '../manuscripts';
import { db } from '@/db';
import { eraWritingOperations } from '@/services/worldEras/writings';
import { assertWorldEra, readWorldDocument, announceEraChange } from '@/services/worldEras/store';
import type { WorldEraScope } from '@/services/worldEras/types';
import type { Writing } from '@/types';
import { sha256Hex } from '@/services/judge/text';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { createAnnotation } from '@/engines/annotations/operations';
import { planManuscriptImport } from './plan';
import type { ImportChoice, ImportSplit, InspectedManuscript, ImportedCommentOrigin } from './types';

/** No parse/hash/native work is performed inside the transaction. */
export async function applyManuscriptImport(scope: WorldEraScope, sources: InspectedManuscript[], split: ImportSplit, choices: ImportChoice[], expectedDigest: string,manuscriptId='main') {
  const plan = await planManuscriptImport(sources, split, scope, choices,manuscriptId);
  if (plan.digest !== expectedDigest) throw Error('manuscript_plan_conflict');
  const contentHashes = await Promise.all(plan.chapters.map(chapter => sha256Hex(chapter.content)));
  const commitId = crypto.randomUUID(), now = Date.now(), ids: string[] = [], sourceIds: string[] = [];
  const replacements = plan.chapters.filter(chapter => chapter.choice.targetId);
  if (new Set(replacements.map(chapter => chapter.choice.targetId)).size !== replacements.length) throw Error('manuscript_target_duplicate');
  await db.transaction('rw', db.tables, async () => {
    const project = await assertWorldEra(scope);
    assertManuscriptOwner(project,manuscriptId==='main'?{}:{manuscriptId});
    if (!project.enabledEngines.includes('writings')) throw Error('writings_engine_disabled');
    const ops = eraWritingOperations(scope), current = new Map<string, Writing>();
    // Preflight *all* targets before snapshots or sources. A refusal is atomic.
    for (const chapter of replacements) {
      const choice = chapter.choice, read = await readWorldDocument(scope, 'writings', choice.targetId!);
      const row = read?.document.root as unknown as Writing | undefined;
      if (!row || row.projectId !== scope.projectId || writingManuscriptId(row)!==manuscriptId || row.updatedAt !== choice.expectedUpdatedAt || scope.eraId && read!.version !== choice.expectedDocumentVersion) throw Error('manuscript_target_conflict');
      current.set(row.id, row);
    }
    for (const source of sources) {
      let stored = await db.manuscriptSources.where('[projectId+sha256]').equals([scope.projectId, source.sha256]).first();
      if (!stored) { stored = { id: crypto.randomUUID(), projectId: scope.projectId, sha256: source.sha256, name: source.name, format: source.format, original: source.original, revision: 0, receipts: [], createdAt: now }; await db.manuscriptSources.add(stored); }
      sourceIds.push(stored.id);
    }
    const existing = selectManuscriptWritings(await ops.getWritings(scope.projectId),{kind:'manuscript',id:manuscriptId});
    let number = existing.reduce((max, row) => Math.max(max, row.chapter ?? 0), 0);
    for (const [index, chapter] of plan.chapters.entries()) {
      const sourceIndex = Number(chapter.key.split(':')[0]), sourceId = sourceIds[sourceIndex];
      const receipt = { sourceId, commitId, chapterKey: chapter.key, contentHash: contentHashes[index] };
      let id: string;
      if (chapter.choice.targetId) {
        id = chapter.choice.targetId;
        const replaced = await ops.replaceWritingWithSnapshot(id, { title: chapter.title, content: chapter.content, wordCount: chapter.words, manuscriptSource: receipt }, current.get(id)!.updatedAt);
        if (replaced.status !== 'applied') throw Error('manuscript_target_conflict');
      } else {
        id = crypto.randomUUID();
        const row: Writing = { id,...(manuscriptId!=='main'?{manuscriptId}:{}), projectId: scope.projectId, title: chapter.title, content: chapter.content, wordCount: chapter.words, status: 'draft', tags: [], chapter: ++number, manuscriptSource: receipt, createdAt: now, updatedAt: now };
        if (scope.eraId) await ops.createWriting(row); else await db.writings.add(row);
      }
      ids.push(id);
      const origin = (comment: typeof chapter.comments[number]['source']): ImportedCommentOrigin => ({ sourceId, commentId: comment.id, author: comment.author, date: comment.date });
      for (const comment of chapter.comments) {
        const date = Date.parse(comment.source.date), createdAt = Number.isFinite(date) ? date : now;
        await createAnnotation({ id: crypto.randomUUID(), projectId: scope.projectId, eraId: scope.eraId, sourceEngineId: 'writings', sourceEntityId: id, anchor: { type: 'text_range', start: comment.start, end: comment.end, selectedText: comment.selectedText, contextBefore: comment.contextBefore, contextAfter: comment.contextAfter }, noteType: 'text', noteBody: comment.source.text || '(Comentario sin texto)', isOrphaned: false, position: comment.start, createdAt, updatedAt: now, revision: 0, resolvedAt: comment.source.resolved ? now : undefined, importedComment: origin(comment.source), replies: comment.replies.map(reply => ({ id: crypto.randomUUID(), body: reply.text || '(Respuesta sin texto)', createdAt: Number.isFinite(Date.parse(reply.date)) ? Date.parse(reply.date) : now, updatedAt: now, importedComment: origin(reply) })) });
      }
    }
    for (const [index, sourceId] of sourceIds.entries()) {
      const row = (await db.manuscriptSources.get(sourceId))!;
      const writingIds = plan.chapters.flatMap((chapter, position) => Number(chapter.key.split(':')[0]) === index ? [ids[position]] : []);
      if (writingIds.length) await db.manuscriptSources.put({ ...row, revision: row.revision + 1, receipts: [...row.receipts, { id: commitId, eraId: scope.eraId, writingIds, planDigest: plan.digest, createdAt: now }] });
    }
    await db.projects.update(scope.projectId, { updatedAt: Math.max(now, project.updatedAt + 1) });
  });
  announceEraChange(scope.projectId); notifyDataChanged({ source: 'other', table: 'writings', projectId: scope.projectId });
  return { commitId, sourceIds, writingIds: ids, chapterCount: ids.length, wordCount: plan.chapters.reduce((n, chapter) => n + chapter.words, 0), importedComments: plan.importedComments, retainedComments: plan.retainedComments };
}
