import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import { useTranslation } from '@/i18n/useTranslation';
import { LocalMediaPlayer } from '@/engines/media/LocalMediaPlayer';
import { blockIdentifier, type CodexBlockHost } from '../codexBlocks/model';
const noSubscription = () => () => {};
export default function MediaBlockView({ node, extension, selected }: NodeViewProps) {
  const { locale } = useTranslation(); const host = extension.options as CodexBlockHost;
  useSyncExternalStore(host.subscribe ?? noSubscription, () => JSON.stringify(host.context()));
  const projectId = blockIdentifier(node.attrs.projectId), assetId = blockIdentifier(node.attrs.assetId);
  const allowed = Boolean(projectId && projectId === host.context().projectId);
  const result = useLiveQuery(async () => { const asset = allowed ? await db.localMediaAssets.get(assetId) : undefined; return { asset: asset?.projectId === projectId ? asset : undefined }; }, [allowed, projectId, assetId]);
  const asset = allowed && result?.asset?.id === assetId && result.asset.projectId === projectId ? result.asset : undefined;
  return <NodeViewWrapper as="figure" contentEditable={false} data-local-media-view className={`not-prose my-4 rounded-lg border bg-surface p-4 ${selected ? 'border-accent-gold' : 'border-border'}`}>
    {asset ? <><figcaption className="mb-3 break-words text-sm text-text-primary">{asset.title}</figcaption><LocalMediaPlayer key={asset.id} asset={asset} loop={false} speed={1} fallback={locale === 'es' ? 'El sistema no puede reproducir este formato.' : 'Your system cannot play this format.'} /></> : <p className="m-0 text-sm text-text-muted">{!allowed ? locale === 'es' ? 'Referencia de otro proyecto o sin contexto local.' : 'Reference outside this project or without local context.' : !result ? locale === 'es' ? 'Cargando medio local…' : 'Loading local media…' : locale === 'es' ? 'El archivo vinculado no está disponible.' : 'The linked media file is unavailable.'}</p>}
  </NodeViewWrapper>;
}
