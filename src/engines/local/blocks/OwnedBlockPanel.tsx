import {useLayoutEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {useTranslation} from '@/i18n/useTranslation';
import {useEnginePane} from '@/engines/_shared/EnginePaneContext';
import type {WorldEraScope} from '@/services/worldEras/types';
import {LocalToolUndoBoundary} from '../LocalToolUndoBoundary';
import LocalToolPendingBoundary from '../LocalToolPendingBoundary';
import {LocalToolHostAncestors} from '../documents/hostContext';
import {useRichProseHostContext} from '../RichProseEditor';
import {useLocalToolAudioLifecycle} from '../useLocalToolAudioLifecycle';
import {createOwnedBlockClient} from './client';
import {LocalToolAtomPendingContext} from './pending';
import {getOwnedBlockPanel, subscribeOwnedBlockPanels, type OwnedBlockPanelSession} from './panelSessions';

const mountedPanels = new Set<string>();

export function OwnedBlockPanelUnavailable() {
  const {locale} = useTranslation();
  return <p data-owned-block-panel-unavailable role="status" className="p-4 text-sm text-text-muted">
    {locale === 'es' ? 'Este bloque ya no estÃƒÂ¡ disponible en el panel.' : 'This block is no longer available in the panel.'}
  </p>;
}

export default function OwnedBlockPanel({token, scope, ownerKind}: {token: string; scope: WorldEraScope; ownerKind: string}) {
  const session = useSyncExternalStore(subscribeOwnedBlockPanels, () => getOwnedBlockPanel(token, scope, ownerKind));
  return session ? <MountedOwnedBlockPanel key={token} session={session}/> : <OwnedBlockPanelUnavailable/>;
}

function MountedOwnedBlockPanel({session}: {session: OwnedBlockPanelSession}) {
  const {locale} = useTranslation();
  const pane = useEnginePane();
  const reportTitle = pane?.reportTitle;
  const {scope, owner, blockId, token, definition, source, port, report, ancestors} = session;
  const title = definition.name[locale];
  const [instance] = useState(() => crypto.randomUUID());
  useLayoutEffect(() => { reportTitle?.(title); }, [reportTitle, title]);
  useLayoutEffect(() => {
    mountedPanels.add(instance);
    return () => { mountedPanels.delete(instance); };
  }, [instance]);
  const client = useMemo(() => {
    const isCurrent = () => mountedPanels.has(instance) && getOwnedBlockPanel(token, scope, owner.kind) === session;
    function assertCurrent() {
      if (!isCurrent()) throw Error('local_tool_block_context_expired');
    }
    return createOwnedBlockClient(scope, source, definition, owner, {
      identity: JSON.stringify([port.identity, 'panel', instance]),
      read() { assertCurrent(); return port.read(); },
      commit(before, next) { assertCurrent(); return port.commit(before, next, isCurrent); },
      subscribe: port.subscribe,
    }, pane?.openBeside);
  }, [scope, owner, token, definition, source, port, session, instance, pane?.openBeside]);
  useLocalToolAudioLifecycle(client.audio);
  const context = useRichProseHostContext({view: 'embed', canEdit: true, scope, blockPresentation: 'panel'}, client, definition.codec);
  const Component = definition.component;
  if (!Component) return <OwnedBlockPanelUnavailable/>;
  return <section data-owned-block-panel={blockId} aria-label={title} className="min-w-0 rounded-xl border border-border bg-surface p-4">
    <h3 className="mb-3 break-words font-display text-lg text-text-primary">{title}</h3>
    <LocalToolAtomPendingContext.Provider value={report}>
      <LocalToolPendingBoundary>
        <LocalToolHostAncestors.Provider value={ancestors}>
          <LocalToolUndoBoundary data-tool-editor-surface>
            <Component projectId={scope.projectId} client={client} context={context}/>
          </LocalToolUndoBoundary>
        </LocalToolHostAncestors.Provider>
      </LocalToolPendingBoundary>
    </LocalToolAtomPendingContext.Provider>
  </section>;
}
