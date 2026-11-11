import {useLocalToolAssetPreview} from '../useLocalToolAssetPreview';
import {useRichProseHostContext} from '../RichProseEditor';
import {renderRichProsePreview} from '../richProseHtml';
import {useLocalToolAudioLifecycle} from '../useLocalToolAudioLifecycle';
import {LocalToolUndoBoundary} from '../LocalToolUndoBoundary';
import {LocalToolAtomPendingContext, setLocalToolAtomPending} from './pending';
import {useContext, useMemo, useRef, useLayoutEffect, useSyncExternalStore, useEffect, useState} from 'react';
import {NodeViewWrapper, type NodeViewProps} from '@tiptap/react';
import {useLiveQuery} from 'dexie-react-hooks';
import {db} from '@/db';
import {listWorldDocuments} from '@/services/worldEras/store';
import {useTranslation} from '@/i18n/useTranslation';
import {useEnginePane} from '@/engines/_shared/EnginePaneContext';
import {resolveProjectLocalTool} from '../releases';
import {createLocalToolClient} from '../storage';
import {LocalToolHostAncestors} from '../documents/hostContext';
import {localToolBlockPreview} from './preview';
import {validateLocalToolBlockEnvelope, type LocalToolBlockEnvelope} from './types';
import {validateBlockForDefinition} from './definitions';
import {createOwnedBlockClient} from './client';
import type {LocalToolEditorHost} from './editorHost';
import {
  captureOwnedAtomAccess, getOwnedBlockPanel, openOwnedBlockPanel, registerOwnedBlockPanel,
  subscribeOwnedBlockPanels, type LiveOwnedBlockPort, type OwnedBlockPanelSession,
} from './panelSessions';

export default function SourceToolBlockView(props: NodeViewProps) {
  const envelope = props.node.attrs.envelope as LocalToolBlockEnvelope | null;
  return envelope ? <SourceBlockSession key={JSON.stringify([props.node.attrs.projectId, envelope.id, envelope.namespace, envelope.key])} {...props}/> :
    <NodeViewWrapper contentEditable={false}><p role="alert">Invalid source block</p></NodeViewWrapper>;
}

