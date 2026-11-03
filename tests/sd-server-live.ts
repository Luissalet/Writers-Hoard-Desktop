// Live contract check against the REAL pinned sd-server, using the app's own
// launch arguments and job payload builders. Needs an installed runtime and an
// installed catalogue model under the app's userData (`npm run test:sd-live`).
//
// Proves on the actual binary what the unit contracts can only assert:
//   1. the per-request sampler, scheduler, steps and CFG override the
//      catalogue defaults the server was started with;
//   2. `embed_image_metadata` makes the PNG carry the recipe (A1111 line plus
//      the SDCPP record with the generator commit), and our reader parses it;
//   3. the structured `lora[]` field is read by the server: a LoRA that is not
//      in the folder is refused instead of being silently ignored.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { buildSdJobPayload, buildSdServerArgs } from '@/services/aiRuntime/sdServer';
import { LOCAL_IMAGE_CATALOG } from '@/services/aiRuntime/imageCatalog';
import { parseA1111Parameters, readPngMetadata, readSdcppRecord } from '@/services/imageMetadata';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

function userData(): string {
  if (process.env.WH_USER_DATA) return process.env.WH_USER_DATA;
  const base = process.platform === 'win32' ? process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config');
  return path.join(base, 'writers-hoard');
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (address && typeof address === 'object' ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

function installed() {
  const ai = path.join(userData(), 'ai');
  const runtimes = path.join(ai, 'sd-runtime');
  const backend = existsSync(runtimes) ? readdirSync(runtimes).find((name) => existsSync(path.join(runtimes, name, process.platform === 'win32' ? 'sd-server.exe' : 'sd-server'))) : undefined;
  check(backend, `No sd-server runtime installed under ${runtimes}`);
  const entry = LOCAL_IMAGE_CATALOG.find((model) => model.files.every((file) => existsSync(path.join(ai, 'image-models', model.id, file.fileName))));
  check(entry, `No catalogue model fully installed under ${path.join(ai, 'image-models')}`);
  const paths = Object.fromEntries(entry.files.map((file) => [file.role, path.join(ai, 'image-models', entry.id, file.fileName)]));
  const dir = path.join(runtimes, backend);
  return { dir, binary: path.join(dir, process.platform === 'win32' ? 'sd-server.exe' : 'sd-server'), entry, paths };
}

async function runJob(origin: string, body: Record<string, unknown>) {
  const response = await fetch(`${origin}/sdcpp/v1/img_gen`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const accepted = await response.json().catch(() => ({})) as { id?: string; error?: unknown };
  if (!accepted.id) return { httpStatus: response.status, error: accepted.error ?? accepted } as const;
  for (let i = 0; i < 900; i += 1) {
    await sleep(1000);
    const job = await (await fetch(`${origin}/sdcpp/v1/jobs/${encodeURIComponent(accepted.id)}`)).json() as { status?: string; error?: unknown; result?: { images?: { b64_json?: string }[] } };
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return job;
  }
  throw new Error('sd-server job did not finish in 15 minutes');
}

export async function testSdServerLive(): Promise<string[]> {
  const { dir, binary, entry, paths } = installed();
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const args = buildSdServerArgs(entry, { port, paths } as Parameters<typeof buildSdServerArgs>[1]);
  const child = spawn(binary, args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  const results: string[] = [];
  try {
    let up = false;
    for (let i = 0; i < 240 && !up && child.exitCode === null; i += 1) {
      await sleep(1000);
      try { up = (await fetch(`${origin}/sdcpp/v1/capabilities`)).ok; } catch { /* still loading */ }
    }
    check(up, `sd-server did not answer:\n${log.slice(-1500)}`);
    const defaults = entry.defaults;
    const sampler = defaults.sampler === 'euler' ? 'euler_a' : 'euler';
    const scheduler = defaults.scheduler === 'karras' ? 'exponential' : 'karras';
    const steps = defaults.steps === 6 ? 5 : 6;
    const guidance = defaults.cfg === 5.5 ? 4.5 : 5.5;
    const request = { prompt: 'a lighthouse on a cliff, ink drawing', negativePrompt: 'blurry', width: 256, height: 256, n: 1, seed: 4242, steps, guidance, sampler, scheduler } as Parameters<typeof buildSdJobPayload>[0];
    const done = await runJob(origin, buildSdJobPayload(request, entry)) as { status?: string; error?: unknown; result?: { images?: { b64_json?: string }[] } };
    check(done.status === 'completed', `generation did not complete: ${JSON.stringify(done).slice(0, 400)}`);
    const b64 = done.result?.images?.[0]?.b64_json;
    check(b64, 'completed job carried no image');
    const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
    const png = path.join(os.tmpdir(), `wh-sd-live-${entry.id}.png`);
    writeFileSync(png, bytes);
    const parameters = readPngMetadata(bytes).parameters;
    check(parameters, 'PNG has no parameters chunk: embed_image_metadata was not honoured');
    const line = parseA1111Parameters(parameters);
    const record = readSdcppRecord(parameters) as { seed?: number; sampling?: { method?: string; scheduler?: string; steps?: number; guidance?: { txt_cfg?: number } }; generator?: { commit?: string } } | undefined;
    check(line.prompt === request.prompt && line.negativePrompt === request.negativePrompt, 'prompt/negative did not round-trip through the PNG');
    check(record?.sampling?.method === sampler && record.sampling.scheduler === scheduler, `sampler/scheduler not the requested ones: ${JSON.stringify(record?.sampling)}`);
    check(record?.sampling?.steps === steps && record.sampling.guidance?.txt_cfg === guidance, `steps/CFG not the requested ones: ${JSON.stringify(record?.sampling)}`);
    check(record?.seed === 4242, 'seed did not round-trip');
    results.push(`Real sd-server (${path.basename(dir)}, ${record?.generator?.commit ?? '?'}) honoured request ${sampler}/${scheduler}/${steps} steps/CFG ${guidance} over defaults ${defaults.sampler}/${defaults.scheduler ?? '-'}/${defaults.steps}/${defaults.cfg}; PNG recipe parsed (${png})`);
    const refused = await runJob(origin, buildSdJobPayload({ ...request, loras: [{ name: 'wh-live-missing-lora', fileName: 'wh-live-missing-lora.safetensors', weight: 0.8 }] }, entry));
    check(!('status' in refused) || refused.status !== 'completed', 'a LoRA absent from the folder was accepted: the server ignored lora[]');
    results.push(`Structured lora[] is read by the server: a missing LoRA is refused (${JSON.stringify('httpStatus' in refused ? refused.httpStatus : refused.status)})`);
  } finally {
    child.kill();
  }
  return results;
}
