import { useState } from 'react';
import { Plus, Search, User, MapPin, Sword, Shield, Sparkles, HelpCircle, Image as ImageIcon, X } from 'lucide-react';
import type { CodexEntry, CodexEntryType, InspirationImage } from '@/types';
import Modal from '@/components/common/Modal';
import CodexEntryForm from './CodexEntryForm';
import EmptyState from '@/components/common/EmptyState';
import { useTranslation } from '@/i18n/useTranslation';

const typeIcons: Record<CodexEntryType, typeof User> = {
  character: User,
  location: MapPin,
  item: Sword,
  faction: Shield,
  concept: Sparkles,
  magic: Sparkles,
  custom: HelpCircle,
};

const typeColors: Record<CodexEntryType, string> = {
  character: '#c4973b',
  location: '#4a9e6d',
  item: '#4a7ec4',
  faction: '#c4463a',
  concept: '#7c5cbf',
  magic: '#d4a843',
  custom: '#8a8690',
};

interface CodexEntryListProps {
  projectId: string;
  entries: CodexEntry[];
  images?: InspirationImage[];
  onAdd: (entry: CodexEntry) => void;
  onEdit: (id: string, changes: Partial<CodexEntry>) => void;
  onDelete: (id: string) => void;
}

export default function CodexEntryList({ projectId, entries, images = [], onAdd, onEdit, onDelete }: CodexEntryListProps) {
  const { t } = useTranslation();
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editEntry, setEditEntry] = useState<CodexEntry | null>(null);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<CodexEntryType | 'all'>('all');
  const [selectedEntry, setSelectedEntry] = useState<CodexEntry | null>(null);

  const filtered = entries.filter(e => {
    const matchesSearch = e.title.toLowerCase().includes(search.toLowerCase());
    const matchesType = filterType === 'all' || e.type === filterType;
    return matchesSearch && matchesType;
  });

  const types: (CodexEntryType | 'all')[] = ['all', 'character', 'location', 'item', 'faction', 'concept', 'magic', 'custom'];

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px] relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('codex.searchEntries')}
            className="w-full pl-9 pr-4 py-2 bg-elevated border border-border rounded-lg text-text-primary text-sm outline-none focus:border-accent-gold transition"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {types.map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-2.5 py-1.5 rounded-lg text-xs capitalize transition ${
                filterType === t
                  ? 'bg-accent-gold/20 text-accent-gold'
                  : 'text-text-muted hover:text-text-primary hover:bg-elevated'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-accent-gold text-deep font-semibold text-sm rounded-lg hover:bg-accent-amber transition"
        >
          <Plus size={16} />
          {t('codex.newEntry')}
        </button>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<User size={40} />}
          title={t('codex.noEntries.title')}
          message={t('codex.noEntries.message')}
          action={{ label: t('codex.createEntry'), onClick: () => setShowForm(true) }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(entry => {
            const Icon = typeIcons[entry.type] || HelpCircle;
            const color = typeColors[entry.type];
            return (
              <button
                key={entry.id}
                onClick={() => setSelectedEntry(entry)}
                className="text-left p-4 bg-surface border border-border rounded-xl hover:border-accent-gold/40 transition group"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${color}20` }}>
                    {entry.avatar ? (
                      <img src={entry.avatar} alt="" className="w-10 h-10 rounded-lg object-cover" />
                    ) : (
                      <Icon size={20} style={{ color }} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-serif font-bold text-text-primary group-hover:text-accent-gold transition truncate">
                      {entry.title}
                    </h3>
                    <p className="text-xs capitalize mt-0.5" style={{ color }}>{entry.type}</p>
                    {entry.tags.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {entry.tags.slice(0, 3).map(tag => (
                          <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-elevated rounded text-text-dim">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal open={showForm || !!editEntry} onClose={() => { setShowForm(false); setEditEntry(null); }} title={editEntry ? t('codex.editEntry') : t('codex.newCodexEntry')} wide>
        <CodexEntryForm
          projectId={projectId}
          entry={editEntry || undefined}
          onSave={(entry) => {
            if (editEntry) {
              onEdit(entry.id, entry);
            } else {
              onAdd(entry);
            }
            setShowForm(false);
            setEditEntry(null);
          }}
          onCancel={() => { setShowForm(false); setEditEntry(null); }}
        />
      </Modal>

      {/* Detail View Modal */}
      <Modal open={!!selectedEntry} onClose={() => setSelectedEntry(null)} title={selectedEntry?.title} wide>
        {selectedEntry && (
          <div className="space-y-4">
            <div className="flex items-start gap-4 mb-4">
              {selectedEntry.avatar && (
                <img src={selectedEntry.avatar} alt="" className="w-24 h-24 rounded-xl object-cover border border-border flex-shrink-0" />
              )}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs capitalize px-2 py-1 rounded" style={{ backgroundColor: `${typeColors[selectedEntry.type]}20`, color: typeColors[selectedEntry.type] }}>
                  {selectedEntry.type}
                </span>
                {selectedEntry.tags.map(tag => (
                  <span key={tag} className="text-xs px-2 py-1 bg-elevated rounded text-text-muted">
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Fields */}
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(selectedEntry.fields).filter(([, v]) => v).map(([key, value]) => (
                <div key={key} className="p-3 bg-elevated rounded-lg">
                  <div className="text-xs text-text-muted mb-1 capitalize">{key.replace(/([A-Z])/g, ' $1')}</div>
                  <div className="text-sm text-text-primary">{value}</div>
                </div>
              ))}
            </div>

            {/* Content */}
            {selectedEntry.content && (
              <div className="tiptap-editor border border-border rounded-lg p-4 bg-elevated">
                <div dangerouslySetInnerHTML={{ __html: selectedEntry.content }} />
              </div>
            )}

            {/* Linked Images Gallery */}
            {(() => {
              const entryImages = images.filter(img =>
                (img.linkedEntryIds || []).includes(selectedEntry.id)
              );
              if (entryImages.length === 0) return null;
              return (
                <div>
                  <h4 className="flex items-center gap-2 text-sm font-semibold text-text-primary mb-3">
                    <ImageIcon size={14} className="text-accent-gold" />
                    {t('codex.gallery')} ({entryImages.length})
                  </h4>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                    {entryImages.map(img => (
                      <button
                        key={img.id}
                        onClick={() => setLightboxSrc(img.imageData)}
                        className="aspect-square rounded-lg overflow-hidden border border-border hover:border-accent-gold/40 transition"
                      >
                        <img src={img.imageData} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => { setSelectedEntry(null); setEditEntry(selectedEntry); }}
                className="flex-1 py-2.5 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-amber transition"
              >
                {t('common.edit')}
              </button>
              <button
                onClick={() => { onDelete(selectedEntry.id); setSelectedEntry(null); }}
                className="px-6 py-2.5 border border-danger/50 text-danger rounded-lg hover:bg-danger/10 transition"
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Image lightbox */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setLightboxSrc(null)}
        >
          <button className="absolute top-4 right-4 p-2 bg-white/10 rounded-full hover:bg-white/20 transition">
            <X size={24} className="text-white" />
          </button>
          <img
            src={lightboxSrc}
            alt=""
            className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
