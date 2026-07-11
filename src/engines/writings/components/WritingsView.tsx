import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  Lightbulb,
  PenLine,
  CheckCircle2,
  FileText,
  ArrowLeft,
  Hash,
  Cloud,
  ExternalLink,
  ArrowRightLeft,
  Copy,
  X,
  Maximize2,
  Minimize2,
  Check,
  BookDown,
  History,
} from 'lucide-react';
import type { Writing, WritingStatus } from '@/types';
import { generateId } from '@/utils/idGenerator';
import { countWords } from '@/utils/text';
import TiptapEditor from '@/components/editor/TiptapEditor';
import TagInput from '@/components/common/TagInput';
import Modal from '@/components/common/Modal';
import EmptyState from '@/components/common/EmptyState';
import GoogleDocsPicker from './GoogleDocsPicker';
import GoogleDocBadge from './GoogleDocBadge';
import AiToolbar from './AiToolbar';
import CompileModal from './CompileModal';
import HistoryModal from './HistoryModal';
import { takeSnapshot } from '../snapshots';
import { useProject } from '@/hooks/useProjects';
import { useGoogleStore } from '@/stores/googleStore';
import { fetchGoogleDocForAi } from '@/services/googleDocs';
import { recordEditorActivity } from '@/services/writingActivity';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfirmDialog } from '@/engines/_shared';
import AnnotationSurface from '@/engines/annotations/components/AnnotationSurface';
import type { AnnotationAnchor } from '@/engines/annotations/types';
import GettingStartedChecklist from '@/components/project/GettingStartedChecklist';

const STATUS_CONFIG: Record<WritingStatus, { icon: typeof Lightbulb; color: string; bg: string }> = {
  idea: { icon: Lightbulb, color: '#d4a843', bg: 'rgba(212, 168, 67, 0.12)' },
  draft: { icon: PenLine, color: '#4a7ec4', bg: 'rgba(74, 126, 196, 0.12)' },
  finished: { icon: CheckCircle2, color: '#4a9e6d', bg: 'rgba(74, 158, 109, 0.12)' },
};

/** Debounce for the editor autosave (ms). */
const AUTOSAVE_MS = 1200;
/** Cap per-flush "active seconds" so idle pauses don't inflate session time. */
const MAX_FLUSH_SECONDS = 120;

interface WritingsViewProps {
  projectId: string;
  writings: Writing[];
  onAdd: (writing: Writing) => void;
  onEdit: (id: string, changes: Partial<Writing>) => void;
  onDelete: (id: string) => void;
  onRefresh?: () => void;
}

