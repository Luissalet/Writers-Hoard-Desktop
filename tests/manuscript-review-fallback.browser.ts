import JSZip from 'jszip';
import { db } from '@/db';
import { inspectManuscriptFile } from '@/engines/writings/manuscriptReview/inspect';
import { planManuscriptImport } from '@/engines/writings/manuscriptReview/plan';
import { applyManuscriptImport } from '@/engines/writings/manuscriptReview/persist';
export async function testManuscriptReviewFallback() {
  if (window.electronAPI?.documents) throw Error('Fallback test requires the normal web-only capability state');
  const projectId = 'web-fallback', now = Date.now();
  await db.projects.add({ id: projectId, title: 'Web', type: 'standalone', mode: 'novelist', status: 'draft', color: '#555555', description: '', enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: now, updatedAt: now });
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Uno</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Visible </w:t></w:r><w:del w:id="1"><w:r><w:delText>deleted</w:delText></w:r></w:del><w:ins w:id="2"><w:r><w:t>inserted</w:t></w:r></w:ins></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>');
  zip.file('word/comments.xml', '<w:comments><w:comment w:id="1"><w:p><w:r><w:t>Source comment</w:t></w:r></w:p></w:comment></w:comments>');
  const file = new File([await zip.generateAsync({ type: 'uint8array' })], 'legacy.docx');
  const source = await inspectManuscriptFile(file), scope = { projectId }, split = { mode: 'heading' as const, headingLevel: 1, separator: '***' }, plan = await planManuscriptImport([source], split, scope);
  if (!source.findings.some(row => row.code === 'simplified-browser-docx') || !source.findings.some(row => row.code === 'simplified-final-revisions') || plan.retainedComments !== 1 || plan.importedComments !== 0 || !plan.chapters[0].content.includes('inserted') || plan.chapters[0].content.includes('deleted') || !plan.chapters[0].content.includes('<strong>')) throw Error('Web-only import lost its old behavior or hid conversion losses');
  const result = await applyManuscriptImport(scope, [source], split, [], plan.digest), stored = await db.manuscriptSources.get(result.sourceIds[0]);
  if (!stored || stored.original.size !== file.size) throw Error('Web-only original not retained');
  return ['Web-only DOCX prose import remains available, with detected revision/table/comment losses and portable exact original instead of a silent rich-review claim'];
}
