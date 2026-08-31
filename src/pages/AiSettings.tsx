// ============================================================================
// AI settings — /settings/ai
// ============================================================================
//
// One page, five sections, reachable from the left sidebar at all times:
// connections by IP/URL, local text models and local image models with a
// hardware fit, default routes, and the external MCP access panel (moved
// here from the general modal).

import { useEffect } from 'react';
import { Bot, Plug } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import TopBar from '@/components/layout/TopBar';
import AiBridgePane from '@/components/settings/AiBridgePane';
import ConnectionsSection from '@/components/ai-settings/ConnectionsSection';
import LocalModelsSection from '@/components/ai-settings/LocalModelsSection';
import LocalImageModelsSection from '@/components/ai-settings/LocalImageModelsSection';
import DefaultsSection from '@/components/ai-settings/DefaultsSection';
import { useAiRuntimeStore } from '@/stores/aiRuntimeStore';
import { isDesktop } from '@/utils/platform';

export default function AiSettings() {
  const { t } = useTranslation();
  const available = useAiRuntimeStore((s) => s.available);
  const loadConnections = useAiRuntimeStore((s) => s.loadConnections);
  const loadDefaults = useAiRuntimeStore((s) => s.loadDefaults);
  const desktop = isDesktop();

  useEffect(() => {
    void loadConnections();
    void loadDefaults();
  }, [loadConnections, loadDefaults]);

  return (
    <>
      <TopBar title={t('settings.ai.page.title')} subtitle={t('settings.ai.page.subtitle')} />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-6 space-y-8">
          {!desktop || !available ? (
            <div className="rounded-lg border border-border bg-elevated px-4 py-3 text-sm text-text-muted flex items-start gap-2">
              <Bot size={16} className="text-accent-gold mt-0.5 flex-shrink-0" />
              <span>{t('settings.ai.page.desktopOnly')}</span>
            </div>
          ) : (
            <>
              <ConnectionsSection />
              <div className="border-t border-border" />
              <LocalModelsSection />
              <div className="border-t border-border" />
              <LocalImageModelsSection />
              <div className="border-t border-border" />
              <DefaultsSection />
              <div className="border-t border-border" />
              <section className="space-y-2">
                <div className="flex items-start gap-2 mb-1">
                  <Plug size={14} className="text-accent-gold mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-text-dim">{t('settings.ai.page.mcpIntro')}</p>
                </div>
                <AiBridgePane />
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
}
