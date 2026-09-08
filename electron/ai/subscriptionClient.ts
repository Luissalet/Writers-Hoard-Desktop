import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AdapterError } from './adapters/http';

export type SubscriptionKind = 'claude-subscription' | 'codex-subscription';
const LIMIT = 2_000_000;
const instructions = 'Continue the supplied Writers Hoard conversation. Its system messages define the task and language. Return only the next assistant response. Do not use native tools, skills, or interactive questions.';

export function subscriptionEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const forbidden = /^(OPENAI_API_KEY|CODEX_API_KEY|OPENAI_BASE_URL|CODEX_ACCESS_TOKEN|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|ANTHROPIC_PROFILE|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_USE_.*)$/i;
  return Object.fromEntries(Object.entries(source).filter(([key]) => !forbidden.test(key)));
}
export function confirmsSubscription(kind: SubscriptionKind, code: number | null, text: string): boolean {
  if (code !== 0) return false;
  if (kind === 'codex-subscription') return text.split(/\r?\n/).some(line => line.trim() === 'Logged in using ChatGPT');
  try { const data = JSON.parse(text); return data.loggedIn === true && data.authMethod === 'claude.ai'; } catch { return false; }
}
interface Executable { file: string; prefix: string[] }
async function executable(kind: SubscriptionKind): Promise<Executable> {
  const name = kind === 'codex-subscription' ? 'codex' : 'claude';
  const dirs = (process.env.PATH ?? '').split(path.delimiter);
  if (process.platform === 'win32') dirs.push(path.join(os.homedir(), '.local', 'bin'), path.join(process.env.APPDATA ?? '', 'npm'));
  for (const dir of dirs) {
    for (const suffix of process.platform === 'win32' ? ['.exe', '.cmd'] : ['']) {
      const file = path.join(dir, name + suffix);
      try {
        if (!(await fs.stat(file)).isFile()) continue;
        if (suffix !== '.cmd') return { file, prefix: [] };
        // Run npm's known JS entry directly; never interpolate arguments into cmd.exe.
        const entry = path.join(dir, 'node_modules', name === 'codex' ? '@openai/codex/bin/codex.js' : '@anthropic-ai/claude-code/cli.js');
        if ((await fs.stat(entry)).isFile()) return { file: process.execPath, prefix: [entry] };
      } catch { /* Try next installation. */ }
    }
  }
  throw new AdapterError('unreachable', `Instala el cliente oficial ${name} y reinicia Writer’s Hoard para detectarlo.`);
}
const clients = new Set<ChildProcessWithoutNullStreams>();
export function shutdownSubscriptionClients(): void { for (const child of clients) stop(child); }
function start(exe: Executable, args: string[], cwd: string): ChildProcessWithoutNullStreams {
  const child = spawn(exe.file, [...exe.prefix, ...args], { cwd, detached: process.platform !== 'win32', env: { ...subscriptionEnvironment(), ...(exe.prefix.length ? { ELECTRON_RUN_AS_NODE: '1' } : {}) }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  clients.add(child); child.once('close', () => clients.delete(child));
  return child;
}
function stop(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill());
  } else {
    try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
    catch { child.kill('SIGKILL'); }
  }
}
async function capture(exe: Executable, args: string[], cwd: string, signal?: AbortSignal, input = '', timeout = 15_000): Promise<{ code: number | null; text: string }> {
  if (signal?.aborted) throw new AdapterError('cancelled', 'Cancelado.');
  const child = start(exe, args, cwd);
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '', failure: Error | undefined;
    const fail = (error: Error) => { failure ??= error; stop(child); };
    const timer = setTimeout(() => fail(new AdapterError('timeout', 'El cliente oficial no respondió a tiempo.')), timeout);
    const abort = () => fail(new AdapterError('cancelled', 'Cancelado.'));
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', () => fail(new AdapterError('unreachable', 'No se pudo iniciar el cliente oficial.')));
    child.stdin.on('error', () => { /* close owns the result */ });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; if (stdout.length > LIMIT) fail(new AdapterError('bad-response', 'Respuesta demasiado grande.')); });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; if (stderr.length > LIMIT) fail(new AdapterError('bad-response', 'Salida del cliente demasiado grande.')); });
    child.on('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', abort); if (failure) reject(failure); else resolve({ code, text: stdout.trim() ? stdout : stderr }); });
    child.stdin.end(input);
  });
}
export async function checkSubscription(kind: SubscriptionKind, signal?: AbortSignal): Promise<void> {
  const exe = await executable(kind);
  const result = await capture(exe, kind === 'codex-subscription' ? ['login', 'status'] : ['auth', 'status', '--json'], os.tmpdir(), signal);
  if (!confirmsSubscription(kind, result.code, result.text)) throw new AdapterError('unauthorized', 'El cliente oficial no ha confirmado una sesión de suscripción. Inicia sesión con tu cuenta; no se usará una API de pago como alternativa.');
}
export async function subscriptionLogin(kind: SubscriptionKind): Promise<{ ok: boolean; error?: string }> {
  try {
    const exe = await executable(kind);
    if (process.platform !== 'win32') return { ok: false, error: `Ejecuta ${kind === 'codex-subscription' ? 'codex login' : 'claude auth login'} en tu terminal y vuelve a comprobar.` };
    // A visible terminal is the explicit login UI, never used for inference.
    const args = kind === 'codex-subscription'
      ? ['-c', 'forced_login_method="chatgpt"', 'login']
      : ['--setting-sources', '', '--settings', '{"forceLoginMethod":"claudeai"}', 'auth', 'login'];
    const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
    // Windows PowerShell 5 strips embedded quotes with the native call operator.
    // ProcessStartInfo takes the exact Windows command line, including empty args.
    const windowsArg = (value: string) => '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';
    const script = '$p = New-Object System.Diagnostics.ProcessStartInfo; $p.FileName = ' + quote(exe.file)
      + '; $p.Arguments = ' + quote([...exe.prefix, ...args].map(windowsArg).join(' '))
      + '; $p.UseShellExecute = $false; $login = [System.Diagnostics.Process]::Start($p); $login.WaitForExit()';
    const child = spawn('powershell.exe', ['-NoProfile', '-NoExit', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      env: { ...subscriptionEnvironment(), ...(exe.prefix.length ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
      windowsHide: false, detached: true, stdio: 'ignore',
    });
    await new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('spawn', resolve); });
    child.unref();
    return { ok: true };
  } catch (err) { return { ok: false, error: err instanceof AdapterError ? err.message : 'No se pudo abrir el inicio de sesión del cliente oficial.' }; }
}

