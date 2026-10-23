import {writingManuscriptId} from '../manuscripts';
import {eraWritingOperations} from '@/services/worldEras/writings';
import { manuscriptMarkerPattern } from './markers';
import { splitIntoChapters } from '../manuscriptImport';
import { createWritingEditor } from '@/services/aiBridge/tools/editorialDocument';
import { htmlToText } from '@/engines/_shared/anchoring/htmlToText';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { countWords } from '@/utils/text';
import { describeRevisionDocument } from '../revisions';
import { sha256Hex } from '@/services/judge/text';
import type { WorldEraScope } from '@/services/worldEras/types';
import type { InspectedManuscript, ImportChoice, ImportPlanChapter, ImportSplit, ManuscriptPlan } from './types';

export async function planManuscriptImport(sources: InspectedManuscript[], split: ImportSplit, scope: WorldEraScope, choices: ImportChoice[] = [],manuscriptId='main'): Promise<ManuscriptPlan> {
  if(choices.some(choice=>choice.targetId)){const rows=await eraWritingOperations(scope).getWritings(scope.projectId);if(choices.some(choice=>choice.targetId&&!rows.some(row=>row.id===choice.targetId&&writingManuscriptId(row)===manuscriptId)))throw Error('manuscript_target_scope_invalid');}
  if (!['file', 'heading', 'separator'].includes(split.mode) || !Number.isInteger(split.headingLevel) || split.headingLevel < 1 || split.headingLevel > 6 || typeof split.separator !== 'string') throw Error('manuscript_split_invalid');
  if (new Set(choices.map(choice => choice.key)).size !== choices.length) throw Error('manuscript_choice_duplicate');
  const parsed = splitIntoChapters(sources, { ...split, fallbackTitle: index => `Capítulo ${index}` });
  if (choices.some(choice => !parsed.some(chapter => chapter.key === choice.key))) throw Error('manuscript_choice_missing');
  const chapters: ImportPlanChapter[] = [], findings = sources.flatMap(source => source.findings);
  const titleReviews = sources.reduce((n, source) => n + source.blocks.filter((block, index) => block.level > 0 && (split.mode === 'heading' ? block.level <= split.headingLevel : index === 0) && /data-wh-revision/.test(block.html)).length, 0);
  if (titleReviews) findings.push({ code: 'chapter-title-revisions-retained-in-original', count: titleReviews });
  const mapped = new Set<string>();
  for (const chapter of parsed) {
    const choice = choices.find(row => row.key === chapter.key) ?? { key: chapter.key, title: chapter.title, included: true };
    if (typeof choice.title !== 'string' || !choice.title.trim() || typeof choice.included !== 'boolean') throw Error('manuscript_choice_invalid');
    if (!choice.included) continue;
    const sourceIndex = Number(chapter.key.split(':')[0]), source = sources[sourceIndex];
    const editor = createWritingEditor(chapter.blocks.map(block => block.html).join(''));
    let marked: string, pendingRevisions: number;
    try { marked = sanitizeRichHtml(editor.getHTML()); pendingRevisions = describeRevisionDocument(editor.state.doc).length; } finally { editor.destroy(); }
    const markedText = htmlToText(marked), tokens = new Map<string, number>(), tokenCounts = new Map<string, number>();
    const tokenRe = manuscriptMarkerPattern(source.markerPrefix, source.comments.map(comment => comment.id));
    let removed = 0;
    for (const match of markedText.matchAll(tokenRe)) { const key = `${match[1]}-${match[2]}`; tokens.set(key, match.index! - removed); tokenCounts.set(key, (tokenCounts.get(key) ?? 0) + 1); removed += match[0].length; }
    const content = marked.replace(tokenRe, ''), text = htmlToText(content), comments: ImportPlanChapter['comments'] = [];
    // Offsets are exact only if removing markers did not change whitespace normalization.
    const exactText = markedText.replace(tokenRe, '') === text;
    for (const comment of source.comments.filter(comment => comment.parent === null)) {
      const start = tokens.get(`start-${comment.id}`), end = tokens.get(`end-${comment.id}`);
      if (exactText && tokenCounts.get(`start-${comment.id}`) === 1 && tokenCounts.get(`end-${comment.id}`) === 1 && start !== undefined && end !== undefined && end >= start && end <= text.length) {
        comments.push({ source: comment, start, end, selectedText: text.slice(start, end), contextBefore: text.slice(Math.max(0, start - 40), start), contextAfter: text.slice(end, end + 40), replies: source.comments.filter(reply => reply.parent === comment.id) });
        mapped.add(`${sourceIndex}:${comment.id}`);
        for (const reply of source.comments.filter(reply => reply.parent === comment.id)) mapped.add(`${sourceIndex}:${reply.id}`);
      }
    }
    chapters.push({ key: chapter.key, title: choice.title.trim().slice(0, 120), content, words: countWords(content), pendingRevisions, comments, choice, blocks: chapter.blocks });
  }
  if (!chapters.length) throw Error('manuscript_no_chapters');
  const allComments = sources.reduce((n, source) => n + source.comments.length + (source.sourceOnlyComments ?? 0), 0);
  const retainedComments = allComments - mapped.size;
  if (retainedComments) findings.push({ code: 'comments-retained-in-original-unmapped-or-excluded', count: retainedComments });
  const commentData = ({ startMarker: _start, endMarker: _end, ...comment }: import('./types').SourceComment) => { void _start; void _end; return comment; };
  const digest = await sha256Hex(JSON.stringify({ version: 1, manuscriptId, sources: sources.map(source => ({ name: source.name, sha256: source.sha256, format: source.format })), split, scope, choices: chapters.map(chapter => ({ ...chapter.choice, title: chapter.title })), findings, content: chapters.map(chapter => ({ content: chapter.content, comments: chapter.comments.map(comment => ({ ...comment, source: commentData(comment.source), replies: comment.replies.map(commentData) })) })) }));
  const importedComments = chapters.reduce((n, chapter) => n + chapter.comments.length, 0);
  return { digest, chapters, findings, importedComments, importedReplies: mapped.size - importedComments, retainedComments };
}
