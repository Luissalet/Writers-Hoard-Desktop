import { useLiveQuery } from 'dexie-react-hooks';
import { LocalMediaPlayer } from '@/engines/media/LocalMediaPlayer';
import type { LocalMediaAsset } from '@/engines/media/types';
import { useTranslation } from '@/i18n/useTranslation';
import { readWorldDocument } from '@/services/worldEras/store';

type PreviewRead = { state: 'ready'; asset: LocalMediaAsset; version: string } | { state: 'missing' | 'error' };

/** Read only the selected Base resource; the parent keys this host by owner/target. */
export default function AssetsMediaPreview({ projectId, id, kind, name, onClose }: {
  projectId: string; id: string; kind: 'audio' | 'video'; name: string; onClose: () => void;
}) {
  const { t } = useTranslation();
  const read = useLiveQuery(async (): Promise<PreviewRead> => {
    try {
      const result = await readWorldDocument({ projectId }, 'media', id);
      const asset = result?.document.root as unknown as LocalMediaAsset | undefined;
      return asset?.id === id && asset.projectId === projectId && asset.kind === kind
        && asset.blob instanceof Blob && asset.blob.size > 0
        ? { state: 'ready', asset, version: result!.version }
        : { state: 'missing' };
    } catch {
      return { state: 'error' };
    }
  }, [projectId, id, kind]);

  return <section data-testid="assets-media-preview" data-preview-state={read?.state ?? 'loading'}
    aria-label={t('assetsLibrary.preview')} className="space-y-3 border-y border-border py-3">
    <div className="flex items-start gap-3">
      <h4 className="min-w-0 flex-1 break-words text-sm font-semibold text-text-primary">{read?.state === 'ready' ? read.asset.title : name}</h4>
      <button type="button" data-testid="assets-preview-close" onClick={onClose}
        className="min-h-9 shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold">{t('assetsLibrary.close')}</button>
    </div>
    {!read ? <p role="status" className="text-sm text-text-muted">{t('assetsLibrary.previewLoading')}</p>
      : read.state !== 'ready' ? <p role="status" className="text-sm text-text-muted">{t(read.state === 'missing' ? 'assetsLibrary.previewMissing' : 'assetsLibrary.previewFailed')}</p>
        : <LocalMediaPlayer key={`${projectId}:${id}:${kind}:${read.version}`} asset={read.asset}
          loop={false} speed={1} fallback={t('assetsLibrary.previewFormat')} />}
  </section>;
}
