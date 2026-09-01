import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
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
  Search,
  Undo2,
  Redo2,
  MessageSquarePlus,
  ImagePlus,
  Bot,
} from 'lucide-react';
import { askCopilotAbout, copilotAvailable } from '@/stores/copilotHandoffStore';
import type { AnnotationAnchor } from '@/engines/annotations/types';
import { useAppStore } from '@/stores/appStore';
import FindReplaceBar from './FindReplaceBar';
import {
  isFindShortcut,
  isReplaceShortcut,
  ownsEditorShortcut,
  registerEditorSurface,
} from './editorShortcuts';

/**
 * ONE INSTANCE PER DOCUMENT. A host that shows a different document in the same
 * place must give this component a `key` of that document's id.
 *
 * `useEditor` is called with no deps, so it builds its ProseMirror editor once
 * per mount and keeps it for the life of the component — including the undo
 * stack, which is plugin state on that editor and belongs to no document in
 * particular. Swapping `content` on a mounted instance goes through
 * `setContent` below, and `setContent` is an ordinary transaction: it is added
 * to the history like any edit. So without a key, one Ctrl+Z after a swap walks
 * back OUT of the document on screen and into the previous one, `onUpdate`
 * reports the result as if the writer had typed it, and the host saves the
 * wrong document's text over the right document's row.
 */
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
  /**
   * Optional. When provided, the editor renders a "Generar imagen" button above
   * a non-empty selection. Clicking it hands the selected text plus surrounding
   * context to the host, which turns it into an image via the Image Studio.
   */
  onGenerateImage?: (selection: { selectedText: string; contextBefore: string; contextAfter: string }) => void;
}

interface FloatingMenuState {
  visible: boolean;
  top: number;
  left: number;
}

/** An open find bar, with the state the shortcut has to carry into it. */
interface FindSession {
  query: string;
  replace: boolean;
  anchor: number;
  /** Bumped on every re-press of the shortcut, to refocus the field. */
  token: number;
}

const HIDDEN_MENU: FloatingMenuState = { visible: false, top: 0, left: 0 };
const CONTEXT_WINDOW = 40;
// Wider than the annotation window: the image model wants scene context.
const IMAGE_CONTEXT_WINDOW = 500;
// Long enough for a character name or a phrase, short enough that selecting a
// paragraph and hitting Ctrl+F does not fill the field with the paragraph.
const SEED_LIMIT = 120;

function seedQuery(editor: Editor): string {
  const { from, to, empty } = editor.state.selection;
  if (empty) return '';
  const selected = editor.state.doc.textBetween(from, to, ' ', ' ').trim();
  return selected.length > 0 && selected.length <= SEED_LIMIT ? selected : '';
}

