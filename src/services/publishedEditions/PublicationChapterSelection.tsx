import { useLiveQuery } from 'dexie-react-hooks';
import { listParallelDraftMeta } from '@/engines/writings/parallelDrafts';
export default function PublicationChapterSelection({ projectId, eraId, writingId, title, checked, draftId, onToggle, onDraft, locale }: { projectId: string; eraId?: string; writingId: string; title: string; checked: boolean; draftId?: string; onToggle: (value: boolean) => void; onDraft: (value: string) => void; locale: 'es' | 'en' }) {
  const drafts = useLiveQuery(() => listParallelDraftMeta(projectId, writingId, eraId), [projectId, eraId, writingId]), es = locale === 'es';
  return <div className="space-y-2 rounded-lg border border-border p-2">
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-accent-gold" checked={checked} onChange={event => onToggle(event.target.checked)} /><span className="min-w-0 break-words">{title}</span></label>
    <label className="block space-y-1 text-xs text-text-muted">{es ? 'Texto que se publicará' : 'Text to publish'}<select className="w-full rounded-lg border border-border bg-deep px-2 py-2 text-sm text-text-primary" aria-label={`${es ? 'Borrador para publicar' : 'Draft to publish'} · ${title}`} disabled={!checked || !drafts} value={draftId ?? ''} onChange={event => onDraft(event.target.value)}><option value="">{es ? 'Capítulo principal' : 'Canonical chapter'}</option>{draftId && drafts && !drafts.some(row => row.id === draftId) && <option value={draftId}>{es ? 'Borrador ausente: elige otro' : 'Missing draft: choose another'}</option>}{drafts?.map(draft => <option key={draft.id} value={draft.id}>{draft.draftName}</option>)}</select></label>
  </div>;
}
