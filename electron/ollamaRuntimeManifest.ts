/**
 * Immutable embedded-runtime artifact. Update these fields together from one
 * official Ollama GitHub release; never point a fixed digest at `latest`.
 *
 * The digest and size below are published by GitHub for the official v0.32.15
 * release asset (`GET /repos/ollama/ollama/releases/tags/v0.32.15`).
 */
export const OLLAMA_RUNTIME_ARTIFACT = Object.freeze({
  version: 'v0.32.15',
  fileName: 'ollama-windows-amd64.zip',
  url: 'https://github.com/ollama/ollama/releases/download/v0.32.15/ollama-windows-amd64.zip',
  sha256: 'a1d11d46a944f9c7521f5e9a3a5db51cd3365401da627d96c204698fc6914ff9',
  sizeBytes: 1_460_302_386,
});

export interface OllamaRuntimeReceipt {
  version: string;
  fileName: string;
  sha256: string;
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

/** Fail closed if a future edit leaves version, URL, digest or size inconsistent. */
export function isOllamaRuntimeArtifactConfigured(
  artifact: typeof OLLAMA_RUNTIME_ARTIFACT = OLLAMA_RUNTIME_ARTIFACT,
): boolean {
  return (
    /^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(artifact.version) &&
    artifact.fileName === 'ollama-windows-amd64.zip' &&
    artifact.url ===
      `https://github.com/ollama/ollama/releases/download/${artifact.version}/${artifact.fileName}` &&
    isSha256Hex(artifact.sha256) &&
    Number.isSafeInteger(artifact.sizeBytes) &&
    artifact.sizeBytes > 0
  );
}

export function matchesOllamaRuntimeDigest(actualSha256: string): boolean {
  return (
    isOllamaRuntimeArtifactConfigured() &&
    isSha256Hex(actualSha256) &&
    actualSha256.toLowerCase() === OLLAMA_RUNTIME_ARTIFACT.sha256
  );
}

export function isCurrentOllamaRuntimeReceipt(value: unknown): value is OllamaRuntimeReceipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Partial<OllamaRuntimeReceipt>;
  return (
    isOllamaRuntimeArtifactConfigured() &&
    receipt.version === OLLAMA_RUNTIME_ARTIFACT.version &&
    receipt.fileName === OLLAMA_RUNTIME_ARTIFACT.fileName &&
    receipt.sha256 === OLLAMA_RUNTIME_ARTIFACT.sha256
  );
}
