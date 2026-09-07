import { useEffect } from 'react';
import { Accessibility, BookOpen, Bot, ChevronRight, Globe } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Modal from '@/components/common/Modal';
import { useLocaleStore, type Locale } from '@/stores/localeStore';
import { useAiStore } from '@/stores/aiStore';
import { useAiRuntimeStore } from '@/stores/aiRuntimeStore';
import { useAppStore } from '@/stores/appStore';
import { useTranslation } from '@/i18n/useTranslation';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const LANGUAGES: { id: Locale; label: string; flag: string }[] = [
  { id: 'es', label: 'Español (Castellano)', flag: '🇪🇸' },
  { id: 'en', label: 'English', flag: '🇬🇧' },
];

/** A segmented control: three or fewer choices, all of them visible. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-text-muted">{label}</span>
      <div className="flex items-center gap-0.5 p-0.5 rounded-lg border border-border bg-elevated">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            aria-pressed={value === option.id}
            className={`px-2.5 py-1 rounded-md text-xs transition ${
              value === option.id
                ? 'bg-accent-gold/15 text-accent-gold font-medium'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * General settings. Everything AI-related — connections by IP, local models,
 * defaults, the MCP port — lives on its own page (/settings/ai, in the
 * sidebar); this modal only points there so the two never drift apart.
 */
export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { locale, setLocale } = useLocaleStore();
  const enabled = useAiStore((s) => s.config.enabled);
  const defaults = useAiRuntimeStore((s) => s.defaults);
  const reading = useAppStore((s) => s.reading);
  const setReading = useAppStore((s) => s.setReading);
  const loadReading = useAppStore((s) => s.loadReading);
  const motion = useAppStore((s) => s.motion);
  const setMotion = useAppStore((s) => s.setMotion);
  const loadMotion = useAppStore((s) => s.loadMotion);

  useEffect(() => {
    void Promise.all([loadReading(), loadMotion()]);
  }, [loadMotion, loadReading]);

  return (
    <Modal open={open} onClose={onClose} title={t('settings.title')}>
      <div className="space-y-6">
        {/* ── Language ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Globe size={14} className="text-accent-gold" />
            <h3 className="text-sm font-medium text-text-primary">{t('settings.language')}</h3>
          </div>
          <p className="text-[10px] text-text-dim mb-2">{t('settings.language.subtitle')}</p>
          <div className="space-y-1.5">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.id}
                type="button"
                onClick={() => setLocale(lang.id)}
                aria-pressed={locale === lang.id}
                className={`w-full text-left px-4 py-2.5 rounded-lg border transition text-sm flex items-center gap-3 ${
                  locale === lang.id
                    ? 'border-accent-gold/40 bg-accent-gold/5'
                    : 'border-border hover:border-accent-gold/20'
                }`}
              >
                <span className="text-base">{lang.flag}</span>
                <span className={`font-medium ${locale === lang.id ? 'text-accent-gold' : 'text-text-primary'}`}>
                  {lang.label}
                </span>
              </button>
            ))}
          </div>
        </section>

        <div className="border-t border-border" />

        {/* ── Reading: how the manuscript is set, not the interface ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <BookOpen size={14} className="text-accent-gold" />
            <h3 className="text-sm font-medium text-text-primary">{t('settings.reading')}</h3>
          </div>
          <p className="text-[10px] text-text-dim mb-3">{t('settings.reading.subtitle')}</p>
          <div className="space-y-2">
            <Choice
              label={t('settings.reading.face')}
              value={reading.face}
              options={[
                { id: 'serif', label: t('settings.reading.face.serif') },
                { id: 'sans', label: t('settings.reading.face.sans') },
                { id: 'mono', label: t('settings.reading.face.mono') },
              ]}
              onChange={(face) => void setReading({ face })}
            />
            <Choice
              label={t('settings.reading.size')}
              value={reading.size}
              options={[
                { id: 'small', label: t('settings.reading.size.small') },
                { id: 'medium', label: t('settings.reading.size.medium') },
                { id: 'large', label: t('settings.reading.size.large') },
              ]}
              onChange={(size) => void setReading({ size })}
            />
            <Choice
              label={t('settings.reading.measure')}
              value={reading.measure}
              options={[
                { id: 'narrow', label: t('settings.reading.measure.narrow') },
                { id: 'wide', label: t('settings.reading.measure.wide') },
              ]}
              onChange={(measure) => void setReading({ measure })}
            />
            <Choice
              label={t('settings.reading.layout')}
              value={reading.layout}
              options={[
                { id: 'flow', label: t('settings.reading.layout.flow') },
                { id: 'page', label: t('settings.reading.layout.page') },
              ]}
              onChange={(layout) => void setReading({ layout })}
            />
            <Choice
              label={t('settings.reading.pageSize')}
              value={reading.pageSize}
              options={[
                { id: 'a4', label: t('settings.reading.pageSize.a4') },
                { id: 'letter', label: t('settings.reading.pageSize.letter') },
              ]}
              onChange={(pageSize) => void setReading({ pageSize })}
            />
          </div>
          <div
            data-reading-face={reading.face}
            data-reading-size={reading.size}
            data-reading-measure={reading.measure}
            className="mt-3 px-4 py-3 rounded-lg border border-border bg-elevated"
          >
            <p className="wh-reading-sample text-text-primary">
              {t('settings.reading.preview')}
            </p>
          </div>
        </section>

        <div className="border-t border-border" />

        <section>
          <div className="flex items-center gap-2 mb-3">
            <Accessibility size={14} className="text-accent-gold" aria-hidden="true" />
            <h3 className="text-sm font-medium text-text-primary">{t('settings.motion')}</h3>
          </div>
          <p className="text-[10px] text-text-dim mb-3">{t('settings.motion.subtitle')}</p>
          <Choice
            label={t('settings.motion.preference')}
            value={motion}
            options={[
              { id: 'system', label: t('settings.motion.system') },
              { id: 'reduce', label: t('settings.motion.reduce') },
              { id: 'full', label: t('settings.motion.full') },
            ]}
            onChange={(preference) => void setMotion(preference)}
          />
        </section>

        <div className="border-t border-border" />

        {/* ── AI: one door, the dedicated page ── */}
        <section>
          <button
            type="button"
            onClick={() => {
              onClose();
              navigate('/settings/ai');
            }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-border hover:border-accent-gold/40 hover:bg-accent-gold/5 transition text-left"
          >
            <Bot size={16} className="text-accent-gold flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text-primary font-medium">{t('settings.ai.page.title')}</p>
              <p className="text-[10px] text-text-dim mt-0.5 truncate">
                {enabled
                  ? defaults.chat
                    ? t('settings.ai.page.summary').replace('{model}', defaults.chat.modelId)
                    : t('settings.ai.page.summaryNoModel')
                  : t('settings.ai.page.summaryDisabled')}
              </p>
            </div>
            <ChevronRight size={14} className="text-text-dim flex-shrink-0" />
          </button>
        </section>
      </div>
    </Modal>
  );
}
