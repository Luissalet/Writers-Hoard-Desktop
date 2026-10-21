import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Modal from '@/components/common/Modal';
import { useTranslation } from '@/i18n/useTranslation';
import { sanitizedHtml } from '@/utils/sanitizeRichHtml';
import { listParallelDraftHistory, readParallelDraftHistory } from '../parallelDraftHistory';
import { restoreParallelDraftHistory, type PaneDocument } from '../parallelDrafts';
import type { WritingSnapshot } from '../snapshotTypes';
const button = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';
export default function ParallelDraftHistoryModal({ document, onClose }: { document: PaneDocument; onClose: () => void }) {
  const { locale } = useTranslation(), es = locale === 'es';
  const rows = useLiveQuery(() => listParallelDraftHistory(document), [document.projectId, document.eraId, document.writingId, document.draftId]);
  const [selected, setSelected] = useState(''), [version, setVersion] = useState<WritingSnapshot>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { let active = true; setVersion(undefined); if (selected) void readParallelDraftHistory(document, selected).then(row => { if (active) setVersion(row); }).catch(cause => { if (active) setError(String(cause)); }); return () => { active = false; }; }, [selected, document]);
  return <Modal open title={`${es ? 'Historial del borrador' : 'Draft history'} · ${document.draftName ?? ''}`} busy={busy} onClose={onClose}>
    <div className="max-h-[75vh] space-y-4 overflow-y-auto p-4 sm:p-6">
      <p className="text-sm text-text-muted">{es ? 'Restaurar sustituye sólo esta alternativa y guarda su texto actual en este historial.' : 'Restore replaces only this alternative and retains its current text in this history.'}</p>
      <label className="block space-y-1 text-sm">{es ? 'Versión guardada' : 'Saved version'}<select className="w-full rounded-lg border border-border bg-deep p-2" value={selected} onChange={event => setSelected(event.target.value)}><option value="">{es ? 'Elige una versión' : 'Choose a version'}</option>{rows?.map(row => <option key={row.id} value={row.id}>{new Date(row.createdAt).toLocaleString(locale)} · {row.wordCount} {es ? 'palabras' : 'words'} · {row.draftName}</option>)}</select></label>
      {rows?.length === 0 && <p className="text-sm text-text-muted">{es ? 'Las versiones anteriores aparecerán al guardar cambios en este borrador.' : 'Previous versions appear when changes to this draft are saved.'}</p>}
      {version && <div className="tiptap-editor rounded-lg border border-border p-4" data-draft-history-preview dangerouslySetInnerHTML={sanitizedHtml(version.content)} />}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || !version} onClick={async () => { setBusy(true); setError(''); try { await restoreParallelDraftHistory(document, selected); onClose(); } catch { setError(es ? 'El borrador ha cambiado. Cierra el historial y vuelve a abrirlo para revisar la versión actual.' : 'The draft changed. Close and reopen history to review its current version.'); } finally { setBusy(false); } }}>{es ? 'Restaurar en este borrador' : 'Restore in this draft'}</button><button type="button" className={button} disabled={busy} onClick={onClose}>{es ? 'Cerrar' : 'Close'}</button></div>
    </div>
  </Modal>;
}
