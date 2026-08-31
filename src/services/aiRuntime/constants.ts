// ============================================================================
// AI runtime — shared constants (pure)
// ============================================================================

/** Stable id of the connection main synthesises for the managed Ollama. */
export const BUILTIN_OLLAMA_ID = 'builtin-ollama';

/** Stable id of the connection main synthesises for the managed image server. */
export const BUILTIN_SD_ID = 'builtin-sd';

/** Context the copilot asks a local model to allocate. ≈120K characters. */
export const DEFAULT_CONTEXT_TOKENS = 32_768;

/** Tools offered per turn, before the model sees any of them. */
export const DEFAULT_MAX_TOOLS = 16;
