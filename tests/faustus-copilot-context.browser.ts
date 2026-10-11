import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { db } from '@/db';
import { writerContext, registerCopilotEditor } from '@/services/copilot/faustusContext';
import { whGetContext } from '@/services/aiBridge/tools/context';
import { useAppStore } from '@/stores/appStore';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

export async function testFaustusCopilotContext(): Promise<string[]> {
  const now = Date.now();
  await db.projects.put({ id: 'qa-project', title: 'Two identical names', description: '', mode: 'novelist', type: 'standalone', color: '', status: 'draft', enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: now, updatedAt: now });
  await db.projects.put({ id: 'qa-project-2', title: 'Two identical names', description: '', mode: 'novelist', type: 'standalone', color: '', status: 'draft', enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: now, updatedAt: now });
  await db.writings.put({ id: 'chapter', projectId: 'qa-project', title: 'Chapter', content: '<p>First paragraph</p>', wordCount: 2, status: 'draft', tags: [], createdAt: now, updatedAt: now });
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({ element, extensions: [StarterKit], content: '<p>First paragraph</p>' });
  const unregister = registerCopilotEditor(editor, { projectId: 'qa-project', objectId: 'chapter', kind: 'writings' });
  editor.commands.setTextSelection({ from: 1, to: 6 });
  const context = await writerContext('qa-space', 'qa-project', 'writings', 'es', '');
  assert(context.active_objects[0]?.object_id === 'chapter', 'A manually opened chapter must resolve without a query parameter.');
  assert(context.selection?.text === 'First', 'The live editor selection must be captured at send time.');
  assert(context.selection.range?.unit === 'prosemirror', 'The selection range must declare its real coordinate unit.');
  editor.commands.setTextSelection({ from: 7, to: 16 });
  const changed = await writerContext('qa-space', 'qa-project', 'writings', 'es', '');
  assert(changed.selection?.text === 'paragraph', 'A later send must read the new selection.');
  assert(context.selection?.text === 'First', 'The previous send context must remain immutable.');
  const other = await writerContext('qa-space', 'qa-project-2', 'writings', 'es', '');
  assert(!other.selection && other.active_objects.length === 0, 'A project with the same name cannot inherit the other project selection.');
  unregister(); editor.destroy(); element.remove();
  window.location.hash = '#/project/qa-project/writings?writing=chapter';
  const hash = await writerContext('qa-space', 'qa-project', 'writings', 'en');
  assert(hash.active_objects[0]?.object_id === 'chapter', 'Desktop HashRouter must resolve deep-linked objects.');
  assert(!hash.selection, 'Destroyed editors must not contribute selections.');
  useAppStore.setState({ currentProjectId: 'qa-project' });
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { faustus: { getInfo: async () => ({ data_space_id: 'qa-space' }) }, aiBridge: { getInfo: async () => ({ writesEnabled: true }) } } });
  const native = await whGetContext() as { hoardContext?: { origin: { data_space_id: string }; active_objects: Array<{ object_id: string }> } };
  assert(native.hoardContext?.origin.data_space_id === 'qa-space' && native.hoardContext.active_objects[0]?.object_id === 'chapter', 'The existing MCP context tool must expose the same application context.');
  await db.projects.bulkDelete(['qa-project', 'qa-project-2']); await db.writings.delete('chapter');
  return ['live selection and manually opened identity', 'per-send snapshots and project isolation', 'native desktop hash routes', 'existing MCP context tool parity'];
}
