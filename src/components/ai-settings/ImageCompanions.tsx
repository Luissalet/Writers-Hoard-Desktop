// ============================================================================
// AI settings — image companions: ControlNets and upscalers
// ============================================================================
//
// Files the image server is pointed at rather than models it runs. Each
// catalogued one is fetched by pinned digest into a folder main owns, exactly
// as a model is, so the row mirrors a model row: size, download with progress
// and cancel, delete behind a confirm. A ControlNet is chosen when the server
// starts; that cost is stated once, in the panel note, and again in the delete
// confirm when the running server is holding the file.
//
// `ImageCompanionRow` is also mounted by the Image Studio, next to a Generate
// button a missing ControlNet has blocked, so the fix sits where the problem
// is read.

import { useState } from 'react';
import { CheckCircle2, Download, ExternalLink, Puzzle, Trash2, X, XCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfirmDialog } from '@/engines/_shared';
import { useImageRuntimeStore } from '@/stores/imageRuntimeStore';
import { LOCAL_IMAGE_COMPANIONS, type ImageCompanionAsset } from '@/services/aiRuntime/imageCatalog';
import { formatBytes } from '@/services/aiRuntime/fit';
import ProgressBar from './ProgressBar';

export function ImageCompanionRow({ asset, onDelete }: { asset: ImageCompanionAsset; onDelete?: (asset: ImageCompanionAsset) => void }) {
  const { t } = useTranslation();
  const status = useImageRuntimeStore((s) => s.status);
  const progress = useImageRuntimeStore((s) => s.progress[asset.id]);
  const error = useImageRuntimeStore((s) => s.errors[asset.id]);
  const downloadCompanion = useImageRuntimeStore((s) => s.downloadCompanion);
  const cancelCompanionDownload = useImageRuntimeStore((s) => s.cancelCompanionDownload);

  const file = status?.companions?.find((c) => c.catalogId === asset.id);
  const isDownloading = status?.downloadingCompanion === asset.id || progress !== undefined;
  const isLoaded = Boolean(file) && status?.loadedControlNet === asset.fileName;
  // Main downloads one companion at a time and answers a second with 'busy'.
  const otherDownloading = Boolean(status?.downloadingCompanion) && status?.downloadingCompanion !== asset.id;

  return (
    <div data-companion={asset.id} className={`px-4 py-2.5 rounded-lg border text-sm ${file ? 'border-accent-gold/30' : 'border-border'}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium truncate text-text-primary">{asset.label}</span>
          <span className="text-[9px] px-1 rounded bg-elevated text-text-dim uppercase">{t(`settings.ai.imageCompanions.kind.${asset.kind}`)}</span>
          {file && (
            <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 uppercase tracking-wide">
              <CheckCircle2 size={9} />
              {t('settings.ai.imageCompanions.installed')}
            </span>
          )}
          {isLoaded && <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 uppercase tracking-wide">{t('settings.ai.imageModels.loaded')}</span>}
        </div>
        <span className="text-[10px] text-text-dim flex-shrink-0 tabular-nums">
          {file ? t('settings.ai.local.installedSize').replace('{size}', formatBytes(file.sizeBytes)) : formatBytes(asset.sizeBytes)}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 flex-wrap text-[10px] text-text-dim">
        <span className="font-mono">{asset.id}</span>
        <a href={asset.licenseUrl} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 hover:text-accent-gold transition" title={t('settings.ai.imageModels.licenseHint')}>
          {asset.license}
          <ExternalLink size={9} />
        </a>
      </div>
      <p className="text-[10px] text-text-dim mt-0.5">{t(`settings.ai.imageCompanions.${asset.pitchKey}`)}</p>

      {isDownloading ? (
        <div className="mt-2 space-y-1.5" role="status">
          <ProgressBar progress={progress && progress.totalBytes > 0 ? progress.receivedBytes / progress.totalBytes : 0} indeterminate={!progress} />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-muted tabular-nums">
              {progress ? `${formatBytes(progress.receivedBytes)} / ${formatBytes(progress.totalBytes)}` : t('settings.ai.local.preparing')}
            </span>
            <button type="button" onClick={() => void cancelCompanionDownload(asset.id)} className="text-[11px] text-text-dim hover:text-danger transition flex items-center gap-1">
              <X size={11} />
              {t('settings.ai.local.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex items-center justify-end gap-1.5">
          {file ? (
            onDelete && (
              <button
                type="button"
                onClick={() => onDelete(asset)}
                title={t('settings.ai.local.delete')}
                aria-label={t('settings.ai.local.delete')}
                className="p-1.5 rounded text-text-dim hover:text-danger hover:bg-danger/10 transition"
              >
                <Trash2 size={12} />
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={() => void downloadCompanion(asset.id)}
              disabled={otherDownloading}
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded bg-accent-gold/10 text-accent-gold hover:bg-accent-gold/20 transition disabled:opacity-50"
            >
              <Download size={11} />
              {t('settings.ai.local.download')}
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="mt-2 flex items-center gap-2 px-2 py-1.5 bg-red-500/10 text-red-400 text-[11px] rounded">
          <XCircle size={12} className="flex-shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}
    </div>
  );
}

export default function ImageCompanionsPanel() {
  const { t } = useTranslation();
  const status = useImageRuntimeStore((s) => s.status);
  const deleteCompanion = useImageRuntimeStore((s) => s.deleteCompanion);
  const [pendingDelete, setPendingDelete] = useState<ImageCompanionAsset | null>(null);

  // Files the writer dropped into the folders by hand still count for the
  // studio's ControlNet choice, so they are named here too; the app did not
  // download them and does not delete them.
  const byHand = (status?.companions ?? []).filter((c) => c.catalogId === null);
  const pendingFile = pendingDelete ? status?.companions?.find((c) => c.catalogId === pendingDelete.id) : undefined;
  const pendingLoaded = Boolean(pendingDelete) && status?.loadedControlNet === pendingDelete?.fileName;

  return (
    <div className="space-y-2 rounded-lg border border-border px-4 py-3">
      <div className="flex items-center gap-2">
        <Puzzle size={13} className="text-accent-gold flex-shrink-0" />
        <p className="text-sm text-text-primary font-medium">{t('settings.ai.imageCompanions.title')}</p>
      </div>
      <p className="text-[10px] text-text-dim">{t('settings.ai.imageCompanions.note')}</p>
      <div className="space-y-1.5">
        {LOCAL_IMAGE_COMPANIONS.map((asset) => (
          <ImageCompanionRow key={asset.id} asset={asset} onDelete={setPendingDelete} />
        ))}
      </div>
      {byHand.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-text-dim">{t('settings.ai.imageCompanions.byHand')}</p>
          <ul className="space-y-1">
            {byHand.map((file) => (
              <li key={`${file.kind}/${file.fileName}`} className="flex items-center gap-2 text-[11px]">
                <span className="font-mono text-text-primary truncate">{file.fileName}</span>
                <span className="text-[9px] px-1 rounded bg-elevated text-text-dim uppercase">{t(`settings.ai.imageCompanions.kind.${file.kind}`)}</span>
                <span className="ml-auto text-text-dim tabular-nums flex-shrink-0">{formatBytes(file.sizeBytes)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        destructive
        message={[
          t('settings.ai.imageCompanions.deleteConfirm')
            .replace('{name}', pendingDelete?.label ?? '')
            .replace('{size}', formatBytes(pendingFile?.sizeBytes ?? pendingDelete?.sizeBytes)),
          pendingLoaded ? t('settings.ai.imageCompanions.deleteStopsServer') : '',
        ].filter(Boolean).join(' ')}
        onConfirm={() => {
          const asset = pendingDelete;
          setPendingDelete(null);
          if (asset) void deleteCompanion(asset.id);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
