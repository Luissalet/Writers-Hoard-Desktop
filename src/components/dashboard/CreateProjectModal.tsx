import { useState } from 'react';
import { Check } from 'lucide-react';
import Modal from '@/components/common/Modal';
import ColorPicker from '@/components/common/ColorPicker';
import IconPicker from '@/components/common/IconPicker';
import { PROJECT_MODES, getAllEngines, getEnginesForMode, getSuggestedEnginesForMode } from '@/engines';
import { useTranslation } from '@/i18n/useTranslation';
import type { Project, ProjectMode } from '@/types';

interface CreateProjectModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (project: Project) => Promise<void>;
}

interface FormState {
  title: string;
  type: Project['type'];
  description: string;
  color: string;
  icon: string;
}

export default function CreateProjectModal({ open, onClose, onCreate }: CreateProjectModalProps) {
  const { t } = useTranslation();
  const [creationStep, setCreationStep] = useState<'mode' | 'details'>('mode');
  const [selectedMode, setSelectedMode] = useState<ProjectMode | null>(null);
  const [enabledEngines, setEnabledEngines] = useState<string[]>([]);
  const [form, setForm] = useState<FormState>({
    title: '',
    type: 'standalone',
    description: '',
    color: '#c4973b',
    icon: '',
  });
  const [creating, setCreating] = useState(false);

  // Get engines for current mode
  const defaultEnginesForMode = selectedMode ? getEnginesForMode(selectedMode) : [];
  const suggestedEnginesForMode = selectedMode ? getSuggestedEnginesForMode(selectedMode) : [];
  const allAvailableEngines = getAllEngines();

  const handleModeSelect = (mode: ProjectMode) => {
    setSelectedMode(mode);
    // Initialize enabled engines based on mode defaults
    const defaultIds = getEnginesForMode(mode).map(e => e.id);
    setEnabledEngines(defaultIds);
    setCreationStep('details');
  };

  const handleResetCreate = () => {
    onClose();
    setCreationStep('mode');
    setSelectedMode(null);
    setEnabledEngines([]);
    setForm({ title: '', type: 'standalone', description: '', color: '#c4973b', icon: '' });
  };

  const handleCreate = async () => {
    if (!form.title.trim() || !selectedMode) return;

    setCreating(true);
    try {
      const { generateId } = await import('@/utils/idGenerator');
      const project: Project = {
        id: generateId('proj'),
        title: form.title,
        type: form.type,
        mode: selectedMode,
        color: form.color,
        ...(form.icon ? { icon: form.icon } : {}),
        description: form.description,
        enabledEngines: enabledEngines,
        engineOrder: enabledEngines, // Initial order matches enabled order
        status: 'draft',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await onCreate(project);
      handleResetCreate();
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleResetCreate}
      title={creationStep === 'mode' ? t('createProject.chooseMode') : t('createProject.newProject')}
    >
      {creationStep === 'mode' ? (
        // Step 1: Mode Selection
        <div className="space-y-6">
          <p className="text-text-muted text-sm">{t('createProject.modeHint')}</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {PROJECT_MODES.map(modeConfig => {
              const IconComponent = modeConfig.icon;
              const isRecommended = modeConfig.id === 'essentials';
              return (
                <button
                  key={modeConfig.id}
                  onClick={() => handleModeSelect(modeConfig.id as ProjectMode)}
                  className={`group relative p-4 rounded-lg border bg-elevated hover:bg-surface transition overflow-hidden text-left ${
                    isRecommended ? 'border-accent-gold/60 ring-1 ring-accent-gold/30' : 'border-border'
                  }`}
                  style={{
                    borderLeftWidth: '4px',
                    borderLeftColor: modeConfig.color,
                  }}
                >
                  {/* Subtle background tint */}
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-5 transition pointer-events-none"
                    style={{ backgroundColor: modeConfig.color }}
                  />
                  {isRecommended && (
                    <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-accent-gold/20 text-accent-gold text-[10px] font-semibold uppercase tracking-wide z-10">
                      {t('modes.essentials.recommended')}
                    </span>
                  )}
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-3">
                      <IconComponent size={28} style={{ color: modeConfig.color }} className="flex-shrink-0" />
                      {!isRecommended && (
                        <div className="w-5 h-5 rounded-full border-2 border-border group-hover:border-accent-gold transition" />
                      )}
                    </div>
                    <h3 className="font-serif font-bold text-text-primary text-sm mb-1">{t(`modes.${modeConfig.id}.name`)}</h3>
                    <p className="text-xs text-text-muted leading-tight">{t(`modes.${modeConfig.id}.description`)}</p>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="flex gap-3 pt-4">
            <button
              onClick={handleResetCreate}
              className="px-6 py-2.5 border border-border text-text-muted rounded-lg hover:bg-elevated transition"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        // Step 2: Project Details
        <div className="space-y-5">
          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('common.title')}</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={t('createProject.titlePlaceholder')}
              className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            />
          </div>

          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('createProject.type')}</label>
            <div className="grid grid-cols-2 gap-2">
              {(['saga', 'standalone', 'collection', 'idea'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => setForm({ ...form, type })}
                  className={`px-3 py-2 rounded-lg text-sm capitalize transition ${
                    form.type === type
                      ? 'bg-accent-gold/20 text-accent-gold border border-accent-gold/40'
                      : 'bg-elevated border border-border text-text-muted hover:text-text-primary'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('common.description')}</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={t('createProject.descriptionPlaceholder')}
              rows={3}
              className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition resize-none"
            />
          </div>

          <div className="flex gap-6">
            <div className="flex-1">
              <label className="block text-sm text-text-muted mb-1.5">{t('createProject.color')}</label>
              <ColorPicker
                value={form.color}
                onChange={(color) => setForm({ ...form, color })}
              />
            </div>
            <div>
              <label className="block text-sm text-text-muted mb-1.5">{t('createProject.icon')}</label>
              <IconPicker
                value={form.icon}
                onChange={(icon) => setForm({ ...form, icon })}
                color={form.color}
              />
            </div>
          </div>

          {/* Engines Section */}
          <div className="bg-elevated border border-border rounded-lg p-4">
            <h3 className="font-serif font-semibold text-text-primary mb-3 text-sm">{t('createProject.activeEngines')}</h3>
            <div className="space-y-3">
              {/* Default engines */}
              {defaultEnginesForMode.length > 0 && (
                <div>
                  <p className="text-xs text-text-muted mb-2">{t('createProject.includedWith')} {selectedMode ? t(`modes.${selectedMode}.name`) : ''}</p>
                  <div className="flex flex-wrap gap-2">
                    {defaultEnginesForMode.map(engine => (
                      <button
                        key={engine.id}
                        onClick={() => {
                          setEnabledEngines(prev =>
                            prev.includes(engine.id)
                              ? prev.filter(id => id !== engine.id)
                              : [...prev, engine.id]
                          );
                        }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition ${
                          enabledEngines.includes(engine.id)
                            ? 'bg-accent-gold/20 text-accent-gold border border-accent-gold/40'
                            : 'bg-surface border border-border text-text-muted hover:text-text-primary'
                        }`}
                      >
                        {enabledEngines.includes(engine.id) && <Check size={14} />}
                        {t(`engines.${engine.id}.name`)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggested engines */}
              {suggestedEnginesForMode.length > 0 && (
                <div>
                  <p className="text-xs text-text-muted mb-2">{t('createProject.recommendedFor')} {selectedMode ? t(`modes.${selectedMode}.name`) : ''}</p>
                  <div className="flex flex-wrap gap-2">
                    {suggestedEnginesForMode.map(engine => (
                      <button
                        key={engine.id}
                        onClick={() => {
                          setEnabledEngines(prev =>
                            prev.includes(engine.id)
                              ? prev.filter(id => id !== engine.id)
                              : [...prev, engine.id]
                          );
                        }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition ${
                          enabledEngines.includes(engine.id)
                            ? 'bg-accent-gold/20 text-accent-gold border border-accent-gold/40'
                            : 'bg-surface/50 border border-border/50 text-text-muted hover:text-text-primary'
                        }`}
                      >
                        {enabledEngines.includes(engine.id) && <Check size={14} />}
                        {t(`engines.${engine.id}.name`)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Additional available engines */}
              {selectedMode === 'custom' && allAvailableEngines.length > 0 && (
                <div>
                  <p className="text-xs text-text-muted mb-2">{t('createProject.allEngines')}</p>
                  <div className="flex flex-wrap gap-2">
                    {allAvailableEngines.map(engine => (
                      <button
                        key={engine.id}
                        onClick={() => {
                          setEnabledEngines(prev =>
                            prev.includes(engine.id)
                              ? prev.filter(id => id !== engine.id)
                              : [...prev, engine.id]
                          );
                        }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition ${
                          enabledEngines.includes(engine.id)
                            ? 'bg-accent-gold/20 text-accent-gold border border-accent-gold/40'
                            : 'bg-surface/50 border border-border/50 text-text-muted hover:text-text-primary'
                        }`}
                      >
                        {enabledEngines.includes(engine.id) && <Check size={14} />}
                        {t(`engines.${engine.id}.name`)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleCreate}
              disabled={!form.title.trim() || enabledEngines.length === 0 || creating}
              className="flex-1 py-2.5 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-amber transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? t('common.creating') : t('createProject.createButton')}
            </button>
            <button
              onClick={() => setCreationStep('mode')}
              className="px-6 py-2.5 border border-border text-text-muted rounded-lg hover:bg-elevated transition"
            >
              {t('common.back')}
            </button>
            <button
              onClick={handleResetCreate}
              className="px-6 py-2.5 border border-border text-text-muted rounded-lg hover:bg-elevated transition"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
