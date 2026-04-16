import { useState, useEffect } from 'react';
import { Settings, Loader2, CheckCircle2, XCircle, Wifi, Globe } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { useAiStore } from '@/stores/aiStore';
import { useLocaleStore, type Locale } from '@/stores/localeStore';
import { AVAILABLE_MODELS } from '@/config/ai';
import { useTranslation } from '@/i18n/useTranslation';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const LANGUAGES: { id: Locale; label: string; flag: string }[] = [
  { id: 'es', label: 'Español (Castellano)', flag: '🇪🇸' },
  { id: 'en', label: 'English', flag: '🇬🇧' },
];

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t } = useTranslation();
  const { locale, setLocale } = useLocaleStore();
  const { config, isConnected, availableModels, isLoading, error, loadSettings, saveSettings, checkConnection } = useAiStore();

  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [model, setModel] = useState(config.model);
  const [enabled, setEnabled] = useState(config.enabled);

  useEffect(() => {
    if (open) {
      loadSettings().then(() => {
        const s = useAiStore.getState();
        setBaseUrl(s.config.baseUrl);
        setModel(s.config.model);
        setEnabled(s.config.enabled);
      });
    }
  }, [open, loadSettings]);

  const handleSave = async () => {
    await saveSettings({ baseUrl, model, enabled });
  };

  const handleTestConnection = () => {
    saveSettings({ baseUrl }).then(() => checkConnection());
  };

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

        {/* ── AI Assistant ── */}
        <section>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary font-medium">{t('settings.ai.title')}</p>
              <p className="text-[10px] text-text-dim mt-0.5">{t('settings.ai.subtitle')}</p>
            </div>
            <button
              onClick={() => { setEnabled(!enabled); saveSettings({ enabled: !enabled }); }}
              className={`relative w-11 h-6 rounded-full transition ${
                enabled ? 'bg-accent-gold' : 'bg-elevated'
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  enabled ? 'translate-x-5.5 left-0' : 'left-0.5'
                }`}
                style={{ transform: enabled ? 'translateX(22px)' : 'translateX(0)' }}
              />
            </button>
          </div>

          {enabled && (
            <div className="mt-4 space-y-4">
              {/* Proxy URL */}
              <div>
                <label className="block text-sm text-text-muted mb-1.5">{t('settings.ai.proxyUrl')}</label>
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  onBlur={handleSave}
                  placeholder="http://localhost:8317"
                  className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition font-mono"
                />
              </div>

              {/* Model selector */}
              <div>
                <label className="block text-sm text-text-muted mb-1.5">{t('settings.ai.model')}</label>
                <div className="space-y-1.5">
                  {AVAILABLE_MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => { setModel(m.id); saveSettings({ model: m.id }); }}
                      className={`w-full text-left px-4 py-2.5 rounded-lg border transition text-sm ${
                        model === m.id
                          ? 'border-accent-gold/40 bg-accent-gold/5'
                          : 'border-border hover:border-accent-gold/20'
                      }`}
                    >
                      <span className={`font-medium ${model === m.id ? 'text-accent-gold' : 'text-text-primary'}`}>
                        {m.label}
                      </span>
                      <span className="text-[10px] text-text-dim ml-2">{m.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Test connection */}
              <div className="space-y-2">
                <button
                  onClick={handleTestConnection}
                  disabled={isLoading}
                  className="w-full py-2.5 bg-elevated border border-border rounded-lg text-sm text-text-muted hover:text-text-primary hover:border-accent-gold/30 transition inline-flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isLoading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      {t('settings.ai.testing')}
                    </>
                  ) : (
                    <>
                      <Wifi size={14} />
                      {t('settings.ai.testConnection')}
                    </>
                  )}
                </button>

                {!isLoading && isConnected && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 text-green-400 text-xs rounded-lg">
                    <CheckCircle2 size={14} />
                    <span>
                      {t('settings.ai.connected')} — {availableModels.length}{' '}
                      {availableModels.length !== 1 ? t('settings.ai.modelsAvailablePlural') : t('settings.ai.modelsAvailable')}{' '}
                      {availableModels.length !== 1 ? t('settings.ai.availablePlural') : t('settings.ai.available')}
                    </span>
                  </div>
                )}

                {!isLoading && error && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 text-red-400 text-xs rounded-lg">
                    <XCircle size={14} />
                    <span>{error}</span>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="px-3 py-2 bg-elevated rounded-lg text-[10px] text-text-dim space-y-1">
                <p className="flex items-center gap-1.5">
                  <Settings size={10} />
                  {t('settings.ai.requirement')}
                </p>
                <p>{t('settings.ai.quotaNote')}</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
