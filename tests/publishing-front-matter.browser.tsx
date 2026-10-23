// Front and back matter of a book: the copyright page after the title page and
// the back-cover text as the last page, in every format, in the preview and
// through the bridge.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { db } from '@/db';
import PublishingPreviewPane from '@/components/project/PublishingPreviewPane';
import { buildPublishingArtifacts, publishingCopyright } from '@/services/projectTools';
import { buildPublishingDocx } from '@/engines/writings/publishingDocx';
import { buildPublishingEpub } from '@/engines/writings/publishingEpub';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import type { Project, Writing } from '@/types';
import type { PublishingProfile } from '@/types/projectTools';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

export async function testPublishingFrontMatter(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [];
  const P = 'pfm-project';
  const writings: Writing[] = [
    { id: 'pfm-1', projectId: P, title: 'El puerto', status: 'draft', content: '<p>Uno dos tres.</p>', wordCount: 3, chapter: 1, tags: [], createdAt: 1, updatedAt: 1 },
    { id: 'pfm-2', projectId: P, title: 'La tormenta', status: 'draft', content: '<p>Cuatro cinco.</p>', wordCount: 2, chapter: 2, tags: [], createdAt: 1, updatedAt: 1 },
  ];
  const project = { id: P, title: 'La sal', author: 'Marta Salinas', blurb: 'Una isla sin faro.\nUna mujer que vuelve.' };
  const profile: PublishingProfile = { id: 'pfm-profile', projectId: P, name: 'Libro', format: 'manuscript', includeTitlePage: true, includeToc: false, includeCopyright: true, includeBlurb: true, includeSynopsis: false, includeBibliography: false, citationStyle: 'apa', selectedWritingIds: [], createdAt: 1, updatedAt: 1 };
  const at = Date.UTC(2026, 5, 1);

  assert(publishingCopyright(project, 'Todos los derechos reservados.', at) === '© 2026 Marta Salinas. Todos los derechos reservados.', 'Copyright line');
  assert(publishingCopyright({ title: 'La sal' }, 'R.', at) === '© 2026 La sal. R.', 'Copyright falls back to the title');
  const artifacts = buildPublishingArtifacts(project, profile, writings, [], { generatedAt: at, titleOverride: 'La sal' });
  const md = artifacts.markdown;
  const copyrightAt = md.indexOf('© 2026 Marta Salinas. Todos los derechos reservados.');
  assert(copyrightAt > md.indexOf('Marta Salinas') - 1 && copyrightAt < md.indexOf('El puerto'), `Markdown copyright after the title page: ${md.slice(0, 400)}`);
  assert(md.lastIndexOf('# Contracubierta') > md.indexOf('La tormenta') && md.includes('Una mujer que vuelve.'), 'Markdown back cover last');
  const html = artifacts.html;
  assert(/class="copyright-page"><p>© 2026 Marta Salinas/.test(html) && html.indexOf('copyright-page') < html.indexOf('El puerto'), 'HTML copyright page');
  assert(/class="chapter blurb"><h1 class="chapter-title">Contracubierta<\/h1><p>Una isla sin faro.<\/p><p>Una mujer que vuelve.<\/p>/.test(html), 'HTML back cover, a paragraph a line');
  const off = buildPublishingArtifacts(project, { ...profile, includeCopyright: false, includeBlurb: false }, writings, [], { generatedAt: at });
  assert(!off.markdown.includes('©') && !off.markdown.includes('Contracubierta') && !off.html.includes('class="copyright-page"') && !off.html.includes('class="chapter blurb"'), 'Off leaves both out');
  passed.push('Markdown and HTML: "© 2026 Marta Salinas. Todos los derechos reservados." on its own page after the title page (the title when there is no author), and "Contracubierta" with the blurb as the last page; both off by default');

  const { default: JSZip } = await import('jszip');
  const docx = await JSZip.loadAsync(await (await buildPublishingDocx(artifacts.document)).arrayBuffer());
  const body = await docx.file('word/document.xml')!.async('string');
  assert(body.indexOf('© 2026 Marta Salinas') > 0 && body.indexOf('© 2026 Marta Salinas') < body.indexOf('El puerto'), 'DOCX copyright before the first chapter');
  assert(body.lastIndexOf('Contracubierta') > body.indexOf('La tormenta') && body.includes('Una mujer que vuelve.'), 'DOCX back cover after the last chapter');
  const core = await docx.file('docProps/core.xml')!.async('string');
  assert(core.includes('Marta Salinas'), `DOCX creator: ${core}`);
  const epub = await JSZip.loadAsync(await (await buildPublishingEpub(artifacts.document)).arrayBuffer());
  const opf = await epub.file('EPUB/package.opf')!.async('string');
  const spine = [...opf.matchAll(/<itemref idref="([^"]+)"/g)].map(m => m[1]);
  assert(spine.indexOf('copyright') === spine.indexOf('title') + 1 && spine[spine.length - 1] === 'blurb', `EPUB spine: ${spine.join(',')}`);
  assert((await epub.file('EPUB/blurb.xhtml')!.async('string')).includes('Una isla sin faro.'), 'EPUB back cover page');
  passed.push(`DOCX: copyright page before the first chapter, back cover after the last, author as the file's creator; ePub spine ${spine.join(' → ')}`);

  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  try {
    await act(async () => { root = createRoot(host); root.render(<PublishingPreviewPane project={project} profile={profile} writings={writings} />); await pause(300); });
    assert(/© \d{4} Marta Salinas\. Todos los derechos reservados\./.test(document.querySelector('[data-testid="publishing-preview-copyright"]')?.textContent ?? ''), 'Preview copyright');
    assert(/Contracubierta.*Una isla sin faro/.test(document.querySelector('[data-testid="publishing-preview-blurb"]')?.textContent ?? ''), 'Preview back cover');
    await act(async () => { root!.render(<PublishingPreviewPane project={{ ...project, blurb: undefined }} profile={profile} writings={writings} />); await pause(400); });
    assert(!document.querySelector('[data-testid="publishing-preview-blurb"]') && /contracubierta/.test(document.querySelector('[data-testid="publishing-preview-no-blurb"]')?.textContent ?? ''), 'Asked for a back cover the project has not written');
    passed.push('Preview: the copyright line and the back cover show where the file prints them; asking for a back cover the project has not written says where to write it');
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }

  try {
    await db.projects.put({ id: P, title: 'La sal', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings'], createdAt: 1, updatedAt: 1, author: 'Marta Salinas' } as Project);
    await db.writings.bulkPut(writings);
    const details = await runBridgeTool('wh_update_project_details', { projectId: P, blurb: 'Una isla sin faro.' });
    assert(details.ok && (await db.projects.get(P))?.blurb === 'Una isla sin faro.', `Blurb set: ${JSON.stringify(details)}`);
    const created = await runBridgeTool('wh_publishing_profile_set', { projectId: P, name: 'Libro', includeCopyright: true, includeBlurb: true });
    assert(created.ok, JSON.stringify(created));
    const profileId = (created.result as { profile: { id: string } }).profile.id;
    const listed = await runBridgeTool('wh_publishing_profiles', { projectId: P });
    const row = (listed.result as { hasBlurb: boolean; profiles: Array<{ id: string; includeCopyright: boolean; pieces: number }> });
    assert(row.hasBlurb && row.profiles[0]?.id === profileId && row.profiles[0].includeCopyright && row.profiles[0].pieces === 2, `Listed: ${JSON.stringify(row)}`);
    const compiled = await runBridgeTool('wh_publishing_compile', { projectId: P, profileId });
    const text = compiled.result as { text: string; copyright: string; blurb: boolean; pieces: number };
    assert(compiled.ok && /^© \d{4} Marta Salinas\./.test(text.copyright) && text.blurb && text.pieces === 2 && text.text.includes('Una isla sin faro.'), `Compiled: ${JSON.stringify(compiled).slice(0, 400)}`);
    const changed = await runBridgeTool('wh_publishing_profile_set', { projectId: P, profileId, includeBlurb: false });
    assert(changed.ok && (await db.publishingProfiles.get(profileId))?.includeBlurb === false, 'Changed');
    await undoAuditEntry({ entry: { ...(changed.result as { __audit: Record<string, unknown> }).__audit, tool: 'wh_publishing_profile_set', kind: 'update' } });
    assert((await db.publishingProfiles.get(profileId))?.includeBlurb === true, 'Undo puts the change back');
    await undoAuditEntry({ entry: { ...(created.result as { __audit: Record<string, unknown> }).__audit, tool: 'wh_publishing_profile_set', kind: 'create' } });
    assert(!(await db.publishingProfiles.get(profileId)), 'Undo removes a profile the bridge made');
    const bad = await runBridgeTool('wh_publishing_profile_set', { projectId: P, name: 'Sel', selectionMode: 'selected' });
    assert(!bad.ok, 'A selection with nothing in it is refused');
    passed.push('Bridge: wh_update_project_details sets the blurb; wh_publishing_profile_set creates and changes a profile (undo restores it or removes the one it made); wh_publishing_profiles lists it with its pieces; wh_publishing_compile returns the compiled text with the copyright line and back cover');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
