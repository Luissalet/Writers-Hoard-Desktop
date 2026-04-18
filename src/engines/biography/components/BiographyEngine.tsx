import { useState, useMemo } from 'react';
import { BookUser, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import EngineSpinner from '@/engines/_shared/components/EngineSpinner';
import NewItemForm from '@/engines/_shared/components/NewItemForm';
import { useAutoSelect, useEnsureDefault } from '@/engines/_shared';
import { useBiographies } from '../hooks';
import BiographyView from './BiographyView';
import { generateId } from '@/utils/idGenerator';

export default function BiographyEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const { items: biographies, loading, addItem: addBiography, editItem: editBiography, removeItem: removeBiography } = useBiographies(projectId);
  const [activeBiographyId, setActiveBiographyId] = useState<string>('');
  const [showNewBio, setShowNewBio] = useState(false);
  const [newBioName, setNewBioName] = useState('');

  useAutoSelect(biographies, activeBiographyId, setActiveBiographyId);

  useEnsureDefault({
    items: biographies,
    loading,
    createDefault: () => ({
      id: generateId('bio'),
      projectId,
      subjectName: 'New Subject',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    addItem: addBiography,
    onCreated: setActiveBiographyId,
  });

  const activeBiography = useMemo(
    () => biographies.find(b => b.id === activeBiographyId),
    [biographies, activeBiographyId],
  );

  if (loading) return <EngineSpinner />;

  const handleCreateBio = async () => {
    const bio = {
      id: generateId('bio'),
      projectId,
      subjectName: newBioName.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await addBiography(bio);
    setActiveBiographyId(bio.id);
    setNewBioName('');
    setShowNewBio(false);
  };

  return (
    <div className="space-y-4">
      {/* Main biography view */}
      {activeBiography && (
        <BiographyView
          biography={activeBiography}
          onUpdate={(changes) => editBiography(activeBiography.id, changes)}
        />
      )}

      {/* Biographies dashboard */}
      <div className="border border-border rounded-xl bg-surface/50 p-4 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <BookUser size={14} className="text-accent-gold" />
            {t('biography.yourBiographies')}
          </h3>
          {showNewBio ? (
            <NewItemForm
              variant="compact"
              value={newBioName}
              onChange={setNewBioName}
              placeholder={t('biography.subjectNamePlaceholder')}
              onConfirm={handleCreateBio}
              onCancel={() => {
                setShowNewBio(false);
                setNewBioName('');
              }}
            />
          ) : (
            <button
              onClick={() => setShowNewBio(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent-gold/10 text-accent-gold rounded-lg hover:bg-accent-gold/20 transition"
            >
              <Plus size={13} />
              {t('biography.newBiography')}
            </button>
          )}
        </div>

        {biographies.length === 0 ? (
          <p className="text-sm text-text-dim text-center py-4">{t('biography.noBiographies')}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {biographies.map((bio) => {
              const isActive = bio.id === activeBiographyId;
              return (
                <div
                  key={bio.id}
                  className={`group relative rounded-lg border-2 transition cursor-pointer ${
                    isActive ? 'border-accent-gold bg-accent-gold/10' : 'border-border bg-elevated hover:border-accent-gold/40'
                  }`}
                >
                  {bio.subjectPhoto && (
                    <img
                      src={bio.subjectPhoto}
                      alt={bio.subjectName}
                      className="w-full h-20 object-cover rounded-t-[6px]"
                    />
                  )}
                  <button onClick={() => setActiveBiographyId(bio.id)} className="w-full text-left p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <BookUser size={12} className={isActive ? 'text-accent-gold' : 'text-text-dim'} />
                      <span
                        className={`text-sm font-serif font-semibold truncate ${isActive ? 'text-accent-gold' : 'text-text-primary'}`}
                      >
                        {bio.subjectName}
                      </span>
                    </div>
                    <p className="text-[10px] text-text-dim">{new Date(bio.createdAt).toLocaleDateString()}</p>
                  </button>

                  {/* Delete button */}
                  {biographies.length > 1 && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (confirm(t('biography.deleteConfirm').replace('{name}', bio.subjectName))) {
                          await removeBiography(bio.id);
                          if (activeBiographyId === bio.id) {
                            const remaining = biographies.filter((b) => b.id !== bio.id);
                            if (remaining.length > 0) setActiveBiographyId(remaining[0].id);
                          }
                        }
                      }}
                      className="absolute top-1.5 right-1.5 p-1 rounded-full opacity-0 group-hover:opacity-100 text-text-dim hover:text-danger hover:bg-danger/10 transition"
                      title={t('biography.deleteBiography')}
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
