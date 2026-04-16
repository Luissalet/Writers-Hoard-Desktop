import { useState, useRef } from 'react';
import type { CodexEntry, CodexEntryType } from '@/types';
import { getTemplateFields } from '@/types';
import { generateId } from '@/utils/idGenerator';
import TiptapEditor from '@/components/editor/TiptapEditor';
import TagInput from '@/components/common/TagInput';
import { User, MapPin, Sword, Shield, Sparkles, HelpCircle, BookOpen, ImagePlus, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

const typeConfig: Record<CodexEntryType, { icon: typeof User; labelKey: string; color: string }> = {
  character: { icon: User, labelKey: 'codex.types.character', color: '#c4973b' },
  location: { icon: MapPin, labelKey: 'codex.types.location', color: '#4a9e6d' },
  item: { icon: Sword, labelKey: 'codex.types.item', color: '#4a7ec4' },
  faction: { icon: Shield, labelKey: 'codex.types.faction', color: '#c4463a' },
  concept: { icon: Sparkles, labelKey: 'codex.types.concept', color: '#7c5cbf' },
  magic: { icon: Sparkles, labelKey: 'codex.types.magic', color: '#d4a843' },
  custom: { icon: HelpCircle, labelKey: 'codex.types.custom', color: '#8a8690' },
};

const FIELD_LABEL_KEYS: Record<string, string> = {
  name: 'codex.field.name',
  age: 'codex.field.age',
  species: 'codex.field.species',
  role: 'codex.field.role',
  physicalDescription: 'codex.field.physicalDescription',
  personality: 'codex.field.personality',
  backstory: 'codex.field.backstory',
  abilities: 'codex.field.abilities',
  goals: 'codex.field.goals',
  flaws: 'codex.field.flaws',
  region: 'codex.field.region',
  climate: 'codex.field.climate',
  population: 'codex.field.population',
  history: 'codex.field.history',
  notableFeatures: 'codex.field.notableFeatures',
  inhabitants: 'codex.field.inhabitants',
  type: 'codex.field.type',
  origin: 'codex.field.origin',
  properties: 'codex.field.properties',
  currentOwner: 'codex.field.currentOwner',
  leader: 'codex.field.leader',
  territory: 'codex.field.territory',
  allies: 'codex.field.allies',
  enemies: 'codex.field.enemies',
};

interface CodexEntryFormProps {
  projectId: string;
  entry?: CodexEntry;
  onSave: (entry: CodexEntry) => void;
  onCancel: () => void;
}

export default function CodexEntryForm({ projectId, entry, onSave, onCancel }: CodexEntryFormProps) {
  const { t } = useTranslation();
  const [type, setType] = useState<CodexEntryType>(entry?.type || 'character');
  const [title, setTitle] = useState(entry?.title || '');
  const [avatar, setAvatar] = useState(entry?.avatar || '');
  const [fields, setFields] = useState<Record<string, string>>(entry?.fields || getTemplateFields(type));
  const [content, setContent] = useState(entry?.content || '');
  const [tags, setTags] = useState<string[]>(entry?.tags || []);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setAvatar(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleTypeChange = (newType: CodexEntryType) => {
    setType(newType);
    if (!entry) {
      setFields(getTemplateFields(newType));
    }
  };

  const handleSave = () => {
    if (!title.trim()) return;
    onSave({
      id: entry?.id || generateId('codex'),
      projectId,
      type,
      title,
      avatar: avatar || undefined,
      fields,
      content,
      tags,
      relations: entry?.relations || [],
      createdAt: entry?.createdAt || Date.now(),
      updatedAt: Date.now(),
    });
  };

  return (
    <div className="space-y-6">
      {/* Type selector */}
      {!entry && (
        <div>
          <label className="block text-sm text-text-muted mb-2">{t('codex.entryType')}</label>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(typeConfig) as CodexEntryType[]).map(entryType => {
              const config = typeConfig[entryType];
              const Icon = config.icon;
              return (
                <button
                  key={entryType}
                  onClick={() => handleTypeChange(entryType)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition ${
                    type === entryType
                      ? 'border-2'
                      : 'border border-border text-text-muted hover:text-text-primary hover:bg-elevated'
                  }`}
                  style={type === entryType ? { borderColor: config.color, color: config.color, backgroundColor: `${config.color}15` } : {}}
                >
                  <Icon size={16} />
                  {t(config.labelKey)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Title + Avatar */}
      <div className="flex gap-4 items-start">
        {/* Avatar */}
        <div className="flex-shrink-0">
          <label className="block text-sm text-text-muted mb-1.5">{t('codex.avatar')}</label>
          <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
          {avatar ? (
            <div className="relative w-20 h-20 rounded-xl overflow-hidden border border-border group">
              <img src={avatar} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-1">
                <button
                  onClick={() => avatarInputRef.current?.click()}
                  className="p-1.5 bg-white/20 rounded-full hover:bg-white/30 transition"
                  title={t('common.change')}
                >
                  <ImagePlus size={12} className="text-white" />
                </button>
                <button
                  onClick={() => setAvatar('')}
                  className="p-1.5 bg-white/20 rounded-full hover:bg-red-500/50 transition"
                  title={t('common.remove')}
                >
                  <X size={12} className="text-white" />
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => avatarInputRef.current?.click()}
              className="w-20 h-20 rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 text-text-muted hover:border-accent-gold/50 hover:text-accent-gold transition"
            >
              <ImagePlus size={20} />
              <span className="text-[10px]">{t('common.image')}</span>
            </button>
          )}
        </div>

        {/* Title */}
        <div className="flex-1">
          <label className="block text-sm text-text-muted mb-1.5">{t('common.title')}</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('codex.entryName')}
            className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition text-lg font-serif"
          />
        </div>
      </div>

      {/* Template fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.entries(fields).map(([key, value]) => (
          <div key={key}>
            <label className="block text-sm text-text-muted mb-1.5">
              {t(FIELD_LABEL_KEYS[key] || key)}
            </label>
            {key === 'backstory' || key === 'history' || key === 'physicalDescription' || key === 'personality' ? (
              <textarea
                value={value}
                onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition resize-none text-sm"
              />
            ) : (
              <input
                value={value}
                onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
                className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition text-sm"
              />
            )}
          </div>
        ))}
      </div>

      {/* Rich text content */}
      <div>
        <label className="flex items-center gap-2 text-sm text-text-muted mb-1.5">
          <BookOpen size={14} />
          {t('codex.extendedNotes')}
        </label>
        <TiptapEditor content={content} onChange={setContent} placeholder={t('codex.extendedNotesPlaceholder')} />
      </div>

      {/* Tags */}
      <div>
        <label className="block text-sm text-text-muted mb-1.5">{t('common.tags')}</label>
        <TagInput tags={tags} onChange={setTags} />
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={handleSave}
          className="flex-1 py-2.5 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-amber transition"
        >
          {entry ? t('codex.saveChanges') : t('codex.createEntry')}
        </button>
        <button
          onClick={onCancel}
          className="px-6 py-2.5 border border-border text-text-muted rounded-lg hover:bg-elevated transition"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
