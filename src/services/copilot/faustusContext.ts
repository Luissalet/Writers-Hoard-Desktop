import { db } from '@/db';
import type { Editor } from '@tiptap/react';
import type { WriterHoardContext } from './faustusProtocol';

export interface WriterEditorIdentity { projectId: string; objectId: string; kind: string }
const editors = new Map<Editor, WriterEditorIdentity>();
let lastEditor: Editor | null = null;

export function registerCopilotEditor(editor: Editor, identity: WriterEditorIdentity): () => void {
  editors.set(editor, identity);
  const focus = () => { lastEditor = editor; };
  editor.on('focus', focus);
  return () => { editor.off('focus', focus); editors.delete(editor); if (lastEditor === editor) lastEditor = null; };
}

const DOCUMENT_PARAMS: Record<string, readonly string[]> = { writings: ['writing'], codex: ['entry'], seeds: ['seed'], notes: ['note'], outline: ['beat', 'outline'], biography: ['bio'], 'character-arc': ['arc'], 'real-atlas': ['place'], maps: ['pin', 'map'], board: ['node'], worldgen: ['region', 'place'] };

function routeSearch(): string {
  if (window.location.search) return window.location.search;
  const queryAt = window.location.hash.indexOf('?');
  return queryAt < 0 ? '' : window.location.hash.slice(queryAt);
}

/** Resolve the current saved identity at send time, not from a previous render. */
export async function writerContext(dataSpaceId: string, projectId: string, engine: string | null, locale: string, search = routeSearch()): Promise<WriterHoardContext> {
  const project = await db.projects.get(projectId);
  if (!project) throw new Error('Writer project is no longer available.');
  const query = new URLSearchParams(search);
  const focused = [...editors.keys()].find((editor) => editor.isFocused) ?? lastEditor ?? [...editors.keys()].at(-1);
  const identity = focused ? editors.get(focused) : null;
  const objectId = identity?.projectId === projectId && identity.kind === engine ? identity.objectId : engine ? (DOCUMENT_PARAMS[engine] ?? ['entity']).map((key) => query.get(key)).find(Boolean) : null;
  const context: WriterHoardContext = {
    contract_version: '1.0',
    origin: { app_id: 'writer', data_space_id: dataSpaceId, surface: 'editor' },
    project: { external_project_id: projectId, title: project.title, description: project.description },
    active_objects: [],
    view: { mode: engine ?? 'overview', locale, enabled_engines: project.enabledEngines },
    attachments: [],
  };
  if (engine && objectId) {
    const writing = engine === 'writings' ? await db.writings.get(objectId) : null;
    context.active_objects.push({ app_id: 'writer', data_space_id: dataSpaceId, kind: engine, object_id: objectId, title: writing?.title, revision: writing ? String(writing.updatedAt) : undefined });
  }
  if (focused && identity?.projectId === projectId && identity.objectId === objectId && !focused.isDestroyed) {
    const { from, to } = focused.state.selection;
    if (from !== to) context.selection = { object_id: identity.objectId, kind: 'text_range', text: focused.state.doc.textBetween(from, to, '\n'), range: { start: from, end: to, unit: 'prosemirror' }, revision: context.active_objects[0]?.revision };
  }
  return context;
}
