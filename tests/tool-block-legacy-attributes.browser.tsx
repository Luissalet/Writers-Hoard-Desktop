import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ToolDocumentBlock } from '@/components/editor/toolBlocks/ToolDocumentBlock';
import { createCodexBlockHost } from '@/components/editor/codexBlocks/model';
import { toolTarget } from '@/components/editor/toolBlocks/model';
import { prepareToolDocumentBlocksForExport } from '@/components/editor/toolBlocks/preview';
import { hydrateToolDocumentBlocks } from '@/components/editor/toolBlocks/reading';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function testToolBlockLegacyAttributes() {
  const projectId = 'legacy-tool-attrs-' + crypto.randomUUID(), documentId = projectId + '-table', results: string[] = [], editors: Editor[] = [];
  const context = createCodexBlockHost({ projectId, scopeId: 'legacy-attributes' });
  const target = { projectId, kind: 'tables', documentId, label: 'Cached legacy label' };
  const legacy = `<figure data-wh-tool-block="true" data-project-id="${projectId}" data-tool-kind="tables" data-document-id="${documentId}" data-label="Cached legacy label"><figcaption>Cached legacy label</figcaption></figure>`;
  const open = (content: string | ReturnType<Editor['getJSON']>) => { const editor = new Editor({ extensions: [StarterKit, ToolDocumentBlock.configure({ ...context, nodeView: false })], content }); editors.push(editor); return editor; };
  const attrs = (editor: Editor) => { const node = editor.state.doc.firstChild; check(node?.type.name === 'toolDocumentBlock', 'Expected real parsed tool node'); return node.attrs; };
  let stop: (() => void) | undefined, reader: HTMLDivElement | undefined;
  try {
    const editor = open(legacy), parsed = attrs(editor), schemaAttribute = editor.schema.nodes.toolDocumentBlock.attrs.presentation;
    check(toolTarget(parsed)?.documentId === documentId, 'Legacy HTML node has no valid target: ' + JSON.stringify(parsed));
    check(schemaAttribute.hasDefault && schemaAttribute.default === undefined && parsed.presentation === undefined, 'Absent presentation must be optional with an undefined schema default');
    results.push('Legacy HTML without presentation parses as an allowed tool target; ProseMirror hasDefault is true with undefined');

    const html = editor.getHTML(), json = JSON.parse(JSON.stringify(editor.getJSON()));
    check(html.includes(`data-document-id="${documentId}"`) && !html.includes('data-presentation'), 'Legacy HTML serialization loses identity or invents presentation');
    for (const content of [html, json]) check(toolTarget(attrs(open(content)))?.documentId === documentId, 'Serialized HTML/JSON reopen loses legacy pointer');
    for (const presentation of ['preview', 'editor']) {
      const modern = open(legacy.replace('<figure ', `<figure data-presentation="${presentation}" `));
      check(toolTarget(attrs(modern))?.presentation === presentation, 'Modern enum lost at HTML admission');
      check(toolTarget(attrs(open(JSON.parse(JSON.stringify(modern.getJSON())))))?.presentation === presentation, 'Modern enum lost at JSON reopen');
    }
    results.push('Legacy pointer survives serialized HTML and JSON reopening; both modern presentation enums survive the same adapter');

    check(toolTarget(target)?.documentId === documentId, 'Omitted DTO presentation rejected');
    for (const presentation of [null, '', 'invalid']) check(toolTarget({ ...target, presentation }) === null, 'Pure DTO validator accepted invalid presentation');
    check(toolTarget(attrs(open(legacy.replace('<figure ', '<figure data-presentation="invalid" ')))) === null, 'Invalid literal DOM presentation became an active target');
    results.push('Pure DTO null/empty/invalid presentation remains rejected, and an explicit invalid DOM enum is not normalized into an active target');

    await db.projects.put({ id: projectId, title: 'Legacy snapshot', mode: 'custom', type: 'standalone', enabledEngines: ['tables'], engineOrder: ['tables'], createdAt: 1, updatedAt: 1, dataTables: [{ id: documentId, title: 'Actual legacy table', mode: 'table', columns: [{ id: 'c', name: 'Value', kind: 'text' }], rows: [{ id: 'r', cells: { c: 'Preserved live cell' } }] }] });
    const exported = await prepareToolDocumentBlocksForExport(html, projectId, 'en');
    check(exported.includes('Actual legacy table') && exported.includes('Preserved live cell'), 'Serialized legacy pointer failed offline snapshot export');
    reader = document.createElement('div'); reader.innerHTML = html; document.body.append(reader); stop = hydrateToolDocumentBlocks(reader, projectId, 'en');
    for (let index = 0; index < 80 && !reader.textContent?.includes('Preserved live cell'); index++) await new Promise(resolve => setTimeout(resolve, 30));
    check(reader.textContent?.includes('Actual legacy table') && reader.textContent.includes('Preserved live cell'), 'Serialized legacy pointer failed reader hydration');
    results.push('Canonical legacy HTML keeps its source for real offline snapshot export and live reader hydration');
    return results;
  } finally { stop?.(); reader?.remove(); for (const editor of editors) editor.destroy(); await deleteProject(projectId); }
}
