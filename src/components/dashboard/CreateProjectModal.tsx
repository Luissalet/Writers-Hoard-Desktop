import { useState } from 'react';
import { Check } from 'lucide-react';
import Modal from '@/components/common/Modal';
import ColorPicker from '@/components/common/ColorPicker';
import { PROJECT_MODES, getAllEngines, getEnginesForMode, getSuggestedEnginesForMode } from '@/engines';
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
}

export default function CreateProjectModal({ open, onClose, onCreate }: CreateProjectModalProps) {
  const [creationStep, setCreationStep] = useState<'mode' | 'details'>('mode');
  const [selectedMode, setSelectedMode] = useState<ProjectMode | null>(null);
  const [enabledEngines, setEnabledEngines] = useState<string[]>([]);
  const [form, setForm] = useState<FormState>({
    title: '',
    type: 'standalone',
    description: '',
    color: '#c4973b',
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
    setForm({ title: '', type: 'standalone', description: '', color: '#c4973b' });
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
      title={creationStep === 'mode' ? 'Choose Your Mode' : 'New Project'}
    >
      {creationStep === 'mode' ? (
        // Step 1: Mode Selection
        <div className="space-y-6">
          <p className="text-text-muted text-sm">Select your creative focus. You can always change this later.</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {PROJECT_MODES.map(modeConfig => {
              const IconComponent = modeConfig.icon;
              return (
                <button
                  key={modeConfig.id}
                  onClick={() => handleModeSelect(modeConfig.id as ProjectMode)}
                  className="group relative p-4 rounded-lg border border-border bg-elevated hover:bg-surface transition overflow-hidden text-left"
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
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-3">
                      <IconComponent size={28} style={{ color: modeConfig.color }} className="flex-shrink-0" />
                      <div className="w-5 h-5 rounded-full border-2 border-border group-hover:border-accent-gold transition" />
                    </div>
                    <h3 className="font-serif font-bold text-text-primary text-sm mb-1">{modeConfig.name}</h3>
                    <p className="text-xs text-text-muted leading-tight">{modeConfig.description}</p>
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
              Cancel
            </button>
          </div>
        </div>
      ) : (
        // Step 2: Project Details
        <div className="space-y-5">
          <div>
            <label className="block text-sm text-text-muted mb-1.5">Title</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="The name of your world..."
              className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            />
          </div>

          <div>
            <label className="block text-sm text-text-muted mb-1.5">Type</label>
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
            <label className="block text-sm text-text-muted mb-1.5">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="A brief description..."
              rows={3}
              className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition resize-none"
            />
          </div>

          <div>
            <label className="block text-sm text-text-muted mb-1.5">Color</label>
            <ColorPicker
              value={form.color}
              onChange={(color) => setForm({ ...form, color })}
            />
          </div>

          {/* Engines Section */}
          <div className="bg-elevated border border-border rounded-lg p-4">
            <h3 className="font-serif font-semibold text-text-primary mb-3 text-sm">Active Engines</h3>
            <div className="space-y-3">
              {/* Default engines */}
              {defaultEnginesForMode.length > 0 && (
                <div>
                  <p className="text-xs text-text-muted mb-2">Included with {selectedMode}</p>
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
                        {engine.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggested engines */}
              {suggestedEnginesForMode.length > 0 && (
                <div>
                  <p className="text-xs text-text-muted mb-2">Recommended for {selectedMode}</p>
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
                        {engine.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Additional available engines */}
              {selectedMode === 'custom' && allAvailableEngines.length > 0 && (
                <div>
                  <p className="text-xs text-text-muted mb-2">All Available Engines</p>
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
                        {engine.name}
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
              {creating ? 'Creating...' : 'Create Project'}
            </button>
            <button
              onClick={() => setCreationStep('mode')}
              className="px-6 py-2.5 border border-border text-text-muted rounded-lg hover:bg-elevated transition"
            >
              Back
            </button>
            <button
              onClick={handleResetCreate}
              className="px-6 py-2.5 border border-border text-text-muted rounded-lg hover:bg-elevated transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
