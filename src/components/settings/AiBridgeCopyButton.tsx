import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

export default function CopyButton({ value, label, testId }: { value: string; label: string; testId?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span className="flex items-center gap-1">
    <button
      onClick={() => {
        setFailed(false);
        setCopied(false);
        void Promise.resolve().then(() => navigator.clipboard.writeText(value)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => setFailed(true));
      }}
      data-testid={testId}
      title={label}
      aria-label={copied ? t('settings.bridge.connect.copied') : label}
      className="p-1.5 rounded border border-border hover:border-accent-gold/40 text-text-muted hover:text-accent-gold transition flex-shrink-0"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
    <span role="status" className={failed ? 'text-[10px] text-red-400' : 'sr-only'}>
      {failed ? t('settings.bridge.connect.copyError') : copied ? t('settings.bridge.connect.copied') : ''}
    </span>
    </span>
  );
}
