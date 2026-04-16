import { useState } from 'react';
import { Plus, Trash2, ExternalLink as LinkIcon, Play, FileText, Instagram, Globe } from 'lucide-react';
import type { ExternalLink, ExternalLinkType } from '@/types';
import { generateId } from '@/utils/idGenerator';
import Modal from '@/components/common/Modal';
import EmptyState from '@/components/common/EmptyState';
import { useTranslation } from '@/i18n/useTranslation';

const typeConfig: Record<ExternalLinkType, { icon: typeof LinkIcon; color: string; label: string }> = {
  youtube: { icon: Play, color: '#c4463a', label: 'YouTube' },
  'google-doc': { icon: FileText, color: '#4a7ec4', label: 'Google Doc' },
  instagram: { icon: Instagram, color: '#7c5cbf', label: 'Instagram' },
  pinterest: { icon: Globe, color: '#c4463a', label: 'Pinterest' },
  spotify: { icon: Play, color: '#4a9e6d', label: 'Spotify' },
  'word-file': { icon: FileText, color: '#4a7ec4', label: 'Word Doc' },
  other: { icon: Globe, color: '#8a8690', label: 'Link' },
};

function detectLinkType(url: string): ExternalLinkType {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('docs.google.com')) return 'google-doc';
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('pinterest.com')) return 'pinterest';
  if (url.includes('spotify.com')) return 'spotify';
  return 'other';
}

function getYouTubeEmbedUrl(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  return match ? `https://www.youtube.com/embed/${match[1]}` : null;
}

interface ExternalLinksViewProps {
  projectId: string;
  links: ExternalLink[];
  onAdd: (link: ExternalLink) => void;
  onDelete: (id: string) => void;
}

export default function ExternalLinksView({ projectId, links, onAdd, onDelete }: ExternalLinksViewProps) {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ url: '', title: '', notes: '' });
  const [expandedYT, setExpandedYT] = useState<string | null>(null);

  const handleAdd = () => {
    if (!form.url.trim() || !form.title.trim()) return;
    const type = detectLinkType(form.url);
    onAdd({
      id: generateId('link'),
      projectId,
      type,
      url: form.url,
      title: form.title,
      notes: form.notes,
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setForm({ url: '', title: '', notes: '' });
    setShowForm(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-serif font-bold text-accent-gold">{t('links.title')}</h3>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-accent-gold text-deep font-semibold text-sm rounded-lg hover:bg-accent-amber transition"
        >
          <Plus size={16} /> {t('links.addLink')}
        </button>
      </div>

      {links.length === 0 ? (
        <EmptyState
          icon={<LinkIcon size={40} />}
          title={t('links.empty.title')}
          message={t('links.empty.message')}
          action={{ label: t('links.addLink'), onClick: () => setShowForm(true) }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {links.map(link => {
            const config = typeConfig[link.type] || typeConfig.other;
            const Icon = config.icon;
            const embedUrl = link.type === 'youtube' ? getYouTubeEmbedUrl(link.url) : null;

            return (
              <div key={link.id} className="bg-surface border border-border rounded-xl overflow-hidden hover:border-accent-gold/30 transition group">
                {/* YouTube embed */}
                {expandedYT === link.id && embedUrl && (
                  <div className="aspect-video">
                    <iframe
                      src={embedUrl}
                      className="w-full h-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope"
                      allowFullScreen
                    />
                  </div>
                )}

                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${config.color}20` }}>
                      <Icon size={18} style={{ color: config.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-serif font-bold text-text-primary group-hover:text-accent-gold transition truncate">
                        {link.title}
                      </h4>
                      <p className="text-xs text-text-muted truncate">{link.url}</p>
                      {link.notes && <p className="text-xs text-text-dim mt-1 line-clamp-2">{link.notes}</p>}
                    </div>
                    <div className="flex items-center gap-1">
                      {link.type === 'youtube' && embedUrl && (
                        <button
                          onClick={() => setExpandedYT(expandedYT === link.id ? null : link.id)}
                          className="p-1.5 hover:bg-elevated rounded transition"
                          title={t('links.togglePlayer')}
                        >
                          <Play size={14} className="text-yarn-red" />
                        </button>
                      )}
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 hover:bg-elevated rounded transition"
                        title={t('links.openLink')}
                      >
                        <LinkIcon size={14} className="text-text-muted" />
                      </a>
                      <button
                        onClick={() => onDelete(link.id)}
                        className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-danger/20 rounded transition"
                      >
                        <Trash2 size={14} className="text-danger" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Link Modal */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title={t('links.addModal.title')}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('common.url')}</label>
            <input
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder={t('links.urlPlaceholder')}
              className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
              autoFocus
            />
            {form.url && (
              <span className="text-xs mt-1 inline-block px-2 py-0.5 rounded" style={{ color: typeConfig[detectLinkType(form.url)]?.color, backgroundColor: `${typeConfig[detectLinkType(form.url)]?.color}15` }}>
                {t('links.detected')} {typeConfig[detectLinkType(form.url)]?.label}
              </span>
            )}
          </div>
          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('common.title')}</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={t('links.titlePlaceholder')}
              className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
            />
          </div>
          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('common.notes')}</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder={t('links.notesPlaceholder')}
              rows={2}
              className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition resize-none"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={handleAdd} className="flex-1 py-2.5 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-amber transition">
              {t('links.addLink')}
            </button>
            <button onClick={() => setShowForm(false)} className="px-6 py-2.5 border border-border text-text-muted rounded-lg hover:bg-elevated transition">
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
