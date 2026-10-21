import { markdownToTiptapHtml } from '@/services/aiBridge/markdown';
import { testFootnoteBridgeLiteralSyntaxSurvives, testFootnoteBridgeMarkdownToHtml, testFootnoteBridgeRoundTripKeepsIdsAndTexts } from './footnotesBridge';
export async function testManuscriptMarkerDiagnostic(): Promise<string[]> {
  const raw = '\uE000wh-lift-0:0\uE001 / \uE000wh-lift-1:0\uE001 / \uE0000\uE001';
  const html = markdownToTiptapHtml(`${raw} \`code ${raw} [^n]\` y[^n]\n\n[^n]: secret`, { footnotes: true });
  const host = new DOMParser().parseFromString(html, 'text/html');
  if (!host.body.textContent?.startsWith(raw) || host.querySelector('code')?.textContent !== `code ${raw} [^n]` || host.querySelectorAll('sup[data-footnote-id]').length !== 1) throw Error(`Literal sentinel/code/footnote collision changed content: ${html}`);
  testFootnoteBridgeLiteralSyntaxSurvives(); testFootnoteBridgeMarkdownToHtml(); testFootnoteBridgeRoundTripKeepsIdsAndTexts();
  return ['Literal private-use characters, two occupied prefixes and code remain exact; one actual footnote', 'Existing Markdown/footnote literal and roundtrip cases pass with preservation oracle'];
}
