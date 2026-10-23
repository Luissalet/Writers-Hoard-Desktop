import { useId, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { toast } from '@/components/common/toast';
import ColorPicker from '@/components/common/ColorPicker';
import IconPicker from '@/components/common/IconPicker';
import { PROJECT_MODES, getEnginesForMode } from '@/engines';
import { groupEnginesForMode } from '@/config/projectPresets';
import { useTranslation } from '@/i18n/useTranslation';
import type { Project, ProjectMode } from '@/types';
import GenrePicker from '@/services/projectGenres/GenrePicker';
import { defaultReaderPresentation, readerInk } from '@/engines/writings/readerPresentation';
import { initialCoverJacket } from '@/engines/writings/coverDesign/model';
import ReaderBookCover from '@/engines/writings/components/ReaderBookCover';

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
  /** The book's cover, set at creation (the jacket editor refines it later). */
  cover: { enabled: boolean; style: 'hardcover' | 'paperback' | 'paper'; color: string };
}

export default function CreateProjectModal({ open, onClose, onCreate }: CreateProjectModalProps) {
  const { t, locale } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const [creationStep, setCreationStep] = useState<'mode' | 'details'>('mode');
  const [selectedMode, setSelectedMode] = useState<ProjectMode | null>(null);
  const [enabledEngines, setEnabledEngines] = useState<string[]>([]);
  const [form, setForm] = useState<FormState>({
    title: '',
    type: 'standalone',
    description: '',
    color: '#c4973b',
    cover: { enabled: false, style: 'hardcover', color: '#293b33' },
    icon: '',
  });
  const [creating, setCreating] = useState(false);
  const [genres,setGenres]=useState<string[]>([]);
  // `creating` state cannot gate re-entry: holding Enter fires several keydowns
  // before React re-renders, and each one used to mint a fresh project id.
  const creatingRef = useRef(false);

  // Included / Recommended / Everything else, from the one helper the Engine
  // Manager also groups by — so "Included with Novelist" cannot come to mean
  // two different things in the two places a writer picks engines.
  const groups = groupEnginesForMode(selectedMode);
  const defaultEnginesForMode = groups.included;
  const suggestedEnginesForMode = groups.recommended;
  const allAvailableEngines = groups.other;

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
    setForm({ title: '', type: 'standalone', description: '', color: '#c4973b', icon: '', cover: { enabled: false, style: 'hardcover', color: '#293b33' } });
    setGenres([]);
  };

  // The one gate both the submit button and the Enter key go through.
  const canCreate = !!form.title.trim() && !!selectedMode && enabledEngines.length > 0;

  const handleCreate = async () => {
    // `selectedMode` is re-tested only so it narrows for the project below.
    if (creatingRef.current || !canCreate || !selectedMode) return;

    creatingRef.current = true;
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
        genres,
        enabledEngines: enabledEngines,
        engineOrder: enabledEngines, // Initial order matches enabled order
        status: 'draft',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...(form.cover.enabled && (form.type === 'standalone' || form.type === 'saga') ? { readerPresentation: { ...defaultReaderPresentation(), cover: { style: form.cover.style, color: form.cover.color, texture: 'linen' as const, artwork: false, showAtStart: true, jacket: initialCoverJacket(form.title, readerInk(form.cover.color), true) } } } : {}),
      };
      await onCreate(project);
      handleResetCreate();
    } catch (error) {
      // The form stays open with everything the writer entered.
      console.error('Project creation failed', error);
      toast.error(t('common.saveFailed'));
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  return (
    // Escape, the backdrop and the X only hide the form: an accidental dismiss
    // must not throw away a typed title, description and engine selection.
    // The draft comes back on the next "New project"; Cancel discards it.
    <Modal
      open={open}
      onClose={onClose}
      busy={creating}
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
                >
                  {/* Subtle background tint */}
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-5 transition pointer-events-none"
                    style={{ backgroundColor: modeConfig.color }}
                  />
                  {isRecommended && (
                    <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-accent-gold/20 text-accent-gold text-[10px] font-semibold uppercase tracking-wide z-10">
                      {t('common.recommended')}
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
            <label htmlFor={titleId} className="block text-sm text-text-muted mb-1.5">{t('common.title')}</label>
            <input
              id={titleId}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={t('createProject.titlePlaceholder')}
              className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
            />
          </div>

          <fieldset>
            <legend className="block text-sm text-text-muted mb-1.5">{t('createProject.type')}</legend>
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
                  {t(`project.type.${type}`)}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor={descriptionId} className="block text-sm text-text-muted mb-1.5">{t('common.description')}</label>
            <textarea
              id={descriptionId}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={t('createProject.descriptionPlaceholder')}
              rows={3}
              className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition resize-none"
            />
          </div>

          <GenrePicker value={genres} onChange={setGenres} disabled={creating}/>
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

          {(form.type === 'standalone' || form.type === 'saga') && <div className="rounded-lg border border-border p-3" data-testid="create-cover">
            <label className="flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" data-testid="create-cover-enabled" checked={form.cover.enabled} onChange={event => setForm({ ...form, cover: { ...form.cover, enabled: event.target.checked } })} />{t('createProject.cover')}</label>
            {form.cover.enabled && <div className="mt-3 flex flex-wrap items-start gap-4">
              <div className="space-y-2">
                <label className="block text-xs text-text-muted">{t('createProject.coverStyle')}
                  <select data-testid="create-cover-style" className="mt-1 block rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text-primary" value={form.cover.style} onChange={event => setForm({ ...form, cover: { ...form.cover, style: event.target.value as FormState['cover']['style'] } })}>
                    <option value="hardcover">{t('createProject.coverHardcover')}</option><option value="paperback">{t('createProject.coverPaperback')}</option><option value="paper">{t('createProject.coverPaper')}</option>
                  </select>
                </label>
                <span className="block text-xs text-text-muted">{t('createProject.coverColor')}</span>
                <ColorPicker value={form.cover.color} onChange={(color) => setForm({ ...form, cover: { ...form.cover, color } })} />
                <p className="max-w-xs text-[11px] text-text-dim">{t('createProject.coverHelp')}</p>
              </div>
              <div className="w-40" data-testid="create-cover-preview"><ReaderBookCover title={form.title || t('createProject.coverUntitled')} cover={{ style: form.cover.style, color: form.cover.color, texture: 'linen', artwork: false, showAtStart: true, jacket: initialCoverJacket(form.title || t('createProject.coverUntitled'), readerInk(form.cover.color), true) }} locale={locale === 'en' ? 'en' : 'es'} /></div>
            </div>}
          </div>}

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
              disabled={!canCreate || creating}
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
