// ============================================
// Optional model-written summary
// ============================================
//
// Goes through the app's existing AI runtime and the project's own AI privacy
// switches (the same ones project-grounded analysis obeys). The model sees the
// claims and their numbered sources, nothing else. What it writes is NOT
// trusted: the report runs the citation check over it and flags what fails.

import { callAi } from '@/services/aiService';
import { getGroundedAiPrivacy } from '@/services/projectTools';
import type { ClaimView } from './derive';
import type { ReportSource } from './report';

export type ModelSummaryErrorCode = 'disabled' | 'empty' | 'failed';

export class ModelSummaryError extends Error {
  readonly code: ModelSummaryErrorCode;
  constructor(code: ModelSummaryErrorCode) { super(code); this.name = 'ModelSummaryError'; this.code = code; }
}

const SYSTEM = [
  'You summarise an investigation for its author.',
  'Use ONLY the numbered claims you are given. Do not add facts, names, dates or numbers that are not in them.',
  'After every statement of fact, cite the sources that back it with their numbers in square brackets, like [1] or [1][2], using only numbers listed for that claim.',
  'A claim with no source numbers is not established: mention it only as something that still needs a source.',
  'Never say anything is proven or certain. Keep it under 160 words, in plain paragraphs, in the language of the question.',
].join(' ');

/** What the model is shown: one line per live claim, with its active source numbers. */
export function summaryPrompt(question: string, views: readonly ClaimView[], sources: readonly ReportSource[]): string {
  const numbers = new Map(sources.map(source => [source.citation.id, source.number]));
  const lines = views.filter(view => view.status !== 'retracted').map(view => {
    const markers = [...new Set(view.supports.filter(s => s.active).map(s => numbers.get(s.citationId)).filter((n): n is number => n !== undefined))]
      .sort((a, b) => a - b).map(n => `[${n}]`).join('');
    return `- ${view.claim.statement.replace(/\s+/g, ' ').trim()} ${markers || '(no active source)'} (${view.status}; ${view.evidenceCount} excerpts, ${view.independentCount} independent sources)`;
  });
  return `Question: ${question.trim() || '(none set)'}\n\nClaims:\n${lines.join('\n')}`;
}

export async function requestModelSummary(
  projectId: string,
  question: string,
  views: readonly ClaimView[],
  sources: readonly ReportSource[],
  config: Parameters<typeof callAi>[2],
): Promise<string> {
  const privacy = await getGroundedAiPrivacy(projectId);
  if (!privacy.enabled || !privacy.allowRemoteRequests || !privacy.includeResearch) throw new ModelSummaryError('disabled');
  if (!views.some(view => view.status !== 'retracted')) throw new ModelSummaryError('empty');
  try {
    const answer = (await callAi(SYSTEM, summaryPrompt(question, views, sources), config)).trim();
    if (!answer) throw new ModelSummaryError('failed');
    return answer;
  } catch (error) {
    if (error instanceof ModelSummaryError) throw error;
    throw new ModelSummaryError('failed');
  }
}
