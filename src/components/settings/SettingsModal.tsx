import { Bot, ChevronRight, Globe } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Modal from '@/components/common/Modal';
import { useLocaleStore, type Locale } from '@/stores/localeStore';
import { useAiStore } from '@/stores/aiStore';
import { useAiRuntimeStore } from '@/stores/aiRuntimeStore';
import { useTranslation } from '@/i18n/useTranslation';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const LANGUAGES: { id: Locale; label: string; flag: string }[] = [
  { id: 'es', label: 'Español (Castellano)', flag: '🇪🇸' },
  { id: 'en', label: 'English', flag: '🇬🇧' },
];

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
                onClick={() => setLocale(lang.id)}
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
