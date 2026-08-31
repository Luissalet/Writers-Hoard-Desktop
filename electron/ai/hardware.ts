// ============================================================================
// AI runtime — what machine is this? (main process)
// ============================================================================
//
// CPU and RAM come from Node. GPU memory is the number that decides whether a
// model fits, and the only exact source for it is the vendor tool: nvidia-smi
// is queried first (present wherever the NVIDIA driver is). On Windows without
// it, WMI is asked — its AdapterRAM field is a 32-bit value that caps out at
// 4 GB on many systems, so that answer is flagged "estimated". Anything else
// is reported honestly as "no GPU figure", and the fit falls back to RAM.
//
// Cached for thirty seconds: the settings page re-renders far more often than
// hardware changes.

import os from 'node:os';
import { execFile } from 'node:child_process';
import type { GpuInfo, GpuVendor, HardwareProfile } from '@/services/aiRuntime/types';

const CACHE_MS = 30_000;
let cached: { at: number; profile: HardwareProfile } | null = null;
let inFlight: Promise<HardwareProfile> | null = null;

function run(cmd: string, args: string[], timeoutMs = 4000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });
}

function vendorOf(name: string): GpuVendor {
  const n = name.toLowerCase();
  if (/nvidia|geforce|rtx|gtx|quadro|tesla/.test(n)) return 'nvidia';
  if (/amd|radeon|rx \d/.test(n)) return 'amd';
  if (/intel|arc|iris|uhd/.test(n)) return 'intel';
  if (/apple/.test(n)) return 'apple';
  return 'unknown';
}

async function nvidiaSmi(): Promise<GpuInfo[] | null> {
  try {
    const out = await run('nvidia-smi', [
      '--query-gpu=name,memory.total,memory.free',
      '--format=csv,noheader,nounits',
    ]);
    const gpus: GpuInfo[] = [];
    for (const line of out.split('\n')) {
      const parts = line.split(',').map((p) => p.trim());
      if (parts.length < 3) continue;
      const total = Number(parts[1]);
      const free = Number(parts[2]);
      if (!Number.isFinite(total)) continue;
      gpus.push({
        name: parts[0],
        vendor: 'nvidia',
        vramTotalBytes: Math.round(total * 1024 * 1024),
        vramFreeBytes: Number.isFinite(free) ? Math.round(free * 1024 * 1024) : null,
      });
    }
    return gpus.length ? gpus : null;
  } catch {
    return null;
  }
}

async function windowsWmi(): Promise<GpuInfo[] | null> {
  if (process.platform !== 'win32') return null;
  try {
    const out = await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress',
    ], 8000);
    const parsed = JSON.parse(out.trim() || 'null') as
      | { Name?: string; AdapterRAM?: number }
      | Array<{ Name?: string; AdapterRAM?: number }>
      | null;
    if (!parsed) return null;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const gpus: GpuInfo[] = rows
      .filter((row) => typeof row.Name === 'string')
      .map((row) => ({
        name: row.Name as string,
        vendor: vendorOf(row.Name as string),
        vramTotalBytes: typeof row.AdapterRAM === 'number' && row.AdapterRAM > 0 ? row.AdapterRAM : null,
        vramFreeBytes: null,
      }))
      // Virtual/remote display adapters carry no memory worth planning around.
      .filter((gpu) => !/microsoft basic|remote|virtual|parsec/i.test(gpu.name));
    return gpus.length ? gpus : null;
  } catch {
    return null;
  }
}

export async function detectHardware(force = false): Promise<HardwareProfile> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.profile;
  if (inFlight) return inFlight;
  inFlight = (async (): Promise<HardwareProfile> => {
    const cpus = os.cpus();
    let gpus = await nvidiaSmi();
    let source: HardwareProfile['source'] = 'nvidia-smi';
    let gpuConfidence: HardwareProfile['gpuConfidence'] = 'measured';
    if (!gpus) {
      gpus = await windowsWmi();
      source = gpus ? 'wmi' : 'os-only';
      gpuConfidence = gpus && gpus.some((g) => g.vramTotalBytes) ? 'estimated' : 'none';
    }
    const profile: HardwareProfile = {
      platform: `${process.platform}-${process.arch}`,
      cpuModel: cpus[0]?.model?.trim() ?? 'CPU',
      cpuCores: cpus.length,
      ramTotalBytes: os.totalmem(),
      ramFreeBytes: os.freemem(),
      gpus: gpus ?? [],
      source,
      gpuConfidence,
      detectedAt: Date.now(),
    };
    cached = { at: Date.now(), profile };
    return profile;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
