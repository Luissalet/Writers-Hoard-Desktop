// ============================================================================
// AI settings — pick a (connection, model) pair
// ============================================================================

import { useEffect, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAiRuntimeStore } from '@/stores/aiRuntimeStore';
import type { AiModelType, AiRouteSelection } from '@/services/aiRuntime/types';

interface ModelRoutePickerProps {
  type: AiModelType;
  value: AiRouteSelection | undefined;
  onChange: (route: AiRouteSelection | null) => void;
  /** Only show models with this capability (e.g. 'tools'). */
  requireCapability?: 'tools' | 'vision';
  allowNone?: boolean;
}

export default function ModelRoutePicker({ type, value, onChange, requireCapability, allowNone = true }: ModelRoutePickerProps) {
  const { t } = useTranslation();
  const connections = useAiRuntimeStore((s) => s.connections);
  const modelsByConnection = useAiRuntimeStore((s) => s.modelsByConnection);
  const loadModels = useAiRuntimeStore((s) => s.loadModels);

  // Keyed on ids, not on the array: the store replaces the array on every
  // status update, and an effect that re-ran on identity looped forever.
  const connectionKey = connections.map((c) => `${c.id}:${c.enabled ? 1 : 0}`).join('|');
  useEffect(() => {
    for (const id of connectionKey.split('|')) {
      const [connectionId, enabled] = id.split(':');
      if (connectionId && enabled === '1') void loadModels(connectionId);
    }
  }, [connectionKey, loadModels]);

  const groups = useMemo(
    () =>
      connections
        .filter((c) => c.enabled)
        .map((connection) => ({
          connection,
          state: modelsByConnection[connection.id],
          models: (modelsByConnection[connection.id]?.models ?? []).filter(
            (m) => m.type === type && (!requireCapability || m.capabilities.includes(requireCapability)),
          ),
        })),
    [connections, modelsByConnection, requireCapability, type],
  );
  const loading = groups.some((g) => g.state?.loading);
  const encoded = value ? `${value.connectionId}::${value.modelId}` : '';
  const known = groups.some((g) => g.models.some((m) => `${g.connection.id}::${m.id}` === encoded));

  return (
    <div className="flex items-center gap-2">
      <select
        value={encoded}
        onChange={(e) => {
          const raw = e.target.value;
          if (!raw) {
            onChange(null);
            return;
          }
          const [connectionId, ...rest] = raw.split('::');
          onChange({ connectionId, modelId: rest.join('::') });
        }}
        className="flex-1 min-w-0 px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition font-mono"
      >
        {(allowNone || !encoded) && <option value="">{t('settings.ai.route.none')}</option>}
        {encoded && !known && <option value={encoded}>{value?.modelId} ({t('settings.ai.route.unavailable')})</option>}
        {groups
          .filter((g) => g.models.length > 0)
          .map(({ connection, models }) => (
            <optgroup key={connection.id} label={connection.name}>
              {models.map((model) => (
                <option key={model.id} value={`${connection.id}::${model.id}`}>
                  {model.id}
                  {/* "no tools" only means something for a chat model. */}
                  {type === 'chat' && !model.capabilities.includes('tools') ? ` — ${t('settings.ai.route.noTools')}` : ''}
                </option>
              ))}
            </optgroup>
          ))}
      </select>
      {loading && <Loader2 size={14} className="animate-spin text-text-dim flex-shrink-0" />}
    </div>
  );
}
