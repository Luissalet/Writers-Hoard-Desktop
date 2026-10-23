// "Reveal to the players" / "Hide again" for one Codex card, with the badge that says
// it is revealed. One component for the card dialog, the card editor header and the
// Consult panel, so all three write through the same operation.
import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { setCodexRevealed, readReveal } from '@/engines/codex/reveal';
import { revealCopy } from '@/engines/codex/revealCopy';
import { useWorldEraScope } from '@/services/worldEras/hooks';
import { useTranslation } from '@/i18n/useTranslation';
import type { CodexEntry, CodexReveal } from '@/types';

interface Props {
  projectId: string;
  entry: Pick<CodexEntry, 'id' | 'revealed'>;
  /** Called after the marker was written, so the host can refresh its own copy of the card. */
  onChanged?: () => void | Promise<void>;
  compact?: boolean;
  /** Keeps a surrounding editor from losing its selection when the button is pressed. */
  keepFocus?: (event: React.MouseEvent) => void;
}

export default function CodexRevealControl({ projectId, entry, onChanged, compact, keepFocus }: Props) {
  const { locale } = useTranslation();
  const copy = revealCopy[locale === 'en' ? 'en' : 'es'];
  const scope = useWorldEraScope(projectId);
  const [moment, setMoment] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // What we just wrote, shown until the host hands us a card that already carries it.
  const [written, setWritten] = useState<{ base: string; value: CodexReveal | null } | null>(null);
  const stored = JSON.stringify(readReveal(entry.revealed) ?? null);
  const marker = written && written.base === stored ? written.value : readReveal(entry.revealed) ?? null;

  const change = async (reveal: boolean) => {
    setBusy(true); setFailed(false);
    try {
      const { changes } = await setCodexRevealed(scope, [entry.id], reveal, reveal ? { moment } : {});
      setWritten({ base: stored, value: changes[0] ? changes[0].after : marker });
      if (reveal) setMoment('');
      notifyDataChanged({ source: 'other', projectId, table: 'codexEntries', entityId: entry.id });
      await onChanged?.();
    } catch (error) {
      console.error('Codex reveal could not be changed', error);
      setFailed(true);
    } finally { setBusy(false); }
  };

  const button = 'inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs text-text-primary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/50 disabled:opacity-60';
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="codex-reveal" data-revealed={marker ? 'true' : 'false'}>
      {marker && <span data-testid="codex-reveal-state" className="inline-flex items-center gap-1 rounded bg-accent-gold/15 px-2 py-1 text-xs text-accent-gold"><Eye size={12} aria-hidden="true" />{marker.moment ? copy.revealedAt.replace('{moment}', marker.moment) : copy.revealedOn.replace('{date}', new Date(marker.at).toLocaleDateString(locale === 'en' ? 'en-GB' : 'es-ES'))}</span>}
      {!marker && !compact && (
        <label className="inline-flex items-center gap-1 text-xs text-text-muted">
          <span className="sr-only">{copy.moment}</span>
          <input type="text" value={moment} maxLength={120} onChange={event => setMoment(event.target.value)} placeholder={copy.momentPlaceholder} aria-label={copy.moment} data-testid="codex-reveal-moment" className="w-28 rounded-md border border-border bg-elevated px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-gold" />
        </label>
      )}
      <button type="button" disabled={busy} onMouseDown={keepFocus} onClick={() => { void change(!marker); }} data-testid="codex-reveal-toggle" aria-pressed={!!marker} className={button}>
        {marker ? <EyeOff size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}{marker ? copy.hide : copy.reveal}
      </button>
      {failed && <span role="alert" className="text-xs text-danger">{copy.failed}</span>}
    </div>
  );
}
