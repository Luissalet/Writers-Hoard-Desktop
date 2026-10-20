// Legacy MCP identities keep their native tool contracts after incorporation.
// This is static data: discovery never imports an engine or starts the desktop.
import catalogue from '../../publishing/catalog.json';

const ALIASES: Record<string, string> = {
  borges: 'borges', library: 'library', links: 'links', kafka: 'paperwork',
  paperwork: 'paperwork', gutenberg: 'publishing', publishing: 'publishing',
};

export function publishingCompatModule(value: string): string {
  const module = ALIASES[value];
  if (!module) throw new Error(`Unknown incorporated publishing module: ${value}`);
  return module;
}

export function publishingCompatTools(module: string) {
  const native = catalogue.filter(tool => module === 'borges'
    ? ['library', 'links', 'paperwork'].includes(tool.module || '') : tool.module === module);
  const tools = native.map(({ module: _module, native_name, ...tool }) => ({ ...tool, name: native_name || tool.name }));
  if (module !== 'borges') return tools;
  return [
    { name: 'borges_modules', description: 'List modules without starting any engine.', inputSchema: { type: 'object', properties: {} } },
    { name: 'borges_set_module', description: "Enable or disable one module explicitly. All modules default OFF; enable only on the user's request.",
      inputSchema: { type: 'object', properties: { module: { type: 'string', enum: ['library', 'links', 'paperwork'] }, enabled: { type: 'boolean' },
        automatic: { type: 'boolean', description: 'Allow background automation explicitly; OFF by default.' } }, required: ['module', 'enabled'] } },
    ...catalogue.filter(tool => tool.name === 'borges_search_all').map(({ module: _module, native_name: _native, ...tool }) => tool),
    ...tools,
  ];
}

export function publishingCompatOwner(module: string, name: string): string {
  return module === 'borges' ? catalogue.find(tool => tool.name === name)?.module || '' : module;
}

export interface CompatResponse { status: number; body: Record<string, unknown> }
type Dispatch = (method: 'GET' | 'POST', path: string, payload?: unknown, headers?: Record<string, string>) => Promise<CompatResponse>;

export async function callPublishingCompat(module: string, payload: Record<string, unknown>, headers: Record<string, string>, dispatch: Dispatch): Promise<CompatResponse> {
  const name = String(payload.name || '');
  if (!publishingCompatTools(module).some(tool => tool.name === name)) return { status: 404, body: { error: 'unknown-tool', tool: name } };
  const args = payload.arguments && typeof payload.arguments === 'object' && !Array.isArray(payload.arguments) ? payload.arguments as Record<string, unknown> : {};
  if (name === 'borges_modules' || name === 'borges_set_module') {
    const method = name === 'borges_modules' ? 'GET' : 'POST';
    if (method === 'POST' && !['library', 'links', 'paperwork'].includes(String(args.module))) return { status: 400, body: { error: 'unknown-module' } };
    const response = await dispatch(method, '/modules', method === 'POST' ? args : undefined, headers);
    if (Array.isArray(response.body.modules)) response.body = { name: "Writer's Hoard", modules: response.body.modules.filter((item: { id: string }) => ['library', 'links', 'paperwork'].includes(item.id)) };
    return response;
  }
  if (name === 'borges_search_all') {
    const current = await dispatch('GET', '/modules', undefined, headers);
    if (current.status >= 400) return current;
    const modules = current.body.modules;
    if (Array.isArray(modules) && !modules.some((item: { id: string; enabled: boolean }) => ['library', 'links', 'paperwork'].includes(item.id) && item.enabled)) {
      return { status: 200, body: { query: args.q, sources: ['library', 'links', 'paperwork'].map(module => ({ module, status: 'module_disabled', results: [] })),
        note: 'Sólo se han consultado los módulos activos; las citas y resultados son los originales.' } };
    }
    return dispatch('POST', '/api/agent/call', payload, headers);
  }
  return dispatch('POST', `/${publishingCompatOwner(module, name)}/api/agent/call`, payload, headers);
}

export function publishingCompatIdentity(meta: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [header, variable, key, maximum] of [
    ['x-agent-id', 'HOARD_AGENT_ID', 'hoard/agent', 80],
    ['x-agent-session', 'HOARD_AGENT_SESSION', 'hoard/session', 120],
  ] as const) {
    const value = meta[key] ?? env[variable];
    if (typeof value === 'string' && value) result[header] = value.replace(/[^\x20-\x7e]/g, '').slice(0, maximum);
  }
  return result;
}

export function publishingCompatContext(meta: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of ['agent', 'session', 'reason', 'caller']) {
    const value = meta['hoard/' + name];
    if (typeof value === 'string' && value) result[name] = value;
  }
  return result;
}
