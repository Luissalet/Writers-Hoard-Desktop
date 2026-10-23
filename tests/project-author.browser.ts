import { db } from '@/db';
import type { Project, Writing } from '@/types';
import { buildPublishingArtifacts } from '@/services/projectTools';
import { buildReaderHtml } from '@/engines/writings/readerExport';
import { defaultReaderPresentation } from '@/engines/writings/readerPresentation';
import type { PublishingProfile } from '@/types/projectTools';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** The book's byline: set from the bridge, printed on every title page and in the Reader edition, undone. */
export async function testProjectAuthor(): Promise<string[]> {
  const P = 'synthetic-project-author';
  try {
    await db.projects.put({ id: P, title: 'La sal del norte', description: 'Una novela', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings'], createdAt: 1, updatedAt: 1 } satisfies Project);
    const writing: Writing = { id: 'pa-1', projectId: P, title: 'El puerto', status: 'draft', content: '<p>Llovía.</p>', wordCount: 1, chapter: 1, tags: [], createdAt: 1, updatedAt: 1 };
    await db.writings.put(writing);
    const long = await runBridgeTool('wh_update_project_details', { projectId: P, author: 'x'.repeat(121) });
    assert(!long.ok && /120/.test(long.error ?? ''), 'Too long refused');
    const set = await runBridgeTool('wh_update_project_details', { projectId: P, author: '  Marta Salinas ' });
    assert(set.ok && (await db.projects.get(P))?.author === 'Marta Salinas', `Set: ${JSON.stringify(set).slice(0, 200)}`);
    const listed = await runBridgeTool('wh_list_projects', {});
    assert((listed.result as { projects: Array<{ id: string; author: string | null }> }).projects.find(p => p.id === P)?.author === 'Marta Salinas', 'Listed with the author');
    const project = (await db.projects.get(P))!;
    const profile: PublishingProfile = { id: 'pp', projectId: P, name: 'Libro', format: 'manuscript', includeTitlePage: true, includeSynopsis: false, includeBibliography: false, citationStyle: 'apa', selectedWritingIds: [], createdAt: 1, updatedAt: 1 };
    const artifacts = buildPublishingArtifacts(project, profile, [writing], []) as unknown as { markdown: string; html: string };
    assert(/\*\*Marta Salinas\*\*/.test(artifacts.markdown) && /<p class="byline">Marta Salinas<\/p>/.test(artifacts.html), `Title pages: ${artifacts.markdown.slice(0, 200)}`);
    const reader = await buildReaderHtml(project, [writing], defaultReaderPresentation(), 'es');
    assert(/data-reader-byline>Marta Salinas</.test(reader.html), 'Reader byline');
    const audit = (set.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_update_project_details', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'author' } });
    assert(undone.ok && (await db.projects.get(P))?.author === undefined, 'Undo removes the byline');
    return ['Edit project → Autoría: the byline (set through wh_update_project_details, 120 characters at most) is printed under the title on the Markdown and HTML title pages (also DOCX and ePub, with dc:creator) and in the Reader edition; wh_list_projects reports it; undo takes it back'];
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
