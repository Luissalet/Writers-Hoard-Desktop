import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SceneCast } from '../types';
import { generateId } from '@/utils/idGenerator';
import { InlineColorPicker } from '@/components/common/ColorPicker';
import { useTranslation } from '@/i18n/useTranslation';

interface CastBarProps {
  cast: SceneCast[];
  onAddCharacter: (member: SceneCast) => void;
  onAddDialog: (characterName: string, characterColor: string) => void;
  onRemoveCharacter: (id: string) => void;
}

export default function CastBar({
  cast,
  onAddCharacter,
  onAddDialog,
  onRemoveCharacter,
}: CastBarProps) {
  const { t } = useTranslation();
  const [showNewMember, setShowNewMember] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#c4973b');

  const handleAddMember = async () => {
    if (!newName.trim()) return;

    const member: SceneCast = {
      id: generateId('cast'),
      sceneId: '', // will be set by parent
      characterName: newName.trim(),
      color: newColor,
    };

    onAddCharacter(member);
    setNewName('');
    setNewColor('#c4973b');
    setShowNewMember(false);
  };

  return (
    <div className="border border-border rounded-lg bg-surface/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text-primary">{t('dialogScene.cast')}</h3>
        <button
          onClick={() => setShowNewMember(!showNewMember)}
          className="flex items-center gap-1.5 px-2 py-1 text-xs bg-accent-gold/10 text-accent-gold rounded hover:bg-accent-gold/20 transition"
          title={t('dialogScene.addCharacter')}
        >
          <Plus size={13} />
          {t('dialogScene.addCharacter')}
        </button>
      </div>

      <AnimatePresence>
        {showNewMember && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-3 p-3 bg-elevated rounded-lg border border-border"
          >
            <div className="space-y-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('dialogScene.characterNamePlaceholder')}
                className="w-full px-2.5 py-1.5 bg-surface border border-border rounded text-sm text-text-primary placeholder:text-text-dim focus:border-accent-gold outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddMember();
                  if (e.key === 'Escape') setShowNewMember(false);
                }}
              />
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">{t('dialogScene.color')}:</span>
                <InlineColorPicker value={newColor} onChange={setNewColor} size="sm" />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleAddMember}
                  className="flex-1 px-2 py-1.5 bg-accent-gold/20 text-accent-gold text-xs font-semibold rounded hover:bg-accent-gold/30 transition"
                >
                  {t('common.add')}
                </button>
                <button
                  onClick={() => {
                    setShowNewMember(false);
                    setNewName('');
                  }}
                  className="flex-1 px-2 py-1.5 bg-border/30 text-text-muted text-xs rounded hover:bg-border/50 transition"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {cast.length === 0 ? (
        <p className="text-xs text-text-dim text-center py-3">
          {t('dialogScene.noCast')}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {cast.map((member) => (
            <motion.button
              key={member.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={() => onAddDialog(member.characterName, member.color)}
              className="group relative flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-elevated hover:bg-elevated/70 transition text-sm font-medium"
              style={{ borderColor: member.color + '40', backgroundColor: member.color + '08' }}
            >
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: member.color }}
              />
              <span style={{ color: member.color }}>
                {member.characterName}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveCharacter(member.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-danger/20 transition"
              >
                <X size={12} className="text-text-dim hover:text-danger" />
              </button>
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}
