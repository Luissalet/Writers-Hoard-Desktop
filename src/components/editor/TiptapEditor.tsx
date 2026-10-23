import {SourceToolBlock} from '@/engines/local/blocks/SourceToolBlock';
import SourceToolBlockControls from '@/engines/local/blocks/SourceToolBlockControls';
import {registerLocalToolEditor,type LocalToolEditorHost,type LocalToolEditorContext} from '@/engines/local/blocks/editorHost';
import type {LocalToolBlockOwner} from '@/engines/local/blocks/types';
import { useEditor, EditorContent } from '@tiptap/react';
import './revisionMarks.css';
import type { AnyExtension, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { createWritingBlockExtensions } from './blocks/extensions';
import SlashMenu from './blocks/SlashMenu';
import SlashToolHost from './blocks/SlashToolHost';
import ImageControls from './blocks/ImageControls';
import BlockFieldControls from './blocks/BlockFieldControls';
import { lazy, Suspense, useEffect,useLayoutEffect, useRef, useState } from 'react';
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
  Superscript,
  Sparkles,
  Languages,
} from 'lucide-react';
import { askCopilotAbout, copilotAvailable } from '@/stores/copilotHandoffStore';
import { registerCopilotEditor, type WriterEditorIdentity } from '@/services/copilot/faustusContext';
import { useEnginePane, paneReferenceScope } from '@/engines/_shared/EnginePaneContext';
import type { AnnotationAnchor } from '@/engines/annotations/types';
import { useAppStore } from '@/stores/appStore';
import FindReplaceBar from './FindReplaceBar';
import FootnoteLayer from './footnotes/FootnoteLayer';
import { GhostText, ghostSuggestionOf, type GhostTextHost } from './ghostText/GhostTextExtension';
import type { GhostTextBinding } from './ghostText/useGhostText';
import { GHOST_DEBOUNCE_MS } from '@/services/ghostText/ghostText';
import { createPageLayoutPlugin, pageLayoutKey, type PageLayoutOptions } from './pageMode/PageLayout';
import type { CodexEntry, FootnoteMarkerStyle } from '@/types';
import type { Citation } from '@/types/projectTools';
import { AdvancedEditorToolbar, createAdvancedExtensions } from './advanced';
import DocumentTools from './documents/DocumentTools';
import { createRevisionExtensions } from '@/engines/writings/revisions';
import RevisionControls from './revisions/RevisionControls';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import { getEraProject, listEraRows } from '@/services/worldEras/store';
import { createDictionaryGlossPlugin, createGlossMatcher, dictionaryGlossKey } from '@/engines/dictionary/glosses';
import { createInlineMentionsPlugin, inlineMentionsKey, OPEN_CODEX_REFERENCE, type OpenCodexReferenceDetail } from '@/services/codexReference/inlineMentions';
import { navigateTo } from '@/engines/_shared/anchoring';
import { WikiMarksControls } from './wiki/WikiMarks';
import { WikiHidden, WikiHiddenBlock, WikiSpoiler } from './wiki/marks';
import { createEditorialExtensions } from '@/engines/writings/editorial';
import EditorialControls from './editorial/EditorialControls';
import ProofingControls from './proofing/ProofingControls';
import HeadingNavigator from './navigation/HeadingNavigator';
import { CodexBlock } from './codexBlocks/CodexBlock';
import CodexBlockControls from './codexBlocks/CodexBlockControls';
import { createCodexBlockHost } from './codexBlocks/model';
import { MediaBlock } from './mediaBlocks/MediaBlock';
import MediaBlockControls from './mediaBlocks/MediaBlockControls';
import { ToolDocumentBlock } from './toolBlocks/ToolDocumentBlock';
import ToolDocumentControls from './toolBlocks/ToolDocumentControls';
import EntityDetectionControls from './entityDetection/EntityDetectionControls';
import { entityPreferences } from '@/services/entityDetection/service';
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
export type EditorLayout = 'flow' | 'page';