interface RpcItem { id: string; type: string; text: string; phase?: string }
interface RpcTurn { id: string; status?: string; error?: unknown; items?: RpcItem[] }
interface RpcResult {
  config?: { model_providers?: Record<string, unknown>; mcp_servers?: Record<string, unknown> };
  account?: { type: string };
  thread?: { id: string };
  modelProvider?: string;
  approvalPolicy?: string;
  sandbox?: { type: string };
  turn?: RpcTurn;
}
interface RpcNotification { method?: string; params?: { threadId?: string; turnId?: string; item?: RpcItem; turn?: RpcTurn } }

// A bounded JSON-lines RPC peer for Codex app-server. Never executes server requests.
class Rpc {
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: RpcResult) => void; reject: (error: Error) => void }>();
  private buffer = '';
  private failure?: Error;
  onEvent: (message: RpcNotification) => void = () => {};
  constructor(private child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      try {
        this.buffer += chunk;
        if (this.buffer.length > LIMIT) throw new Error('frame');
        let end: number;
        while ((end = this.buffer.indexOf('\n')) >= 0) {
          const message = JSON.parse(this.buffer.slice(0, end)); this.buffer = this.buffer.slice(end + 1);
          if (message.method && message.id !== undefined) throw new Error('native tool request');
          if (message.id !== undefined) {
            const pending = this.pending.get(message.id); this.pending.delete(message.id);
            if (message.error) pending?.reject(new AdapterError('bad-response', 'Codex rechazó la solicitud; revisa la sesión y la cuota.'));
            else pending?.resolve(message.result);
          } else this.onEvent(message);
        }
      } catch { this.fail(new AdapterError('bad-response', 'Codex devolvió un evento no permitido o inválido.')); }
    });
    child.stderr.resume();
    child.on('error', () => this.fail(new AdapterError('unreachable', 'No se pudo iniciar Codex.')));
    child.on('close', () => this.fail(new AdapterError('bad-response', 'Codex cerró la conexión.')));
    child.stdin.on('error', () => this.fail(new AdapterError('bad-response', 'Codex cerró la entrada.')));
  }
  fail(error: Error): void { this.failure ??= error; for (const p of this.pending.values()) p.reject(this.failure); this.pending.clear(); stop(this.child); }
  notify(method: string): void { this.child.stdin.write(JSON.stringify({ method }) + '\n'); }
  call(method: string, params: object): Promise<RpcResult> {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.sequence;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
  }
}
const disabled = ['shell_tool', 'unified_exec', 'code_mode_host', 'multi_agent', 'hooks', 'plugins', 'apps', 'browser_use', 'computer_use', 'image_generation', 'memories', 'goals', 'sleep_tool', 'view_image', 'workspace_dependencies', 'shell_snapshot', 'remote_plugin', 'skill_search'];
async function codexAnswer(exe: Executable, cwd: string, prompt: string, model: string, signal: AbortSignal): Promise<string> {
  // Older binaries may silently ignore isolation fields: validate their own schema.
  const schema = await capture(exe, ['app-server', 'generate-json-schema', '--experimental', '--out', cwd], cwd, signal);
  if (schema.code !== 0) throw new AdapterError('policy', 'Actualiza Codex: no se pudo verificar su protocolo de chat.');
  const spec = JSON.parse(await fs.readFile(path.join(cwd, 'v2', 'ThreadStartParams.json'), 'utf8'));
  if (!['environments', 'ephemeral', 'selectedCapabilityRoots', 'dynamicTools'].every(key => spec.properties?.[key]) || !spec.properties.environments.description?.includes('Empty disables environment access')) throw new AdapterError('policy', 'Actualiza Codex para usar chat sin acceso al equipo.');
  const instructionFile = path.join(cwd, 'instructions.txt'); await fs.writeFile(instructionFile, instructions);
  const overrides: Record<string, unknown> = { model_provider: 'openai', forced_login_method: 'chatgpt', approval_policy: 'never', sandbox_mode: 'read-only', web_search: 'disabled', notify: [], project_doc_max_bytes: 0, 'analytics.enabled': false, 'otel.log_user_prompt': false, model_instructions_file: instructionFile };
  const args = ['app-server', '--stdio', ...Object.entries(overrides).flatMap(([key, value]) => ['-c', key + '=' + JSON.stringify(value)]), ...disabled.flatMap(flag => ['--disable', flag]), '--enable', 'skip_host_skill_discovery'];
  const child = start(exe, args, cwd); const rpc = new Rpc(child);
  let rejectTurn: ((error: Error) => void) | undefined;
  const abort = () => { const err = new AdapterError('cancelled', 'Cancelado.'); rpc.fail(err); rejectTurn?.(err); };
  const timer = setTimeout(() => { const err = new AdapterError('timeout', 'Codex superó el tiempo de respuesta.'); rpc.fail(err); rejectTurn?.(err); }, 14 * 60_000);
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) abort();
    await rpc.call('initialize', { clientInfo: { name: 'writers_hoard_chat', version: '1' }, capabilities: { experimentalApi: true } }); rpc.notify('initialized');
    const config = (await rpc.call('config/read', { includeLayers: false, cwd })).config;
    if (!config || config.model_providers?.openai) throw new AdapterError('policy', 'El proveedor OpenAI personalizado de Codex no está permitido para esta conexión de suscripción.');
    const servers = config.mcp_servers ?? {};
    if (typeof servers !== 'object' || Object.keys(servers).length > 256) throw new AdapterError('policy', 'No se pudo aislar la configuración de Codex.');
    if ((await rpc.call('account/read', { refreshToken: false })).account?.type !== 'chatgpt') throw new AdapterError('unauthorized', 'Codex no confirmó la sesión ChatGPT.');
    const started = await rpc.call('thread/start', { cwd, ephemeral: true, environments: [], selectedCapabilityRoots: [], dynamicTools: [], config: { mcp_servers: Object.fromEntries(Object.keys(servers).map(name => [name, { enabled: false }])) }, approvalPolicy: 'never', sandbox: 'read-only', modelProvider: 'openai', baseInstructions: instructions, developerInstructions: instructions, ...(model === 'client-default' ? {} : { model }) });
    const threadId = started.thread?.id;
    if (!threadId || started.modelProvider !== 'openai' || started.approvalPolicy !== 'never' || started.sandbox?.type !== 'readOnly') throw new AdapterError('policy', 'Codex no confirmó los permisos restringidos de chat.');
    const turnIds = new Set<string>(); const items = new Map<string, string>(); let size = 0, events = 0;
    const completed = new Promise<RpcTurn | undefined>((resolve, reject) => {
      rejectTurn = reject;
      child.once('close', () => reject(new AdapterError('bad-response', 'Codex terminó antes de completar la respuesta.')));
      rpc.onEvent = message => {
        try {
          if (++events > 100_000) throw new Error('event limit');
          const data = message.params ?? {}; if (data.threadId !== threadId) return;
          if (data.turnId) { turnIds.add(data.turnId); if (turnIds.size > 1) throw new Error('turn mismatch'); }
          if (message.method === 'error') throw new Error('provider');
          if (message.method === 'item/started' || message.method === 'item/completed') {
            const item = data.item;
            if (!item) throw new Error('missing item');
            if (!['agentMessage', 'userMessage', 'reasoning', 'contextCompaction'].includes(item.type)) throw new Error('native tool');
            if (message.method === 'item/completed' && item.type === 'agentMessage' && (!item.phase || item.phase === 'final_answer')) {
              if (typeof item.id !== 'string' || typeof item.text !== 'string' || items.size > 4096) throw new Error('item');
              size += item.text.length - (items.get(item.id)?.length ?? 0); if (size > LIMIT) throw new Error('answer size'); items.set(item.id, item.text);
            }
          }
          if (message.method === 'turn/completed') resolve(data.turn);
        } catch { const err = new AdapterError('bad-response', 'Codex no completó un turno de chat válido; no se usó otra facturación.'); reject(err); rpc.fail(err); }
      };
    });
    // Attach rejection immediately while waiting for the turn/start response.
    void completed.catch(() => {});
    const turnId = (await rpc.call('turn/start', { threadId, input: [{ type: 'text', text: prompt }] })).turn?.id;
    const final = await completed;
    if (!turnId || final?.id !== turnId || [...turnIds].some(id => id !== turnId) || final?.status !== 'completed' || final.error || (final.items ?? []).some((item: RpcItem) => !['agentMessage', 'userMessage', 'reasoning', 'contextCompaction'].includes(item.type))) throw new AdapterError('bad-response', 'Codex no completó la respuesta. Comprueba tu cuota y vuelve a intentarlo.');
    return [...items.values()].join('\n\n');
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); stop(child); }
}
export async function subscriptionAnswer(kind: SubscriptionKind, model: string, prompt: string, signal: AbortSignal): Promise<string> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model)) throw new AdapterError('bad-request', 'Identificador de modelo no válido.');
  if (prompt.length > LIMIT) throw new AdapterError('bad-request', 'La conversación es demasiado grande.');
  await checkSubscription(kind, signal);
  const exe = await executable(kind); const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'writers-hoard-chat-'));
  try {
    if (kind === 'codex-subscription') return await codexAnswer(exe, cwd, prompt, model, signal);
    const args = ['-p', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--no-chrome', '--no-session-persistence', '--permission-mode', 'dontAsk', '--setting-sources', '', '--settings', '{"forceLoginMethod":"claudeai","disableAllHooks":true}', '--output-format', 'stream-json', '--verbose', ...(model === 'client-default' ? [] : ['--model', model])];
    const result = await capture(exe, args, cwd, signal, prompt, 14 * 60_000);
    if (result.code !== 0) throw new AdapterError('server-error', 'Claude no completó la respuesta. Comprueba tu sesión y cuota; no se usó una API alternativa.');
    return parseClaudeAnswer(result.text);
  } finally { await fs.rm(cwd, { recursive: true, force: true }).catch(() => {}); }
}
export function parseClaudeAnswer(text: string): string {
  let answer: string | undefined;
  try {
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      const event = JSON.parse(line);
      if (event.message?.content?.some((block: { type?: string }) => block.type === 'tool_use' || block.type === 'tool_result')) throw new Error('native tool');
      if (event.type === 'result') { if (event.is_error || event.subtype !== 'success' || typeof event.result !== 'string') throw new Error('failed'); answer = event.result; }
    }
    if (!answer?.trim()) throw new Error('empty');
    return answer;
  } catch { throw new AdapterError('bad-response', 'Claude no devolvió una respuesta de texto válida.'); }
}
