// Small things the three prep block views share.
import { useSyncExternalStore } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import type { CodexBlockHost } from '../codexBlocks/model';

const noSubscription = () => () => {};
/** The project the editor belongs to, kept current when the editor moves to another. */
export function usePrepProject(host: CodexBlockHost): string | undefined {
  const snapshot = useSyncExternalStore(host.subscribe ?? noSubscription, () => JSON.stringify(host.context()));
  try { return (JSON.parse(snapshot) as { projectId?: string }).projectId || undefined; } catch { return undefined; }
}
export const prepFieldClass = 'min-h-9 min-w-0 rounded-lg border border-border bg-deep px-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold';
export const prepButtonClass = 'inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';
export const prepPrimaryClass = 'inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-accent-gold px-3 text-sm text-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-gold disabled:opacity-50';
export const prepBoxClass = (selected: boolean) => `not-prose my-3 rounded-lg border bg-surface p-3 ${selected ? 'border-accent-gold' : 'border-border'}`;
/** Whether the editor can be written in, kept current when it is switched between reading and writing. */
export function usePrepEditable(editor: Editor): boolean {
  return useEditorState({ editor, selector: ({ editor: current }) => current.isEditable });
}
