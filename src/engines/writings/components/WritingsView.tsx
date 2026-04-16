import { useState, useMemo, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import type { Writing, WritingStatus } from '@/types';
import { generateId } from '@/utils/idGenerator';
import TiptapEditor from '@/components/editor/TiptapEditor';
import TagInput from '@/components/common/TagInput';
import Modal from '@/components/common/Modal';
import EmptyState from '@/components/common/EmptyState';
import GoogleDocsPicker from './GoogleDocsPicker';
import GoogleDocBadge from './GoogleDocBadge';
import AiToolbar from './AiToolbar';
import { useGoogleStore } from '@/stores/googleStore';
import { fetchGoogleDocForAi } from '@/services/googleDocs';

const STATUS_CONFIG: Record<WritingStatus, { icon: typeof Lightbulb; label: string; labelEs: string; color: string; bg: string }> = {
  idea: { icon: Lightbulb, label: 'Ideas', labelEs: 'Ideas', color: '#d4a843', bg: 'rgba(212, 168, 67, 0.12)' },
  draft: { icon: PenLine, label: 'Drafts', labelEs: 'Borradores', color: '#4a7ec4', bg: 'rgba(74, 126, 196, 0.12)' },
  finished: { icon: CheckCircle2, label: 'Finished', labelEs: 'Terminados', color: '#4a9e6d', bg: 'rgba(74, 158, 109, 0.12)' },
};

function countWords(html: string): number {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return 0;
  return text.split(' ').length;
}

interface WritingsViewProps {
  projectId: string;
  writings: Writing[];
  onAdd: (writing: Writing) => void;
  onEdit: (id: string, changes: Partial<Writing>) => void;
  onDelete: (id: string) => void;
  onRefresh?: () => void;
}

export default function WritingsView({ projectId, writings, onAdd, onEdit, onDelete, onRefresh }: WritingsViewProps) {
  const [activeStatus, setActiveStatus] = useState<WritingStatus>('draft');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [openWriting, setOpenWriting] = useState<Writing | null>(null);
  const [editedContent, setEditedContent] = useState('');
  const [editedTitle, setEditedTitle] = useState('');
  const [showGooglePicker, setShowGooglePicker] = useState(false);

  const { accessToken } = useGoogleStore();

  // New writing form
  const [newTitle, setNewTitle] = useState('');
  const [newStatus, setNewStatus] = useState<WritingStatus>('draft');
  const [newSynopsis, setNewSynopsis] = useState('');
  const [newChapter, setNewChapter] = useState('');
  const [newTags, setNewTags] = useState<string[]>([]);

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

  const handleCreate = () => {
    if (!newTitle.trim()) return;
    onAdd({
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
    });
    setNewTitle('');
    setNewStatus('draft');
    setNewSynopsis('');
    setNewChapter('');
    setNewTags([]);
    setShowCreateForm(false);
  };

  const handleOpenWriting = (writing: Writing) => {
    setOpenWriting(writing);
    setEditedContent(writing.content);
    setEditedTitle(writing.title);
  };

  const handleSaveContent = () => {
    if (!openWriting) return;
    const wc = countWords(editedContent);
    onEdit(openWriting.id, {
      content: editedContent,
      title: editedTitle,
      wordCount: wc,
    });
    setOpenWriting({ ...openWriting, content: editedContent, title: editedTitle, wordCount: wc });
  };

  const handleStatusChange = (writingId: string, newSt: WritingStatus) => {
    onEdit(writingId, { status: newSt });
    if (openWriting?.id === writingId) {
      setOpenWriting({ ...openWriting, status: newSt });
    }
  };

  const handleDuplicate = (writing: Writing, targetStatus: WritingStatus) => {
    onAdd({
      ...writing,
      id: generateId('wrt'),
      status: targetStatus,
      title: `${writing.title} (copia)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
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

  // ---- Google Doc Detail View ----
  if (openWriting?.isGoogleDoc) {
    const config = STATUS_CONFIG[openWriting.status];

    const contentFetcher = accessToken && openWriting.googleDocId
      ? () => fetchGoogleDocForAi(accessToken, openWriting.googleDocId!)
      : undefined;

    return (
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => setOpenWriting(null)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-muted hover:text-text-primary transition rounded-lg hover:bg-elevated"
          >
            <ArrowLeft size={16} />
            Back
          </button>
          <div className="flex-1" />
          {/* Status switcher */}
          <div className="flex items-center gap-1 bg-surface border border-border rounded-lg px-1 py-0.5">
            {(Object.entries(STATUS_CONFIG) as [WritingStatus, typeof config][]).map(([st, cfg]) => {
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
                  {cfg.labelEs}
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
            <p className="text-sm font-medium text-text-primary">El contenido vive en Google Docs</p>
            <p className="text-xs text-text-muted mt-0.5">Escribe ahí y usa las herramientas de IA aquí abajo para analizarlo.</p>
          </div>
          <a
            href={openWriting.googleDocUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-500 text-white text-sm font-semibold rounded-lg hover:bg-blue-600 transition flex-shrink-0"
          >
            Abrir
            <ExternalLink size={14} />
          </a>
        </div>

        {/* AI Tools */}
        <div className="space-y-2">
          <p className="text-xs text-text-dim uppercase tracking-wider font-medium">Herramientas IA</p>
          <p className="text-xs text-text-muted">
            Al hacer clic, Claude cargará el documento desde Google Docs y lo analizará.
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
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => { handleSaveContent(); setOpenWriting(null); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-muted hover:text-text-primary transition rounded-lg hover:bg-elevated"
          >
            <ArrowLeft size={16} />
            Back
          </button>
          <div className="flex-1" />

          {/* Status switcher */}
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
                  {cfg.labelEs}
                </button>
              );
            })}
          </div>

          <button
            onClick={handleSaveContent}
            className="px-4 py-1.5 bg-accent-gold text-deep font-semibold text-sm rounded-lg hover:bg-accent-amber transition"
          >
            Save
          </button>
        </div>

        {/* Title */}
        <input
          value={editedTitle}
          onChange={(e) => setEditedTitle(e.target.value)}
          className="w-full text-2xl font-serif font-bold bg-transparent border-none outline-none text-text-primary placeholder:text-text-dim"
          placeholder="Untitled writing..."
        />

        {/* Word count, chapter & Google Doc badge */}
        <div className="flex items-center gap-4 text-xs text-text-muted">
          <span>{wc.toLocaleString()} words</span>
          {openWriting.chapter !== undefined && (
            <span className="flex items-center gap-1">
              <Hash size={12} />
              Chapter {openWriting.chapter}
            </span>
          )}
          <span>
            <StatusIcon size={12} className="inline mr-1" style={{ color: config.color }} />
            {config.labelEs}
          </span>
          {openWriting.isGoogleDoc && (
            <GoogleDocBadge
              lastSyncedAt={openWriting.lastSyncedAt}
              googleDocUrl={openWriting.googleDocUrl}
            />
          )}
        </div>

        {/* AI Toolbar */}
        <AiToolbar
          writing={{ ...openWriting, content: editedContent }}
          projectId={projectId}
          onSynopsisUpdate={handleSynopsisUpdate}
        />

        {/* Editor */}
        <TiptapEditor
          content={editedContent}
          onChange={setEditedContent}
          placeholder="Start writing your story..."
        />
      </div>
    );
  }

  // ---- List View ----
  return (
    <div className="space-y-5">
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
              {cfg.labelEs}
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
          onClick={() => setShowGooglePicker(true)}
          className="flex items-center gap-1.5 px-3 py-2 border border-border text-text-muted text-sm rounded-lg hover:text-blue-400 hover:border-blue-400/30 transition"
        >
          <Cloud size={16} />
          Google Docs
        </button>

        <button
          onClick={() => { setNewStatus(activeStatus); setShowCreateForm(true); }}
          className="flex items-center gap-1.5 px-4 py-2 bg-accent-gold text-deep font-semibold text-sm rounded-lg hover:bg-accent-amber transition"
        >
          <Plus size={16} />
          New Writing
        </button>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<FileText size={40} />}
          title={`No ${STATUS_CONFIG[activeStatus].labelEs.toLowerCase()}`}
          message={
            activeStatus === 'idea'
              ? 'Capture fleeting ideas before they escape. Quick notes, what-ifs, sparks.'
              : activeStatus === 'draft'
              ? 'Your works in progress live here. Start writing and shape your stories.'
              : 'Completed works you\'re proud of. Move drafts here when they\'re done.'
          }
          action={{ label: 'Create One', onClick: () => { setNewStatus(activeStatus); setShowCreateForm(true); } }}
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
                        {writing.wordCount.toLocaleString()} words
                      </span>
                      <span className="text-[10px] text-text-dim">
                        Updated {new Date(writing.updatedAt).toLocaleDateString()}
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
                      title="Mover o copiar"
                    >
                      <ArrowRightLeft size={14} className="text-text-muted" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(writing.id); }}
                      className="p-1.5 hover:bg-danger/20 rounded-lg transition"
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
                          <span className="text-xs font-semibold text-text-primary">Mover o copiar</span>
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
                            Mover a
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
                                    ? { color: stCfg.color, backgroundColor: stCfg.bg, ringColor: `${stCfg.color}40` }
                                    : {}
                                  }
                                >
                                  <StIcon size={16} />
                                  {stCfg.labelEs}
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
                            Copiar a
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
                                  {stCfg.labelEs}
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
      <Modal open={showCreateForm} onClose={() => setShowCreateForm(false)} title="New Writing">
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-text-muted mb-1.5">Title</label>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Chapter title, idea name..."
              className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition font-serif text-lg"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            />
          </div>

          <div>
            <label className="block text-sm text-text-muted mb-1.5">Category</label>
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
                    {cfg.labelEs}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-muted mb-1.5">Chapter # (optional)</label>
              <input
                value={newChapter}
                onChange={(e) => setNewChapter(e.target.value.replace(/\D/g, ''))}
                placeholder="e.g. 1"
                className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
              />
            </div>
            <div>
              <label className="block text-sm text-text-muted mb-1.5">Synopsis (optional)</label>
              <input
                value={newSynopsis}
                onChange={(e) => setNewSynopsis(e.target.value)}
                placeholder="Brief summary..."
                className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-text-muted mb-1.5">Tags</label>
            <TagInput tags={newTags} onChange={setNewTags} />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleCreate}
              className="flex-1 py-2.5 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-amber transition"
            >
              Create
            </button>
            <button
              onClick={() => setShowCreateForm(false)}
              className="px-6 py-2.5 border border-border text-text-muted rounded-lg hover:bg-elevated transition"
            >
              Cancel
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
    </div>
  );
}
