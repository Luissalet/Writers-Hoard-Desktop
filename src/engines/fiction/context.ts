import { api } from './native/lib/api';
import { buildContext, collectEditors, getView } from './native/lib/copilot-context';
import type { WriterHoardContext } from '@/services/copilot/faustusProtocol';

export async function fictionContext(dataSpaceId: string, locale: string): Promise<WriterHoardContext> {
  const native = await buildContext({ view: getView(), editors: collectEditors(window), deps: {
    getWorld: api.getWorld, getEntity: api.getEntity, getWorldContext: api.worldContext,
    getThreads: api.listThreads, getClocks: api.listClocks,
  } });
  const project = native.project as WriterHoardContext['project'] | undefined;
  const objects = Array.isArray(native.active_objects) ? native.active_objects as Array<{ kind: string; object_id: string; title?: string }> : [];
  return {
    contract_version: '1.0',
    origin: { app_id: 'scheherazade', data_space_id: dataSpaceId, surface: 'editor' },
    project: project || { external_project_id: 'fiction-library', title: locale === 'es' ? 'Ficción interactiva' : 'Interactive fiction' },
    active_objects: objects.map(object => ({ ...object, app_id: 'scheherazade', data_space_id: dataSpaceId })),
    view: { ...(native.view as Record<string, unknown> || {}), mode: getView().section, locale, enabled_engines: ['fiction'] },
    attachments: [],
  };
}
