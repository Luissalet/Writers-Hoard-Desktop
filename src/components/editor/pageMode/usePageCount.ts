import { useCallback, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/react';
import { getPageCount } from './PageLayout';

/**
 * The page count of a live editor, for a host to print beside the word count.
 *
 * Not `useEditorState`: that hook caches its snapshot until a transaction it
 * has SEEN, and the page plugin's first measurement is dispatched in a frame
 * that usually lands before the host has subscribed — so the count sat at 1
 * until the writer typed something. Reading the plugin state directly on
 * every subscription (and re-subscribing when the editor changes) has no
 * such window.
 */
export function usePageCount(editor: Editor | null): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!editor) return () => {};
      editor.on('transaction', onChange);
      return () => {
        editor.off('transaction', onChange);
      };
    },
    [editor],
  );
  const read = useCallback(() => (editor && !editor.isDestroyed ? getPageCount(editor) : 1), [editor]);
  return useSyncExternalStore(subscribe, read, () => 1);
}
