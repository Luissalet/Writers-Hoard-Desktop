// ============================================================================
// Ghost text — asking the local model for one continuation
// ============================================================================
//
// The editor extension decides WHEN (a pause, a cursor at the end of a
// paragraph); this decides WITH WHAT: the Codex entries the recent text names,
// the project's own style brief, and a model that runs on this machine. Every
// call goes through the same gateway as the rest of the app's AI features, by
// connection id — the renderer never opens a socket to a model server — and a
// connection that is not on this computer is never chosen.

import { db } from '@/db';
import type { CodexEntry } from '@/types';
import type { EditorialProfile } from '@/types/editorial';
import { getEditorialProfile } from '@/services/editorialProfile';
import { aiApi, chatStream } from '@/services/aiRuntime/client';
import { DEFAULT_CONTEXT_TOKENS } from '@/services/aiRuntime/constants';
import type { AiChatMessage, AiRouteSelection } from '@/services/aiRuntime/types';
import { useAiRuntimeStore } from '@/stores/aiRuntimeStore';
import { useAiStore } from '@/stores/aiStore';
import {
  GHOST_MAX_TOKENS,
  buildGhostMessages,
  isLocalGhostConnection,
  isSuggestionComplete,
  pickGhostRoute,
  selectGhostCodexNotes,
  styleBriefFromProfile,
  trimSuggestion,
} from './ghostText';

const CODEX_TTL_MS = 15_000;
const codexCache = new Map<string, { at: number; entries: CodexEntry[] }>();

/** The project's Codex, read at most every few seconds however fast the writer pauses. */
async function codexFor(projectId: string): Promise<CodexEntry[]> {
  const hit = codexCache.get(projectId);
  if (hit && Date.now() - hit.at < CODEX_TTL_MS) return hit.entries;
  const entries = await db.codexEntries.where('projectId').equals(projectId).toArray();
  codexCache.set(projectId, { at: Date.now(), entries });
  return entries;
}

async function styleFor(projectId: string): Promise<string> {
  try {
    const profile: EditorialProfile = await getEditorialProfile(projectId);
    return styleBriefFromProfile(profile);
  } catch {
    return '';
  }
}

/** For tests and for "I just edited the Codex": forget what was cached. */
export function resetGhostTextCaches(): void {
  codexCache.clear();
  routeCache = null;
}

const ROUTE_TTL_MS = 60_000;
let routeCache: { at: number; key: string; route: AiRouteSelection } | null = null;

/** Which model answers — decided cheaply, because it sits inside the pause. */
async function resolveRoute(): Promise<AiRouteSelection | null> {
  const store = useAiRuntimeStore.getState();
  if (!store.connectionsLoaded) await store.loadConnections();
  if (!useAiRuntimeStore.getState().defaults.chat) await store.loadDefaults();
  const first = useAiRuntimeStore.getState();
  const key = JSON.stringify([first.defaults.chat, first.connections.map((c) => [c.id, c.enabled, c.locality])]);
  if (routeCache && routeCache.key === key && Date.now() - routeCache.at < ROUTE_TTL_MS) return routeCache.route;

  const route = await findRoute();
  if (route) routeCache = { at: Date.now(), key, route };
  return route;
}

async function findRoute(): Promise<AiRouteSelection | null> {
  const store = useAiRuntimeStore.getState();
  const chat = store.defaults.chat;
  // The writer's own chat model, when it is local: one connection to ask, and
  // no other server is even listed.
  const own = chat ? store.connections.find((c) => c.id === chat.connectionId && isLocalGhostConnection(c)) : undefined;
  if (chat && own) {
    await store.loadModels(own.id).catch(() => []);
    const only = pickGhostRoute({
      defaultChat: chat,
      connections: [own],
      modelsByConnection: useAiRuntimeStore.getState().modelsByConnection,
    });
    if (only && only.connectionId === chat.connectionId && only.modelId === chat.modelId) return only;
  }
  const local = useAiRuntimeStore.getState().connections.filter(isLocalGhostConnection);
  await Promise.all(local.map((connection) => store.loadModels(connection.id).catch(() => [])));
  const state = useAiRuntimeStore.getState();
  return pickGhostRoute({
    defaultChat: state.defaults.chat,
    connections: state.connections,
    modelsByConnection: state.modelsByConnection,
  });
}
/**
 * One streamed completion that stops as soon as it holds a sentence, and that
 * stops at once when `signal` aborts (a new keystroke): the gateway is told to
 * cancel and the answer is ignored from that moment.
 */
function streamContinuation(
  route: AiRouteSelection,
  messages: AiChatMessage[],
  before: string,
  signal: AbortSignal,
): Promise<string | null> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(null);
      return;
    }
    let accumulated = '';
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const handle = chatStream(
      {
        connectionId: route.connectionId,
        modelId: route.modelId,
        messages,
        maxTokens: GHOST_MAX_TOKENS,
        temperature: 0.7,
        // The same window every other feature asks for: a different one would
        // make the local server reload the model it already holds.
        contextTokens: DEFAULT_CONTEXT_TOKENS,
        disableThinking: true,
      },
      (event) => {
        if (settled) return;
        if (event.type === 'delta') {
          accumulated += event.text;
          if (isSuggestionComplete(accumulated, before)) {
            handle.cancel();
            finish(trimSuggestion(accumulated, before));
          }
        } else if (event.type === 'done') {
          finish(trimSuggestion(accumulated, before, { truncated: event.finishReason === 'length' }));
        } else if (event.type === 'error' || event.type === 'cancelled') {
          // A suggestion is a convenience: a model that is down is not an error to show.
          finish(null);
        }
      },
    );
    function onAbort(): void {
      handle.cancel();
      finish(null);
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export interface GhostRequest {
  projectId: string;
  /** Text before the cursor, already bounded. */
  before: string;
  signal: AbortSignal;
}

/** One continuation for the text before the cursor, or null (and nothing shown). */
export async function requestGhostContinuation({ projectId, before, signal }: GhostRequest): Promise<string | null> {
  if (signal.aborted || !aiApi() || !useAiStore.getState().config.enabled) return null;
  const route = await resolveRoute();
  if (!route || signal.aborted) return null;
  const [entries, style] = await Promise.all([codexFor(projectId), styleFor(projectId)]);
  if (signal.aborted) return null;
  const messages = buildGhostMessages({ before, notes: selectGhostCodexNotes(before, entries), style });
  return streamContinuation(route, messages, before, signal);
}