function SourceBlockSession({node, editor, extension, getPos, selected}: NodeViewProps) {
  useSyncExternalStore(changed => {
    editor.on('transaction', changed);
    return () => { editor.off('transaction', changed); };
  }, () => editor.state);
  const envelope = node.attrs.envelope as LocalToolBlockEnvelope;
  const {id: blockId, namespace, key: blockKey} = envelope;
  const projectId = String(node.attrs.projectId);
  const host = (extension.options as {host: LocalToolEditorHost}).host;
  const {locale} = useTranslation();
  const pane = useEnginePane();
  const eraId = host.context().eraId;
  const ancestors = useContext(LocalToolHostAncestors);
  const identity = JSON.stringify([projectId, eraId ?? null, 'source-block', blockId]);
  const alive = useRef(true);
  const session = useRef(crypto.randomUUID());
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const documents = useLiveQuery(async () => envelope.scope === 'world' ?
    (await listWorldDocuments({projectId, eraId}, envelope.world.kind)).map(read => read.document) : undefined,
  [projectId, eraId, envelope.scope, envelope.scope === 'world' ? envelope.world.kind : '']);
  let source: ReturnType<typeof resolveProjectLocalTool> | undefined, error = '';
  try {
    if (project) {
      source = resolveProjectLocalTool(namespace, project);
      const block = source.blocks?.find(item => item.key === blockKey);
      if (!block) throw Error('local_tool_block_source_unavailable');
      validateBlockForDefinition(envelope, block);
    }
  } catch (reason) { error = String(reason); source = undefined; }

  const definition = source?.blocks?.find(item => item.key === blockKey);
  const position = typeof getPos === 'function' ? getPos() : undefined;
  const owner = typeof position === 'number' ? host.context().owner(editor, position) : undefined;
  const ownerKind = owner?.kind, ownerId = owner?.documentId;
  const canEdit = editor.isEditable && !!owner && !!project?.enabledEngines.includes('local-tool-' + namespace) &&
    host.context().projectId === projectId && !ancestors.includes(identity);
  const sourcePin = project?.localToolInstallations?.[namespace]?.contentHash ?? null;
  const navigate = pane?.openBeside ?? pane?.navigate;
  const live = useRef({sourcePin, canEdit, host, getPos});
  useLayoutEffect(() => { live.current = {sourcePin, canEdit, host, getPos}; }, [sourcePin, canEdit, host, getPos]);

  const port = useMemo<LiveOwnedBlockPort | undefined>(() => {
    if (!source || definition?.scope !== 'host' || !ownerKind || !ownerId || !canEdit) return;
    const scope = {projectId, eraId};
    const owner = {kind: ownerKind, documentId: ownerId};
    const assertAvailable = captureOwnedAtomAccess(editor, scope, owner, blockId);
    function locate() {
      const current = live.current;
      const context = current.host.context();
      if (!alive.current || editor.isDestroyed || !editor.isEditable || context.projectId !== projectId ||
        context.eraId !== eraId || !current.canEdit || current.sourcePin !== sourcePin) throw Error('local_tool_block_context_expired');
      assertAvailable();
      const pos = current.getPos();
      if (typeof pos !== 'number') throw Error('local_tool_block_missing');
      const actual = editor.state.doc.nodeAt(pos);
      const actualOwner = context.owner(editor, pos);
      if (actual?.type.name !== 'sourceToolBlock' || actual.attrs.projectId !== projectId ||
        actualOwner?.kind !== ownerKind || actualOwner?.documentId !== ownerId) throw Error('local_tool_block_context_expired');
      const stored: unknown = actual.attrs.envelope;
      validateLocalToolBlockEnvelope(stored);
      if (stored.scope !== 'host' || stored.id !== blockId || stored.namespace !== namespace || stored.key !== blockKey)
        throw Error('local_tool_block_context_expired');
      return {pos, node: actual, envelope: stored};
    }
    return {
      identity: JSON.stringify([projectId, eraId ?? null, owner, blockId, namespace, blockKey, sourcePin, session.current]),
      read: () => structuredClone(locate().envelope),
      subscribe(changed) {
        editor.on('transaction', changed);
        return () => { editor.off('transaction', changed); };
      },
      async commit(before, next, isCurrent) {
        const project = await db.projects.get(projectId);
        if (!project?.enabledEngines.includes('local-tool-' + namespace) ||
          (project.localToolInstallations?.[namespace]?.contentHash ?? null) !== sourcePin ||
          resolveProjectLocalTool(namespace, project) !== source ||
          live.current.host.context().allowOwnedBlockPanel && !project.enabledEngines.includes(ownerKind) ||
          isCurrent && !isCurrent()) throw Error('local_tool_block_context_expired');
        const current = locate();
        if (JSON.stringify(current.envelope) !== JSON.stringify(before)) throw Error('local_tool_block_conflict');
        editor.view.dispatch(editor.state.tr.setNodeMarkup(current.pos, undefined, {...current.node.attrs, envelope: next}));
      },
    };
  }, [source, definition, ownerKind, ownerId, canEdit, projectId, eraId, editor, sourcePin, blockId, namespace, blockKey]);

  const client = useMemo(() => {
    if (!source || !definition) return;
    if (definition.scope === 'world') return createLocalToolClient(projectId, source, {eraId, readOnly: true, navigate});
    if (port && ownerKind && ownerId)
      return createOwnedBlockClient({projectId, eraId}, source, definition, {kind: ownerKind, documentId: ownerId}, port, navigate);
  }, [source, definition, projectId, eraId, navigate, port, ownerKind, ownerId]);
  useLocalToolAudioLifecycle(client?.audio);

  const report = useMemo(() => (token: string, pending: boolean) =>
    setLocalToolAtomPending(editor, 'owned:' + blockId, token, pending), [editor, blockId]);
  const paneId = pane?.instanceId, canOpen = !!pane?.openBeside && !!host.context().allowOwnedBlockPanel;
  const [panel, setPanel] = useState<OwnedBlockPanelSession>();
  const [openFailed, setOpenFailed] = useState(false);
  useLayoutEffect(() => {
    if (!canOpen || !paneId || !source || definition?.scope !== 'host' || !port || !ownerKind || !ownerId) return;
    const registered = registerOwnedBlockPanel({
      scope: {projectId, eraId}, owner: {kind: ownerKind, documentId: ownerId},
      blockId, source, sourcePin, definition, paneId, editor, port, report, ancestors: [...ancestors, identity],
    });
    setPanel(registered.session);
    return registered.release;
  }, [canOpen, paneId, source, definition, port, ownerKind, ownerId, projectId, eraId, blockId, sourcePin, editor, report, ancestors, identity]);
  const livePanel = useSyncExternalStore(subscribeOwnedBlockPanels,
    () => panel && panel.port === port ? getOwnedBlockPanel(panel.token, panel.scope, panel.owner.kind) : undefined);
  const [leaveBlocked, setLeaveBlocked] = useState(false);
  useEffect(() => {
    const notify = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail.editor === editor && detail.key === 'owned:' + blockId) setLeaveBlocked(true);
    };
    window.addEventListener('wh-source-block-pending', notify);
    return () => window.removeEventListener('wh-source-block-pending', notify);
  }, [editor, blockId]);

  const semantic = localToolBlockPreview(envelope, locale, documents);
  const preview = useLocalToolAssetPreview(semantic, projectId, namespace, eraId);
  const Component = definition?.component;
  const richContext = useRichProseHostContext({
    view: 'embed', canEdit, scope: {projectId, eraId}, ...(envelope.scope === 'host' ? {blockPresentation: 'inline'} : {}),
  }, client, envelope.scope === 'host' ? (canEdit && definition?.scope === 'host' ? definition.codec : envelope.codec) : undefined);
  return <NodeViewWrapper as="figure" contentEditable={false} data-wh-source-live-view data-source-block-id={blockId}
    className={`not-prose my-4 min-w-0 rounded-xl border bg-surface p-4 ${selected ? 'border-accent-gold ring-1 ring-accent-gold' : 'border-border'}`}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="min-w-0 break-words font-display text-lg text-text-primary">{envelope.name[locale]}</h3>
      {livePanel && <button type="button" data-tool-editor-surface className="min-h-9 rounded border border-border px-3 text-xs"
        onClick={() => { void openOwnedBlockPanel(livePanel).then(result => setOpenFailed(!result.applied), () => setOpenFailed(true)); }}>
        {locale === 'es' ? 'Abrir bloque al lado' : 'Open block beside'}
      </button>}
    </div>
    {error && <p className="mb-3 text-xs text-text-muted">{locale === 'es' ? 'Fuente no disponible; se conserva el contenido guardado.' : 'Source unavailable; saved content is preserved.'}</p>}
    {openFailed && <p role="status" className="mb-3 text-sm text-text-muted">{locale === 'es' ? 'No se pudo abrir el bloque al lado.' : 'Could not open the block beside.'}</p>}
    {leaveBlocked && <p role="alert" className="mb-3 text-sm text-danger">{locale === 'es' ? 'Guarda o descarta el borrador del bloque antes de quitarlo.' : 'Save or discard the block draft before removing it.'}</p>}
    <LocalToolAtomPendingContext.Provider value={report}><LocalToolHostAncestors.Provider value={[...ancestors, identity]}>
      <LocalToolUndoBoundary data-tool-editor-surface>
        {Component && client && canEdit ? <Component projectId={projectId} client={client} context={richContext}/> :
          <div className="prose prose-sm max-w-none break-words" dangerouslySetInnerHTML={{__html: renderRichProsePreview(preview, false)}}/>}
      </LocalToolUndoBoundary>
    </LocalToolHostAncestors.Provider></LocalToolAtomPendingContext.Provider>
  </NodeViewWrapper>;
}
