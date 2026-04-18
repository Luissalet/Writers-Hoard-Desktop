// ============================================
// Storyboard Engine — Connector Editor Modal
// ============================================

import { useState, useEffect } from 'react';
import Modal from '@/components/common/Modal';
import type { StoryboardConnector } from '../types';
import { useTranslation } from '@/i18n/useTranslation';

interface ConnectorEditorProps {
  isOpen: boolean;
  connector: StoryboardConnector | null;
  storyboardId: string;
  fromPanelId: string;
  toPanelId: string;
  onClose: () => void;
  onSave: (connector: StoryboardConnector) => void;
  onDelete?: (connectorId: string) => void;
}

const CONNECTOR_TYPES: Array<{ id: StoryboardConnector['type']; symbol: string }> = [
  { id: 'arrow', symbol: '→' },
  { id: 'cut', symbol: '|' },
  { id: 'fade', symbol: '◇' },
  { id: 'dissolve', symbol: '◊' },
  { id: 'note', symbol: '◆' },
  { id: 'custom', symbol: '•' },
];

export default function ConnectorEditor({
  isOpen,
  connector,
  storyboardId,
  fromPanelId,
  toPanelId,
  onClose,
  onSave,
  onDelete,
}: ConnectorEditorProps) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState<Partial<StoryboardConnector>>(
    connector || { type: 'arrow', label: '', symbol: '' }
  );

  useEffect(() => {
    if (connector) {
      setFormData(connector);
    } else {
      setFormData({ type: 'arrow', label: '', symbol: '' });
    }
  }, [connector, isOpen]);

  const handleSave = () => {
    const connectorData: StoryboardConnector = {
      id: connector?.id || `conn-${Date.now()}`,
      storyboardId,
      sourceId: fromPanelId,
      targetId: toPanelId,
      type: (formData.type || 'arrow') as StoryboardConnector['type'],
      label: (formData.label || '').trim() || undefined,
      symbol: (formData.symbol || '').trim() || undefined,
    };
    onSave(connectorData);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Modal open={isOpen} onClose={onClose} title={connector ? t('storyboard.connector.editTitle') : t('storyboard.connector.createTitle')}>
      <div className="space-y-6 max-w-lg">
        <div>
          <label className="block text-sm font-semibold text-text-primary mb-3">{t('storyboard.connector.transitionType')}</label>
          <div className="grid grid-cols-2 gap-2">
            {CONNECTOR_TYPES.map((type) => (
              <button
                key={type.id}
                onClick={() => setFormData(prev => ({ ...prev, type: type.id }))}
                className={`p-3 rounded-lg border-2 text-left transition ${
                  formData.type === type.id
                    ? 'border-accent-gold bg-accent-gold/10'
                    : 'border-border bg-surface hover:border-accent-gold'
                }`}
              >
                <div className="text-xl font-bold text-accent-gold mb-1">{type.symbol}</div>
                <div className="font-semibold text-text-primary text-sm">{t(`storyboard.connector.types.${type.id}.label`)}</div>
                <div className="text-text-muted text-xs">{t(`storyboard.connector.types.${type.id}.desc`)}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-text-primary mb-2">{t('storyboard.connector.labelLabel')}</label>
          <input
            type="text"
            value={formData.label || ''}
            onChange={(e) => setFormData(prev => ({ ...prev, label: e.target.value }))}
            placeholder={t('storyboard.connector.labelPlaceholder')}
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary placeholder-text-muted focus:border-accent-gold focus:outline-none transition"
          />
          <p className="text-text-muted text-xs mt-1">{t('storyboard.connector.labelHint')}</p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-text-primary mb-2">{t('storyboard.connector.symbolLabel')}</label>
          <input
            type="text"
            value={formData.symbol || ''}
            onChange={(e) => setFormData(prev => ({ ...prev, symbol: e.target.value }))}
            placeholder={t('storyboard.connector.symbolPlaceholder')}
            maxLength={3}
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary placeholder-text-muted focus:border-accent-gold focus:outline-none transition"
          />
          <p className="text-text-muted text-xs mt-1">{t('storyboard.connector.symbolHint')}</p>
        </div>

        <div className="flex gap-3 pt-4 border-t border-border">
          {connector && onDelete && (
            <button
              onClick={() => {
                if (confirm(t('storyboard.connector.deleteConfirm'))) {
                  onDelete(connector.id);
                  onClose();
                }
              }}
              className="px-4 py-2 bg-red-600/10 border border-red-600 text-red-600 rounded-lg hover:bg-red-600/20 transition font-semibold text-sm"
            >
              {t('common.delete')}
            </button>
          )}
          <div className="flex-1 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-surface border border-border text-text-primary rounded-lg hover:bg-elevated transition font-semibold"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSave}
              className="flex-1 px-4 py-2 bg-accent-gold text-deep rounded-lg hover:bg-accent-amber transition font-semibold"
            >
              {t('storyboard.connector.save')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
