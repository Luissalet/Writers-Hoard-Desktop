import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useWorldEraScope } from '@/services/worldEras/hooks';
import { listEraRows } from '@/services/worldEras/store';
import { flushPendingWrites } from '@/services/pendingWrites';
import type { CodexEntry } from '@/types';
import type { sendProductionDossier } from './handoff';

export default function ProductionHandoff({ projectId, writingId, invalidTime }: {
  projectId: string;
  writingId: string;
  invalidTime: boolean;
}) {
  const { t } = useTranslation();
  const scope = useWorldEraScope(projectId);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof sendProductionDossier>>>();
  const [message, setMessage] = useState('');
  const cards = useLiveQuery(async () => (await listEraRows<CodexEntry>(scope, 'codexEntries'))
    .filter(card => card.type === 'character' || card.type === 'location')
    .sort((a, b) => a.title.localeCompare(b.title)), [scope.projectId, scope.eraId]);
  const selected = cards?.find(card => card.id === target);

  async function send() {
    setBusy(true);
    setMessage('');
    try {
      if (!(await flushPendingWrites()).ok) {
        setMessage(t('production.saveFirst'));
        return;
      }
      const { compileProductionDossier } = await import('./dossier');
      const { sendProductionDossier } = await import('./handoff');
      const dossier = await compileProductionDossier({
        ...scope, writingId, kind: selected?.type === 'character' ? 'character' : selected ? 'place' : 'scene',
        subjectId: selected?.id,
      });
      setResult(await sendProductionDossier(dossier));
      setMessage(t('production.sent'));
    } catch {
      setMessage(t('production.sendFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!result?.undo) return;
    setBusy(true);
    setMessage('');
    try {
      const { undoProductionHandoff } = await import('./handoff');
      await undoProductionHandoff(result.undo);
      setResult(undefined);
      setMessage(t('production.undone'));
    } catch {
      setMessage(t('production.undoFailed'));
    } finally {
      setBusy(false);
    }
  }

  const button = 'rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:border-accent-gold disabled:opacity-50';
  return (
    <details>
      <summary className="cursor-pointer text-sm text-text-muted">{t('production.dossier')}</summary>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="block text-sm text-text-muted">
          {t('production.subject')}
          <select value={selected?.id ?? ''} onChange={event => setTarget(event.target.value)}
            className="mt-1 block max-w-64 rounded-lg border border-border bg-elevated px-3 py-2 text-text-primary">
            <option value="">{t('production.chapterScene')}</option>
            {cards?.map(card => <option key={card.id} value={card.id}>{card.title}</option>)}
          </select>
        </label>
        <button type="button" className={button} disabled={busy || invalidTime || !window.electronAPI?.family?.call}
          onClick={() => void send()}>{t('production.send')}</button>
        {result?.undo && <button type="button" className={button} disabled={busy}
          onClick={() => void discard()}>{t('production.undo')}</button>}
      </div>
      {!window.electronAPI?.family?.call && <p className="mt-2 text-xs text-text-muted">{t('production.desktop')}</p>}
      <p role="status" className="mt-2 text-xs text-text-muted">{message}{result && <> <code>{result.production}</code></>}</p>
    </details>
  );
}