interface TiptapEditorProps {
  content: string;
  /**
   * The document as HTML after every edit. Serialising the document costs a
   * pass over all of it on each keystroke (≈15 ms for a 120 000-word book), so
   * a host that reads the document itself passes `onDocumentChange` instead.
   */
  onChange?: (html: string) => void;
  /** Told that the document changed, without the HTML (see `onChange`). */
  onDocumentChange?: () => void;
  placeholder?: string;
  /**
   * Optional extra Tiptap extensions (footnotes, chapter headings). Read
   * once, when the editor is built: a host that needs a different set must
   * remount with a new `key`. An extension named `doc` replaces StarterKit's
   * document node, so a host can say what the top level may hold.
   */
  extensions?: AnyExtension[];
  /**
   * Optional. Receives the editor instance once it exists (and `null` when it
   * is destroyed), so a host can render its own controls — a footnotes panel,
   * a chapter toolbar — against the live document.
   */
  onEditorReady?: (editor: Editor | null) => void;
  copilotIdentity?: WriterEditorIdentity;
  documentOwner?:LocalToolBlockOwner|((editor:Editor,position:number)=>LocalToolBlockOwner|undefined);
  prepareExternal?:()=>Promise<boolean>;
  canAcceptExternalBlock?:()=>boolean;
  onExternalBlockCommit?:(owner:LocalToolBlockOwner,root:Record<string,unknown>)=>void;
  /** World references also work in combined documents without registering an AI editor. */
  referenceContext?: { projectId: string; scopeId: string; entryId?: string };
  /** Optional. Extra buttons rendered at the end of the toolbar's left group. */
  toolbarExtra?: React.ReactNode;
  /**
   * `flow` (default) is the continuous editor; `page` sets the prose on
   * fixed-size sheets. The wrapper carries it as `data-editor-layout`, and
   * the editor itself registers the pagination plugin (see `pageLayout`).
   */
  layout?: EditorLayout;
  /**
   * What the page plugin needs when `layout` is `page`: the paper size, the
   * notes to print at the foot of each sheet, the page number's text. The
   * plugin is swapped on a live editor when the layout or the paper changes —
   * not by remounting, which would drop the document, its undo history and
   * whatever the writer had not saved yet. The two callbacks are read through
   * a ref, so a host may pass fresh closures on every render.
   */
  pageLayout?: PageLayoutOptions;
  /**
   * How footnote references are marked (1 2 3, * † ‡, i ii iii, a b c). The
   * wrapper carries it as `data-footnote-style` for the CSS counter styles.
   */
  footnoteStyle?: FootnoteMarkerStyle;
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
  /**
   * Optional. Turns on ghost text: a faint continuation after the cursor when
   * the writer pauses at the end of a paragraph. Absent, or `enabled: false`,
   * the editor behaves exactly as it always did. Read through a ref, so the
   * setting can change on a live editor without a remount.
   */
  ghostText?: GhostTextBinding;
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
const SelectionDictionaryDialog = lazy(() => import('@/engines/dictionary/SelectionDictionaryDialog'));
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
function ToolButton({ active, onClick, title, pressed, children }: {
  active?: boolean;
  onClick: () => void;
  title?: string;
  /** A toggle: announces its state to assistive technology. */
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={pressed === undefined ? undefined : title}
      aria-pressed={pressed}
      className={`p-1.5 rounded transition ${
        active ? 'bg-accent-gold/20 text-accent-gold' : 'text-text-muted hover:text-text-primary hover:bg-elevated'
      }`}
    >
      {children}
    </button>
  );
}

export default function TiptapEditor({
  content,
  onChange,
  onDocumentChange,
  placeholder,
  onAnnotate,
  onGenerateImage,
  extensions,
  onEditorReady,
  copilotIdentity,
  toolbarExtra,
  layout = 'flow',
  pageLayout,
  footnoteStyle = 'numbers',
  ghostText,
  referenceContext,
  documentOwner,prepareExternal,onExternalBlockCommit,canAcceptExternalBlock,
}: TiptapEditorProps) {
  const { t, locale } = useTranslation();
  const pane = useEnginePane();
  const editorialProjectId = referenceContext?.projectId ?? copilotIdentity?.projectId;
  const editorialEraId = pane?.projectId === editorialProjectId ? pane?.eraId : undefined;
  const blockScopeId = paneReferenceScope(referenceContext?.scopeId ?? copilotIdentity?.objectId, pane);
  const emittedHtmlRef=useRef<string|null>(null);
  const sourceEditorRef=useRef<Editor|null>(null),sourceContext=useRef<LocalToolEditorContext>({projectId:editorialProjectId??'',owner:()=>undefined});
  useLayoutEffect(()=>{sourceContext.current={projectId:editorialProjectId??'',eraId:editorialEraId,prepareExternal,acceptExternal:canAcceptExternalBlock,committed:(owner,root)=>{if(typeof documentOwner!=='function'&&typeof root.content==='string')emittedHtmlRef.current=root.content;onExternalBlockCommit?.(owner,root);},owner:(editor,position)=>typeof documentOwner==='function'?documentOwner(editor,position):documentOwner??(copilotIdentity?.kind==='writings'?{kind:'writings',documentId:copilotIdentity.objectId}:undefined)};},[editorialProjectId,editorialEraId,prepareExternal,onExternalBlockCommit,canAcceptExternalBlock,documentOwner,copilotIdentity]);
  const [sourceHost]=useState<LocalToolEditorHost>(()=>({context:()=>sourceContext.current,editor:()=>sourceEditorRef.current}));
  useEffect(()=>registerLocalToolEditor(sourceHost),[sourceHost]);
  const [codexBlockHost] = useState(() => createCodexBlockHost({ projectId: editorialProjectId, scopeId: blockScopeId }));
  useEffect(() => { codexBlockHost.setContext({ projectId: editorialProjectId, scopeId: blockScopeId }); }, [codexBlockHost, editorialProjectId, blockScopeId]);
  const mentionEntries = useLiveQuery(async () => {
    if (!editorialProjectId) return [];
    const project = await db.projects.get(editorialProjectId);
    return project?.enabledEngines.includes('codex') ? editorialEraId ? listEraRows<CodexEntry>({ projectId: editorialProjectId, eraId: editorialEraId }, 'codexEntries') : db.codexEntries.where('projectId').equals(editorialProjectId).toArray() : [];
  }, [editorialProjectId, editorialEraId]);
  const projectDictionaries = useLiveQuery(async () => {
    if (!editorialProjectId) return undefined;
    const project = editorialEraId ? await getEraProject({ projectId: editorialProjectId, eraId: editorialEraId }) : await db.projects.get(editorialProjectId);
    return project?.enabledEngines.includes('dictionary') ? project.dictionaries : undefined;
  }, [editorialProjectId, editorialEraId]);
  const entityDetectionPreferences = useLiveQuery(async () => {
    if (!editorialProjectId) return undefined;
    const project = await db.projects.get(editorialProjectId);
    return project?.enabledEngines.includes('codex') ? entityPreferences(project) : undefined;
  }, [editorialProjectId]);
  const editorialReferences = useLiveQuery<Citation[]>(async () => editorialProjectId
    ? await db.citations.where('projectId').equals(editorialProjectId).toArray()
    : [], [editorialProjectId]);
  const resolvedPlaceholder = placeholder ?? t('editor.placeholder');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<FloatingMenuState>(HIDDEN_MENU);
  const [dictionarySelection, setDictionarySelection] = useState<{ projectId: string; eraId?: string; text: string }>();
  const dictionaryEnabled = projectDictionaries !== undefined;
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [findSession, setFindSession] = useState<FindSession | null>(null);
  const reading = useAppStore((s) => s.reading);
  const loadReading = useAppStore((s) => s.loadReading);
  // A host that brings its own `doc` node (the book, whose top level holds
  // chapters as well as blocks) takes StarterKit's out of the schema: two
  // nodes of one name would both be registered, and the last one would win.
  const ownDocument = extensions?.some((extension) => extension.name === 'doc') ?? false;
  // The HTML last handed to `onChange`. The host hands it straight back as
  // `content`, and the sync effect below can skip serialising the document a
  // second time to find out that nothing came from outside.

  // Ghost text. The extension is built once with the editor, so everything it
  // asks the app goes through this host, which reads the latest binding.
  const ghostBindingRef = useRef(ghostText);
  useEffect(() => {
    ghostBindingRef.current = ghostText;
  });
  const [ghostSuggestion, setGhostSuggestion] = useState<string | null>(null);
  const [ghostHost] = useState<GhostTextHost>(() => ({
    enabled: () => Boolean(ghostBindingRef.current?.enabled),
    request: (input) => ghostBindingRef.current?.request(input) ?? Promise.resolve(null),
    onChange: setGhostSuggestion,
  }));
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false }, document: ownDocument ? false : undefined }),
      Image.configure({ allowBase64: true }),
      Placeholder.configure({ placeholder: resolvedPlaceholder }),
      GhostText.configure({ host: () => ghostHost, delayMs: GHOST_DEBOUNCE_MS }),
      ...createAdvancedExtensions(),
      ...createWritingBlockExtensions(),
      ...createRevisionExtensions(),
      ...createEditorialExtensions(),
      WikiHidden,
      WikiHiddenBlock,
      WikiSpoiler,
      CodexBlock.configure(codexBlockHost),
      MediaBlock.configure(codexBlockHost),
      ToolDocumentBlock.configure(codexBlockHost),
      SourceToolBlock.configure({host:sourceHost}),
      ...(extensions ?? []),
    ],
    content,
    onUpdate: ({ editor }) => {
      if (onChange) {
        const html = editor.getHTML();
        emittedHtmlRef.current = html;
        onChange(html);
      }
      onDocumentChange?.();
    },
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none',
      },
    },
  });

  useLayoutEffect(()=>{sourceEditorRef.current=editor;return()=>{sourceEditorRef.current=null;};},[editor]);
  useEffect(() => {
    void loadReading();
  }, [loadReading]);

  // Switching ghost text off takes a suggestion that is on screen with it.
  const ghostEnabled = Boolean(ghostText?.enabled);
  useEffect(() => {
    if (editor && !ghostEnabled && !editor.isDestroyed && ghostSuggestionOf(editor.state)) {
      editor.commands.dismissGhostText();
    }
  }, [editor, ghostEnabled]);

  // Hand the instance to the host once it exists; `null` on the way out so the
  // host never keeps a destroyed editor.
  useEffect(() => {
    if (!onEditorReady) return;
    onEditorReady(editor);
    return () => onEditorReady(null);
  }, [editor, onEditorReady]);
  const copilotProjectId = copilotIdentity?.projectId;
  useEffect(() => {
    if (!editor || editor.isDestroyed || !editorialProjectId || !projectDictionaries?.some(dictionary => dictionary.detectInManuscript)) return;
    editor.registerPlugin(createDictionaryGlossPlugin(projectDictionaries, wordId => {
      (pane?.navigate ?? navigateTo)(`/project/${encodeURIComponent(editorialProjectId)}/dictionary?entity=${encodeURIComponent(wordId)}`);
    }));
    return () => { if (!editor.isDestroyed) editor.unregisterPlugin(dictionaryGlossKey); };
  }, [editor, editorialProjectId, projectDictionaries, pane?.navigate]);
  const copilotObjectId = copilotIdentity?.objectId;
  const referenceScopeId = paneReferenceScope(referenceContext?.scopeId ?? copilotObjectId, pane);
  const referenceEntryId = referenceContext?.entryId ?? copilotObjectId;
  useEffect(() => {
    if (!editor || editor.isDestroyed || !editorialProjectId || !mentionEntries?.length) return;
    editor.registerPlugin(createInlineMentionsPlugin(mentionEntries.filter(entry => entry.id !== referenceEntryId), id => {
      const detail: OpenCodexReferenceDetail = { projectId: editorialProjectId, entryId: id, scopeId: referenceScopeId, handled: false };
      window.dispatchEvent(new CustomEvent(OPEN_CODEX_REFERENCE, { detail }));
      if (!detail.handled) (pane?.navigate ?? navigateTo)(`/project/${encodeURIComponent(editorialProjectId)}/codex?entry=${encodeURIComponent(id)}`);
    }, createGlossMatcher(projectDictionaries ?? []), entityDetectionPreferences));
    return () => { if (!editor.isDestroyed) editor.unregisterPlugin(inlineMentionsKey); };
  }, [editor, editorialProjectId, mentionEntries, referenceEntryId, referenceScopeId, projectDictionaries, pane?.navigate, entityDetectionPreferences]);
  const copilotKind = copilotIdentity?.kind;
  useEffect(() => {
    if (!editor || !copilotProjectId || !copilotObjectId || !copilotKind) return;
    return registerCopilotEditor(editor, { projectId: copilotProjectId, objectId: copilotObjectId, kind: copilotKind, paneId: pane?.instanceId });
  }, [editor, copilotProjectId, copilotObjectId, copilotKind, pane?.instanceId]);

  // Page mode is a ProseMirror plugin registered on the live editor, the way
  // the find bar registers its search plugin: the document, the history and
  // the selection stay exactly as they are when the writer switches layout
  // or paper. The plugin is rebuilt only for the paper size; the notes
  // collector and the footer label are read through the ref, so the host's
  // inline closures do not rebuild it on every render.
  const pageLayoutRef = useRef(pageLayout);
  useEffect(() => {
    pageLayoutRef.current = pageLayout;
  });
  const pageSize = pageLayout?.pageSize ?? 'a4';
  useEffect(() => {
    if (!editor || layout !== 'page') return;
    editor.registerPlugin(
      createPageLayoutPlugin({
        pageSize,
        collectNotes: (doc) => pageLayoutRef.current?.collectNotes?.(doc) ?? [],
        footerLabel: (page, total) =>
          pageLayoutRef.current?.footerLabel?.(page, total) ?? `${page} / ${total}`,
      }),
    );
    return () => {
      // The plugin view's `destroy` takes the sheet's size attributes off the
      // DOM with it; a destroyed editor has no state to reconfigure.
      if (!editor.isDestroyed) editor.unregisterPlugin(pageLayoutKey);
    };
  }, [editor, layout, pageSize]);

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
    if (content === emittedHtmlRef.current) return;
    if (editor.getHTML() !== content) {
      editor.commands.setContent(content, { emitUpdate: false });
      // What was emitted is no longer what the editor holds.
      emittedHtmlRef.current = null;
    }
  }, [content, editor]);

  // Track selection → position the floating "Annotate" button over the
  // active range. Hidden when no editor, no callback, or selection collapses.
  useEffect(() => {
    if (!editor || (!onAnnotate && !onGenerateImage && !copilotAvailable() && !dictionaryEnabled)) return;

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
  }, [editor, onAnnotate, onGenerateImage, dictionaryEnabled]);

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

  // The footnote button and its popover only make sense when the host built
  // the editor with the footnote node (the book and the chapter do; a codex
  // entry or a diary page does not).
  const hasFootnotes = Boolean(editor.schema.nodes.footnote);

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
      data-editor-layout={layout}
      data-footnote-style={footnoteStyle}
      className="tiptap-editor relative border border-border rounded-lg overflow-hidden bg-elevated"
    >
      {/* Floating selection actions over a non-empty selection. */}
      {dictionarySelection && dictionarySelection.projectId === editorialProjectId && dictionarySelection.eraId === editorialEraId && <Suspense fallback={null}><SelectionDictionaryDialog key={`${editorialProjectId}:${editorialEraId ?? 'base'}`} projectId={dictionarySelection.projectId} eraId={dictionarySelection.eraId} selection={dictionarySelection.text} onClose={() => { setDictionarySelection(undefined); editor.commands.focus(); }} /></Suspense>}
      {menu.visible && (onAnnotate || onGenerateImage || copilotAvailable() || dictionaryEnabled) && (
        <div
          className="absolute z-20 flex w-max max-w-full flex-wrap items-center justify-center gap-0.5 p-0.5 rounded-lg bg-surface border border-accent-gold/40 shadow-lg"
          style={{ top: menu.top, left: '50%', transform: 'translateX(-50%)' }}
        >
          {dictionaryEnabled && editorialProjectId && <button type="button" className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium text-accent-gold hover:bg-accent-gold hover:text-deep" onMouseDown={event => event.preventDefault()} onClick={() => {
            const { from, to } = editor.state.selection, text = editor.state.doc.textBetween(from, to, ' ', ' ');
            if (text.trim()) { setDictionarySelection({ projectId: editorialProjectId, eraId: editorialEraId, text }); setMenu(HIDDEN_MENU); }
          }}><Languages size={13} />{locale === 'es' ? 'Diccionario' : 'Dictionary'}</button>}
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
        {hasFootnotes && (
          <ToolButton
            active={editor.isActive('footnote')}
            onClick={() => editor.chain().focus().insertFootnote().run()}
            title={t('editor.insertFootnote')}
          >
            <Superscript size={16} />
          </ToolButton>
        )}
        {ghostText?.onToggle && (
          <ToolButton
            active={ghostEnabled}
            pressed={ghostEnabled}
            onClick={ghostText.onToggle}
            title={ghostEnabled ? t('editor.ghost.toggleOff') : t('editor.ghost.toggleOn')}
          >
            <Sparkles size={16} />
          </ToolButton>
        )}
        {toolbarExtra}
        <div className="flex-1" />
        <ToolButton title={t('board.tool.undo')} onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 size={16} />
        </ToolButton>
        <ToolButton title={t('board.tool.redo')} onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 size={16} />
        </ToolButton>
      </div>

      {/* Find & replace, inside the document it searches */}
      <details className="border-b border-border bg-surface/50" data-editor-advanced-disclosure>
        <summary className="w-fit cursor-pointer rounded px-3 py-2 text-xs text-text-muted hover:text-accent-gold focus-visible:outline-2 focus-visible:outline-accent-gold">{locale === 'es' ? 'Formato avanzado' : 'Advanced formatting'}</summary>
        <AdvancedEditorToolbar editor={editor} locale={locale} />
      </details>
      <RevisionControls editor={editor} locale={locale} />
      <details className="border-b border-border bg-surface/50" data-editor-document-tools>
        <summary className="w-fit cursor-pointer rounded px-3 py-2 text-xs text-text-muted hover:text-accent-gold focus-visible:outline-2 focus-visible:outline-accent-gold">{locale === 'es' ? 'Referencias y herramientas del documento' : 'References and document tools'}</summary>
      <div className="flex flex-wrap items-start gap-2 border-b border-border bg-surface/50 px-2 py-1.5">
        <div className="min-w-0 grow basis-40 has-[[aria-expanded=true]]:basis-full"><EditorialControls editor={editor} locale={locale} references={editorialReferences ?? []} /></div>
        <div className="min-w-0 grow basis-40 has-[[aria-expanded=true]]:basis-full"><HeadingNavigator editor={editor} locale={locale} /></div>
        <div className="min-w-0 grow basis-40 has-[[aria-expanded=true]]:basis-full"><ProofingControls editor={editor} locale={locale} projectId={editorialProjectId} /></div>
        <div className="min-w-0 grow basis-40"><WikiMarksControls editor={editor} locale={locale} extract={editorialProjectId ? { projectId: editorialProjectId, eraId: editorialEraId } : undefined} /></div>
        {editorialProjectId && <div className="min-w-0 grow basis-40 has-[[aria-expanded=true]]:basis-full"><CodexBlockControls editor={editor} projectId={editorialProjectId} entries={mentionEntries ?? []} locale={locale} /></div>}
        {editorialProjectId && <div className="min-w-0 grow basis-40 has-[[aria-expanded=true]]:basis-full"><MediaBlockControls editor={editor} projectId={editorialProjectId} locale={locale} /></div>}
        {editorialProjectId && <div className="min-w-0 grow basis-40 has-[[aria-expanded=true]]:basis-full"><ToolDocumentControls editor={editor} projectId={editorialProjectId} locale={locale} /></div>}
        {editorialProjectId && <div className="min-w-0 grow basis-40 has-[[aria-expanded=true]]:basis-full"><SourceToolBlockControls editor={editor} projectId={editorialProjectId} locale={locale}/></div>}
        {editorialProjectId && entityDetectionPreferences && <div className="min-w-0 basis-full"><EntityDetectionControls key={`${editorialProjectId}:${editorialEraId ?? 'base'}`} editor={editor} projectId={editorialProjectId} eraId={editorialEraId} entries={mentionEntries ?? []} preferences={entityDetectionPreferences} /></div>}
        <div className="min-w-0 grow basis-40 has-[[aria-expanded=true]]:basis-full"><DocumentTools editor={editor} locale={locale} /></div>
      </div>
      </details>
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
      <SlashMenu editor={editor} wrapperRef={wrapperRef} locale={locale} />
      <SlashToolHost editor={editor} locale={locale} projectId={editorialProjectId} eraId={editorialEraId} />
      <ImageControls editor={editor} wrapperRef={wrapperRef} locale={locale} />
      <BlockFieldControls editor={editor} wrapperRef={wrapperRef} locale={locale} />
      {/* The suggestion is drawn over the text but is not in it, so assistive
          technology is told about it here, politely: it never interrupts what
          is being typed or read. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-ghost-announcer="">
        {ghostSuggestion && ghostEnabled ? `${t('editor.ghost.announce')} ${ghostSuggestion.trim()}` : ''}
      </div>
      {hasFootnotes && <FootnoteLayer editor={editor} />}
    </div>
  );
}
