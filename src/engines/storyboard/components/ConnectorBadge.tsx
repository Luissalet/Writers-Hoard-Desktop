// ============================================
// Storyboard Engine — Connector Badge Component
// ============================================

import { useState } from 'react';
import { ArrowRight, Scissors, Edit2, Trash2 } from 'lucide-react';
import type { StoryboardConnector } from '../types';
import { useTranslation } from '@/i18n/useTranslation';

interface ConnectorBadgeProps {
  connector: StoryboardConnector | null;
  fromPanelId: string;
  toPanelId: string;
  onEdit: (fromId: string, toId: string) => void;
  onDelete: () => void;
}

const CONNECTOR_ICONS: Record<string, { icon: any; label: string; symbol: string }> = {
  arrow: { icon: ArrowRight, label: 'Arrow', symbol: '→' },
  note: { icon: Edit2, label: 'Note', symbol: '◆' },
  cut: { icon: Scissors, label: 'Cut', symbol: '|' },
  fade: { icon: Edit2, label: 'Fade', symbol: '◇' },
  dissolve: { icon: Edit2, label: 'Dissolve', symbol: '◊' },
  custom: { icon: Edit2, label: 'Custom', symbol: '•' },
};

export default function ConnectorBadge({
  connector,
  fromPanelId,
  toPanelId,
  onEdit,
  onDelete,
}: ConnectorBadgeProps) {
  const { t } = useTranslation();
  const [isHovering, setIsHovering] = useState(false);

  if (!connector) {
    return (
      <button
        onClick={() => onEdit(fromPanelId, toPanelId)}
        className="px-2 py-1 text-xs rounded bg-surface/50 border border-dashed border-text-muted text-text-muted hover:border-accent-gold hover:text-accent-gold transition"
        title={t('storyboard.addConnector')}
      >
        +
      </button>
    );
  }

  const info = CONNECTOR_ICONS[connector.type] || CONNECTOR_ICONS.custom;

  return (
    <div
      className="flex items-center justify-center"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <button
        onClick={() => onEdit(fromPanelId, toPanelId)}
        className="relative group px-2 py-1 text-xs rounded bg-accent-gold/10 border border-accent-gold text-accent-gold hover:bg-accent-gold/20 transition font-semibold"
      >
        {info.symbol}
        {connector.label && <span className="ml-1">{connector.label}</span>}
        {isHovering && (
          <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 whitespace-nowrap bg-deep border border-border rounded px-2 py-1 text-text-primary text-xs z-10 pointer-events-none">
            {info.label}
          </div>
        )}
      </button>
      {isHovering && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(t('storyboard.deleteConnector') + '?')) {
              onDelete();
            }
          }}
          className="ml-1 p-1 text-red-600 hover:text-red-700 transition opacity-0 group-hover:opacity-100"
          title={t('storyboard.deleteConnector')}
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
