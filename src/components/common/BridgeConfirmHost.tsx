// ============================================================================
// BridgeConfirmHost — the dialog an AI's deletion has to get past
// ============================================================================
//
// Mounted once in the layout. A bridge tool that wants to delete something
// queues a request in services/aiBridge/confirmation and waits; this renders
// the app's own ConfirmDialog for it, so the interaction is the same one the
// user gets everywhere else — Cancel focused by default, Escape cancels.

import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/engines/_shared';
import { useTranslation } from '@/i18n/useTranslation';
import {
  subscribeBridgeConfirm,
  type BridgeConfirmRequest,
} from '@/services/aiBridge/confirmation';

export default function BridgeConfirmHost() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<BridgeConfirmRequest | null>(null);

  useEffect(() => subscribeBridgeConfirm(setPending), []);

  if (!pending) return null;
  return (
    <ConfirmDialog
      open
      destructive
      title={t('settings.bridge.confirmTitle')}
      message={pending.message}
      onConfirm={() => pending.settle(true)}
      onCancel={() => pending.settle(false)}
    />
  );
}
