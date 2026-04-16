import { useState, useEffect } from 'react';
import { Settings, Loader2, CheckCircle2, XCircle, Wifi } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { useAiStore } from '@/stores/aiStore';
import { AVAILABLE_MODELS } from '@/config/ai';
import { t } from '@/i18n/useTranslation';

interface AiSettingsProps {
  open: boolean;
  onClose: () => void;
}

export default function AiSettings({ open, onClose }: AiSettingsProps) {
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
    // Save first so checkConnection uses the latest URL
    saveSettings({ baseUrl }).then(() => checkConnection());
  };

  return (
    <Modal open={open} onClose={onClose} title="Asistente IA">
      <div className="space-y-5">
        {/* Enable toggle */}
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
          <>
            {/* Proxy URL */}
            <div>
              <label className="block text-sm text-text-muted mb-1.5">URL del Proxy</label>
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
              <label className="block text-sm text-text-muted mb-1.5">Modelo</label>
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
                    Probando conexión...
                  </>
                ) : (
                  <>
                    <Wifi size={14} />
                    Probar Conexión
                  </>
                )}
              </button>

              {!isLoading && isConnected && (
                <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 text-green-400 text-xs rounded-lg">
                  <CheckCircle2 size={14} />
                  <span>Conectado — {availableModels.length} modelo{availableModels.length !== 1 ? 's' : ''} disponible{availableModels.length !== 1 ? 's' : ''}</span>
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
              <p>
                El uso de IA en Writers Hoard cuenta contra tu cuota de suscripción Max.
                Haiku consume menos cuota que Sonnet.
              </p>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
