import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading2,
  Quote,
  Code,
  Link as LinkIcon,
  Undo2,
  Redo2,
  MessageSquarePlus,
} from 'lucide-react';
import type { AnnotationAnchor } from '@/engines/annotations/types';

interface TiptapEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /**
   * Optional. When provided, the editor renders a floating "Annotate"
   * button above any non-empty selection. Clicking it captures the
   * current selection (text + ±40-char context + plain-text offsets) and
   * hands the anchor to the host so it can stage a margin-note composer.
   */
  onAnnotate?: (anchor: AnnotationAnchor) => void;
}

interface FloatingMenuState {
  visible: boolean;
  top: number;
  left: number;
}

const HIDDEN_MENU: FloatingMenuState = { visible: false, top: 0, left: 0 };
const CONTEXT_WINDOW = 40;

export default function TiptapEditor({ content, onChange, placeholder, onAnnotate }: TiptapEditorProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('editor.placeholder');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<FloatingMenuState>(HIDDEN_MENU);
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Image,
      Placeholder.configure({ placeholder: resolvedPlaceholder }),
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none',
      },
    },
  });

  // Track selection → position the floating "Annotate" button over the
  // active range. Hidden when no editor, no callback, or selection collapses.
  useEffect(() => {
    if (!editor || !onAnnotate) return;

    const update = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty || from === to) {
        setMenu(HIDDEN_MENU);
        return;
      }
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      try {
        const fromCoords = editor.view.coordsAtPos(from);
        const toCoords = editor.view.coordsAtPos(to);
        const wrapperRect = wrapper.getBoundingClientRect();
        const top = Math.min(fromCoords.top, toCoords.top) - wrapperRect.top - 38;
        const left = (fromCoords.left + toCoords.right) / 2 - wrapperRect.left;
        setMenu({ visible: true, top: Math.max(top, 4), left });
      } catch {
        setMenu(HIDDEN_MENU);
      }
    };

    editor.on('selectionUpdate', update);
    editor.on('blur', () => {
      // Defer so a click on the floating button is registered before we hide.
      window.setTimeout(() => {
        const sel = editor.state.selection;
        if (sel.empty) setMenu(HIDDEN_MENU);
      }, 120);
    });
    return () => {
      editor.off('selectionUpdate', update);
    };
  }, [editor, onAnnotate]);

  const handleAnnotateClick = () => {
    if (!editor || !onAnnotate) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const doc = editor.state.doc;
    const docSize = doc.content.size;
    const selectedText = doc.textBetween(from, to, '\n', '\n');
    if (!selectedText) return;
    // Approximate plain-text offset by counting all characters before `from`.
    // This won't always line up exactly with htmlToText() (block separators
    // differ by edge case), but the fuzzy resolver's context-triple step
    // recovers cheaply. Storing offsets gives us a fast path when they match.
    const start = doc.textBetween(0, from, '\n', '\n').length;
    const end = start + selectedText.length;
    const contextBefore = doc.textBetween(Math.max(0, from - CONTEXT_WINDOW), from, '\n', '\n');
    const contextAfter = doc.textBetween(to, Math.min(docSize, to + CONTEXT_WINDOW), '\n', '\n');
    onAnnotate({
      type: 'text_range',
      start,
      end,
      selectedText,
      contextBefore,
      contextAfter,
    });
    setMenu(HIDDEN_MENU);
  };

  if (!editor) return null;

  const ToolButton = ({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      onClick={onClick}
      className={`p-1.5 rounded transition ${
        active ? 'bg-accent-gold/20 text-accent-gold' : 'text-text-muted hover:text-text-primary hover:bg-elevated'
      }`}
    >
      {children}
    </button>
  );

  const addLink = () => {
    const url = prompt(t('editor.enterUrl'));
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  return (
    <div ref={wrapperRef} className="tiptap-editor relative border border-border rounded-lg overflow-hidden bg-elevated">
      {/* Floating selection action — "Annotate" — only when the host wired onAnnotate. */}
      {onAnnotate && menu.visible && (
        <button
          type="button"
          onMouseDown={(e) => {
            // MouseDown (not click) so the editor blur handler can't race us.
            e.preventDefault();
            handleAnnotateClick();
          }}
          className="absolute z-20 -translate-x-1/2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface border border-accent-gold/40 text-accent-gold text-xs font-medium shadow-lg hover:bg-accent-gold hover:text-deep transition"
          style={{ top: menu.top, left: menu.left }}
        >
          <MessageSquarePlus size={13} />
          {t('annotations.panel.addNote')}
        </button>
      )}
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-surface/50 flex-wrap">
        <ToolButton active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={16} />
        </ToolButton>
        <ToolButton active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic size={16} />
        </ToolButton>
        <div className="w-px h-5 bg-border mx-1" />
        <ToolButton active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 size={16} />
        </ToolButton>
        <ToolButton active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List size={16} />
        </ToolButton>
        <ToolButton active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered size={16} />
        </ToolButton>
        <ToolButton active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote size={16} />
        </ToolButton>
        <ToolButton active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>
          <Code size={16} />
        </ToolButton>
        <div className="w-px h-5 bg-border mx-1" />
        <ToolButton active={editor.isActive('link')} onClick={addLink}>
          <LinkIcon size={16} />
        </ToolButton>
        <div className="flex-1" />
        <ToolButton onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 size={16} />
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 size={16} />
        </ToolButton>
      </div>

      {/* Editor */}
      <EditorContent editor={editor} />
    </div>
  );
}
