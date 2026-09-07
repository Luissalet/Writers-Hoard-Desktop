import { useState } from 'react';
import Modal from '@/components/common/Modal';
import { useTranslation } from '@/i18n/useTranslation';
import { worldWorkspaceCopy } from '../workspaceCopy';
import type { LocationPolicy } from '../recipe';

export default function RegenerateWorldDialog({ open, hasLocations, onClose, onConfirm }: {
  open: boolean; hasLocations: boolean; onClose: () => void; onConfirm: (policy: LocationPolicy) => void;
}) {
  const { locale } = useTranslation();
  const c = worldWorkspaceCopy(locale);
  const [policy, setPolicy] = useState<LocationPolicy>('keep');
  return <Modal open={open} onClose={onClose} title={c.replaceTitle}>
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-text-muted">{c.replaceHint}</p>
      {hasLocations && <fieldset className="space-y-3">
        <legend className="mb-3 text-sm font-medium text-text-primary">{c.locations}</legend>
        {(['keep', 'clear'] as const).map(value => <label key={value} className="flex cursor-pointer items-start gap-3 text-sm">
          <input type="radio" name="regeneration-locations" value={value} checked={policy === value} onChange={() => setPolicy(value)} className="mt-1 accent-accent-gold" />
          <span><span className="block text-text-primary">{c[value]}</span><span className="mt-1 block text-xs leading-relaxed text-text-muted">{c[value === 'keep' ? 'keepHint' : 'clearHint']}</span></span>
        </label>)}
      </fieldset>}
      <div className="flex flex-wrap justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-text-primary hover:bg-elevated">{c.cancel}</button>
        <button onClick={() => onConfirm(policy)} className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white">{c.replace}</button>
      </div>
    </div>
  </Modal>;
}
