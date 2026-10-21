import { inspectManuscriptFile } from '@/engines/writings/manuscriptReview/inspect';
import { planManuscriptImport } from '@/engines/writings/manuscriptReview/plan';
import { htmlToText } from '@/engines/_shared/anchoring/htmlToText';
export async function testManuscriptLiteralMarkers(): Promise<string[]> {
  const literal = 'Before \uE000wh-abcdef-start-3\uE001after \uE000wh-abcdef-end-3\uE001 end.';
  const source = await inspectManuscriptFile(new File([literal], 'Literal markers.txt', { type: 'text/plain' }));
  const plan = await planManuscriptImport([source], { mode: 'file', headingLevel: 1, separator: '***' }, { projectId: 'independent-literal-source' });
  if (htmlToText(plan.chapters[0].content) !== literal) throw Error('Manuscript import silently removed literal private-use marker text not generated for this source');
  return ['Normal TXT inspect/plan preserves literal private-use marker-looking text byte-for-byte'];
}
