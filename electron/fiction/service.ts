// Private stdio worker for the incorporated fiction engine. No HTTP listener,
// model loading, polling or process is created by importing this module.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { FICTION_TOOLS } from '../../src/services/aiBridge/manifestFiction';

export const STORY_MODULES = ['fiction', 'narration', 'voice', 'illustrations'] as const;
type StoryModule = typeof STORY_MODULES[number];
export interface StoryConfig {
  enabled: StoryModule[];
  dataDir: string;
}
export interface StoryResponse { status: number; type: string; base64: string }
interface WorkerMessage { id: number; ok: boolean; result?: unknown; error?: string }
export interface FictionOptions {
  configFile: string;
  dataDir: string;
  command: string;
  args: string[];
  cwd: string;
}

export class FictionService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private workerPid: number | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private config: StoryConfig | null = null;
  private configLoading: Promise<StoryConfig> | null = null;
  private controls: Promise<unknown> = Promise.resolve();
  constructor(private options: FictionOptions) {}
  get running(): boolean { return this.child !== null; }

  private async readConfig(): Promise<StoryConfig> {
    if (this.config) return this.config;
    return this.configLoading ??= (async () => {
      let saved: Partial<StoryConfig> = {};
      try { saved = JSON.parse(await fs.readFile(this.options.configFile, 'utf8')); } catch { /* First run is OFF. */ }
      this.config = {
        enabled: Array.isArray(saved.enabled) ? saved.enabled.filter((item): item is StoryModule => STORY_MODULES.includes(item)) : [],
        dataDir: typeof saved.dataDir === 'string' && path.isAbsolute(saved.dataDir) ? saved.dataDir : this.options.dataDir,
      };
      return this.config;
    })();
  }

  async status() {
    const config = await this.readConfig();
    return { ...config, enabled: [...config.enabled], running: this.child !== null, pid: this.workerPid ?? this.child?.pid ?? null,
      modules: STORY_MODULES.map(id => ({ id, enabled: config.enabled.includes(id) })) };
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async save(config: StoryConfig): Promise<void> {
    await fs.mkdir(path.dirname(this.options.configFile), { recursive: true });
    const temporary = this.options.configFile + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(config, null, 2) + '\n', 'utf8');
    await fs.rename(temporary, this.options.configFile);
  }

  async setModule(module: string, enabled: boolean, dataDir?: string) {
    if (!STORY_MODULES.includes(module as StoryModule) || typeof enabled !== 'boolean') throw new Error('Unknown module or invalid enabled value.');
    const id = module as StoryModule;
    const update = this.controls.then(async () => {
      const previous = await this.readConfig();
      const config = { ...previous, enabled: [...previous.enabled] };
      if (dataDir !== undefined) {
        if (!path.isAbsolute(dataDir)) throw new Error('Data directory must be an absolute path.');
        if (config.enabled.includes('fiction') || this.child) throw new Error('Switch fiction OFF before choosing another data directory.');
        config.dataDir = path.resolve(dataDir);
      }
      config.enabled = config.enabled.filter(item => item !== id);
      if (enabled) config.enabled.push(id);
      // Persist OFF before waiting for an already-running request to finish.
      await this.save(config);
      this.config = config;
    });
    this.controls = update.catch(() => undefined);
    await update;
    if (!enabled) await this.serial(() => id === 'fiction' ? this.stopWorker() : Promise.resolve());
    return this.status();
  }

  private rpc(message: Record<string, unknown>): Promise<unknown> {
    const child = this.child;
    if (!child) return Promise.reject(new Error('Fiction worker is not running.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ ...message, id }) + '\n', error => {
        if (error) { this.pending.delete(id); reject(error); }
      });
    });
  }

  private async startWorker(): Promise<void> {
    if (this.child) return;
    const child = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', HOARD_EVENTS: '0' },
    });
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      let message: WorkerMessage;
      try { message = JSON.parse(line); } catch { return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error || 'Fiction request failed.'));
    });
    child.stderr.on('data', () => { /* Library diagnostics must not enter the MCP protocol. */ });
    const fail = (error: Error) => {
      if (this.child === child) { this.child = null; this.workerPid = null; }
      lines.close();
      for (const entry of this.pending.values()) entry.reject(error);
      this.pending.clear();
    };
    child.once('error', fail);
    child.once('exit', (code) => fail(new Error(`Fiction worker exited (${code ?? 'signal'}).`)));
    try {
      const initialized = await this.rpc({ op: 'init', dataDir: (await this.readConfig()).dataDir }) as { pid: number };
      this.workerPid = initialized.pid;
    }
    catch (error) { child.stdin.end(); throw error; }
  }

  private async stopWorker(): Promise<void> {
    const child = this.child;
    if (!child) return;
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    await this.rpc({ op: 'shutdown' });
    child.stdin.end();
    await exited;
  }

  close(): Promise<void> { return this.serial(() => this.stopWorker()); }

  request(method: string, apiPath: string, body = '', ui = true): Promise<StoryResponse> {
    return this.serial(async () => {
      const config = await this.readConfig();
      if (!config.enabled.includes('fiction')) throw new Error('Fiction is OFF. Enable it explicitly in Writer.');
      if (!apiPath.startsWith('/api/') || apiPath.startsWith('//')) throw new Error('Expected a fiction API path.');
      const feature = apiPath.includes('/illustrate') || apiPath.startsWith('/api/prospero/') ? 'illustrations'
        : apiPath.includes('/narration/') || apiPath.includes('/scene_narrate') || apiPath.includes('/audio') ? 'voice'
          : apiPath.endsWith('/narrate') ? 'narration' : null;
      if (feature && !config.enabled.includes(feature)) {
        if (apiPath.endsWith('/available')) return { status: 200, type: 'application/json', base64: Buffer.from('{"available":false}').toString('base64') };
        throw new Error(`${feature} is OFF. Enable it explicitly in Writer.`);
      }
      await this.startWorker();
      return await this.rpc({ method, path: apiPath, body: Buffer.from(body).toString('base64'), ui,
        narration: config.enabled.includes('narration') }) as StoryResponse;
    });
  }

  async tool(name: string, args: Record<string, unknown>) {
    try {
      if (name === 'wh_story_modules') return { ok: true, result: await this.status() };
      if (name === 'wh_story_module_set') return { ok: true, result: await this.setModule(String(args.module), args.enabled as boolean, args.dataDir as string | undefined) };
      const payload = name === 'dice_roll' ? { ...args, who: 'agent' } : args;
      const response = await this.request('POST', `/api/agent/${name}`, JSON.stringify(payload), false);
      const raw = JSON.parse(Buffer.from(response.base64, 'base64').toString('utf8'));
      // The historical MCP tool wraps the REST list; preserve both public shapes.
      const result = name === 'story_worlds' && response.status < 400 ? { worlds: raw } : raw;
      return response.status < 400 ? { ok: true, result } : { ok: false, code: result.error, error: result.message || result.error };
    } catch (error) {
      return { ok: false, code: 'fiction-unavailable', error: error instanceof Error ? error.message : String(error) };
    }
  }
}

let service: FictionService | null = null;
export function configureFiction(options: FictionOptions) { service = new FictionService(options); }
export function fictionService(): FictionService {
  if (!service) throw new Error('Fiction engine has not been configured.');
  return service;
}
export function isFictionTool(name: string) { return FICTION_TOOLS.some(tool => tool.name === name); }
export function closeFiction(): Promise<void> { return service?.close() ?? Promise.resolve(); }
export function isFictionRunning(): boolean { return service?.running ?? false; }