export default function WritingsView({ projectId, writings, onAdd, onEdit, onDelete, onRefresh }: WritingsViewProps) {
  const { t } = useTranslation();
  const statusLabel = (status: WritingStatus) => t(`writings.status.${status}`);
  const [activeStatus, setActiveStatus] = useState<WritingStatus>('draft');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [openWriting, setOpenWriting] = useState<Writing | null>(null);
  const [editedContent, setEditedContent] = useState('');
  const [editedTitle, setEditedTitle] = useState('');
  const [showGooglePicker, setShowGooglePicker] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<AnnotationAnchor | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'dirty'>('saved');
  const [showCompile, setShowCompile] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const { accessToken } = useGoogleStore();
  const { project } = useProject(projectId);

  // New writing form
  const [newTitle, setNewTitle] = useState('');
  const [newStatus, setNewStatus] = useState<WritingStatus>('draft');
  const [newSynopsis, setNewSynopsis] = useState('');
  const [newChapter, setNewChapter] = useState('');
  const [newTags, setNewTags] = useState<string[]>([]);

  // ---------------------------------------------------------------------
  // Autosave core.
  //
  // Everything the flush needs lives in a ref so the unmount cleanup and
  // window-level handlers never see stale closures. `flushSave` is
  // synchronous from the caller's perspective (persistence is fire-and-
  // forget through `onEdit`), so it's safe in unmount and beforeunload.
  // ---------------------------------------------------------------------
  const editorRef = useRef({
    openId: null as string | null,
    content: '',
    title: '',
    savedContent: '',
    savedTitle: '',
    savedWordCount: 0,
    lastFlushAt: 0,
  });

  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;

  const flushSave = useCallback(() => {
    const s = editorRef.current;
    if (!s.openId) return;
    if (s.content === s.savedContent && s.title === s.savedTitle) return;
    const wc = countWords(s.content);
    onEditRef.current(s.openId, {
      content: s.content,
      title: s.title,
      wordCount: wc,
    });
    // Feed real typing into writing-stats (goals/streaks). Fire-and-forget.
    const now = Date.now();
    const seconds = s.lastFlushAt ? Math.min(MAX_FLUSH_SECONDS, (now - s.lastFlushAt) / 1000) : 0;
    const wordsDelta = wc - s.savedWordCount;
    if (wordsDelta > 0 || seconds > 0) {
      void recordEditorActivity(projectId, wordsDelta, seconds);
    }
    s.savedContent = s.content;
    s.savedTitle = s.title;
    s.savedWordCount = wc;
    s.lastFlushAt = now;
    setSaveState('saved');
  }, [projectId]);

  // Keep the ref in sync with typed state + debounce the flush.
  useEffect(() => {
    const s = editorRef.current;
    if (!s.openId) return;
    s.content = editedContent;
    s.title = editedTitle;
    const dirty = editedContent !== s.savedContent || editedTitle !== s.savedTitle;
    if (!dirty) return;
    setSaveState('dirty');
    const timer = window.setTimeout(flushSave, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [editedContent, editedTitle, flushSave]);

  // Flush on unmount (sidebar navigation, global-search jumps, etc.).
  useEffect(() => () => flushSave(), [flushSave]);

  // Flush + warn on window close while dirty.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const s = editorRef.current;
      if (!s.openId) return;
      const dirty = s.content !== s.savedContent || s.title !== s.savedTitle;
      if (!dirty) return;
      flushSave();
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [flushSave]);

  // Ctrl/Cmd+S saves immediately; Escape exits focus mode.
  useEffect(() => {
    if (!openWriting) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        flushSave();
      } else if (e.key === 'Escape') {
        setFocusMode(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openWriting, flushSave]);

  const filtered = useMemo(
    () => writings
      .filter(w => w.status === activeStatus)
      .sort((a, b) => {
        if (a.chapter !== undefined && b.chapter !== undefined) return (a.chapter || 0) - (b.chapter || 0);
        return b.updatedAt - a.updatedAt;
      }),
    [writings, activeStatus]
  );

  const counts = useMemo(() => ({
    idea: writings.filter(w => w.status === 'idea').length,
    draft: writings.filter(w => w.status === 'draft').length,
    finished: writings.filter(w => w.status === 'finished').length,
  }), [writings]);

  const handleOpenWriting = useCallback((writing: Writing) => {
    setOpenWriting(writing);
    setEditedContent(writing.content);
    setEditedTitle(writing.title);
    setSaveState('saved');
    editorRef.current = {
      openId: writing.id,
      content: writing.content,
      title: writing.title,
      savedContent: writing.content,
      savedTitle: writing.title,
      savedWordCount: writing.wordCount || countWords(writing.content),
      lastFlushAt: Date.now(),
    };
    // Version history: one automatic restore point per editing session,
    // capturing the document as it was BEFORE this session's changes.
    if (!writing.isGoogleDoc) void takeSnapshot(writing, 'auto');
  }, []);

  const handleCloseWriting = useCallback(() => {
    flushSave();
    editorRef.current.openId = null;
    setOpenWriting(null);
    setFocusMode(false);
  }, [flushSave]);

  const handleCreate = () => {
    if (!newTitle.trim()) return;
    const writing: Writing = {
      id: generateId('wrt'),
      projectId,
      title: newTitle,
      status: newStatus,
      content: '',
      synopsis: newSynopsis || undefined,
      wordCount: 0,
      chapter: newChapter ? parseInt(newChapter) : undefined,
      tags: newTags,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    onAdd(writing);
    setNewTitle('');
    setNewStatus('draft');
    setNewSynopsis('');
    setNewChapter('');
    setNewTags([]);
    setShowCreateForm(false);
    // Straight into the editor — creating and then hunting for the new doc
    // in the list was a dead-end flow.
    handleOpenWriting(writing);
  };

  const handleSaveContent = () => {
    flushSave();
    if (!openWriting) return;
    setOpenWriting({ ...openWriting, content: editedContent, title: editedTitle, wordCount: countWords(editedContent) });
  };

  const handleStatusChange = (writingId: string, newSt: WritingStatus) => {
    onEdit(writingId, { status: newSt });
    if (openWriting?.id === writingId) {
      setOpenWriting({ ...openWriting, status: newSt });
    }
  };

  const handleDuplicate = (writing: Writing, targetStatus: WritingStatus) => {
    // eslint-disable-next-line react-hooks/purity -- click handler: runs at event time, not during render
    const now = Date.now();
    onAdd({
      ...writing,
      id: generateId('wrt'),
      status: targetStatus,
      title: `${writing.title} (copia)`,
      createdAt: now,
      updatedAt: now,
      // Strip Google Doc link from copies
      googleDocId: undefined,
      googleDocUrl: undefined,
      googleDocName: undefined,
      lastSyncedAt: undefined,
      syncDirection: undefined,
      isGoogleDoc: undefined,
    });
  };

  // Card action menu state — close on outside click
  const [cardMenuId, setCardMenuId] = useState<string | null>(null);
  const closeCardMenu = useCallback(() => setCardMenuId(null), []);
  useEffect(() => {
    if (!cardMenuId) return;
    const handler = () => closeCardMenu();
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [cardMenuId, closeCardMenu]);

  const handleSynopsisUpdate = (synopsis: string) => {
    if (!openWriting) return;
    onEdit(openWriting.id, { synopsis });
    setOpenWriting({ ...openWriting, synopsis });
  };

  const pendingDeleteWriting = pendingDeleteId ? writings.find(w => w.id === pendingDeleteId) : undefined;

  const confirmDeleteDialog = (
    <ConfirmDialog
      open={pendingDeleteId !== null}
      destructive
      message={t('writings.confirmDelete').replace('{name}', pendingDeleteWriting?.title ?? '')}
      onConfirm={() => {
        const id = pendingDeleteId;
        setPendingDeleteId(null);
        if (!id) return;
        if (openWriting?.id === id) {
          editorRef.current.openId = null; // don't autosave a deleted doc
          setOpenWriting(null);
        }
        onDelete(id);
      }}
      onCancel={() => setPendingDeleteId(null)}
    />
  );

  // ---- Google Doc Detail View ----
  if (openWriting?.isGoogleDoc) {
    const contentFetcher = accessToken && openWriting.googleDocId
      ? () => fetchGoogleDocForAi(accessToken, openWriting.googleDocId!)
      : undefined;

    return (
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleCloseWriting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-muted hover:text-text-primary transition rounded-lg hover:bg-elevated"
          >
            <ArrowLeft size={16} />
            {t('common.back')}
          </button>
          <div className="flex-1" />
          {/* Status switcher */}
          <div className="flex items-center gap-1 bg-surface border border-border rounded-lg px-1 py-0.5">
            {(Object.entries(STATUS_CONFIG) as [WritingStatus, typeof STATUS_CONFIG['idea']][]).map(([st, cfg]) => {
              const Icon = cfg.icon;
              return (
                <button
                  key={st}
                  onClick={() => handleStatusChange(openWriting.id, st)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition ${
                    openWriting.status === st ? 'font-semibold' : 'text-text-muted hover:text-text-primary'
                  }`}
                  style={openWriting.status === st ? { color: cfg.color, backgroundColor: cfg.bg } : {}}
                >
                  <Icon size={13} />
                  {statusLabel(st)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-serif font-bold text-text-primary">{openWriting.title}</h1>

        {/* Metadata */}
        <div className="flex items-center gap-4 text-xs text-text-muted">
          <GoogleDocBadge lastSyncedAt={openWriting.lastSyncedAt} googleDocUrl={openWriting.googleDocUrl} />
        </div>

        {/* Open in Google Docs */}
        <div className="flex items-center gap-3 p-4 bg-blue-500/5 border border-blue-400/20 rounded-xl">
          <Cloud size={20} className="text-blue-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-text-primary">{t('writings.gdocLivesHere')}</p>
            <p className="text-xs text-text-muted mt-0.5">{t('writings.gdocHint')}</p>
          </div>
          <a
            href={openWriting.googleDocUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-500 text-white text-sm font-semibold rounded-lg hover:bg-blue-600 transition flex-shrink-0"
          >
            {t('writings.gdocOpen')}
            <ExternalLink size={14} />
          </a>
        </div>

        {/* AI Tools */}
        <div className="space-y-2">
          <p className="text-xs text-text-dim uppercase tracking-wider font-medium">{t('writings.aiTools')}</p>
          <p className="text-xs text-text-muted">
            {t('writings.aiHint')}
          </p>
          <AiToolbar
            writing={openWriting}
            projectId={projectId}
            onSynopsisUpdate={handleSynopsisUpdate}
            contentFetcher={contentFetcher}
          />
        </div>
      </div>
    );
  }

  // ---- Writing Editor View ----
  if (openWriting) {
    const config = STATUS_CONFIG[openWriting.status];
    const StatusIcon = config.icon;
    const wc = countWords(editedContent);

    return (
      <div className={focusMode ? 'space-y-4 max-w-3xl mx-auto' : 'space-y-4'}>
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleCloseWriting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-muted hover:text-text-primary transition rounded-lg hover:bg-elevated"
          >
            <ArrowLeft size={16} />
            {t('common.back')}
          </button>

          {/* Autosave indicator */}
          <span
            className={`flex items-center gap-1 text-xs transition ${
              saveState === 'saved' ? 'text-text-dim' : 'text-accent-amber'
            }`}
            title={t('writings.autosaveHint')}
          >
            {saveState === 'saved' ? <Check size={12} /> : <PenLine size={12} />}
            {saveState === 'saved' ? t('writings.savedIndicator') : t('writings.unsavedIndicator')}
          </span>

          <div className="flex-1" />

          {!focusMode && (
            /* Status switcher */
            <div className="flex items-center gap-1 bg-surface border border-border rounded-lg px-1 py-0.5">
              {(Object.entries(STATUS_CONFIG) as [WritingStatus, typeof config][]).map(([st, cfg]) => {
                const Icon = cfg.icon;
                return (
                  <button
                    key={st}
                    onClick={() => handleStatusChange(openWriting.id, st)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition ${
                      openWriting.status === st
                        ? 'font-semibold'
                        : 'text-text-muted hover:text-text-primary'
                    }`}
                    style={openWriting.status === st ? { color: cfg.color, backgroundColor: cfg.bg } : {}}
                  >
                    <Icon size={13} />
                    {statusLabel(st)}
                  </button>
                );
              })}
            </div>
          )}

          {/* Version history */}
          <button
            onClick={() => setShowHistory(true)}
            className="p-1.5 rounded-lg transition border text-text-muted border-border hover:text-text-primary hover:bg-elevated"
            title={t('writings.history.title')}
          >
            <History size={15} />
          </button>

          {/* Focus mode toggle */}
          <button
            onClick={() => setFocusMode(!focusMode)}
            className={`p-1.5 rounded-lg transition border ${
              focusMode
                ? 'text-accent-gold border-accent-gold/40 bg-accent-gold/10'
                : 'text-text-muted border-border hover:text-text-primary hover:bg-elevated'
            }`}
            title={focusMode ? t('writings.exitFocusMode') : t('writings.focusMode')}
          >
            {focusMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>

          <button
            onClick={handleSaveContent}
            className="px-4 py-1.5 bg-accent-gold text-deep font-semibold text-sm rounded-lg hover:bg-accent-amber transition"
            title="Ctrl+S"
          >
            {t('writings.save')}
          </button>
        </div>

        {/* Title */}
        <input
          value={editedTitle}
          onChange={(e) => setEditedTitle(e.target.value)}
          className="w-full text-2xl font-serif font-bold bg-transparent border-none outline-none text-text-primary placeholder:text-text-dim"
          placeholder={t('writings.untitled')}
        />

        {/* Word count, chapter & Google Doc badge */}
        <div className="flex items-center gap-4 text-xs text-text-muted">
          <span>{wc.toLocaleString()} {t('writings.words')}</span>
          {openWriting.chapter !== undefined && (
            <span className="flex items-center gap-1">
              <Hash size={12} />
              {t('writings.chapter')} {openWriting.chapter}
            </span>
          )}
          <span>
            <StatusIcon size={12} className="inline mr-1" style={{ color: config.color }} />
            {statusLabel(openWriting.status)}
          </span>
          {openWriting.isGoogleDoc && (
            <GoogleDocBadge
              lastSyncedAt={openWriting.lastSyncedAt}
              googleDocUrl={openWriting.googleDocUrl}
            />
          )}
        </div>

        {/* AI Toolbar — hidden in focus mode */}
        {!focusMode && (
          <AiToolbar
            writing={{ ...openWriting, content: editedContent }}
            projectId={projectId}
            onSynopsisUpdate={handleSynopsisUpdate}
          />
        )}

        {/* Editor + Margin notes */}
        {focusMode ? (
          <TiptapEditor
            content={editedContent}
            onChange={setEditedContent}
            placeholder={t('writings.startWriting')}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
            <TiptapEditor
              content={editedContent}
              onChange={setEditedContent}
              placeholder={t('writings.startWriting')}
              onAnnotate={(anchor) => setPendingAnchor(anchor)}
            />
            <AnnotationSurface
              projectId={projectId}
              engineId="writings"
              entityId={openWriting.id}
              layout="sidebar"
              pendingAnchor={pendingAnchor}
              onPendingAnchorConsumed={() => setPendingAnchor(null)}
            />
          </div>
        )}

        {/* Version history */}
        <HistoryModal
          open={showHistory}
          onClose={() => setShowHistory(false)}
          writing={openWriting}
          currentContent={editedContent}
          currentTitle={editedTitle}
          onRestored={({ title, content, wordCount }) => {
            setEditedTitle(title);
            setEditedContent(content);
            setOpenWriting({ ...openWriting, title, content, wordCount });
            editorRef.current = {
              ...editorRef.current,
              content,
              title,
              savedContent: content,
              savedTitle: title,
              savedWordCount: wordCount,
            };
            setSaveState('saved');
            setShowHistory(false);
          }}
        />

        {confirmDeleteDialog}
      </div>
    );
  }

  // ---- List View ----
  return (
    <div className="space-y-5">
      {/* Getting Started checklist — auto-hides outside essentials mode */}
      <GettingStartedChecklist projectId={projectId} />

      {/* Status tabs */}
      <div className="flex items-center gap-2">
        {(Object.entries(STATUS_CONFIG) as [WritingStatus, typeof STATUS_CONFIG['idea']][]).map(([st, cfg]) => {
          const Icon = cfg.icon;
          return (
            <button
              key={st}
              onClick={() => setActiveStatus(st)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm transition ${
                activeStatus === st
                  ? 'font-semibold border'
                  : 'text-text-muted hover:text-text-primary hover:bg-elevated border border-transparent'
              }`}
              style={activeStatus === st ? { color: cfg.color, backgroundColor: cfg.bg, borderColor: `${cfg.color}30` } : {}}
            >
              <Icon size={16} />
              {statusLabel(st)}
              <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${
                activeStatus === st ? 'opacity-80' : 'bg-elevated'
              }`}>
                {counts[st]}
              </span>
            </button>
          );
        })}

        <div className="flex-1" />

        <button
          onClick={() => setShowCompile(true)}
          className="flex items-center gap-1.5 px-3 py-2 border border-border text-text-muted text-sm rounded-lg hover:text-accent-gold hover:border-accent-gold/40 transition"
          title={t('writings.compile.hint')}
        >
          <BookDown size={16} />
          {t('writings.compile.button')}
        </button>

        <button
          onClick={() => setShowGooglePicker(true)}
          className="flex items-center gap-1.5 px-3 py-2 border border-border text-text-muted text-sm rounded-lg hover:text-blue-400 hover:border-blue-400/30 transition"
        >
          <Cloud size={16} />
          {t('writings.googleDocs')}
        </button>

        <button
          onClick={() => { setNewStatus(activeStatus); setShowCreateForm(true); }}
          className="flex items-center gap-1.5 px-4 py-2 bg-accent-gold text-deep font-semibold text-sm rounded-lg hover:bg-accent-amber transition"
        >
          <Plus size={16} />
          {t('writings.newWriting')}
        </button>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<FileText size={40} />}
          title={
            activeStatus === 'idea'
              ? t('writings.noIdeas')
              : activeStatus === 'draft'
              ? t('writings.noDrafts')
              : t('writings.noFinished')
          }
          message={
            activeStatus === 'idea'
              ? t('writings.noIdeas.message')
              : activeStatus === 'draft'
              ? t('writings.noDrafts.message')
              : t('writings.noFinished.message')
          }
          action={{ label: t('writings.createOne'), onClick: () => { setNewStatus(activeStatus); setShowCreateForm(true); } }}
        />
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {filtered.map((writing, i) => {
              const cfg = STATUS_CONFIG[writing.status];
              return (
                <motion.button
                  key={writing.id}
                  onClick={() => handleOpenWriting(writing)}
                  className="w-full text-left p-4 bg-surface border border-border rounded-xl hover:border-accent-gold/40 transition group flex items-start gap-4"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                >
                  {/* Chapter number or icon */}
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: cfg.bg }}>
                    {writing.chapter !== undefined ? (
                      <span className="font-serif font-bold text-sm" style={{ color: cfg.color }}>
                        {writing.chapter}
                      </span>
                    ) : (
                      <cfg.icon size={18} style={{ color: cfg.color }} />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="font-serif font-bold text-text-primary group-hover:text-accent-gold transition truncate">
                      {writing.title}
                    </h3>
                    <div className="flex items-center gap-3 mt-1">
                      {writing.synopsis && (
                        <p className="text-xs text-text-muted truncate max-w-xs">{writing.synopsis}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <span className="text-[10px] text-text-dim">
                        {writing.wordCount.toLocaleString()} {t('writings.words')}
                      </span>
                      <span className="text-[10px] text-text-dim">
                        {t('writings.updated')} {new Date(writing.updatedAt).toLocaleDateString()}
                      </span>
                      {writing.isGoogleDoc && (
                        <GoogleDocBadge compact />
                      )}
                      {writing.tags.length > 0 && (
                        <div className="flex gap-1">
                          {writing.tags.filter(t => t !== 'google-doc').slice(0, 3).map(tag => (
                            <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-elevated rounded text-text-dim">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setCardMenuId(cardMenuId === writing.id ? null : writing.id);
                      }}
                      className="p-1.5 hover:bg-elevated rounded-lg transition"
                      title={t('writings.moveOrCopy')}
                    >
                      <ArrowRightLeft size={14} className="text-text-muted" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setPendingDeleteId(writing.id); }}
                      className="p-1.5 hover:bg-danger/20 rounded-lg transition"
                      title={t('common.delete')}
                    >
                      <Trash2 size={14} className="text-danger" />
                    </button>

                    {/* Status action popover */}
                    {cardMenuId === writing.id && (
                      <div
                        className="absolute right-0 top-full mt-2 z-50 bg-surface border border-border/80 rounded-2xl shadow-2xl w-64 overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 pt-3 pb-2">
                          <span className="text-xs font-semibold text-text-primary">{t('writings.moveOrCopy')}</span>
                          <button
                            onClick={() => setCardMenuId(null)}
                            className="p-1 hover:bg-elevated rounded-lg transition"
                          >
                            <X size={12} className="text-text-dim" />
                          </button>
                        </div>

                        {/* Move section */}
                        <div className="px-4 pb-3">
                          <p className="text-[10px] uppercase tracking-widest text-text-dim font-semibold mb-2">
                            <ArrowRightLeft size={10} className="inline mr-1 -mt-px" />
                            {t('writings.moveTo')}
                          </p>
                          <div className="grid grid-cols-3 gap-1.5">
                            {(Object.entries(STATUS_CONFIG) as [WritingStatus, typeof STATUS_CONFIG['idea']][]).map(([st, stCfg]) => {
                              const StIcon = stCfg.icon;
                              const isCurrent = writing.status === st;
                              return (
                                <button
                                  key={st}
                                  disabled={isCurrent}
                                  onClick={() => {
                                    handleStatusChange(writing.id, st);
                                    setCardMenuId(null);
                                  }}
                                  className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl text-[11px] transition ${
                                    isCurrent
                                      ? 'font-semibold ring-1'
                                      : 'text-text-muted hover:bg-elevated'
                                  }`}
                                  style={isCurrent
                                    ? { color: stCfg.color, backgroundColor: stCfg.bg, boxShadow: `inset 0 0 0 1px ${stCfg.color}40` }
                                    : {}
                                  }
                                >
                                  <StIcon size={16} />
                                  {statusLabel(st)}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Divider */}
                        <div className="border-t border-border/60 mx-4" />

                        {/* Copy section */}
                        <div className="px-4 pt-3 pb-4">
                          <p className="text-[10px] uppercase tracking-widest text-text-dim font-semibold mb-2">
                            <Copy size={10} className="inline mr-1 -mt-px" />
                            {t('writings.copyTo')}
                          </p>
                          <div className="grid grid-cols-3 gap-1.5">
                            {(Object.entries(STATUS_CONFIG) as [WritingStatus, typeof STATUS_CONFIG['idea']][]).map(([st, stCfg]) => {
                              const StIcon = stCfg.icon;
                              return (
                                <button
                                  key={st}
                                  onClick={() => {
                                    handleDuplicate(writing, st);
                                    setCardMenuId(null);
                                  }}
                                  className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl text-[11px] text-text-muted hover:bg-elevated transition"
                                >
                                  <StIcon size={16} />
                                  {statusLabel(st)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Create Modal */}
      <Modal open={showCreateForm} onClose={() => setShowCreateForm(false)} title={t('writings.newWriting')}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('common.title')}</label>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={t('writings.titlePlaceholder')}
              className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition font-serif text-lg"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            />
          </div>

          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('writings.category')}</label>
            <div className="flex gap-2">
              {(Object.entries(STATUS_CONFIG) as [WritingStatus, typeof STATUS_CONFIG['idea']][]).map(([st, cfg]) => {
                const Icon = cfg.icon;
                return (
                  <button
                    key={st}
                    onClick={() => setNewStatus(st)}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm transition border ${
                      newStatus === st
                        ? 'font-semibold'
                        : 'border-border text-text-muted hover:text-text-primary'
                    }`}
                    style={newStatus === st ? { color: cfg.color, backgroundColor: cfg.bg, borderColor: `${cfg.color}30` } : {}}
                  >
                    <Icon size={16} />
                    {statusLabel(st)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-muted mb-1.5">{t('writings.chapterOptional')}</label>
              <input
                value={newChapter}
                onChange={(e) => setNewChapter(e.target.value.replace(/\D/g, ''))}
                placeholder={t('writings.chapterExample')}
                className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
              />
            </div>
            <div>
              <label className="block text-sm text-text-muted mb-1.5">{t('writings.synopsisOptional')}</label>
              <input
                value={newSynopsis}
                onChange={(e) => setNewSynopsis(e.target.value)}
                placeholder={t('writings.synopsisPlaceholder')}
                className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('common.tags')}</label>
            <TagInput tags={newTags} onChange={setNewTags} />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleCreate}
              className="flex-1 py-2.5 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-amber transition"
            >
              {t('common.create')}
            </button>
            <button
              onClick={() => setShowCreateForm(false)}
              className="px-6 py-2.5 border border-border text-text-muted rounded-lg hover:bg-elevated transition"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Google Docs Picker */}
      <GoogleDocsPicker
        open={showGooglePicker}
        onClose={() => setShowGooglePicker(false)}
        projectId={projectId}
        existingWritings={writings}
        onImported={() => {
          onRefresh?.();
        }}
      />

      {/* Compile / Export manuscript */}
      <CompileModal
        open={showCompile}
        onClose={() => setShowCompile(false)}
        writings={writings.filter(w => !w.isGoogleDoc)}
        projectTitle={project?.title || t('writings.compile.untitledProject')}
      />

      {confirmDeleteDialog}
    </div>
  );
}
