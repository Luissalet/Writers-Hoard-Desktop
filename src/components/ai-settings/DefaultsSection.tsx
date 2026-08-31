// ============================================================================
// AI settings — default routes
// ============================================================================
//
// Which (connection, model) the copilot and the classic features use unless
// a project or a thread says otherwise, and which image model the studio
// starts with. Also the master switch the old modal used to hold, and one
// button that picks the best local model for this machine instead of asking
// the user to compare badges.

import { useEffect, useMemo } from 'react';
import { Route, Sparkles, Wand2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAiStore } from '@/stores/aiStore';
import { BUILTIN_OLLAMA_ID, useAiRuntimeStore } from '@/stores/aiRuntimeStore';
import { pickBestChatModel } from '@/services/aiRuntime/pickModel';
import { DEFAULT_CONTEXT_TOKENS } from '@/services/aiRuntime/constants';
import ModelRoutePicker from './ModelRoutePicker';
import FitBadge from './FitBadge';

export default function DefaultsSection() {
  const { t } = useTranslation();
  const { defaults, loadDefaults, setDefault, connections, modelsByConnection, hardware, loadHardware } = useAiRuntimeStore();
  const { config, saveSettings, setLocalModel } = useAiStore();

  useEffect(() => {
    void loadDefaults();
    void loadHardware();
  }, [loadDefaults, loadHardware]);

  const chatConnection = connections.find((c) => c.id === defaults.chat?.connectionId);

  // Best local candidate: this machine's own servers only, ranked by fit.
  const best = useMemo(() => {
    const local = connections.filter((c) => c.enabled && (c.locality === 'embedded' || c.locality === 'loopback'));
    const models = local.flatMap((c) => modelsByConnection[c.id]?.models ?? []);
    return pickBestChatModel(models, hardware, { contextTokens: DEFAULT_CONTEXT_TOKENS });
  }, [connections, modelsByConnection, hardware]);
  const bestIsCurrent = Boolean(best && defaults.chat?.connectionId === best.model.connectionId && defaults.chat.modelId === best.model.id);

  const adoptBest = async () => {
    if (!best) return;
    await setDefault('chat', { connectionId: best.model.connectionId, modelId: best.model.id });
    if (best.model.connectionId === BUILTIN_OLLAMA_ID) await setLocalModel(best.model.id);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-start gap-2">
          <Route size={14} className="text-accent-gold mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm text-text-primary font-medium">{t('settings.ai.defaults.title')}</p>
            <p className="text-[10px] text-text-dim mt-0.5">{t('settings.ai.defaults.subtitle')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void saveSettings({ enabled: !config.enabled })}
          className={`relative w-11 h-6 rounded-full transition flex-shrink-0 ${config.enabled ? 'bg-accent-gold' : 'bg-elevated'}`}
          title={t('settings.ai.title')}
          aria-label={t('settings.ai.title')}
        >
          <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform left-0.5" style={{ transform: config.enabled ? 'translateX(20px)' : 'translateX(0)' }} />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-[11px] text-text-muted mb-1">{t('settings.ai.defaults.chat')}</label>
          <ModelRoutePicker type="chat" value={defaults.chat} onChange={(route) => void setDefault('chat', route)} />
          <p className="text-[10px] text-text-dim mt-1">
            {t('settings.ai.defaults.chatNote')}
            {chatConnection?.locality === 'remote' ? ` ${t('settings.ai.defaults.remoteNote')}` : ''}
          </p>
          {best && (
            <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px]">
              <button
                type="button"
                onClick={() => void adoptBest()}
                disabled={bestIsCurrent}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-accent-gold/10 text-accent-gold hover:bg-accent-gold/20 transition disabled:opacity-60"
              >
                <Wand2 size={11} />
                {bestIsCurrent ? t('settings.ai.defaults.bestInUse') : t('settings.ai.defaults.pickBest')}
              </button>
              <span className="text-text-dim">{t('settings.ai.defaults.bestIs')}</span>
              <span className="font-mono text-text-muted">{best.model.id}</span>
              <FitBadge fit={best.fit} />
            </div>
          )}
        </div>
        <div>
          <label className="block text-[11px] text-text-muted mb-1 flex items-center gap-1">
            <Sparkles size={11} />
            {t('settings.ai.defaults.image')}
          </label>
          <ModelRoutePicker type="image" value={defaults.image} onChange={(route) => void setDefault('image', route)} />
          <p className="text-[10px] text-text-dim mt-1">{t('settings.ai.defaults.imageNote')}</p>
        </div>
      </div>
    </section>
  );
}