// Module-scope: creating this inside the component made React remount every
// toolbar button on each keystroke (react-hooks/static-components).
function ToolButton({ active, onClick, title, children }: {
  active?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded transition ${
        active ? 'bg-accent-gold/20 text-accent-gold' : 'text-text-muted hover:text-text-primary hover:bg-elevated'
      }`}
    >
      {children}
    </button>
  );
}

export default function TiptapEditor({ content, onChange, placeholder, onAnnotate, onGenerateImage }: TiptapEditorProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('editor.placeholder');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<FloatingMenuState>(HIDDEN_MENU);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [findSession, setFindSession] = useState<FindSession | null>(null);
  const reading = useAppStore((s) => s.reading);
  const loadReading = useAppStore((s) => s.loadReading);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
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

  useEffect(() => {
    void loadReading();
  }, [loadReading]);

  // Plain function on purpose: React Compiler memoizes it, and a manual
  // a manual memo here reported "existing memoization could not be preserved".
  const openFind = (withReplace: boolean): void => {
    if (!editor) return;
    const query = seedQuery(editor);
    const anchor = editor.state.selection.from;
    setFindSession((open) =>
      open
        ? { ...open, replace: open.replace || withReplace, token: open.token + 1 }
        : { query, replace: withReplace, anchor, token: 0 },
    );
  };
  // Kept in a ref so the window listener below never has to be rebuilt, and
  // assigned in an effect because refs may not be written during render.
  const openFindRef = useRef(openFind);
  useEffect(() => {
    openFindRef.current = openFind;
  });

  // The find bar answers to the window, because the writer may be anywhere in
  // the editor when they reach for it — but only when this editor is the one
  // the keystroke belongs to. See `editorShortcuts`.
  const findOpen = findSession !== null;
  useEffect(() => {
    if (!editor) return;
    const handler = (event: KeyboardEvent) => {
      const surface = wrapperRef.current;
      if (!surface) return;

      if (event.key === 'Escape') {
        // Only when the writer is inside this editor: elsewhere Escape belongs
        // to whatever is on top of it — a modal, focus mode.
        if (!findOpen || !surface.contains(document.activeElement)) return;
        event.preventDefault();
        event.stopPropagation();
        setFindSession(null);
        return;
      }

      const find = isFindShortcut(event);
      const replace = isReplaceShortcut(event);
      if ((!find && !replace) || event.repeat) return;
      // Nothing is prevented until we are sure a bar will appear, so an
      // unhandled Ctrl+F still reaches whatever find the host provides.
      if (!ownsEditorShortcut(surface)) return;
      event.preventDefault();
      event.stopPropagation();
      openFindRef.current(replace);
    };
    // Capture: the same keys are watched by hosts above us (focus mode reads
    // Escape), and the one holding the find bar decides first.
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [editor, findOpen]);

  useEffect(() => {
    const surface = wrapperRef.current;
    if (!surface || !editor) return;
    return registerEditorSurface(surface);
  }, [editor]);

  // External content sync (e.g. restoring a version snapshot). During normal
  // typing `editor.getHTML() === content`, so this never fights the cursor.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== content) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [content, editor]);

  // Track selection → position the floating "Annotate" button over the
  // active range. Hidden when no editor, no callback, or selection collapses.
  useEffect(() => {
    if (!editor || (!onAnnotate && !onGenerateImage && !copilotAvailable())) return;

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

    const onBlur = () => {
      // Defer so a click on the floating button is registered before we hide.
      window.setTimeout(() => {
        const sel = editor.state.selection;
        if (sel.empty) setMenu(HIDDEN_MENU);
      }, 120);
    };
    editor.on('selectionUpdate', update);
    editor.on('blur', onBlur);
    return () => {
      editor.off('selectionUpdate', update);
      // Without this the blur handler accumulated on every re-run of the effect
      // (the host passes inline callbacks, so it re-runs on each keystroke).
      editor.off('blur', onBlur);
    };
  }, [editor, onAnnotate, onGenerateImage]);

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

  // Hand the selection to the copilot dock. No prop: the dock is mounted by
  // MainLayout on every project route and drains the store itself.
  const handleAskCopilotClick = () => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    askCopilotAbout(editor.state.doc.textBetween(from, to, '\n', '\n'));
    setMenu(HIDDEN_MENU);
  };

  const handleGenerateImageClick = () => {
    if (!editor || !onGenerateImage) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const doc = editor.state.doc;
    const docSize = doc.content.size;
    // Cap the excerpt: an image is one scene, and a whole chapter would overflow
    // the prompt-writing model for no gain.
    const selectedText = doc.textBetween(from, to, '\n', '\n').slice(0, 2000);
    if (!selectedText.trim()) return;
    const contextBefore = doc.textBetween(Math.max(0, from - IMAGE_CONTEXT_WINDOW), from, '\n', '\n');
    const contextAfter = doc.textBetween(to, Math.min(docSize, to + IMAGE_CONTEXT_WINDOW), '\n', '\n');
    onGenerateImage({ selectedText, contextBefore, contextAfter });
    setMenu(HIDDEN_MENU);
  };

  if (!editor) return null;

  // Inline URL form (replaces native prompt(), which blocks the JS thread
  // and misbehaves across the tab lifecycle — see tasks/lessons.md #12).
  const openLinkForm = () => {
    if (editor.isActive('link')) {
      // Toggle off an existing link directly.
      editor.chain().focus().unsetLink().run();
      return;
    }
    setLinkUrl('');
    setShowLinkForm(true);
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    setShowLinkForm(false);
    if (!url) return;
    const href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
    editor.chain().focus().setLink({ href }).run();
  };

  return (
    <div
      ref={wrapperRef}
      // The reading preference is carried as data, and index.css turns it into
      // the custom properties the prose is set with.
      data-reading-face={reading.face}
      data-reading-size={reading.size}
      data-reading-measure={reading.measure}
      className="tiptap-editor relative border border-border rounded-lg overflow-hidden bg-elevated"
    >
      {/* Floating selection actions over a non-empty selection. */}
      {menu.visible && (onAnnotate || onGenerateImage || copilotAvailable()) && (
        <div
          className="absolute z-20 -translate-x-1/2 flex items-center gap-0.5 p-0.5 rounded-lg bg-surface border border-accent-gold/40 shadow-lg"
          style={{ top: menu.top, left: menu.left }}
        >
          {onAnnotate && (
            <button
              type="button"
              onMouseDown={(e) => {
                // MouseDown (not click) so the editor blur handler can't race us.
                e.preventDefault();
                handleAnnotateClick();
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-accent-gold text-xs font-medium hover:bg-accent-gold hover:text-deep transition"
            >
              <MessageSquarePlus size={13} />
              {t('annotations.panel.addNote')}
            </button>
          )}
          {onGenerateImage && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleGenerateImageClick();
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-accent-gold text-xs font-medium hover:bg-accent-gold hover:text-deep transition"
            >
              <ImagePlus size={13} />
              {t('writings.generateImage')}
            </button>
          )}
          {copilotAvailable() && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleAskCopilotClick();
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-accent-gold text-xs font-medium hover:bg-accent-gold hover:text-deep transition"
            >
              <Bot size={13} />
              {t('editor.askCopilot')}
            </button>
          )}
        </div>
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
        <ToolButton active={editor.isActive('link')} onClick={openLinkForm} title={t('editor.insertLink')}>
          <LinkIcon size={16} />
        </ToolButton>
        <ToolButton
          active={findOpen}
          onClick={() => openFind(false)}
          title={t('editor.find.action')}
        >
          <Search size={16} />
        </ToolButton>
        <div className="flex-1" />
        <ToolButton onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 size={16} />
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 size={16} />
        </ToolButton>
      </div>

      {/* Find & replace, inside the document it searches */}
      {findSession && (
        <FindReplaceBar
          editor={editor}
          initialQuery={findSession.query}
          anchor={findSession.anchor}
          showReplace={findSession.replace}
          focusToken={findSession.token}
          onToggleReplace={() =>
            setFindSession((open) => (open ? { ...open, replace: !open.replace } : open))
          }
          onClose={() => setFindSession(null)}
        />
      )}

      {/* Inline link form */}
      {showLinkForm && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface/70">
          <LinkIcon size={14} className="text-text-dim flex-shrink-0" />
          <input
            autoFocus
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
              if (e.key === 'Escape') setShowLinkForm(false);
            }}
            placeholder="https://…"
            className="flex-1 bg-elevated border border-border rounded px-2.5 py-1 text-sm text-text-primary outline-none focus:border-accent-gold transition"
          />
          <button
            onClick={applyLink}
            className="px-3 py-1 text-xs font-semibold bg-accent-gold text-deep rounded hover:bg-accent-amber transition"
          >
            {t('common.add')}
          </button>
          <button
            onClick={() => setShowLinkForm(false)}
            className="px-2 py-1 text-xs text-text-muted hover:text-text-primary transition"
          >
            {t('common.cancel')}
          </button>
        </div>
      )}

      {/* Editor */}
      <EditorContent editor={editor} />
    </div>
  );
}
