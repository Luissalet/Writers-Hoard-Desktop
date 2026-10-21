import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useState,useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import { useTranslation } from '@/i18n/useTranslation';
import { LocalMediaPlayer } from '@/engines/media/LocalMediaPlayer';
import VoiceMemoPlayer from '@/engines/media/VoiceMemoPlayer';
import {readEraRow} from '@/services/worldEras/store';
import {useEnginePane} from '@/engines/_shared/EnginePaneContext';
import type {LocalMediaAsset} from '@/engines/media/types';
import { blockIdentifier, type CodexBlockHost } from '../codexBlocks/model';
const noSubscription = () => () => {};
export default function MediaBlockView({ node, extension, selected }: NodeViewProps) {
  const { locale } = useTranslation(); const host = extension.options as CodexBlockHost;
  const pane=useEnginePane(),[error,setError]=useState('');
  useSyncExternalStore(host.subscribe ?? noSubscription, () => JSON.stringify(host.context()));
  const projectId = blockIdentifier(node.attrs.projectId), assetId = blockIdentifier(node.attrs.assetId);
  const allowed = Boolean(projectId && projectId === host.context().projectId);
  const eraId=pane?.projectId===projectId?pane.eraId:undefined;
  const result = useLiveQuery(async () => { const asset = allowed ? eraId?await readEraRow<LocalMediaAsset>({projectId,eraId},'localMediaAssets',assetId):await db.localMediaAssets.get(assetId) : undefined; return { asset: asset?.projectId === projectId ? asset : undefined,eraId }; }, [allowed, projectId, assetId,eraId]);
  const asset = allowed && result?.eraId===eraId && result?.asset?.id === assetId && result.asset.projectId === projectId ? result.asset : undefined;
  return <NodeViewWrapper as="figure" contentEditable={false} data-local-media-view className={`not-prose my-4 rounded-lg border bg-surface p-4 ${selected ? 'border-accent-gold' : 'border-border'}`}>
    {asset ? asset.voiceMemo?<VoiceMemoPlayer key={`${projectId}:${eraId??'base'}:${asset.id}`} asset={asset} eraId={eraId} locale={locale} report={setError}/>:<><figcaption className="mb-3 break-words text-sm text-text-primary">{asset.title}</figcaption><LocalMediaPlayer key={`${eraId??'base'}:${asset.id}`} asset={asset} loop={false} speed={1} fallback={locale === 'es' ? 'El sistema no puede reproducir este formato.' : 'Your system cannot play this format.'} /></> : <p className="m-0 text-sm text-text-muted">{!allowed ? locale === 'es' ? 'Referencia de otro proyecto o sin contexto local.' : 'Reference outside this project or without local context.' : !result ? locale === 'es' ? 'Cargando medio local…' : 'Loading local media…' : locale === 'es' ? 'El archivo vinculado no está disponible.' : 'The linked media file is unavailable.'}</p>}
    {error&&<p role="status" className="text-sm text-text-muted">{error}</p>}
  </NodeViewWrapper>;
}
