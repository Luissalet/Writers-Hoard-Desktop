// ============================================================================
// Simple · Studio · Expert
// ============================================================================
//
// Three, not two. Two levels force a choice between hiding the controls and
// showing a research console, and the level that was missing is the one nearly
// every writer actually wants: the sampler, the steps, the CFG and the LoRA
// stack — the vocabulary of every tutorial they will ever read — without the
// sigma schedule.

import { useTranslation } from '@/i18n/useTranslation';
import { STUDIO_LEVELS, type StudioLevel } from '../studio';

export interface LevelSwitcherProps {
  value: StudioLevel;
  onChange: (level: StudioLevel) => void;
}

export default function LevelSwitcher({ value, onChange }: LevelSwitcherProps) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="flex items-center gap-1" role="group" aria-label={t('imageStudio.level.title')}>
        {STUDIO_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => onChange(level)}
            aria-pressed={value === level}
            title={t(`imageStudio.level.${level}.what`)}
            className={`flex-1 px-2 py-1 rounded-lg text-[10px] border transition ${
              value === level
                ? 'border-accent-gold/50 bg-accent-gold/15 text-accent-gold'
                : 'border-border text-text-dim hover:text-text-primary'
            }`}
          >
            {t(`imageStudio.level.${level}`)}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-text-dim">{t(`imageStudio.level.${value}.what`)}</p>
    </div>
  );
}
