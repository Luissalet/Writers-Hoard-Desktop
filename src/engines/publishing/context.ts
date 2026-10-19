import { publishingFetch } from './transport';
import type { WriterHoardContext } from '@/services/copilot/faustusProtocol';

export async function publishingContext(module: string, locale: string): Promise<WriterHoardContext> {
  const identity = await (await publishingFetch(`/api/writer-identity/${module}`)).json() as { app_id: WriterHoardContext['origin']['app_id']; data_space_id: string };
  const adapter = (window as unknown as { hoardCopilot?: { context(): Promise<Record<string, unknown>> } }).hoardCopilot;
  const native = await adapter?.context() || {};
  const objects = (Array.isArray(native.active_objects) ? native.active_objects : []) as Array<{ kind: string; object_id: string; title?: string }>;
  return {
    contract_version: '1.0', origin: { ...identity, surface: 'editor' },
    project: native.project as WriterHoardContext['project'] || { external_project_id: '', title: module },
    active_objects: objects.map(object => ({ ...object, object_id: String(object.object_id), ...identity })),
    ...(native.selection ? { selection: native.selection as WriterHoardContext['selection'] } : {}),
    view: { ...(native.view as object || {}), mode: module, locale, enabled_engines: [module] }, attachments: [],
  };
}
