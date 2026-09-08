// ============================================================================
// AI settings — /settings/ai
// ============================================================================
//
// One page, five sections, reachable from the left sidebar at all times:
// local text models and local image models with a hardware fit, default
// routes, connections by IP/URL, and the external MCP access panel (moved
// here from the general modal).
//
// Order is the first thing this page says. "Pick a model" from the copilot
// lands here, and what that reader needs is the local catalogue with its fit
// badges and a Download button — not a base-URL field for a machine they do
// not have. So the catalogue leads and connecting to another machine is a
// disclosure underneath it, opened by default only for someone who has
// already added a server and is therefore coming back for it.

import { useEffect, useState } from 'react';
import { Bot, ChevronDown, ChevronRight, Plug, Server } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import TopBar from '@/components/layout/TopBar';
import AiBridgePane from '@/components/settings/AiBridgePane';
import ConnectionsSection from '@/components/ai-settings/ConnectionsSection';
import LocalModelsSection from '@/components/ai-settings/LocalModelsSection';
import LocalImageModelsSection from '@/components/ai-settings/LocalImageModelsSection';
import DefaultsSection from '@/components/ai-settings/DefaultsSection';
import SubscriptionsSection from '@/components/ai-settings/SubscriptionsSection';
import { useAiRuntimeStore } from '@/stores/aiRuntimeStore';
import { isDesktop } from '@/utils/platform';

function ConnectionsDisclosure() {
  const { t } = useTranslation();
  // A server the user added themselves means they came here for it before, so
  // it starts open for them. `null` is "nobody has said yet" — connections
  // arrive a tick after mount, and the first click must still win afterwards.
  const hasOwnServer = useAiRuntimeStore((s) => s.connections.some((c) => !c.builtin && !c.kind.endsWith('-subscription')));
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? hasOwnServer;

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        className="w-full flex items-start gap-2 text-left rounded-lg px-1 py-1 text-text-muted hover:text-text-primary transition"
      >
        {expanded ? <ChevronDown size={14} className="mt-0.5 flex-shrink-0" /> : <ChevronRight size={14} className="mt-0.5 flex-shrink-0" />}
        <Server size={14} className="text-text-dim mt-0.5 flex-shrink-0" />
        <span className="min-w-0">
          <span className="block text-sm font-medium">{t('settings.ai.page.connectAnother')}</span>
          <span className="block text-[10px] text-text-dim mt-0.5">{t('settings.ai.connections.subtitle')}</span>
        </span>
      </button>
      {expanded && <ConnectionsSection />}
    </section>
  );
}

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
              <SubscriptionsSection />
              <div className="border-t border-border" />
              <LocalModelsSection />
              <div className="border-t border-border" />
              <LocalImageModelsSection />
              <div className="border-t border-border" />
              <DefaultsSection />
              <div className="border-t border-border" />
              <ConnectionsDisclosure />
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
