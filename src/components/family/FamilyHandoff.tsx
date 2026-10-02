// ============================================================================
// Hand-off buttons: Prospero (a character, a storyboard) and Scheherazade (a world)
// ============================================================================
//
// The same work the bridge tools do (services/familyBridge/actions.ts), behind
// buttons, with a toast that says what happened or what to start. Only shown in
// the desktop app: the hub token lives there.

import { useState, type FormEvent } from 'react';
import { Clapperboard, Download, Send } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { toast } from '@/components/common/toast';
import Modal from '@/components/common/Modal';
import { isDesktop } from '@/utils/platform';
import {
  fetchWorldFromScheherazade, sendCharacterToProspero, sendStoryboardToProspero, sendWorldToScheherazade,
} from '@/services/familyBridge/actions';

const BUTTON =
  'inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-lg text-sm text-text-primary hover:border-accent-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold transition disabled:opacity-60 disabled:cursor-wait';

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One button that sends a codex character or a storyboard to Prospero's Hoard. */
export function SendToProsperoButton({ kind, projectId, id, className }: {
  kind: 'character' | 'storyboard';
  projectId: string;
  id: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  if (!isDesktop()) return null;

  const send = async () => {
    setBusy(true);
    try {
      if (kind === 'character') {
        const sent = await sendCharacterToProspero(projectId, id);
        toast.success(fill(t('family.characterSent'), { name: sent.name, n: sent.picturesSent }));
      } else {
        const sent = await sendStoryboardToProspero(projectId, id);
        toast.success(fill(t('family.storyboardSent'), { name: sent.title, n: sent.shots }));
      }
    } catch (error) {
      toast.error(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" onClick={() => void send()} disabled={busy} className={className ?? BUTTON} data-testid={`send-${kind}-to-prospero`}>
      <Clapperboard size={14} aria-hidden="true" />
      {busy ? t('family.sending') : t('family.toProspero')}
    </button>
  );
}

/** "Send to Scheherazade" and "Bring from Scheherazade" for the project's world. */
export function ScheherazadeButtons({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [sending, setSending] = useState(false);
  const [asking, setAsking] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [worldId, setWorldId] = useState('');
  if (!isDesktop()) return null;

  const send = async () => {
    setSending(true);
    try {
      const sent = await sendWorldToScheherazade(projectId);
      const counts = sent.counts ?? {};
      toast.success(fill(t('family.worldSent'), {
        world: sent.world?.name ?? sent.projectTitle,
        created: counts.created ?? 0,
        updated: counts.updated ?? 0,
        unchanged: counts.unchanged ?? 0,
        kept: (counts.local_modified ?? 0) + (counts.linked_existing ?? 0),
      }));
    } catch (error) {
      toast.error(messageOf(error));
    } finally {
      setSending(false);
    }
  };

  const bring = async (event: FormEvent) => {
    event.preventDefault();
    const wanted = worldId.trim();
    if (!wanted) return;
    setFetching(true);
    try {
      const result = await fetchWorldFromScheherazade(projectId, wanted);
      const counts = result.counts;
      toast.success(fill(t('family.worldFetched'), {
        world: result.world.name,
        created: counts.created ?? 0,
        updated: counts.updated ?? 0,
        unchanged: counts.unchanged ?? 0,
        kept: counts.local_modified ?? 0,
      }));
      setAsking(false);
      setWorldId('');
    } catch (error) {
      toast.error(messageOf(error));
    } finally {
      setFetching(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => void send()} disabled={sending} className={BUTTON} title={t('family.sendWorldHelp')} data-testid="send-world-to-scheherazade">
        <Send size={14} aria-hidden="true" />
        {sending ? t('family.sending') : t('family.toScheherazade')}
      </button>
      <button type="button" onClick={() => setAsking(true)} className={BUTTON} data-testid="bring-world-from-scheherazade">
        <Download size={14} aria-hidden="true" />
        {t('family.fromScheherazade')}
      </button>
      <Modal open={asking} busy={fetching} onClose={() => setAsking(false)} title={t('family.fetchTitle')}>
        <form onSubmit={event => void bring(event)} className="space-y-4">
          <label className="block text-sm text-text-muted">
            {t('family.fetchLabel')}
            <input
              value={worldId}
              onChange={event => setWorldId(event.target.value)}
              autoFocus
              className="mt-1 w-full px-3 py-2 bg-elevated border border-border rounded-lg text-text-primary text-sm outline-none focus:border-accent-gold transition"
              data-testid="scheherazade-world-id"
            />
          </label>
          <p className="text-xs text-text-muted">{t('family.fetchHelp')}</p>
          <div className="flex gap-3">
            <button type="submit" disabled={fetching || !worldId.trim()} className="flex-1 py-2.5 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-amber transition disabled:opacity-60">
              {fetching ? t('family.fetching') : t('family.fetchConfirm')}
            </button>
            <button type="button" onClick={() => setAsking(false)} disabled={fetching} className="px-6 py-2.5 border border-border text-text-primary rounded-lg hover:bg-elevated transition">
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
