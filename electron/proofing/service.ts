import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { GrammarCheckResponse, GrammarMatch } from '../../src/engines/writings/proofing/types';
export interface ProofingServiceConfiguration { appPath?: string; isPackaged?: boolean; resourcesPath?: string; javaPath?: string; runtimePath?: string }
interface Instance { child: ChildProcess; port: number; directory: string; closed: Promise<void>; exited: boolean }
let configuration: ProofingServiceConfiguration = {};
let instance: Instance | undefined; let starting: Promise<Instance> | undefined; let generation = 0;
export function configureProofingService(options: ProofingServiceConfiguration): void {
  if (instance || starting) throw new Error('Stop the proofing service before changing its configuration.');
  configuration = { ...options };
}
function runtimePath() {
  if (configuration.runtimePath) return configuration.runtimePath;
  const base = configuration.isPackaged ? configuration.resourcesPath ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath : path.join(configuration.appPath ?? process.cwd(), 'resources');
  if (!base) throw new Error('The proofing resources directory is unavailable.');
  return path.join(base, 'proofing', 'LanguageTool-6.6');
}
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function unusedPort(): Promise<number> {
  const server = createServer(); await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); return port;
}
async function closeInstance(current: Instance): Promise<void> {
  if (!current.exited) {
    if (process.platform === 'win32' && current.child.pid) {
      // Oracle's PATH launcher starts a descendant JVM. Killing only the
      // launcher leaves that owned server alive, so stop its own process tree.
      await new Promise<void>((resolve, reject) => execFile('taskkill.exe', ['/PID', String(current.child.pid), '/T', '/F'], { windowsHide: true }, error => {
        if (error && !current.exited) reject(new Error('The owned grammar process could not stop.')); else resolve();
      }));
    } else current.child.kill();
  }
  await current.closed;
  await removeOwnedTemporaryDirectory(current.directory);
  if (instance === current) instance = undefined;
}
async function removeOwnedTemporaryDirectory(directory: string): Promise<void> {
  const resolved = path.resolve(directory); const temporaryRoot = path.resolve(tmpdir());
  if (path.dirname(resolved).toLocaleLowerCase() !== temporaryRoot.toLocaleLowerCase() || !path.basename(resolved).startsWith('wh-proofing-')) throw new Error('The proofing temporary directory is outside its owned location.');
  await rm(resolved, { recursive: true, force: true });
}
async function startService(): Promise<Instance> {
  if (instance?.exited) await closeInstance(instance);
  const epoch = generation; const runtime = runtimePath(); await access(path.join(runtime, 'languagetool-server.jar'));
  const port = await unusedPort(); const directory = await mkdtemp(path.join(tmpdir(), 'wh-proofing-'));
  const configPath = path.join(directory, 'server.properties');
  // LanguageTool's default request cap is inappropriate for a writing document.
  // These are its integer protocol maxima, not a document truncation mechanism.
  await writeFile(configPath, 'maxTextLength=2147483647\nmaxTextHardLength=2147483647\nmaxCheckThreads=2\n', 'utf8');
  if (epoch !== generation) { await removeOwnedTemporaryDirectory(directory); throw new Error('Grammar startup was cancelled.'); }
  const child = spawn(configuration.javaPath ?? process.env.WRITER_PROOF_JAVA ?? 'java', ['-cp', 'languagetool-server.jar', 'org.languagetool.server.HTTPServer', '--config', configPath, '--port', String(port)], { cwd: runtime, windowsHide: true, stdio: 'ignore' });
  let resolveClosed!: () => void; const current: Instance = { child, port, directory, exited: false, closed: new Promise(resolve => { resolveClosed = resolve; }) };
  instance = current; child.once('error', () => { current.exited = true; resolveClosed(); }); child.once('close', () => { current.exited = true; resolveClosed(); });
  try {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (epoch !== generation || current.exited) throw new Error('Local grammar could not start. Check that Java 17 or newer is installed.');
      try { const response = await fetch(`http://127.0.0.1:${port}/v2/languages`, { signal: AbortSignal.timeout(1000) }); if (response.ok) return current; } catch { /* Wait for this child only. */ }
      await sleep(100);
    }
    throw new Error('Local grammar startup timed out.');
  } catch (error) { await closeInstance(current); throw error; }
}
async function getService() {
  if (instance && !instance.exited && !starting) return instance;
  if (!starting) starting = startService().finally(() => { starting = undefined; });
  return starting;
}
export async function checkGrammar(request: { text: string; language: 'es' | 'en-US' }): Promise<GrammarCheckResponse> {
  if (!request || typeof request.text !== 'string' || !['es', 'en-US'].includes(request.language)) return { ok: false, code: 'bad-args', error: 'Grammar requires literal text and an explicit es or en-US language.' };
  if (!request.text) return { ok: true, matches: [] };
  try {
    const current = await getService();
    const response = await fetch(`http://127.0.0.1:${current.port}/v2/check`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ text: request.text, language: request.language }), signal: AbortSignal.timeout(180000) });
    if (!response.ok) return { ok: false, code: 'grammar-http', error: `Local grammar returned HTTP ${response.status}.` };
    const result = await response.json() as { matches?: GrammarMatch[] };
    if (!Array.isArray(result.matches)) return { ok: false, code: 'grammar-response', error: 'Local grammar returned an invalid response.' };
    return { ok: true, matches: result.matches };
  } catch (error) { return { ok: false, code: 'grammar-unavailable', error: error instanceof Error ? error.message : 'Local grammar is unavailable.' }; }
}
/** Stops only the child started by this module, never a shared app or model. */
export async function stopProofingService(): Promise<void> {
  generation++; const activeStart = starting;
  if (instance) await closeInstance(instance);
  if (activeStart) { try { const current = await activeStart; await closeInstance(current); } catch { /* Startup already cleaned its resources. */ } }
}
