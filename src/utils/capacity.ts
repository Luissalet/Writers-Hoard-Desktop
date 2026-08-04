// ============================================
// Capacity — the ceiling is the machine, not a constant
// ============================================
//
// This is a local-first desktop app: the only computer it ever runs on is the
// author's, and there is no reason for it to behave as if it were sharing a
// server with strangers. Caches sized for a 2015 laptop meant a 32 GB machine
// recomputed the same regional sheet it had just thrown away, and a worker
// pool fixed at two meant fourteen idle cores while the reader waited.
//
// Every budget in the app derives from here. The baseline — 4 cores, 8 GB — is
// what the old hardcoded constants were implicitly written for, so a machine
// at the baseline behaves exactly as before and everything above it gets used.
//
// Written to run anywhere the code runs, with no host-specific imports:
//   • Electron renderer  → real physical RAM, via the preload bridge
//   • Forge process      → real physical RAM, via the env var main.ts sets
//   • Web worker/browser → navigator.deviceMemory (the spec caps it at 8 GB)

const GIB = 1024 * 1024 * 1024;

const BASELINE_CORES = 4;
const BASELINE_RAM_BYTES = 8 * GIB;

interface ForgeBridgeGlobal {
  whForge?: { memoryBytes?: number };
  process?: { env?: Record<string, string | undefined> };
  navigator?: { hardwareConcurrency?: number; deviceMemory?: number };
}

const host = globalThis as unknown as ForgeBridgeGlobal;

function resolveRamBytes(): number {
  const bridged = host.whForge?.memoryBytes;
  if (typeof bridged === 'number' && bridged > 0) return bridged;

  const fromEnv = Number(host.process?.env?.WH_TOTAL_RAM_BYTES);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;

  const deviceMemory = host.navigator?.deviceMemory;
  if (typeof deviceMemory === 'number' && deviceMemory > 0) return deviceMemory * GIB;

  return BASELINE_RAM_BYTES;
}

/** Logical cores available to this process. */
export const CORES = Math.max(1, Math.floor(host.navigator?.hardwareConcurrency ?? BASELINE_CORES));

/** Physical RAM in bytes, as accurately as this context can know it. */
export const TOTAL_RAM_BYTES = resolveRamBytes();

/** How many times more memory this machine has than the baseline it was tuned for. */
export const RAM_SCALE = TOTAL_RAM_BYTES / BASELINE_RAM_BYTES;

/** How many times more parallelism this machine has than the baseline. */
export const CPU_SCALE = CORES / BASELINE_CORES;

/**
 * Grows a count-based budget with the machine's memory. Never shrinks below
 * the baseline value: a small machine keeps exactly the behaviour the constant
 * was written for.
 */
export function scaleCount(baseline: number): number {
  return Math.max(baseline, Math.round(baseline * RAM_SCALE));
}

/** Same, for a byte budget. */
export function scaleBytes(baseline: number): number {
  return Math.max(baseline, Math.round(baseline * RAM_SCALE));
}

/**
 * How many compute workers to run in parallel.
 *
 * Bounded by cores *and* by memory, because each worldgen session holds its
 * own clone of the world (~80–150 MB). More sessions than cores does not
 * finish sooner — the work is CPU-bound and they would take turns while each
 * still paid for its copy — so this tracks the hardware rather than being an
 * arbitrary cap. `bytesPerWorker` lets a caller say how heavy its sessions are.
 */
export function workerSlots(bytesPerWorker = 192 * 1024 * 1024): number {
  const byMemory = Math.floor((TOTAL_RAM_BYTES * 0.5) / Math.max(1, bytesPerWorker));
  return Math.max(1, Math.min(CORES, byMemory));
}
