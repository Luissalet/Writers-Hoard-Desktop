// ============================================================================
// AI runtime — pinned stable-diffusion.cpp release artifacts (main process)
// ============================================================================
//
// One release, one SHA-256 per file, as published on GitHub with the
// release's own asset digests (August 2026). The runtime is only ever
// installed from an archive whose size and digest match; the receipt written
// next to the binaries records which one, so a later pin bump reinstalls.
//
// Backends: Vulkan is the default on Windows and Linux — one small archive
// that runs on NVIDIA, AMD and Intel alike. CUDA 12 is faster on NVIDIA but
// weighs almost a gigabyte with its runtime libraries, so it is an explicit
// choice. The CPU build is the fallback when no GPU is usable.

import type { SdBackend } from '@/services/aiRuntime/sdServer';

export type { SdBackend };

export interface SdRuntimeAsset {
  fileName: string;
  url: string;
  sizeBytes: number;
  sha256: string;
}

export interface SdRuntimeArtifact {
  version: string;
  backend: SdBackend;
  platform: NodeJS.Platform;
  arch: string;
  /** The binaries, then any runtime libraries that must sit next to them. */
  assets: SdRuntimeAsset[];
  /** Relative path of the server binary inside the extracted tree. */
  serverBinary: string;
}

const RELEASE = 'master-709-92a3b73';
const BASE = `https://github.com/leejet/stable-diffusion.cpp/releases/download/${RELEASE}`;

function asset(fileName: string, sizeBytes: number, sha256: string): SdRuntimeAsset {
  return { fileName, url: `${BASE}/${fileName}`, sizeBytes, sha256 };
}

export const SD_RUNTIME_ARTIFACTS: readonly SdRuntimeArtifact[] = [
  {
    version: RELEASE,
    backend: 'vulkan',
    platform: 'win32',
    arch: 'x64',
    assets: [asset('sd-master-92a3b73-bin-win-vulkan-x64.zip', 42_275_413, '730c656ddfa1688bac6e7650d4e46d7f5335715dff00e8e86c7e07f4a1a191d2')],
    serverBinary: 'sd-server.exe',
  },
  {
    version: RELEASE,
    backend: 'cuda12',
    platform: 'win32',
    arch: 'x64',
    assets: [
      asset('sd-master-92a3b73-bin-win-cuda12-x64.zip', 352_548_814, 'dc36a0228e795ecd497f56a777971f389bb8feae75a51dce14292e79f23f821e'),
      asset('cudart-sd-bin-win-cu12-x64.zip', 563_452_046, 'fe20366827d357c00797eebb58244dddab7fd9a348d70090c3871004c320f38d'),
    ],
    serverBinary: 'sd-server.exe',
  },
  {
    version: RELEASE,
    backend: 'cpu',
    platform: 'win32',
    arch: 'x64',
    assets: [asset('sd-master-92a3b73-bin-win-avx2-x64.zip', 21_195_454, '530bf311f7879afa1bbdb0841b46de491050bf203ba449d6650717600b539794')],
    serverBinary: 'sd-server.exe',
  },
  {
    version: RELEASE,
    backend: 'vulkan',
    platform: 'linux',
    arch: 'x64',
    assets: [asset('sd-master-92a3b73-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip', 44_462_581, 'b2c8330f51c5d4603ee48cafbf2aeeca0f18541e1fe623b981389b1994fcb75f')],
    serverBinary: 'sd-server',
  },
  {
    version: RELEASE,
    backend: 'cpu',
    platform: 'linux',
    arch: 'x64',
    assets: [asset('sd-master-92a3b73-bin-Linux-Ubuntu-24.04-x86_64.zip', 25_162_020, '860b7c12bf7f53af6caaa2507dadca13802ce2b73a0249c163535a9d389f26df')],
    serverBinary: 'sd-server',
  },
  {
    version: RELEASE,
    backend: 'vulkan',
    platform: 'darwin',
    arch: 'arm64',
    // The macOS build uses Metal; it is listed under the default backend so
    // one choice works on every platform.
    assets: [asset('sd-master-92a3b73-bin-Darwin-macOS-15.7.7-arm64.zip', 48_594_872, '53cacbb050cb9c38168de76c3688e4ce02f3c58719da81cecf5ae37be33bf62b')],
    serverBinary: 'sd-server',
  },
];

export function sdRuntimeArtifact(backend: SdBackend, platform: NodeJS.Platform = process.platform, arch: string = process.arch): SdRuntimeArtifact | undefined {
  return SD_RUNTIME_ARTIFACTS.find((a) => a.backend === backend && a.platform === platform && a.arch === arch);
}

/** Backends this platform can install, best first. */
export function sdBackendsFor(platform: NodeJS.Platform = process.platform, arch: string = process.arch): SdBackend[] {
  const order: SdBackend[] = ['vulkan', 'cuda12', 'cpu'];
  return order.filter((backend) => sdRuntimeArtifact(backend, platform, arch));
}

export function sdRuntimeTotalBytes(artifact: SdRuntimeArtifact): number {
  return artifact.assets.reduce((sum, a) => sum + a.sizeBytes, 0);
}

export interface SdRuntimeReceipt {
  version: string;
  backend: SdBackend;
  sha256s: string[];
}

export function isCurrentSdRuntimeReceipt(value: unknown, artifact: SdRuntimeArtifact): value is SdRuntimeReceipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Partial<SdRuntimeReceipt>;
  if (receipt.version !== artifact.version || receipt.backend !== artifact.backend) return false;
  if (!Array.isArray(receipt.sha256s)) return false;
  const wanted = artifact.assets.map((a) => a.sha256);
  return wanted.length === receipt.sha256s.length && wanted.every((sha, i) => receipt.sha256s?.[i] === sha);
}
